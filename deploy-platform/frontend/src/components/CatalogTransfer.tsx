import { useState } from 'react'
import { Button, Modal, Radio, Space, Table, Tag, Upload, message } from 'antd'
import { ExportOutlined, ImportOutlined } from '@ant-design/icons'
import { postLong } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

/** 导入预览：重名流水线需要用户选覆盖、新建副本或跳过。 */
export interface CatalogConflict {
  key: string
  project_code: string
  project_name: string
  name: string
  group_name: string
  existing_id?: number
}

export interface CatalogPreview {
  new_projects: { code: string; name: string; pipeline_count: number; can_create: boolean }[]
  conflicts: CatalogConflict[]
  creates: CatalogConflict[]
  skipped: { reason: string; project_code?: string; name?: string }[]
  conflict_count: number
  create_count: number
}

export interface CatalogImportResult {
  imported: number
  results: { key?: string; name?: string; project_code?: string; action: string; id?: number; reason?: string }[]
}

interface CatalogTransferButtonsProps {
  /** 不传则导出当前用户可见的全部项目和流水线 */
  projectId?: number
  /** 项目页勾选的流水线；空则导出整个项目（或全部） */
  pipelineIds?: number[]
  onImported?: () => void
}

type Decision = 'overwrite' | 'copy' | 'skip'

/** 把导出的 JSON 触发浏览器下载。 */
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 文件名里的时间戳，避免连续导出互相覆盖。 */
function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

/**
 * 项目列表和流水线页共用的导入导出。仅管理员可见。
 * 先预览再落地：重名流水线列出来，由用户选覆盖、新建 name_copy 或跳过。
 */
export default function CatalogTransferButtons({
  projectId,
  pipelineIds,
  onImported,
}: CatalogTransferButtonsProps) {
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [bundle, setBundle] = useState<unknown>(null)
  const [preview, setPreview] = useState<CatalogPreview | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})

  const exportLabel = pipelineIds?.length
    ? `导出选中（${pipelineIds.length}）`
    : projectId
      ? '导出本项目'
      : '导出全部'

  /** 按当前范围拉配置包并触发浏览器下载。 */
  const handleExport = async () => {
    setExporting(true)
    try {
      const data = await postLong(
        '/pipelines/export',
        {
          project_ids: projectId ? [projectId] : undefined,
          pipeline_ids: pipelineIds?.length ? pipelineIds : undefined,
        },
        120000,
      )
      const projects = (data as { projects?: unknown[] })?.projects || []
      if (!projects.length) {
        message.warning('没有可导出的项目或流水线')
        return
      }
      const name = pipelineIds?.length
        ? `rp-pipelines-${stamp()}.json`
        : projectId
          ? `rp-project-${stamp()}.json`
          : `rp-catalog-${stamp()}.json`
      downloadJson(name, data)
      message.success('已开始下载导出文件')
    } finally {
      setExporting(false)
    }
  }

  /** 读 JSON → 预览冲突。重名默认选新建副本，避免误覆盖。 */
  const handleFile = async (file: File) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(await file.text())
    } catch {
      message.error('不是有效的 JSON 文件')
      return false
    }
    setImporting(true)
    try {
      const data = await postLong<CatalogPreview>(
        '/pipelines/import/preview',
        { bundle: parsed },
        120000,
      )
      const initial: Record<string, Decision> = {}
      for (const row of data.conflicts) {
        initial[row.key] = 'copy'
      }
      setBundle(parsed)
      setPreview(data)
      setDecisions(initial)
      setPreviewOpen(true)
    } finally {
      setImporting(false)
    }
    return false
  }

  /** 把表格里所有冲突项设成同一种处理方式。 */
  const applyAll = (action: Decision) => {
    if (!preview) return
    const next: Record<string, Decision> = {}
    for (const row of preview.conflicts) {
      next[row.key] = action
    }
    setDecisions(next)
  }

  /** 按用户选择落地。冲突项必须每条都有 overwrite、copy 或 skip。 */
  const handleImport = async () => {
    if (!preview || !bundle) return
    const undecided = preview.conflicts.filter((c) => !decisions[c.key])
    if (undecided.length) {
      message.warning('请先为每条重名流水线选择覆盖、新建副本或跳过')
      return
    }
    setImporting(true)
    try {
      const res = await postLong<CatalogImportResult>(
        '/pipelines/import',
        { bundle, decisions },
        120000,
      )
      const skipped = (res.results || []).filter((r) => r.action === 'skip')
      const failed = (res.results || []).filter((r) => r.action === 'error')
      if (res.imported) {
        message.success(`已导入 ${res.imported} 条流水线`)
      }
      if (skipped.length) {
        message.info(`已跳过 ${skipped.length} 条同名流水线`)
      }
      if (failed.length) {
        message.warning(`${failed.length} 条未导入：${failed.map((f) => f.reason || f.action).join('；')}`)
      }
      if (!res.imported && !skipped.length && !failed.length) {
        message.warning('没有导入任何流水线')
      }
      setPreviewOpen(false)
      setBundle(null)
      setPreview(null)
      onImported?.()
    } finally {
      setImporting(false)
    }
  }

  const blockedProjects = (preview?.new_projects || []).filter((p) => !p.can_create)

  if (!isAdmin) return null

  return (
    <>
      <Space>
        <Button icon={<ExportOutlined />} loading={exporting} onClick={() => void handleExport()}>
          {exportLabel}
        </Button>
        <Upload accept=".json,application/json" showUploadList={false} beforeUpload={handleFile}>
          <Button icon={<ImportOutlined />} loading={importing}>
            导入
          </Button>
        </Upload>
      </Space>

      <Modal
        title="导入项目与流水线"
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        onOk={() => void handleImport()}
        confirmLoading={importing}
        okText="开始导入"
        width={820}
        destroyOnClose
      >
        {preview ? (
          <div>
            <p>
              将新建 {preview.create_count} 条流水线
              {preview.new_projects.length
                ? `，其中新项目 ${preview.new_projects.map((p) => p.name).join('、')}`
                : ''}
              {preview.conflict_count ? `；${preview.conflict_count} 条与现有同名，请选择处理方式` : ''}
              。
            </p>
            {blockedProjects.length ? (
              <p style={{ color: '#d4380d' }}>
                以下项目在本环境不存在，且当前账号不能新建项目，导入时会跳过：
                {blockedProjects.map((p) => `${p.name}（${p.code}）`).join('、')}
              </p>
            ) : null}
            {preview.skipped.length ? (
              <p>
                预览时跳过 {preview.skipped.length} 项
                {preview.skipped[0]?.reason ? `（${preview.skipped[0].reason}）` : ''}
              </p>
            ) : null}
            {preview.conflicts.length ? (
              <>
                <Space style={{ marginBottom: 8 }} wrap>
                  <Button size="small" onClick={() => applyAll('overwrite')}>
                    全部覆盖
                  </Button>
                  <Button size="small" onClick={() => applyAll('copy')}>
                    全部新建副本
                  </Button>
                  <Button size="small" onClick={() => applyAll('skip')}>
                    全部跳过
                  </Button>
                </Space>
                <Table
                  rowKey="key"
                  size="small"
                  pagination={false}
                  dataSource={preview.conflicts}
                  columns={[
                    { title: '项目', dataIndex: 'project_code', width: 120 },
                    { title: '流水线', dataIndex: 'name', ellipsis: true },
                    {
                      title: '环境',
                      dataIndex: 'group_name',
                      width: 100,
                      render: (v: string) => v || '—',
                    },
                    {
                      title: '处理方式',
                      width: 280,
                      render: (_: unknown, row: CatalogConflict) => (
                        <Radio.Group
                          value={decisions[row.key]}
                          onChange={(e) =>
                            setDecisions((prev) => ({ ...prev, [row.key]: e.target.value }))
                          }
                        >
                          <Radio value="overwrite">覆盖</Radio>
                          <Radio value="copy">新建 _copy</Radio>
                          <Radio value="skip">跳过</Radio>
                        </Radio.Group>
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <Tag color="green">没有重名流水线</Tag>
            )}
          </div>
        ) : null}
      </Modal>
    </>
  )
}
