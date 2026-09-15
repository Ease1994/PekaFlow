import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  Modal,
  Select,
  Switch,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd'
import {
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { get, post, postR, put } from '@/api/client'
import DataTable from '@/components/DataTable'
import type { Pipeline, Project } from '@/api/types'

const { Text, Paragraph } = Typography

interface DeployRequest {
  id: number
  project_id: number
  project_name: string
  pipeline_id: number | null
  pipeline_name: string
  title: string
  repo: string
  source_ref: string
  /** 列表接口不带正文（清单可能上千行），只在详情里返回 */
  changelog: string
  manifest: string
  manifest_count: number
  status: string
  status_label: string
  release_id: number | null
  /** 关联发布的实时进度，单子处于「发布中」时用它说明卡在哪一步 */
  release_status: string | null
  release_status_label: string | null
  release_build_number: number | null
  release_version: string | null
  release_started_at: string | null
  release_finished_at: string | null
  reject_reason: string
  created_by_name: string
  created_at: string | null
  can_release: boolean
  can_edit: boolean
  business_summary: string
  impact_scope: string
  iteration_tag: string
  planned_window: string
  audience: string
  need_user_notice: boolean
}

const STATUS_COLOR: Record<string, string> = {
  draft: 'default',
  submitted: 'processing',
  releasing: 'processing',
  released: 'success',
  release_failed: 'error',
  rejected: 'error',
  closed: 'default',
}

/** 单子还能不能发：草稿、待发布，以及发失败了要重发的 */
const RELEASABLE = ['draft', 'submitted', 'release_failed']

const fmtTime = (v: string | null) =>
  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : ''

const MANIFEST_PLACEHOLDER = `bin/*.dll
Areas/
Views/
Content/o2o-theme.css
!bin/*.pdb`

/**
 * 发布提交：开发人员报「这次要发哪些文件」，发布人员核对后一键发布。
 *
 * 老项目只能增量发，而开发不知道生产上的目录结构，只知道自己改了什么。
 * 这张单子就是两边的交接点，发布时清单会作为执行参数交给流水线。
 */
export default function DeployRequests() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  // 只记 id，内容从列表里现取，这样发布中的进度会跟着列表一起刷新
  const [detailId, setDetailId] = useState<number | null>(null)
  const [projectFilter, setProjectFilter] = useState<number | undefined>()
  const [page, setPage] = useState(1)
  const [form] = Form.useForm()

  // 换项目后条数会变，停在原页码可能直接是空表
  useEffect(() => {
    setPage(1)
  }, [projectFilter])

  const { data: requests = [], isFetching } = useQuery({
    queryKey: ['deploy-requests', projectFilter],
    queryFn: () =>
      get<DeployRequest[]>('/deploy-requests', projectFilter ? { project_id: projectFilter } : {}),
    // 有单子正在发布时自动刷新，不用手点
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === 'releasing') ? 5000 : false,
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<Project[]>('/projects'),
  })

  // 列表接口不带清单/日志正文（避免上百张单子把响应撑爆），详情抽屉必须再拉一次完整单子。
  // 之前抽屉直接拿列表数据，发布清单就变成空白。
  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['deploy-request', detailId],
    queryFn: () => get<DeployRequest>(`/deploy-requests/${detailId}`),
    enabled: detailId != null,
    refetchInterval: (q) =>
      q.state.data?.status === 'releasing' ? 5000 : false,
  })

  // 新建表单里选了项目才去查它的流水线。
  // 只列会消费发布清单的流水线：单子的价值全在清单上，选一条不读清单的
  // （Docker/K8s 整包发布那种），清单会静默失效，比报错还难查
  const selectedProject = Form.useWatch('project_id', form)
  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines', 'deploy-manifest', selectedProject],
    queryFn: () =>
      get<Pipeline[]>('/pipelines', { project_id: selectedProject, deploy_manifest: true }),
    enabled: !!selectedProject,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['deploy-requests'] })
    queryClient.invalidateQueries({ queryKey: ['deploy-request'] })
  }

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => post('/deploy-requests', values),
    onSuccess: () => {
      message.success('已提交')
      setCreateOpen(false)
      form.resetFields()
      refresh()
    },
  })

  const releaseMutation = useMutation({
    mutationFn: (req: DeployRequest) =>
      postR<{ release_id: number; status?: string; error?: string }>(`/deploy-requests/${req.id}/release`),
    onSuccess: (res, req) => {
      const data = res.data
      if (res.message && res.message !== 'ok' && (data?.status === 'failed' || data?.error)) {
        message.error(res.message, 8)
      } else {
        message.success(res.message && res.message !== 'ok' ? res.message : '已发起发布')
      }
      setDetailId(null)
      refresh()
      if (req.pipeline_id && data?.release_id) {
        navigate(`/executions/${req.pipeline_id}/${data.release_id}`)
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      post(`/deploy-requests/${id}/reject`, { reason }),
    onSuccess: () => {
      message.success('已驳回')
      setDetailId(null)
      refresh()
    },
  })

  const reopenMutation = useMutation({
    mutationFn: (id: number) => post(`/deploy-requests/${id}/reopen`),
    onSuccess: () => {
      message.success('已重新提交')
      setDetailId(null)
      refresh()
    },
  })

  const confirmRelease = async (req: DeployRequest) => {
    // 列表里没有清单正文，确认前单独取一次详情来预览
    let manifest = req.manifest
    if (!manifest) {
      try {
        manifest = (await get<DeployRequest>(`/deploy-requests/${req.id}`)).manifest
      } catch {
        manifest = '（清单读取失败，请打开详情确认）'
      }
    }
    Modal.confirm({
      title: `按提交单发布「${req.title}」`,
      width: 560,
      content: (
        <div>
          <Paragraph style={{ marginBottom: 8 }}>
            将用流水线「{req.pipeline_name}」执行发布，本单的清单会作为执行参数传给流水线。
          </Paragraph>
          <pre
            style={{
              background: '#fafafa',
              padding: 8,
              maxHeight: 180,
              overflow: 'auto',
              fontSize: 12,
            }}
          >
            {manifest}
          </pre>
        </div>
      ),
      okText: '确认发布',
      cancelText: '取消',
      onOk: () => releaseMutation.mutateAsync(req),
    })
  }

  const confirmReject = (req: DeployRequest) => {
    let reason = ''
    Modal.confirm({
      title: `驳回「${req.title}」`,
      content: (
        <Input.TextArea
          rows={3}
          placeholder="说明要改什么，提交人能看到"
          onChange={(e) => {
            reason = e.target.value
          }}
        />
      ),
      okText: '驳回',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => rejectMutation.mutateAsync({ id: req.id, reason }),
    })
  }

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, r: DeployRequest) => (
        <a onClick={() => setDetailId(r.id)}>{v}</a>
      ),
    },
    { title: '项目', dataIndex: 'project_name', width: 140 },
    {
      title: '发布流水线',
      dataIndex: 'pipeline_name',
      width: 160,
      render: (v: string) => v || <Text type="secondary">未选择</Text>,
    },
    {
      title: '文件条目',
      dataIndex: 'manifest_count',
      width: 90,
      render: (v: number) => v ?? 0,
    },
    { title: '提交人', dataIndex: 'created_by_name', width: 110 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 130,
      render: (v: string, r: DeployRequest) => (
        <>
          <Tag color={STATUS_COLOR[v] || 'default'}>{r.status_label}</Tag>
          {v === 'releasing' && r.release_status_label && (
            <div style={{ fontSize: 11, color: '#999', marginTop: 2 }}>
              {r.release_status_label}
            </div>
          )}
        </>
      ),
    },
    {
      title: '提交时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string | null) =>
        v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: '操作',
      width: 230,
      render: (_: unknown, r: DeployRequest) => (
        <Space>
          {r.can_release && RELEASABLE.includes(r.status) && (
            <Button
              size="small"
              type="primary"
              icon={<RocketOutlined />}
              onClick={() => confirmRelease(r)}
            >
              {r.status === 'release_failed' ? '重新发布' : '发布'}
            </Button>
          )}
          <Button
            size="small"
            icon={<FileTextOutlined />}
            onClick={() => setDetailId(r.id)}
          >
            发布详情
          </Button>
          {r.release_id && r.pipeline_id && (
            <Button
              size="small"
              onClick={() => navigate(`/executions/${r.pipeline_id}/${r.release_id}`)}
            >
              执行详情
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const projectOptions = useMemo(
    () => projects.map((p) => ({ value: p.id, label: p.name })),
    [projects],
  )

  return (
    <div>
      <Card
        title="发布提交"
        extra={
          <Space>
            <Select
              allowClear
              placeholder="按项目筛选"
              style={{ width: 180 }}
              options={projectOptions}
              value={projectFilter}
              onChange={setProjectFilter}
            />
            <Button icon={<ReloadOutlined />} onClick={refresh} loading={isFetching}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              提交发布
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="开发提单，发布人员核对后一键发布"
          description="填清楚这次要发哪些文件和改了什么；点「发布」时，清单会作为参数交给流水线去编译、打包、发到目标节点。"
          style={{ marginBottom: 16 }}
        />
        <DataTable
          chromeKey="deploy-requests"
          rowKey="id"
          columns={columns}
          dataSource={requests}
          pagination={{ current: page, onChange: setPage }}
          locale={{ emptyText: '还没有发布单' }}
        />
      </Card>

      <Modal
        title="提交发布"
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.validateFields().then((v) => createMutation.mutateAsync(v))}
        confirmLoading={createMutation.isPending}
        okText="提交"
        cancelText="取消"
        width={720}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item label="项目" name="project_id" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              placeholder="选择项目"
              options={projectOptions}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>

          <Form.Item
            label="发布流水线"
            name="pipeline_id"
            rules={[{ required: true, message: '请选择发布用的流水线' }]}
            extra={
              selectedProject && pipelines.length === 0
                ? '该项目下没有按清单增量发布的流水线（需含 pack-incremental 步骤），发布提交单只适用于这类流水线'
                : '只列按清单增量发布的流水线（Windows/IIS 那类）。发布人员点「发布」时执行它，清单会作为参数交给它挑文件打增量包'
            }
          >
            <Select
              placeholder={selectedProject ? '选择流水线' : '请先选择项目'}
              disabled={!selectedProject}
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
              showSearch
              optionFilterProp="label"
              notFoundContent="该项目下没有按清单增量发布的流水线"
            />
          </Form.Item>

          <Form.Item label="标题" name="title" rules={[{ required: true, message: '请填写标题' }]}>
            <Input placeholder="如：订单页样式修复 + 支付回调补偿" />
          </Form.Item>

          <Form.Item label="代码分支 / Tag / Commit" name="source_ref" extra="留空则用流水线默认分支">
            <Input placeholder="如：release/2026-08 或 a1b2c3d" />
          </Form.Item>

          <Form.Item
            label="发布清单"
            name="manifest"
            rules={[{ required: true, message: '请填写这次要发布哪些文件' }]}
            extra="一行一条，相对编译产物根目录；目录以 / 结尾表示整个递归，! 开头表示排除，# 开头是注释"
          >
            <Input.TextArea rows={7} placeholder={MANIFEST_PLACEHOLDER} />
          </Form.Item>

          <Form.Item label="更新日志" name="changelog" extra="这次改了什么，出问题时回查用">
            <Input.TextArea rows={4} placeholder="1. 修复订单列表分页错乱&#10;2. 支付回调增加重试" />
          </Form.Item>

          <Form.Item
            label="业务变更说明"
            name="business_summary"
            extra="对外能念的那几句，项目经理确认和上线通报用这个"
          >
            <Input.TextArea rows={3} placeholder="用户侧：订单列表分页不再错乱；商户侧无感知" />
          </Form.Item>
          <Form.Item label="影响范围" name="impact_scope">
            <Input placeholder="如：全部订单用户 / 仅华南商户" />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="迭代标签" name="iteration_tag" style={{ flex: 1 }}>
              <Input placeholder="如：8 月迭代" />
            </Form.Item>
            <Form.Item label="计划上线窗口" name="planned_window" style={{ flex: 1 }}>
              <Input placeholder="如：2026-08-29 22:00-23:00" />
            </Form.Item>
          </div>
          <Form.Item label="受众 / 要不要通知用户" style={{ marginBottom: 0 }}>
            <div className="rp-field-row">
              <Form.Item name="audience" style={{ flex: 1, marginBottom: 0 }}>
                <Input placeholder="影响谁，如：C 端用户" />
              </Form.Item>
              <Form.Item name="need_user_notice" valuePropName="checked" style={{ marginBottom: 0 }}>
                <Switch checkedChildren="需通知用户" unCheckedChildren="不通知用户" />
              </Form.Item>
            </div>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title={detail?.title || '发布详情'}
        open={detailId != null}
        onClose={() => setDetailId(null)}
        width={640}
        extra={
          detail && (
            <Space>
              {detail.status === 'rejected' && detail.can_edit && (
                <Button
                  loading={reopenMutation.isPending}
                  onClick={() => reopenMutation.mutateAsync(detail.id)}
                >
                  重新提交
                </Button>
              )}
              {detail.can_release && RELEASABLE.includes(detail.status) && (
                <>
                  {detail.status !== 'release_failed' && (
                    <Button danger loading={rejectMutation.isPending} onClick={() => confirmReject(detail)}>
                      驳回
                    </Button>
                  )}
                  {/* 连点会重复触发发布，同一个发布单能跑出好几条发布记录 */}
                  <Button
                    type="primary"
                    icon={<RocketOutlined />}
                    loading={releaseMutation.isPending}
                    onClick={() => confirmRelease(detail)}
                  >
                    {detail.status === 'release_failed' ? '重新发布' : '发布'}
                  </Button>
                </>
              )}
            </Space>
          )
        }
      >
        {detailLoading && !detail ? (
          <div style={{ textAlign: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : detail ? (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_COLOR[detail.status] || 'default'}>{detail.status_label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="项目">{detail.project_name}</Descriptions.Item>
              <Descriptions.Item label="发布流水线">
                {detail.pipeline_name || '未选择'}
              </Descriptions.Item>
              <Descriptions.Item label="代码版本">{detail.source_ref || '默认分支'}</Descriptions.Item>
              <Descriptions.Item label="提交人">{detail.created_by_name}</Descriptions.Item>
              <Descriptions.Item label="迭代">{detail.iteration_tag || '—'}</Descriptions.Item>
              <Descriptions.Item label="计划窗口">{detail.planned_window || '—'}</Descriptions.Item>
              <Descriptions.Item label="影响范围">{detail.impact_scope || '—'}</Descriptions.Item>
              <Descriptions.Item label="受众">{detail.audience || '—'}</Descriptions.Item>
              <Descriptions.Item label="通知用户">
                {detail.need_user_notice ? '需要' : '不需要'}
              </Descriptions.Item>
              {detail.reject_reason && (
                <Descriptions.Item label="驳回原因">
                  <Text type="danger">{detail.reject_reason}</Text>
                </Descriptions.Item>
              )}
            </Descriptions>

            {detail.release_id && (
              <Descriptions
                column={1}
                size="small"
                bordered
                title="本次发布"
                style={{ marginBottom: 16 }}
                extra={
                  detail.pipeline_id && (
                    <Button
                      size="small"
                      onClick={() =>
                        navigate(`/executions/${detail.pipeline_id}/${detail.release_id}`)
                      }
                    >
                      看执行步骤
                    </Button>
                  )
                }
              >
                <Descriptions.Item label="构建号">
                  #{detail.release_build_number ?? detail.release_id}
                  {detail.release_version && (
                    <Text type="secondary" style={{ marginLeft: 8 }}>
                      {detail.release_version}
                    </Text>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="执行状态">
                  {detail.release_status_label || detail.release_status}
                </Descriptions.Item>
                <Descriptions.Item label="开始时间">
                  {fmtTime(detail.release_started_at) || '尚未开始'}
                </Descriptions.Item>
                <Descriptions.Item label="结束时间">
                  {fmtTime(detail.release_finished_at) || '进行中'}
                </Descriptions.Item>
              </Descriptions>
            )}

            <Text strong>发布清单</Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                marginTop: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {detail.manifest}
            </pre>

            <Text strong>业务变更说明</Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                marginTop: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {detail.business_summary || '（未填写）'}
            </pre>

            <Text strong>更新日志</Text>
            <pre
              style={{
                background: '#fafafa',
                padding: 12,
                borderRadius: 4,
                fontSize: 12,
                marginTop: 8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {detail.changelog || '（未填写）'}
            </pre>
          </>
        ) : null}
      </Drawer>
    </div>
  )
}
