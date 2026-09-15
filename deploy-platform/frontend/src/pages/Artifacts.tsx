import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  Popconfirm,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd'
import DataTable from '@/components/DataTable'
import type { TablePaginationConfig } from 'antd'
import type { SorterResult } from 'antd/es/table/interface'
import {
  DeleteOutlined,
  DownloadOutlined,
  InboxOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { del, get, getBlob, post } from '@/api/client'
import type { Project } from '@/api/types'
import { envColor, envLabel, envOptions } from '@/env'

const { Text } = Typography

interface ArtifactRow {
  id: number
  pipeline_id: number
  release_id: number | null
  name: string
  type: string
  version: string
  sha256: string
  size_bytes: number | null
  created_at: string | null
  /** 归属信息，流水线已删除时为空 */
  pipeline_name: string
  project_id: number | null
  project_name: string
  group_name: string
  env: string
  build_number: number | null
}

interface ArtifactPage {
  items: ArtifactRow[]
  total: number
  total_bytes: number
  page: number
  page_size: number
}

interface ArtifactSummary {
  count: number
  total_bytes: number
  policy: { prod_retention_days: number; test_retention_days: number }
}

const TYPE_OPTIONS = [
  { value: 'iis-package', label: '增量发布包' },
  { value: 'zip', label: 'zip' },
  { value: 'jar', label: 'jar' },
  { value: 'war', label: 'war' },
  { value: 'docker', label: 'docker' },
]

function humanSize(bytes: number | null | undefined): string {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * 制品库：构建产出的包都在这儿，按流水线权限可见。
 *
 * 磁盘是会满的，所以这个页面的重点是「看清楚哪些包在占地方」并能批量清掉，
 * 同时把自动清理规则明写出来——否则包不见了没人知道是被谁删的。
 */
export default function Artifacts() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [projectFilter, setProjectFilter] = useState<number>()
  const [typeFilter, setTypeFilter] = useState<string>()
  const [envFilter, setEnvFilter] = useState<string>()
  const [keyword, setKeyword] = useState('')
  const [sort, setSort] = useState('created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [selected, setSelected] = useState<ArtifactRow[]>([])

  const query = {
    project_id: projectFilter,
    type: typeFilter,
    env: envFilter,
    keyword: keyword || undefined,
    sort,
    order,
    page,
    page_size: pageSize,
  }

  const { data, isFetching } = useQuery({
    queryKey: ['artifacts', query],
    queryFn: () => get<ArtifactPage>('/artifacts', query),
  })
  const { data: summary } = useQuery({
    queryKey: ['artifacts-summary'],
    queryFn: () => get<ArtifactSummary>('/artifacts/summary'),
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<Project[]>('/projects'),
  })

  const refresh = () => {
    setSelected([])
    queryClient.invalidateQueries({ queryKey: ['artifacts'] })
    queryClient.invalidateQueries({ queryKey: ['artifacts-summary'] })
  }

  const deleteMutation = useMutation({
    mutationFn: (ids: number[]) =>
      ids.length === 1
        ? del(`/artifacts/${ids[0]}`)
        : post('/artifacts/batch-delete', { ids }),
    onSuccess: () => {
      message.success('已删除')
      refresh()
    },
  })

  const download = async (row: ArtifactRow) => {
    try {
      const blob = await getBlob(`/artifacts/${row.id}/download`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = row.name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      // 拦截器已经弹过错误信息了
    }
  }

  const onTableChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<ArtifactRow> | SorterResult<ArtifactRow>[],
  ) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter
    if (s?.field && s.order) {
      setSort(s.field === 'size_bytes' ? 'size' : String(s.field))
      setOrder(s.order === 'ascend' ? 'asc' : 'desc')
    }
    setPage(pagination.current || 1)
    setPageSize(pagination.pageSize || 20)
  }

  const selectedBytes = useMemo(
    () => selected.reduce((sum, r) => sum + (r.size_bytes || 0), 0),
    [selected],
  )

  const columns = [
    {
      title: '制品',
      dataIndex: 'name',
      render: (v: string, r: ArtifactRow) => (
        <Space direction="vertical" size={0}>
          <Text strong>{v}</Text>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {r.type}
            {r.version ? ` · ${r.version}` : ''}
            {r.sha256 ? ` · ${r.sha256.slice(0, 12)}` : ''}
          </Text>
        </Space>
      ),
    },
    {
      title: '归属',
      dataIndex: 'pipeline_name',
      width: 260,
      render: (v: string, r: ArtifactRow) =>
        v ? (
          <Space direction="vertical" size={0}>
            <Space size={4}>
              <Text>{r.project_name}</Text>
              <Text type="secondary">/</Text>
              <a onClick={() => navigate(`/executions/${r.pipeline_id}`)}>{v}</a>
            </Space>
            <Space size={4}>
              {r.env && (
                <Tag color={envColor(r.env)} style={{ marginRight: 0 }}>
                  {envLabel(r.env)}
                </Tag>
              )}
              <Text type="secondary" style={{ fontSize: 11 }}>
                {r.group_name}
              </Text>
            </Space>
          </Space>
        ) : (
          <Tooltip title="产出它的流水线已被删除，这类制品会在下一次自动清理时回收">
            <Tag>流水线已删除</Tag>
          </Tooltip>
        ),
    },
    {
      title: '来源发布',
      dataIndex: 'build_number',
      width: 110,
      render: (v: number | null, r: ArtifactRow) =>
        v && r.pipeline_id ? (
          <a onClick={() => navigate(`/executions/${r.pipeline_id}/${r.release_id}`)}>#{v}</a>
        ) : (
          <Text type="secondary">手工登记</Text>
        ),
    },
    {
      title: '大小',
      dataIndex: 'size_bytes',
      width: 110,
      sorter: true,
      defaultSortOrder: undefined,
      render: (v: number | null) => humanSize(v),
    },
    {
      title: '产出时间',
      dataIndex: 'created_at',
      width: 170,
      sorter: true,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, r: ArtifactRow) => (
        <Space>
          <Button size="small" icon={<DownloadOutlined />} onClick={() => download(r)}>
            下载
          </Button>
          <Popconfirm
            title="删除这个制品？"
            description="文件会从磁盘上一并删除，不可恢复"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => deleteMutation.mutateAsync([r.id])}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const keepDays = summary?.policy.prod_retention_days ?? 10
  const testDays = summary?.policy.test_retention_days ?? 0

  return (
    <Card
      title={
        <Space>
          <InboxOutlined />
          制品库
        </Space>
      }
      extra={
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={isFetching}>
            刷新
          </Button>
        </Space>
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="制品会自动清理，别把它当长期存储"
        description={
          <>
            测试环境的包
            {testDays > 0 ? `保留 ${testDays} 天` : '只保留当天'}
            ，每天凌晨清理；生产按流水线保留最近 <b>{keepDays}</b> 天的包，更早的会清，但每条线至少留下最新 2 个，避免服务很久没发、回滚时包已经没了。
            需要长期留存的产物请另行归档。这里只列出你有权限的流水线产出的制品。
          </>
        }
      />

      <Space size="large" style={{ marginBottom: 16 }}>
        <Statistic title="可见制品" value={summary?.count ?? 0} suffix="个" />
        <Statistic title="占用空间" value={humanSize(summary?.total_bytes ?? 0)} />
        {selected.length > 0 && (
          <Statistic
            title="已选中"
            value={selected.length}
            suffix={`个 · ${humanSize(selectedBytes)}`}
            valueStyle={{ color: '#1677ff' }}
          />
        )}
      </Space>

      <Space wrap style={{ marginBottom: 12, width: '100%' }}>
        <Select
          allowClear
          placeholder="按项目筛选"
          style={{ width: 200 }}
          value={projectFilter}
          onChange={(v) => {
            setProjectFilter(v)
            setPage(1)
          }}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          showSearch
          optionFilterProp="label"
        />
        <Select
          allowClear
          placeholder="按环境筛选"
          style={{ width: 140 }}
          value={envFilter}
          onChange={(v) => {
            setEnvFilter(v)
            setPage(1)
          }}
          options={envOptions()}
        />
        <Select
          allowClear
          placeholder="按类型筛选"
          style={{ width: 160 }}
          value={typeFilter}
          onChange={(v) => {
            setTypeFilter(v)
            setPage(1)
          }}
          options={TYPE_OPTIONS}
        />
        <Input.Search
          allowClear
          placeholder="搜索制品名"
          style={{ width: 220 }}
          onSearch={(v) => {
            setKeyword(v)
            setPage(1)
          }}
        />
        <Popconfirm
          title={`删除选中的 ${selected.length} 个制品？`}
          description={`将释放 ${humanSize(selectedBytes)} 磁盘空间，文件不可恢复`}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          disabled={selected.length === 0}
          onConfirm={() => deleteMutation.mutateAsync(selected.map((r) => r.id))}
        >
          <Button
            danger
            icon={<DeleteOutlined />}
            disabled={selected.length === 0}
            loading={deleteMutation.isPending}
          >
            批量删除{selected.length > 0 ? `（${selected.length}）` : ''}
          </Button>
        </Popconfirm>
      </Space>

      <DataTable
        chromeKey="artifacts"
        rowKey="id"
        size="small"
        loading={isFetching}
        columns={columns}
        dataSource={data?.items || []}
        onChange={onTableChange}
        rowSelection={{
          selectedRowKeys: selected.map((r) => r.id),
          onChange: (_keys, rows) => setSelected(rows),
          // 「全选」只作用于当前页，跨页批量删太容易误操作
          selections: [Table.SELECTION_ALL, Table.SELECTION_INVERT, Table.SELECTION_NONE],
        }}
        pagination={{
          current: data?.page || page,
          pageSize: data?.page_size || pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (t) => `共计 ${t} 个制品，合计 ${humanSize(data?.total_bytes ?? 0)}`,
        }}
        locale={{
          emptyText: <Empty description="还没有制品，或者你没有相关流水线的权限" />,
        }}
      />
    </Card>
  )
}
