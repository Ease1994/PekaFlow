import { useState } from 'react'
import { Alert, Button, Card, Empty, Input, Modal, Space, Tabs, Tag, message } from 'antd'
import DataTable from '@/components/DataTable'
import { CheckOutlined, CloseOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { get, postR } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { ReleaseApproval } from '@/api/types'
import { envColor, envLabel } from '@/env'
import { useIsMobile } from '@/hooks/useIsMobile'

/** 审批弹窗要处理哪一张单、通过还是驳回、技术审批还是业务确认。 */
type DecideTarget = { id: number; approved: boolean; kind?: 'tech' | 'pm'; action?: string }

const STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
  cancelled: { color: 'default', text: '已失效' },
}

const RELEASE_STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  queued: { color: 'cyan', text: '排队中' },
  running: { color: 'processing', text: '执行中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
  rejected: { color: 'error', text: '已驳回' },
  cancelled: { color: 'default', text: '已取消' },
}

const ACTION_COLOR: Record<string, string> = {
  release: 'blue',
  rollback: 'orange',
  rebuild: 'cyan',
}

/**
 * 审批列表上的操作类型文案。回滚、Rebuild、普通发布必须一眼能分开。
 */
function actionNoun(action?: string) {
  if (action === 'rollback') return '回滚'
  if (action === 'rebuild') return 'Rebuild'
  return '发布'
}

/**
 * 这次要批的内容：发布看 commit 说明；回滚先写撤销哪次构建，再补 commit 或回滚计划。
 */
function changeText(row: ReleaseApproval) {
  const hash = (row.commit_short || (row.source_ref ? row.source_ref.slice(0, 8) : '')).trim()
  const title = (row.commit_title || '').trim()
  if (row.action === 'rollback') {
    const undo = row.rollback_of_build_number
      ? `撤销构建 #${row.rollback_of_build_number}`
      : '撤销上次发布'
    const extra = title ? [hash, title].filter(Boolean).join('  ') : (row.undo_summary || '').trim() || hash
    return extra ? `${undo} · ${extra}` : undo
  }
  return [hash, title].filter(Boolean).join('  ') || '-'
}

/**
 * 当前用户能不能点这张审批单的通过/驳回。
 * 优先信后端 can_decide；没有这个字段时按管理员或指定审批人兜底。
 */
function canDecideApproval(row: ReleaseApproval, userId?: number, isAdmin?: boolean) {
  return row.can_decide ?? (!!isAdmin || row.approver_id === userId)
}

/**
 * 窄屏审批卡片：流水线、类型、环境、这次要动的内容和通过/驳回。
 * 宽表在手机上会把操作列挤出屏幕，企微 H5 点进来后几乎没法批。
 */
function ApprovalMobileCards({
  rows,
  userId,
  isAdmin,
  onDecide,
  onOpenRelease,
}: {
  rows: ReleaseApproval[]
  userId?: number
  isAdmin?: boolean
  onDecide: (row: ReleaseApproval, approved: boolean) => void
  onOpenRelease: (row: ReleaseApproval) => void
}) {
  if (rows.length === 0) return <Empty description="暂无记录" />
  return (
    <div className="mobile-entity-list">
      {rows.map((row) => {
        const canDecide = canDecideApproval(row, userId, isAdmin)
        const ended = row.status === 'pending' && row.release_status !== 'pending'
        return (
          <div key={row.id} className="mobile-entity-card">
            <a className="mobile-entity-title" onClick={() => onOpenRelease(row)}>
              {row.pipeline_name || `${actionNoun(row.action)} #${row.build_number || row.release_id}`}
            </a>
            <div className="mobile-entity-meta">
              <Tag color={ACTION_COLOR[row.action || 'release']}>{row.action_label || actionNoun(row.action)}</Tag>
              {row.group_type ? <Tag color={envColor(row.group_type)}>{row.group_name || envLabel(row.group_type)}</Tag> : null}
              <Tag color={STATUS[row.status]?.color}>{STATUS[row.status]?.text || row.status}</Tag>
            </div>
            <div className="mobile-entity-meta">{changeText(row)}</div>
            <div className="mobile-entity-meta">
              {row.project_name ? <span>{row.project_name} · </span> : null}
              <span>发起人 {row.requester || '-'}</span>
              {row.is_self_approval ? <Tag color="blue">自审</Tag> : null}
            </div>
            {row.status === 'pending' && !ended && canDecide ? (
              <div className="mobile-entity-actions">
                <Space>
                  <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => onDecide(row, true)}>
                    通过
                  </Button>
                  <Button danger size="small" icon={<CloseOutlined />} onClick={() => onDecide(row, false)}>
                    驳回
                  </Button>
                </Space>
              </div>
            ) : (
              <div className="mobile-entity-meta">
                {ended ? `${actionNoun(row.action)}已结束` : canDecide ? null : `待 ${row.approver || '审批人'} 处理`}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 窄屏业务确认卡片。字段来自项目经理闸，和上面技术审批不是同一张表。
 */
function PmMobileCards({
  rows,
  onDecide,
}: {
  rows: any[]
  onDecide: (row: any, approved: boolean) => void
}) {
  if (rows.length === 0) {
    return (
      <div style={{ color: '#999', padding: 16 }}>
        没有待确认的上线。这道闸默认关着，项目打开「项目经理参与」后才会出现。
      </div>
    )
  }
  return (
    <div className="mobile-entity-list">
      {rows.map((r) => (
        <div key={r.id} className="mobile-entity-card">
          <div className="mobile-entity-title">{r.release?.pipeline_name || '待确认上线'}</div>
          <div className="mobile-entity-meta">{r.release?.project_name}</div>
          <div className="mobile-entity-meta">说明：{r.release?.business_summary || '未填写'}</div>
          <div className="mobile-entity-meta">窗口：{r.release?.planned_window || '未约'}</div>
          <div className="mobile-entity-actions">
            <Space>
              <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => onDecide(r, true)}>
                确认
              </Button>
              <Button danger size="small" icon={<CloseOutlined />} onClick={() => onDecide(r, false)}>
                驳回
              </Button>
            </Space>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ReleaseApprovalPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  /** 企微 H5 进来主要是审批，窄屏改卡片，不要再横滑 1500px 的表。 */
  const isMobile = useIsMobile()
  const tab = params.get('tab') || 'pending'
  /** 通知链接带 release_id，用来高亮刚提交的那张单。 */
  const focusReleaseId = Number(params.get('release_id') || 0) || 0
  const [target, setTarget] = useState<DecideTarget | null>(null)
  const [comment, setComment] = useState('')

  const { data: pending = [] } = useQuery({
    queryKey: ['release-approvals', 'pending'],
    queryFn: () => get<ReleaseApproval[]>('/approvals/pending', { scope: 'pending' }),
    refetchInterval: 10000,
  })
  const { data: mine = [] } = useQuery({
    queryKey: ['release-approvals', 'mine'],
    queryFn: () => get<ReleaseApproval[]>('/approvals/pending', { scope: 'mine' }),
    refetchInterval: 10000,
  })
  const { data: allRows = [] } = useQuery({
    queryKey: ['release-approvals', 'all'],
    queryFn: () => get<ReleaseApproval[]>('/approvals/pending', { scope: 'all' }),
    enabled: !!user?.is_admin,
    refetchInterval: 10000,
  })

  const { data: pmPending = [] } = useQuery({
    queryKey: ['pm-decisions', 'pending'],
    queryFn: () => get<any[]>('/pm/decisions', { scope: 'pending' }),
    refetchInterval: 10000,
  })

  const decideMut = useMutation({
    mutationFn: ({
      id,
      approved,
      comment: c,
      kind,
    }: {
      id: number
      approved: boolean
      comment: string
      kind?: 'tech' | 'pm'
      action?: string
    }) =>
      kind === 'pm'
        ? postR<{ status?: string }>(`/pm/decisions/${id}/decide`, { approved, comment: c })
        : postR<{ status?: string }>(`/approvals/${id}/decide`, { approved, comment: c }),
    onSuccess: (res, vars) => {
      // 审批过了不代表跑起来了：拆构建任务也可能失败（比如仓库凭证解不开）。
      // 这种情况后端返回成功 + 原因，别报「已进入执行」把人骗了
      const started = res.data?.status === 'running' || res.data?.status === 'queued'
      if (vars.approved && !started) {
        message.warning(res.message || `审批已通过，但${actionNoun(vars.action)}未能启动`, 8)
      } else {
        message.success(vars.approved ? `已通过，${actionNoun(vars.action)}进入执行` : '已驳回')
      }
      setTarget(null)
      setComment('')
      qc.invalidateQueries({ queryKey: ['release-approvals'] })
      qc.invalidateQueries({ queryKey: ['pm-decisions'] })
    },
    onError: () => {
      // 多半是这单子已经被处理过了，刷新一下让它从待办里消失，省得反复点
      qc.invalidateQueries({ queryKey: ['release-approvals'] })
      qc.invalidateQueries({ queryKey: ['pm-decisions'] })
    },
  })

  const columns = (opts: { review?: boolean }) => [
    { title: '单号', dataIndex: 'id', width: 70 },
    {
      title: '构建号',
      dataIndex: 'build_number',
      width: 90,
      render: (_: number | null | undefined, row: ReleaseApproval) =>
        row.pipeline_id ? (
          <a onClick={() => navigate(`/executions/${row.pipeline_id}/${row.release_id}`)}>
            #{row.build_number || row.release_id}
          </a>
        ) : (
          `#${row.build_number || row.release_id}`
        ),
    },
    { title: '项目', dataIndex: 'project_name', ellipsis: true },
    { title: '流水线', dataIndex: 'pipeline_name', ellipsis: true },
    {
      title: '环境',
      dataIndex: 'group_type',
      width: 100,
      render: (v: string, row: ReleaseApproval) => (
        <Tag color={envColor(v)}>{row.group_name || envLabel(v)}</Tag>
      ),
    },
    {
      title: '类型',
      dataIndex: 'action',
      width: 90,
      render: (v: string, row: ReleaseApproval) => (
        <Tag color={ACTION_COLOR[v || 'release']}>{row.action_label || actionNoun(v)}</Tag>
      ),
    },
    {
      title: '变更',
      key: 'change',
      width: 280,
      ellipsis: true,
      render: (_: unknown, row: ReleaseApproval) => (
        <span title={changeText(row)}>{changeText(row)}</span>
      ),
    },
    {
      title: '发起人',
      dataIndex: 'requester',
      width: 130,
      render: (v: string, row: ReleaseApproval) => (
        <Space size={4}>
          <span>{v || '-'}</span>
          {row.is_self_approval && <Tag color="blue">自审</Tag>}
        </Space>
      ),
    },
    { title: '审批人', dataIndex: 'approver', width: 180, ellipsis: true },
    {
      title: '审批状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => <Tag color={STATUS[v]?.color}>{STATUS[v]?.text || v}</Tag>,
    },
    {
      title: '发布状态',
      dataIndex: 'release_status',
      width: 100,
      render: (v: string) => <Tag color={RELEASE_STATUS[v]?.color}>{RELEASE_STATUS[v]?.text || v}</Tag>,
    },
    { title: '提交时间', dataIndex: 'created_at', width: 180 },
    { title: '审批意见', dataIndex: 'comment', ellipsis: true },
    ...(opts.review
      ? [
          {
            title: '操作',
            width: 170,
            fixed: 'right' as const,
                  render: (_: unknown, row: ReleaseApproval) => {
                    if (row.status !== 'pending') return null
                    // 发布已取消/结束时后端也会拒绝，别给一个必然报错的按钮
                    if (row.release_status !== 'pending') return <span style={{ color: '#999' }}>{actionNoun(row.action)}已结束</span>
                    const canDecide =
                      row.can_decide ?? (!!user?.is_admin || row.approver_id === user?.id)
                    if (!canDecide) {
                      return <span style={{ color: '#999' }}>待 {row.approver || '审批人'} 处理</span>
                    }
              return (
                <Space>
                  <Button
                    type="primary"
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => setTarget({ id: row.id, approved: true, action: row.action })}
                  >
                    通过
                  </Button>
                  <Button
                    danger
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={() => setTarget({ id: row.id, approved: false, action: row.action })}
                  >
                    驳回
                  </Button>
                </Space>
              )
            },
          },
        ]
      : []),
  ]

  /** 点流水线名进执行页；手机卡片和桌面表格共用。 */
  const openRelease = (row: ReleaseApproval) => {
    if (row.pipeline_id) navigate(`/executions/${row.pipeline_id}/${row.release_id}`)
  }

  /** 窄屏卡片、宽屏表格，数据源不变。 */
  const renderApprovals = (rows: ReleaseApproval[], chromeKey: string) =>
    isMobile ? (
      <ApprovalMobileCards
        rows={rows}
        userId={user?.id}
        isAdmin={!!user?.is_admin}
        onDecide={(row, approved) => setTarget({ id: row.id, approved, action: row.action })}
        onOpenRelease={openRelease}
      />
    ) : (
      <DataTable
        chromeKey={chromeKey}
        rowKey="id"
        size="small"
        scroll={{ x: 1680 }}
        columns={columns({ review: true })}
        dataSource={rows}
        rowClassName={(row: ReleaseApproval) =>
          focusReleaseId && row.release_id === focusReleaseId ? 'ant-table-row-selected' : ''
        }
      />
    )

  return (
    <div>
      {!isMobile && (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="生产发布审批"
        description={
          <>
            生产分组的发布会先进入待审批。同一发布是或签：有审批权的人谁先批谁算，
            待办里只出现一张单，审批人列会写上所有可批的人。分组开了「允许发起人自审」时，
            有审批权的发起人也能批自己的单。关掉则只能由其他人批。管理员在「待我审批」里能看到并处理所有还停着的单子。
            紧急情况可在执行流水线时勾选
            <ThunderboltOutlined style={{ color: '#fa8c16', margin: '0 4px' }} />
            应急跳审并填写原因，跳审会记录审计并通知审批人。
          </>
        }
      />
      )}

      <Card>
        <Tabs
          size={isMobile ? 'small' : 'middle'}
          activeKey={['pending', 'pm', 'mine', 'all'].includes(tab) ? tab : 'pending'}
          onChange={(k) => {
            const next = new URLSearchParams(params)
            next.set('tab', k)
            setParams(next, { replace: true })
          }}
          items={[
            {
              key: 'pending',
              label: `待我审批（${pending.length}）`,
              children: renderApprovals(pending, 'approval-pending'),
            },
            {
              key: 'pm',
              label: `待我业务确认（${pmPending.length}）`,
              children: isMobile ? (
                <PmMobileCards
                  rows={pmPending}
                  onDecide={(r, approved) => setTarget({ id: r.id, approved, kind: 'pm' })}
                />
              ) : pmPending.length === 0 ? (
                  <div style={{ color: '#999', padding: 16 }}>
                    没有待确认的上线。这道闸默认关着，项目打开「项目经理参与」后才会出现。
                  </div>
                ) : (
                  <DataTable
                    chromeKey="pm-pending"
                    rowKey="id"
                    size="small"
                    dataSource={pmPending}
                    columns={[
                      { title: '项目', render: (_: unknown, r: any) => r.release?.project_name },
                      { title: '流水线', render: (_: unknown, r: any) => r.release?.pipeline_name },
                      { title: '业务说明', render: (_: unknown, r: any) => r.release?.business_summary || '未填写' },
                      { title: '窗口', render: (_: unknown, r: any) => r.release?.planned_window || '未约' },
                      {
                        title: '操作',
                        width: 180,
                        render: (_: unknown, r: any) => (
                          <Space>
                            <Button
                              type="primary"
                              size="small"
                              icon={<CheckOutlined />}
                              onClick={() => setTarget({ id: r.id, approved: true, kind: 'pm' })}
                            >
                              确认
                            </Button>
                            <Button
                              danger
                              size="small"
                              icon={<CloseOutlined />}
                              onClick={() => setTarget({ id: r.id, approved: false, kind: 'pm' })}
                            >
                              驳回
                            </Button>
                          </Space>
                        ),
                      },
                    ]}
                  />
                ),
            },
            {
              key: 'mine',
              label: `我发起的（${mine.length}）`,
              children: renderApprovals(mine, 'approval-mine'),
            },
            ...(user?.is_admin
              ? [
                  {
                    key: 'all',
                    label: `全部记录（${allRows.length}）`,
                    children: renderApprovals(allRows, 'approval-all'),
                  },
                ]
              : []),
          ]}
        />
      </Card>

      <Modal
        title={
          target?.kind === 'pm'
            ? target?.approved
              ? '确认这次上线'
              : '驳回这次上线'
            : target?.approved
              ? `通过${actionNoun(target?.action)}`
              : `驳回${actionNoun(target?.action)}`
        }
        open={!!target}
        styles={{ content: { maxWidth: 'calc(100vw - 24px)' } }}
        onCancel={() => {
          setTarget(null)
          // 留着的话，下一条审批会带出上一条的意见，很容易顺手就提交了
          setComment('')
        }}
        confirmLoading={decideMut.isPending}
        okButtonProps={{
          danger: target?.approved === false,
          disabled: target?.approved === false && !comment.trim(),
        }}
        okText={target?.approved ? '确认通过' : '确认驳回'}
        onOk={() => {
          if (!target) return
          decideMut.mutate({
            id: target.id,
            approved: target.approved,
            comment,
            kind: target.kind,
            action: target.action,
          })
        }}
      >
        <p>
          {target?.kind === 'pm'
            ? target?.approved
              ? '确认的是范围和窗口。技术审批仍按原流程；两边都过了才会进队列。'
              : '驳回后这次发布结束。必须写原因。'
            : target?.approved
              ? `通过后该${actionNoun(target?.action)}立即进入执行队列（若还开着项目经理确认，会先等那边）。`
              : `驳回后该${actionNoun(target?.action)}结束，发起人需要重新发起。驳回必须填写原因。`}
        </p>
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={target?.approved ? '审批意见（可选）' : '驳回原因（必填）'}
        />
      </Modal>
    </div>
  )
}
