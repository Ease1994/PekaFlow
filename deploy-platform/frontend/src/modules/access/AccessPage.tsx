import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd'
import { AuditOutlined, CheckOutlined, CloseOutlined, StopOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/api/client'
import { envLabel } from '@/env'
import DataTable from '@/components/DataTable'
import { useAuthStore } from '@/stores/auth'

interface Catalog {
  projects: { id: number; name: string; code: string }[]
  groups: { id: number; name: string; type: string; project_id: number }[]
  pipelines: {
    id: number
    name: string
    project_id: number
    group_id: number
    project: string
    group: string
    env: string
  }[]
}

interface Application {
  id: number
  applicant_id: number
  applicant: string
  project_id: number
  group_id: number
  pipeline_id: number
  project_name: string
  group_name: string
  pipeline_name: string
  apply_type: string
  scope?: string
  scope_label?: string
  granted_actions: string
  reason: string
  status: string
  reviewer: string
  review_comment: string
  reviewed_at: string
  created_at: string
  source: string
}

const STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
  cancelled: { color: 'default', text: '已撤销' },
}

const SOURCE: Record<string, { color: string; text: string }> = {
  web: { color: 'default', text: '手动' },
  ai: { color: 'blue', text: 'AI助手' },
  api: { color: 'cyan', text: 'API' },
  cron: { color: 'purple', text: '定时' },
}

/** 申请覆盖范围：整项目 / 环境分组 / 单条流水线。 */
type ApplyScope = 'project' | 'group' | 'pipeline'

/** 可申请的动作。默认勾查看+执行。 */
const APPLY_ACTION_OPTIONS = [
  { value: 'read', label: '查看' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'execute', label: '执行' },
  { value: 'approve', label: '审批' },
  { value: 'approval_exempt', label: '豁免审批' },
]

/** 列表和审批弹窗用的范围名称。 */
function scopeLabel(row: Application): string {
  if (row.scope_label) return row.scope_label
  if (row.apply_type === 'project_execute') return '整项目'
  if (row.apply_type === 'group_execute') return '环境分组'
  return '流水线'
}

/** 通过后实际授予的范围说明。 */
function grantHint(row: Application | { apply_type?: string } | null, approved: boolean): string {
  if (!approved) return '驳回后申请人仍可重新提交。'
  const kind = row && 'apply_type' in row ? row.apply_type : ''
  const scope =
    kind === 'project_execute' ? '该项目（含当前和以后新建的流水线）' : kind === 'group_execute' ? '该环境分组' : '该流水线'
  return `通过后按拟授动作写入${scope}。单条流水线申请里的审批权会落到所属环境分组。`
}

export default function AccessPage() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [projectId, setProjectId] = useState<number>()
  const [groupId, setGroupId] = useState<number>()
  const [pipelineId, setPipelineId] = useState<number>()
  const [applyScope, setApplyScope] = useState<ApplyScope>('pipeline')
  const [reason, setReason] = useState('')
  /** 拟授动作；默认查看+执行。 */
  const [applyActions, setApplyActions] = useState<string[]>(['read', 'execute'])
  const [reviewTarget, setReviewTarget] = useState<{
    id: number
    approved: boolean
    apply_type: string
  } | null>(null)
  const [comment, setComment] = useState('')

  const { data: catalog } = useQuery({
    queryKey: ['access-catalog'],
    queryFn: () => get<Catalog>('/access/catalog'),
  })
  const { data: mine = [] } = useQuery({
    queryKey: ['access-applications', 'mine'],
    queryFn: () => get<Application[]>('/access/applications', { scope: 'mine' }),
  })
  const { data: pending = [] } = useQuery({
    queryKey: ['access-applications', 'pending'],
    queryFn: () => get<Application[]>('/access/applications', { scope: 'pending' }),
  })
  const { data: allRows = [] } = useQuery({
    queryKey: ['access-applications', 'all'],
    queryFn: () => get<Application[]>('/access/applications', { scope: 'all' }),
    enabled: !!user?.is_admin,
  })

  const groups = useMemo(
    () => (catalog?.groups || []).filter((g) => !projectId || g.project_id === projectId),
    [catalog, projectId],
  )
  const pipelines = useMemo(
    () =>
      (catalog?.pipelines || []).filter(
        (p) => (!projectId || p.project_id === projectId) && (!groupId || p.group_id === groupId),
      ),
    [catalog, projectId, groupId],
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['access-applications'] })
  }

  const applyMut = useMutation({
    mutationFn: () => {
      if (applyScope === 'project') {
        return post<Application>('/access/applications', { project_id: projectId, reason, actions: applyActions })
      }
      if (applyScope === 'group') {
        return post<Application>('/access/applications', { group_id: groupId, reason, actions: applyActions })
      }
      return post<Application>('/access/applications', { pipeline_id: pipelineId, reason, actions: applyActions })
    },
    onSuccess: (row) => {
      message.success(`已提交申请 #${row.id}，等待审批`)
      setReason('')
      invalidate()
    },
  })

  /** 当前范围是否已选齐必填项。 */
  const canSubmit =
    applyScope === 'project'
      ? !!projectId
      : applyScope === 'group'
        ? !!groupId
        : !!pipelineId

  const actMut = useMutation({
    mutationFn: ({ id, action, comment: c }: { id: number; action: 'approve' | 'reject' | 'cancel'; comment?: string }) =>
      post<Application>(`/access/applications/${id}/${action}`, action === 'cancel' ? undefined : { comment: c || '' }),
    onSuccess: () => {
      message.success('已处理')
      setReviewTarget(null)
      setComment('')
      invalidate()
    },
  })

  const columns = (opts: { review?: boolean; mine?: boolean }) => [
    { title: '单号', dataIndex: 'id', width: 70 },
    { title: '申请人', dataIndex: 'applicant', width: 120 },
    {
      title: '范围',
      width: 110,
      render: (_: unknown, row: Application) => <Tag>{scopeLabel(row)}</Tag>,
    },
    { title: '项目', dataIndex: 'project_name' },
    { title: '分组', dataIndex: 'group_name', width: 140 },
    { title: '流水线', dataIndex: 'pipeline_name' },
    {
      title: '拟授',
      dataIndex: 'granted_actions',
      width: 200,
      render: (v: string) => v || 'read,execute',
    },
    { title: '申请说明', dataIndex: 'reason', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string, row: Application) => (
        <Space>
          <Tag color={STATUS[s]?.color}>{STATUS[s]?.text || s}</Tag>
          {s === 'approved' && row.granted_actions && <Tag>已授 {row.granted_actions}</Tag>}
        </Space>
      ),
    },
    { title: '提交时间', dataIndex: 'created_at', width: 180 },
    {
      title: '触发',
      dataIndex: 'source',
      width: 90,
      render: (s: string) => <Tag color={SOURCE[s]?.color}>{SOURCE[s]?.text || s || '手动'}</Tag>,
    },
    { title: '审批人', dataIndex: 'reviewer', width: 100 },
    { title: '审批意见', dataIndex: 'review_comment', ellipsis: true },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, row: Application) => {
        if (row.status !== 'pending') return null
        if (opts.review) {
          return (
            <Space>
              <Button
                type="primary"
                size="small"
                icon={<CheckOutlined />}
                onClick={() => setReviewTarget({ id: row.id, approved: true, apply_type: row.apply_type })}
              >
                通过
              </Button>
              <Button
                danger
                size="small"
                icon={<CloseOutlined />}
                onClick={() => setReviewTarget({ id: row.id, approved: false, apply_type: row.apply_type })}
              >
                驳回
              </Button>
            </Space>
          )
        }
        if (opts.mine && row.applicant_id === user?.id) {
          return (
            <Button
              size="small"
              icon={<StopOutlined />}
              onClick={() => actMut.mutate({ id: row.id, action: 'cancel' })}
            >
              撤销
            </Button>
          )
        }
        return null
      },
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="申请权限"
        description="可选三种范围：整项目、某个环境分组、或某一条流水线。默认申请查看 + 执行；也可以勾选创建、更新、删除、审批、豁免审批。AI 助手里直接说「申请某某执行权限」或「申请某某全部权限」。"
      />

      <Card title={<><AuditOutlined /> 提交申请</>} style={{ marginBottom: 16 }}>
        <Form layout="vertical">
          <Form.Item label="申请范围" style={{ marginBottom: 16 }}>
            <Radio.Group
              value={applyScope}
              onChange={(e) => setApplyScope(e.target.value)}
              optionType="button"
              options={[
                { value: 'pipeline', label: '单条流水线' },
                { value: 'group', label: '整个环境' },
                { value: 'project', label: '整个项目' },
              ]}
            />
          </Form.Item>
          <Space wrap size="middle" style={{ width: '100%' }} align="start">
            <Form.Item label="项目" style={{ marginBottom: 0, minWidth: 220 }}>
              <Select
                allowClear
                placeholder="选择项目"
                value={projectId}
                onChange={(v) => {
                  setProjectId(v)
                  setGroupId(undefined)
                  setPipelineId(undefined)
                }}
                options={(catalog?.projects || []).map((p) => ({ value: p.id, label: p.name }))}
              />
            </Form.Item>
            {applyScope !== 'project' ? (
              <Form.Item label="分组" style={{ marginBottom: 0, minWidth: 220 }}>
                <Select
                  allowClear
                  placeholder="选择分组"
                  value={groupId}
                  onChange={(v) => {
                    setGroupId(v)
                    setPipelineId(undefined)
                  }}
                  options={groups.map((g) => ({
                    value: g.id,
                    label: `${g.name}（${envLabel(g.type)}）`,
                  }))}
                />
              </Form.Item>
            ) : null}
            {applyScope === 'pipeline' ? (
              <Form.Item label="流水线" style={{ marginBottom: 0, minWidth: 260 }}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="选择流水线"
                  value={pipelineId}
                  onChange={setPipelineId}
                  options={pipelines.map((p) => ({
                    value: p.id,
                    label: `${p.name}${p.env ? ` · ${envLabel(p.env)}` : ''}`,
                  }))}
                />
              </Form.Item>
            ) : null}
          </Space>
          <Form.Item label="申请权限" style={{ marginTop: 16 }}>
            <Checkbox.Group
              options={APPLY_ACTION_OPTIONS}
              value={applyActions}
              onChange={(v) => {
                const next = v as string[]
                if (!next.length) {
                  setApplyActions(['read', 'execute'])
                  return
                }
                setApplyActions(next.includes('read') ? next : ['read', ...next])
              }}
            />
          </Form.Item>
          <Form.Item label="申请说明" style={{ marginTop: 16, maxWidth: 720 }}>
            <Input.TextArea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="说明用途，便于审批人判断"
            />
          </Form.Item>
          <Button
            type="primary"
            disabled={!canSubmit}
            loading={applyMut.isPending}
            onClick={() => applyMut.mutate()}
          >
            提交申请
          </Button>
        </Form>
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'mine',
              label: `我的申请（${mine.length}）`,
              children: (
                <DataTable
                  chromeKey="access-mine"
                  rowKey="id"
                  size="small"
                  columns={columns({ mine: true })}
                  dataSource={mine}
                />
              ),
            },
            {
              key: 'pending',
              label: `待我审批（${pending.length}）`,
              children: (
                <DataTable
                  chromeKey="access-pending"
                  rowKey="id"
                  size="small"
                  columns={columns({ review: true })}
                  dataSource={pending}
                />
              ),
            },
            ...(user?.is_admin
              ? [
                  {
                    key: 'all',
                    label: `全部记录（${allRows.length}）`,
                    children: (
                      <DataTable
                        chromeKey="access-all"
                        rowKey="id"
                        size="small"
                        columns={columns({ review: true })}
                        dataSource={allRows}
                      />
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal
        title={reviewTarget?.approved ? '通过申请' : '驳回申请'}
        open={!!reviewTarget}
        onCancel={() => setReviewTarget(null)}
        onOk={() => {
          if (!reviewTarget) return
          actMut.mutate({
            id: reviewTarget.id,
            action: reviewTarget.approved ? 'approve' : 'reject',
            comment,
          })
        }}
        confirmLoading={actMut.isPending}
        okButtonProps={{ danger: reviewTarget?.approved === false }}
        okText={reviewTarget?.approved ? '确认通过' : '确认驳回'}
      >
        <p>{grantHint(reviewTarget, !!reviewTarget?.approved)}</p>
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="审批意见（可选）"
        />
      </Modal>
    </div>
  )
}
