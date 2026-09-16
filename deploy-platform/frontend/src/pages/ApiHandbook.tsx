import { useMemo, useState } from 'react'
import { Alert, Card, Collapse, Input, Space, Spin, Table, Tag, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/api/client'
import { useT } from '@/i18n'

const { Text, Paragraph } = Typography

/** OpenAPI 里一条操作（某个 path + method）。 */
interface OpenApiOp {
  tags?: string[]
  summary?: string
  description?: string
  operationId?: string
  parameters?: OpenApiParam[]
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: unknown }>
  }
  responses?: Record<string, { description?: string }>
}

/** OpenAPI 参数：路径 / 查询 / 头。 */
interface OpenApiParam {
  name?: string
  in?: string
  required?: boolean
  description?: string
  schema?: { type?: string; $ref?: string }
}

/** 后端 /meta/openapi 返回的文档。 */
interface OpenApiDoc {
  info?: { title?: string; version?: string; description?: string }
  tags?: { name: string; description?: string }[]
  paths?: Record<string, Record<string, unknown>>
}

/** 展平后的一条接口，供搜索和分组。 */
interface ApiRow {
  method: string
  path: string
  tag: string
  summary: string
  description: string
  op: OpenApiOp
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

const METHOD_COLOR: Record<string, string> = {
  get: 'green',
  post: 'blue',
  put: 'orange',
  patch: 'gold',
  delete: 'red',
  head: 'default',
  options: 'default',
}

/**
 * 从 $ref 或 type 里取出给人看的类型名。
 * 完整 JSON Schema 太长，手册页只需要知道「这是个整数还是个对象」。
 */
function schemaName(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return ''
  const s = schema as { type?: string; $ref?: string }
  if (s.$ref) {
    const parts = s.$ref.split('/')
    return parts[parts.length - 1] || s.$ref
  }
  return s.type || ''
}

/**
 * 把 OpenAPI paths 展成列表。只认标准 HTTP 方法，path 级的 parameters 会合并进操作。
 */
function flattenOps(doc: OpenApiDoc | undefined): ApiRow[] {
  const paths = doc?.paths || {}
  const rows: ApiRow[] = []
  for (const [path, item] of Object.entries(paths)) {
    if (!item || typeof item !== 'object') continue
    const pathItem = item as Record<string, unknown>
    const shared = Array.isArray(pathItem.parameters) ? (pathItem.parameters as OpenApiParam[]) : []
    for (const [method, raw] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue
      if (!raw || typeof raw !== 'object') continue
      const op = raw as OpenApiOp
      const tag = (op.tags && op.tags[0]) || ''
      rows.push({
        method: method.toLowerCase(),
        path,
        tag,
        summary: (op.summary || op.operationId || '').trim(),
        description: (op.description || '').trim(),
        op: {
          ...op,
          parameters: [...shared, ...(op.parameters || [])],
        },
      })
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))
  return rows
}

/**
 * 调用手册：登录后查看平台 HTTP 接口。
 *
 * 文档来自鉴权后的 /meta/openapi，不走 Nginx 上的 /docs。
 * 页面只展示方法、路径、参数和说明，真正调用仍要带 Token，权限不够会 403。
 */
export default function ApiHandbook() {
  const t = useT()
  const [keyword, setKeyword] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['openapi-handbook'],
    queryFn: () => get<OpenApiDoc>('/meta/openapi'),
  })

  const rows = useMemo(() => flattenOps(data), [data])
  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((row) => {
      const blob = `${row.method} ${row.path} ${row.tag} ${row.summary} ${row.description}`.toLowerCase()
      return blob.includes(q)
    })
  }, [rows, keyword])

  const tagDesc = useMemo(() => {
    const map: Record<string, string> = {}
    for (const tag of data?.tags || []) {
      if (tag.name) map[tag.name] = tag.description || ''
    }
    return map
  }, [data])

  const groups = useMemo(() => {
    const order: string[] = []
    const byTag = new Map<string, ApiRow[]>()
    for (const row of filtered) {
      const tag = row.tag || t('handbook.untagged')
      if (!byTag.has(tag)) {
        byTag.set(tag, [])
        order.push(tag)
      }
      byTag.get(tag)!.push(row)
    }
    return order.map((tag) => ({ tag, rows: byTag.get(tag) || [] }))
  }, [filtered, t])

  return (
    <Card title={t('menu.handbook')}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert type="info" showIcon message={t('handbook.authHint')} />
        <Input.Search
          allowClear
          placeholder={t('handbook.searchPh')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : filtered.length === 0 ? (
          <Text type="secondary">{t('handbook.noMatch')}</Text>
        ) : (
          groups.map((group) => (
            <div key={group.tag}>
              <Space align="baseline" style={{ marginBottom: 8 }}>
                <Text strong>{group.tag}</Text>
                <Text type="secondary">
                  {t('handbook.count', { n: group.rows.length })}
                </Text>
              </Space>
              {tagDesc[group.tag] ? (
                <Paragraph type="secondary" style={{ marginTop: 0 }}>
                  {tagDesc[group.tag]}
                </Paragraph>
              ) : null}
              <Collapse
                items={group.rows.map((row) => ({
                  key: `${row.method} ${row.path}`,
                  label: (
                    <Space wrap size={8}>
                      <Tag color={METHOD_COLOR[row.method] || 'default'} style={{ marginInlineEnd: 0, minWidth: 56, textAlign: 'center' }}>
                        {row.method.toUpperCase()}
                      </Tag>
                      <Text code>{row.path}</Text>
                      <Text type="secondary">{row.summary}</Text>
                    </Space>
                  ),
                  children: <OpDetail row={row} />,
                }))}
              />
            </div>
          ))
        )}
      </Space>
    </Card>
  )
}

/**
 * 展开后的参数、请求体、响应码。缺的块不渲染，避免空表占地方。
 */
function OpDetail({ row }: { row: ApiRow }) {
  const t = useT()
  const params = row.op.parameters || []
  const jsonSchema = row.op.requestBody?.content?.['application/json']?.schema
  const responses = Object.entries(row.op.responses || {})

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {row.description ? <Paragraph style={{ marginBottom: 0 }}>{row.description}</Paragraph> : null}
      {params.length > 0 ? (
        <div>
          <Text strong>{t('handbook.params')}</Text>
          <Table
            size="small"
            pagination={false}
            rowKey={(p, i) => `${p.in}-${p.name}-${i}`}
            style={{ marginTop: 8 }}
            columns={[
              { title: t('common.name'), dataIndex: 'name', width: 160 },
              {
                title: t('handbook.location'),
                dataIndex: 'in',
                width: 90,
                render: (v: string) => v || '',
              },
              {
                title: t('handbook.required'),
                dataIndex: 'required',
                width: 80,
                render: (v: boolean) => (v ? t('handbook.yes') : t('handbook.optional')),
              },
              {
                title: t('handbook.type'),
                width: 140,
                render: (_: unknown, p: OpenApiParam) => schemaName(p.schema),
              },
              { title: t('common.description'), dataIndex: 'description', ellipsis: true },
            ]}
            dataSource={params}
          />
        </div>
      ) : null}
      {jsonSchema ? (
        <div>
          <Text strong>{t('handbook.body')}</Text>
          <pre
            style={{
              marginTop: 8,
              marginBottom: 0,
              maxHeight: 280,
              overflow: 'auto',
              padding: 12,
              background: '#f5f5f5',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            {JSON.stringify(jsonSchema, null, 2)}
          </pre>
        </div>
      ) : null}
      {responses.length > 0 ? (
        <div>
          <Text strong>{t('handbook.responses')}</Text>
          <Table
            size="small"
            pagination={false}
            rowKey={(r) => r.code}
            style={{ marginTop: 8 }}
            columns={[
              { title: t('common.status'), dataIndex: 'code', width: 100 },
              { title: t('common.description'), dataIndex: 'description' },
            ]}
            dataSource={responses.map(([code, body]) => ({
              code,
              description: body?.description || '',
            }))}
          />
        </div>
      ) : null}
    </Space>
  )
}
