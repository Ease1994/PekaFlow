import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Calendar,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  message,
} from 'antd'
import DataTable from '@/components/DataTable'
import {
  AuditOutlined,
  CheckOutlined,
  CloseOutlined,
  ReloadOutlined,
  ScheduleOutlined,
  SoundOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Dayjs } from 'dayjs'
import { get, post, postR } from '@/api/client'
import { envColor, envLabel } from '@/env'
import { useAuthStore } from '@/stores/auth'

const { Text, Paragraph } = Typography

interface Blocker {
  kind: string
  label: string
  owner_ids: number[]
}

interface ReleaseCard {
  id: number
  pipeline_id: number
  pipeline_name: string
  project_id: number | null
  project_name: string
  group_name: string
  group_type: string
  build_number: number
  version: string
  status: string
  operator_name: string
  business_summary: string
  impact_scope: string
  iteration_tag: string
  planned_window: string
  audience: string
  need_user_notice: boolean
  announced_at: string
  blocker: Blocker
  created_at: string
}

interface PlannedItem {
  id: number
  title: string
  project_name: string
  pipeline_name: string
  business_summary: string
  iteration_tag: string
  planned_window: string
  status: string
}

interface Stability {
  project_id: number
  project_name: string
  days: number
  total: number
  success: number
  failed: number
  rolled_back: number
  success_rate: number
  plain: string
}

interface Decision {
  id: number
  status: string
  reviewer: string
  release: ReleaseCard
}

interface Workbench {
  projects: { id: number; name: string; pm_enabled: boolean; is_pm: boolean }[]
  in_progress: ReleaseCard[]
  planned: PlannedItem[]
  recent: ReleaseCard[]
  calendar: { id: string; date: string; title: string; env: string; status: string; window: string; kind: string; release_id?: number; pipeline_id?: number }[]
  stability: Stability[]
  pending_mine: Decision[]
  is_pm: boolean
}

const STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待确认/待审批' },
  queued: { color: 'cyan', text: '排队中' },
  assigned: { color: 'cyan', text: '已派发' },
  running: { color: 'processing', text: '执行中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
  rejected: { color: 'error', text: '已驳回' },
  cancelled: { color: 'default', text: '已取消' },
  rolling_back: { color: 'gold', text: '回滚中' },
  rolled_back: { color: 'purple', text: '已回滚' },
}

function StatusTag({ status }: { status: string }) {
  const s = STATUS[status] || { color: 'default', text: status }
  return <Tag color={s.color}>{s.text}</Tag>
}

type CalItem = NonNullable<Workbench['calendar']>[number]

function dayMarkColor(items: CalItem[]): string | undefined {
  if (!items.length) return undefined
  const statuses = items.map((i) => i.status)
  if (statuses.some((s) => s === 'failed' || s === 'rejected')) return '#ff4d4f'
  if (statuses.some((s) => ['running', 'queued', 'pending', 'assigned', 'rolling_back'].includes(s))) {
    return '#fa8c16'
  }
  if (statuses.some((s) => s === 'success' || s === 'rolled_back')) return '#52c41a'
  return '#1677ff'
}

export default function PmWorkbench() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [params, setParams] = useSearchParams()
  const projectId = params.get('project') ? Number(params.get('project')) : undefined
  const [decide, setDecide] = useState<{ id: number; approved: boolean } | null>(null)
  const [comment, setComment] = useState('')
  const [announce, setAnnounce] = useState<ReleaseCard | null>(null)
  const [announceText, setAnnounceText] = useState('')

  const { data, isFetching } = useQuery({
    queryKey: ['pm-workbench', projectId],
    queryFn: () => get<Workbench>('/pm/workbench', projectId ? { project_id: projectId } : undefined),
    refetchInterval: 15000,
  })

  const decideMut = useMutation({
    mutationFn: ({ id, approved, comment: c }: { id: number; approved: boolean; comment: string }) =>
      postR(`/pm/decisions/${id}/decide`, { approved, comment: c }),
    onSuccess: (res, vars) => {
      message.success(res.message || (vars.approved ? '已确认' : '已驳回'))
      setDecide(null)
      setComment('')
      qc.invalidateQueries({ queryKey: ['pm-workbench'] })
      qc.invalidateQueries({ queryKey: ['pm-decisions'] })
    },
  })

  const announceMut = useMutation({
    mutationFn: ({ id, text }: { id: number; text: string }) =>
      post(`/pm/releases/${id}/announce`, { text }),
    onSuccess: () => {
      message.success('已发送通报')
      setAnnounce(null)
      qc.invalidateQueries({ queryKey: ['pm-workbench'] })
    },
  })

  const openAnnounce = async (row: ReleaseCard) => {
    const draft = await get<{ text: string }>(`/pm/releases/${row.id}/announcement`)
    setAnnounce(row)
    setAnnounceText(draft.text)
  }

  const calMap = useMemo(() => {
    const m = new Map<string, NonNullable<Workbench['calendar']>>()
    for (const item of data?.calendar || []) {
      if (!item.date) continue
      const list = m.get(item.date) || []
      list.push(item)
      m.set(item.date, list)
    }
    return m
  }, [data])

  const recentColumns = [
    {
      title: '项目 / 流水线',
      render: (_: unknown, r: ReleaseCard) => (
        <a onClick={() => navigate(`/executions/${r.pipeline_id}/${r.id}`)}>
          {r.pipeline_name} #{r.build_number}
        </a>
      ),
    },
    {
      title: '环境',
      width: 80,
      render: (_: unknown, r: ReleaseCard) => (
        <Tag color={envColor(r.group_type)}>{envLabel(r.group_type) || r.group_name}</Tag>
      ),
    },
    {
      title: '状态',
      width: 88,
      render: (_: unknown, r: ReleaseCard) => <StatusTag status={r.status} />,
    },
    {
      title: '',
      width: 80,
      render: (_: unknown, r: ReleaseCard) =>
        (data?.is_pm || user?.is_admin) && ['success', 'rolled_back', 'failed'].includes(r.status) ? (
          <Button size="small" icon={<SoundOutlined />} onClick={() => openAnnounce(r)}>
            通报
          </Button>
        ) : null,
    },
  ]

  const columns = [
    {
      title: '项目 / 流水线',
      render: (_: unknown, r: ReleaseCard) => (
        <div>
          <div>
            <a onClick={() => navigate(`/executions/${r.pipeline_id}/${r.id}`)}>
              {r.project_name} / {r.pipeline_name} #{r.build_number}
            </a>
          </div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {r.operator_name} · {r.iteration_tag || '未标迭代'}
          </Text>
        </div>
      ),
    },
    {
      title: '环境',
      width: 90,
      render: (_: unknown, r: ReleaseCard) => (
        <Tag color={envColor(r.group_type)}>{envLabel(r.group_type) || r.group_name}</Tag>
      ),
    },
    {
      title: '业务说明',
      render: (_: unknown, r: ReleaseCard) => r.business_summary || <Text type="secondary">未填写</Text>,
    },
    {
      title: '现在卡在',
      width: 220,
      render: (_: unknown, r: ReleaseCard) => r.blocker?.label || '—',
    },
    {
      title: '状态',
      width: 120,
      render: (_: unknown, r: ReleaseCard) => <StatusTag status={r.status} />,
    },
    {
      title: '窗口',
      width: 140,
      dataIndex: 'planned_window',
    },
    {
      title: '',
      width: 140,
      render: (_: unknown, r: ReleaseCard) =>
        (data?.is_pm || user?.is_admin) && ['success', 'rolled_back', 'failed'].includes(r.status) ? (
          <Button size="small" icon={<SoundOutlined />} onClick={() => openAnnounce(r)}>
            通报
          </Button>
        ) : null,
    },
  ]

  return (
    <div>
      <Card
        title={
          <Space>
            <ScheduleOutlined />
            项目工作台
          </Space>
        }
        extra={
          <Space>
            <Select
              allowClear
              placeholder="全部项目"
              style={{ width: 220 }}
              value={projectId}
              options={(data?.projects || []).map((p) => ({
                value: p.id,
                label: p.is_pm ? `${p.name}（我是项目经理）` : p.name,
              }))}
              onChange={(id) => {
                const next = new URLSearchParams(params)
                if (id) next.set('project', String(id))
                else next.delete('project')
                setParams(next)
              }}
            />
            <Button icon={<ReloadOutlined />} onClick={() => qc.invalidateQueries({ queryKey: ['pm-workbench'] })} loading={isFetching}>
              刷新
            </Button>
          </Space>
        }
        style={{ marginBottom: 16 }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="按项目看发布，不进编排器。生产审批仍按原流程；这里多出来的确认默认是关着的。"
        />
        <Row gutter={16}>
          {(data?.stability || []).map((s) => (
            <Col key={s.project_id} xs={24} md={8}>
              <Card size="small" style={{ marginBottom: 12 }}>
                <Statistic title={s.project_name} value={s.success_rate} suffix="%" />
                <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                  {s.plain}
                </Paragraph>
              </Card>
            </Col>
          ))}
          {!data?.stability?.length ? (
            <Col span={24}>
              <Empty description="还没有最近的发布，稳定性会在有数据后出现" />
            </Col>
          ) : null}
        </Row>
      </Card>

      {(data?.pending_mine || []).length > 0 && (
        <Card title={`待我确认（${data?.pending_mine.length}）`} style={{ marginBottom: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {data?.pending_mine.map((d) => (
              <Card key={d.id} size="small">
                <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                  <Descriptions.Item label="发布">
                    {d.release.project_name} / {d.release.pipeline_name} #{d.release.build_number}
                  </Descriptions.Item>
                  <Descriptions.Item label="环境">
                    <Tag color={envColor(d.release.group_type)}>{envLabel(d.release.group_type)}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="业务说明" span={2}>
                    {d.release.business_summary || '尚未填写'}
                  </Descriptions.Item>
                  <Descriptions.Item label="影响">{d.release.impact_scope || '—'}</Descriptions.Item>
                  <Descriptions.Item label="窗口">{d.release.planned_window || '未约'}</Descriptions.Item>
                </Descriptions>
                <Space style={{ marginTop: 12 }}>
                  <Button
                    type="primary"
                    icon={<CheckOutlined />}
                    onClick={() => setDecide({ id: d.id, approved: true })}
                  >
                    确认今晚可以上
                  </Button>
                  <Button danger icon={<CloseOutlined />} onClick={() => setDecide({ id: d.id, approved: false })}>
                    驳回
                  </Button>
                  <Button
                    icon={<AuditOutlined />}
                    onClick={() => navigate(`/executions/${d.release.pipeline_id}/${d.release.id}`)}
                  >
                    看执行
                  </Button>
                </Space>
              </Card>
            ))}
          </Space>
        </Card>
      )}

      <Card title="进行中" style={{ marginBottom: 16 }}>
        <DataTable
          chromeKey="pm-in-progress"
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={data?.in_progress || []}
          pagination={false}
          locale={{ emptyText: '当前没有进行中的发布' }}
        />
      </Card>

      <Card title="计划中（已提单未发）" style={{ marginBottom: 16 }}>
        <DataTable
          chromeKey="pm-planned"
          rowKey="id"
          size="small"
          dataSource={data?.planned || []}
          pagination={false}
          locale={{ emptyText: '没有待发的提交单' }}
          columns={[
            { title: '项目', dataIndex: 'project_name', width: 140 },
            { title: '标题', dataIndex: 'title' },
            { title: '流水线', dataIndex: 'pipeline_name', width: 160 },
            {
              title: '业务说明',
              render: (_: unknown, r: PlannedItem) => r.business_summary || <Text type="secondary">未填写</Text>,
            },
            { title: '迭代', dataIndex: 'iteration_tag', width: 120 },
            { title: '窗口', dataIndex: 'planned_window', width: 160 },
            {
              title: '操作',
              width: 100,
              render: (_: unknown, r: PlannedItem) => (
                <Button size="small" onClick={() => navigate('/deploy-requests')}>
                  去提交单
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card title="最近完成">
            <DataTable
              chromeKey="pm-recent"
              rowKey="id"
              size="small"
              columns={recentColumns}
              dataSource={data?.recent || []}
              pagination={{ pageSize: 5, size: 'small', showSizeChanger: false, showTotal: (n) => `共 ${n} 条` }}
              locale={{ emptyText: '这一周还没有完成的发布' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="发布日历">
            <Calendar
              fullscreen={false}
              fullCellRender={(value: Dayjs, info) => {
                if (info.type !== 'date') return info.originNode
                const key = value.format('YYYY-MM-DD')
                const items = calMap.get(key) || []
                const mark = dayMarkColor(items)
                return (
                  <div
                    className="ant-picker-calendar-date"
                    title={items.map((it) => it.title).join('\n')}
                    style={{ minHeight: 36, padding: '4px 0' }}
                  >
                    <div
                      className="ant-picker-calendar-date-value"
                      style={
                        mark
                          ? {
                              display: 'inline-block',
                              width: 26,
                              height: 26,
                              lineHeight: '26px',
                              borderRadius: '50%',
                              background: mark,
                              color: '#fff',
                              fontWeight: 600,
                            }
                          : undefined
                      }
                    >
                      {value.date()}
                    </div>
                  </div>
                )
              }}
              onSelect={(value: Dayjs) => {
                const items = calMap.get(value.format('YYYY-MM-DD')) || []
                const rel = items.find((i) => i.release_id && i.pipeline_id)
                if (rel?.release_id && rel.pipeline_id) {
                  navigate(`/executions/${rel.pipeline_id}/${rel.release_id}`)
                }
              }}
            />
            <Space size={12} wrap style={{ marginTop: 8 }}>
              <Text type="secondary"><span style={{ color: '#52c41a' }}>●</span> 成功</Text>
              <Text type="secondary"><span style={{ color: '#fa8c16' }}>●</span> 进行中</Text>
              <Text type="secondary"><span style={{ color: '#ff4d4f' }}>●</span> 失败</Text>
              <Text type="secondary"><span style={{ color: '#1677ff' }}>●</span> 计划</Text>
            </Space>
            <div>
              <Text type="secondary">点色块日期可跳到执行详情。悬停可看名称。</Text>
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title={decide?.approved ? '确认这次上线' : '驳回这次上线'}
        open={!!decide}
        onCancel={() => {
          setDecide(null)
          setComment('')
        }}
        confirmLoading={decideMut.isPending}
        okButtonProps={{ danger: decide?.approved === false, disabled: decide?.approved === false && !comment.trim() }}
        okText={decide?.approved ? '确认' : '驳回'}
        onOk={() => decide && decideMut.mutate({ id: decide.id, approved: decide.approved, comment })}
      >
        <p>
          {decide?.approved
            ? '确认的是范围和窗口。技术审批仍按原流程；两边都过了才会进队列。'
            : '驳回后这次发布结束。必须写原因。'}
        </p>
        <Input.TextArea
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={decide?.approved ? '意见（可选）' : '驳回原因（必填）'}
        />
      </Modal>

      <Modal
        title="上线通报"
        open={!!announce}
        onCancel={() => setAnnounce(null)}
        confirmLoading={announceMut.isPending}
        okText="发送"
        onOk={() => announce && announceMut.mutate({ id: announce.id, text: announceText })}
      >
        <Paragraph type="secondary">发给项目经理、发起人，并按平台设置推企微/邮件。可改再发。</Paragraph>
        <Input.TextArea rows={8} value={announceText} onChange={(e) => setAnnounceText(e.target.value)} />
      </Modal>
    </div>
  )
}
