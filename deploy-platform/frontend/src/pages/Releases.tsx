import { Card, Tag, Button, Space, Statistic, Row, Col, Modal, Empty, message, Drawer, Tooltip, DatePicker, Select, Form, Alert, Typography, Tabs } from 'antd'
import DataTable from '@/components/DataTable'
import { CheckCircleOutlined, PlayCircleOutlined, FileTextOutlined, FilterOutlined, UnorderedListOutlined, EditOutlined, UserOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useState, useEffect, useMemo } from 'react'
import dayjs from 'dayjs'
const { Text } = Typography
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, postR } from '@/api/client'
import { agentDisplay } from '@/utils/agentLabel'
import { useAuthStore } from '@/stores/auth'
import { useReleaseLogStream, useTaskLogStream } from '@/hooks/useTaskLogStream'
import type { Paged, Release, Pipeline, Project, UserInfo as User } from '@/api/types'
import ExecuteReleaseButton from '@/components/ExecuteReleaseButton'
import RiskActionButton from '@/components/RiskActionButton'
import { sequenceHeaderMeta } from '@/utils/releaseStatus'

const statusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  queued: { color: 'cyan', text: '排队中' },
  running: { color: 'processing', text: '执行中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
  rejected: { color: 'error', text: '审批驳回' },
  rolling_back: { color: 'warning', text: '回滚中' },
  rolled_back: { color: 'default', text: '已回滚' },
}

const strategyMap: Record<string, string> = {
  rolling: '滚动发布',
  'blue-green': '蓝绿发布',
  gray: '灰度发布',
  all: '全量发布',
}

export default function Releases() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const user = useAuthStore((s) => s.user)
  const [activeLogId, setActiveLogId] = useState<number | null>(null)
  const { lines: logLines, done: logDone } = useReleaseLogStream(activeLogId)
  // 序列详情 Drawer（蓝盾左中右风格：序列 + 步骤日志）
  const [activeDetailId, setActiveDetailId] = useState<number | null>(null)
  const [selectedStep, setSelectedStep] = useState<{ taskId: number; stepOrder: number } | null>(null)
  // 蓝盾风格的多维筛选（日期/项目/流水线/发布人/状态/触发方式）
  const [fDate, setFDate] = useState<[string, string] | null>(null)
  const [fProject, setFProject] = useState<number | undefined>()
  const [fPipeline, setFPipeline] = useState<number | undefined>()
  const [fOperator, setFOperator] = useState<number | undefined>()
  const [fStatus, setFStatus] = useState<string | undefined>()
  const [fTrigger, setFTrigger] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // URL ?pipeline_id=X 自动筛选（项目详情页点流水线名进入）
  // 带了 pipeline_id 时筛选区不显示，不用回填下拉；在 render 里 setState 只会多绕一轮渲染
  const pipelineId = searchParams.get('pipeline_id')
    ? Number(searchParams.get('pipeline_id'))
    : undefined

  // 加载当前过滤的流水线名（用于标题）
  const { data: filteredPipeline } = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => get<Pipeline>(`/pipelines/${pipelineId}`),
    enabled: !!pipelineId,
  })

  // 管理员全局视图才用：admin_only + 跨项目下拉
  const isAdminView = !pipelineId && user?.is_admin

  // 筛选下拉数据（按需启用）
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<Project[]>('/projects'),
    enabled: !!isAdminView || !!fProject,
  })
  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines-by-project', fProject],
    queryFn: () => get<Pipeline[]>('/pipelines', fProject ? { project_id: fProject } : undefined),
    enabled: !!fProject,
  })
  const { data: operators = [] } = useQuery({
    queryKey: ['operators'],
    queryFn: () => get<User[]>('/users'),
    enabled: !!isAdminView,
  })

  const clearFilter = () => {
    setSearchParams({})
  }

  // 筛完往往只剩几条，还停在第 3 页的话看到的是一张空表，像是「没有符合的记录」
  useEffect(() => {
    setPage(1)
  }, [fStatus, fTrigger, fOperator, fProject, fPipeline, fDate?.[0], fDate?.[1]])

  const releaseParams: Record<string, unknown> = {}
  // 下拉里选的流水线和 URL 带进来的是同一个筛选，URL 优先
  const effectivePipelineId = pipelineId ?? fPipeline
  if (effectivePipelineId) releaseParams.pipeline_id = effectivePipelineId
  else if (isAdminView) releaseParams.admin_only = true
  if (fStatus) releaseParams.status = fStatus
  if (fTrigger) releaseParams.trigger_by = fTrigger
  if (fOperator) releaseParams.operator_id = fOperator
  if (fProject) releaseParams.project_id = fProject
  if (fDate?.[0]) releaseParams.date_from = fDate[0]
  if (fDate?.[1]) releaseParams.date_to = fDate[1]

  // 服务端分页：发布记录只增不减，全平台视角下几万条全拉回来毫无意义，
  // 何况还带着轮询。筛选条件后端都支持，翻页只取当页
  const { data: releasePage } = useQuery({
    queryKey: ['releases', effectivePipelineId, isAdminView, fStatus, fTrigger, fOperator, fProject, fDate?.[0], fDate?.[1], page, pageSize],
    queryFn: () =>
      get<Paged<Release>>('/releases', { ...releaseParams, page, page_size: pageSize }),
    // 全部跑完就没必要继续轮询，页面挂着也不该一直打后端
    refetchInterval: (q) =>
      (q.state.data?.items || []).some((r) =>
        ['running', 'queued', 'pending', 'rolling_back'].includes(r.status),
      )
        ? 3000
        : false,
  })
  const releases = releasePage?.items || []

  const { data: stats } = useQuery({
    queryKey: ['release-stats'],
    queryFn: () => get<{ total: number; success: number; failed: number; running: number; success_rate: number }>('/releases/statistics'),
  })

  // 连点会把同一条排队中的发布推两次
  const [executingId, setExecutingId] = useState<number | null>(null)

  const handleExecute = async (id: number) => {
    setExecutingId(id)
    try {
      const res = await postR(`/releases/${id}/execute`)
      if (res.message && res.message !== 'ok') {
        message.error(res.message, 8)
      }
      queryClient.invalidateQueries({ queryKey: ['releases'] })
      queryClient.invalidateQueries({ queryKey: ['release-stats'] })
    } finally {
      setExecutingId(null)
    }
  }

  const refreshReleases = () => {
    queryClient.invalidateQueries({ queryKey: ['releases'] })
    queryClient.invalidateQueries({ queryKey: ['release-stats'] })
  }

  interface SequenceStep {
  order: number
  plugin: string
  with: Record<string, unknown>
  status: string
  duration: number | null
  duration_label: string | null
}
interface SequenceJob {
  task_id: number
  id: string
  name: string
  agent: string
  status: string
  started_at: string | null
  finished_at: string | null
  duration: number | null
  duration_label: string | null
  steps: SequenceStep[]
}
interface SequenceStage {
  name: string
  status: string
  jobs: SequenceJob[]
}
interface PipelineVariable {
  name: string
  type: string
  value: string
  description: string
}
interface SequenceData {
  release_id: number
  pipeline_id: number
  pipeline_name: string
  version: string
  source_ref: string | null
  trigger_by: string
  status?: string
  error?: string
  created_at: string | null
  started_at: string | null
  finished_at: string | null
  total_duration: number | null
  total_duration_label: string | null
  is_running: boolean
  pipeline_variables: PipelineVariable[]
  stages: SequenceStage[]
}
interface CommitInfo {
  short_id: string
  id: string
  title: string
  message: string
  author_name: string
  author_email: string
  created_at: string
}
interface CommitsData {
  from: string | null
  to: string | null
  range: string
  commits: CommitInfo[]
  provider: string | null
}

  // 序列接口实时轮询：执行中每 2s，执行完停止
  const { data: sequence } = useQuery({
    queryKey: ['release-sequence', activeDetailId],
    queryFn: () => get<SequenceData>(`/releases/${activeDetailId}/sequence`),
    enabled: !!activeDetailId,
    refetchInterval: (query) => (query.state.data?.is_running ? 2000 : false),
  })

  // 打开 Drawer 时默认选中第一个 step（只选一次）
  useEffect(() => {
    if (sequence?.stages?.[0]?.jobs?.[0] && !selectedStep) {
      const firstJob = sequence.stages[0].jobs[0]
      if (firstJob.steps?.[0]) {
        setSelectedStep({ taskId: firstJob.task_id, stepOrder: 0 })
      }
    }
  }, [sequence])

  // step 日志：SSE 订阅选中任务这一条流。
  // 原来是每 2 秒把整次发布所有任务的完整日志全拉一遍，再 find 出一条、扔掉其余
  const { lines: stepLogLines } = useTaskLogStream(selectedStep?.taskId)

  // 代码变更（本次发布 vs 上次发布 commit 区间）
  const { data: commitsData } = useQuery({
    queryKey: ['release-commits', activeDetailId],
    queryFn: () => get<CommitsData>(`/releases/${activeDetailId}/commits`),
    enabled: !!activeDetailId,
  })

  const columns = [
    {
      title: '项目',
      dataIndex: 'project_name',
      width: 130,
      render: (v: string) => (v && v !== '—' ? <Tag color="blue">{v}</Tag> : <span style={{ color: '#bbb' }}>—</span>),
    },
    {
      title: '流水线',
      dataIndex: 'pipeline_name',
      width: 200,
      render: (v: string, r: Release) => (
        <a
          onClick={() => navigate(`/executions/${r.pipeline_id}`)}
          style={{ fontWeight: 500 }}
        >
          {v}
        </a>
      ),
    },
    { title: '版本', dataIndex: 'version', width: 120, render: (v: string) => <Tag>{v || '—'}</Tag> },
    {
      title: '代码版本',
      dataIndex: 'source_ref',
      width: 120,
      render: (v: string | null) =>
        v ? (
          <Tooltip title={v}>
            <Tag color="cyan" style={{ fontFamily: 'monospace' }}>
              {v.length > 12 ? v.slice(0, 8) + '…' : v}
            </Tag>
          </Tooltip>
        ) : (
          <Tag>latest</Tag>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 220,
      render: (v: string, r: Release) => {
        const s = statusMap[v] || { color: 'default', text: v }
        return (
          <div>
            <Tag color={s.color}>{s.text}</Tag>
            {r.error_summary ? (
              <Tooltip title={r.error_summary}>
                <div
                  style={{
                    color: '#ff4d4f',
                    fontSize: 12,
                    marginTop: 4,
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.error_summary}
                </div>
              </Tooltip>
            ) : null}
          </div>
        )
      },
    },
    {
      title: '发布人',
      dataIndex: 'operator_name',
      width: 120,
      render: (v: string) => (
        <Space size={4}>
          <UserOutlined style={{ color: '#999' }} />
          <span>{v || '—'}</span>
        </Space>
      ),
    },
    {
      title: '触发方式',
      dataIndex: 'trigger_by',
      width: 90,
      render: (v: string) => ({ manual: '手动', webhook: 'Webhook', cron: '定时', ai: 'AI', rebuild: 'Rebuild', rollback: '回滚' }[v] || v),
    },
    {
      title: '发布时间',
      dataIndex: 'created_at',
      width: 160,
      render: (v: string) => (
        <Space size={4} style={{ color: '#999', fontSize: 12 }}>
          <ClockCircleOutlined />
          {v ? dayjs(v).format('MM-DD HH:mm:ss') : '—'}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 280,
      fixed: 'right' as const,
      // 发布管理（全局视图，只读统计）：隐藏操作按钮
      // 进入单流水线执行历史（?pipeline_id=X）才显示
      render: (_: unknown, r: Release) =>
        pipelineId ? (
          <Space>
            <Button
              size="small"
              icon={<UnorderedListOutlined />}
              onClick={() => {
                setActiveDetailId(r.id)
                setSelectedStep(null)
              }}
            >
              序列
            </Button>
            {r.status === 'queued' && (
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                loading={executingId === r.id}
                onClick={() => handleExecute(r.id)}
              >
                执行
              </Button>
            )}
            <RiskActionButton
              action="rebuild"
              releaseId={r.id}
              buildNumber={r.build_number}
              approvalRequired={r.approval_required}
              allowBypass={r.allow_emergency_bypass}
              groupType={r.group_type}
              disabled={['pending', 'queued', 'running'].includes(r.status)}
              onDone={(nr) => {
                refreshReleases()
                if (nr.status !== 'pending') navigate(`/executions/${nr.pipeline_id}/${nr.id}`)
              }}
            />
            {['success', 'failed'].includes(r.status) && (
              <RiskActionButton
                action="rollback"
                releaseId={r.id}
                buildNumber={r.build_number}
                approvalRequired={r.approval_required}
                allowBypass={r.allow_emergency_bypass}
                groupType={r.group_type}
                onDone={(nr) => {
                  refreshReleases()
                  if (nr.status !== 'pending') navigate(`/executions/${nr.pipeline_id}/${nr.id}`)
                }}
              />
            )}
            {['running', 'success', 'failed'].includes(r.status) && (
              <Button
                size="small"
                icon={<FileTextOutlined />}
                onClick={() => setActiveLogId(r.id)}
              >
                日志
              </Button>
            )}
          </Space>
        ) : null,
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card><Statistic title="总发布次数" value={stats?.total ?? 0} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="成功" value={stats?.success ?? 0} valueStyle={{ color: '#52c41a' }} /></Card>
        </Col>
        <Col span={6}>
          <Card><Statistic title="失败" value={stats?.failed ?? 0} valueStyle={{ color: '#ff4d4f' }} /></Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="成功率"
              value={stats?.success_rate ?? 0}
              precision={1}
              suffix="%"
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          pipelineId ? (
            <Space>
              <FilterOutlined />
              <span>
                发布历史 · 流水线 <strong>{filteredPipeline?.name || `#${pipelineId}`}</strong>
              </span>
              <Button type="link" size="small" onClick={clearFilter}>
                查看全部
              </Button>
            </Space>
          ) : (
            <Space>
              <FilterOutlined />
              <span>发布管理（全局 · 仅管理员）</span>
            </Space>
          )
        }
        extra={
          pipelineId ? (
            <Space>
              <ExecuteReleaseButton
                pipeline={filteredPipeline}
                pipelineId={pipelineId}
                onDone={() => queryClient.invalidateQueries({ queryKey: ['releases'] })}
              />
              <Button
                icon={<EditOutlined />}
                onClick={() => navigate(`/pipeline/${pipelineId}/edit`)}
              >
                编辑流水线
              </Button>
            </Space>
          ) : null
        }
      >
        {/* 蓝盾风格：多维查询条件（仅全局视图显示） */}
        {!pipelineId && user?.is_admin && (
          <div
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              alignItems: 'center',
              padding: '12px 0',
              borderBottom: '1px solid #f0f0f0',
              marginBottom: 12,
            }}
          >
            <span style={{ color: '#666' }}>📅 发布日期：</span>
            <DatePicker.RangePicker
              value={
                fDate
                  ? [dayjs(fDate[0]), fDate[1] ? dayjs(fDate[1]) : null]
                  : null
              }
              onChange={(d) => setFDate(d ? [d[0]!.toISOString(), d[1] ? d[1].toISOString() : ''] : null)}
            />
            <span style={{ color: '#666' }}>📁 项目：</span>
            <Select
              allowClear
              placeholder="全部项目"
              style={{ width: 180 }}
              value={fProject}
              onChange={(v) => {
                setFProject(v)
                setFPipeline(undefined)  // 切换项目时清空流水线
              }}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
            />
            <span style={{ color: '#666' }}>🔧 流水线：</span>
            <Select
              allowClear
              placeholder={fProject ? '全部流水线' : '先选项目'}
              style={{ width: 200 }}
              value={fPipeline}
              onChange={setFPipeline}
              disabled={!fProject}
              options={pipelines.map((p) => ({ value: p.id, label: p.name }))}
            />
            <span style={{ color: '#666' }}>👤 发布人：</span>
            <Select
              allowClear
              placeholder="全部发布人"
              style={{ width: 140 }}
              value={fOperator}
              onChange={setFOperator}
              options={operators.map((o) => ({ value: o.id, label: o.display_name || o.username }))}
            />
            <span style={{ color: '#666' }}>📊 状态：</span>
            <Select
              allowClear
              placeholder="全部状态"
              style={{ width: 130 }}
              value={fStatus}
              onChange={setFStatus}
              options={Object.entries(statusMap).map(([k, v]) => ({ value: k, label: v.text }))}
            />
            <span style={{ color: '#666' }}>⚡ 触发方式：</span>
            <Select
              allowClear
              placeholder="全部"
              style={{ width: 120 }}
              value={fTrigger}
              onChange={setFTrigger}
              options={[
                { value: 'manual', label: '手动' },
                { value: 'webhook', label: 'Webhook' },
                { value: 'cron', label: '定时' },
                { value: 'rebuild', label: 'Rebuild' },
                { value: 'rollback', label: '回滚' },
              ]}
            />
            <Button
              size="small"
              onClick={() => {
                setFDate(null); setFProject(undefined); setFPipeline(undefined)
                setFOperator(undefined); setFStatus(undefined); setFTrigger(undefined)
              }}
            >
              重置
            </Button>
          </div>
        )}

        {/* 非管理员：只显示"无权访问"提示 */}
        {!pipelineId && !user?.is_admin && (
          <Alert
            type="warning"
            showIcon
            message="发布管理仅对管理员开放"
            description="如需查看执行历史，请从项目 → 流水线进入。"
            style={{ marginBottom: 16 }}
          />
        )}

        <DataTable
          chromeKey="releases"
          rowKey="id"
          columns={columns}
          dataSource={releases}
          pagination={{
            current: releasePage?.page || page,
            pageSize: releasePage?.page_size || pageSize,
            total: releasePage?.total || 0,
            showSizeChanger: true,
            showTotal: (t) => `共计 ${t} 条发布记录`,
          }}
          onChange={(p) => {
            setPage(p.current || 1)
            setPageSize(p.pageSize || 10)
          }}
        />
      </Card>

      {/* 执行日志弹窗（SSE 实时流） */}
      <Modal
        title={`执行日志 #${activeLogId ?? ''}（实时）`}
        open={!!activeLogId}
        onCancel={() => setActiveLogId(null)}
        footer={<Button onClick={() => setActiveLogId(null)}>关闭</Button>}
        width={720}
      >
        <div style={{ marginBottom: 12 }}>
          <Tag color={logDone ? 'green' : 'processing'}>
            {logDone ? '已完成' : '执行中 · 实时推送'}
          </Tag>
        </div>
        <div
          style={{
            background: '#1e1e1e',
            color: '#d4d4d4',
            fontFamily: 'monospace',
            fontSize: 12,
            padding: 16,
            borderRadius: 6,
            maxHeight: 420,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            lineHeight: 1.7,
          }}
        >
          {logLines.length === 0
            ? '（等待日志输出...）'
            : logLines.join('\n')}
        </div>
      </Modal>

      {/* 发布序列详情 Drawer（蓝盾风格：时间轴 + 全局变量 + stage/job/step 树 + 步骤日志） */}
      <Drawer
        title={
          sequence ? (
            <Space>
              <span>发布 #{sequence.pipeline_name} · v{sequence.version}</span>
              <Tag color={sequenceHeaderMeta(sequence).color}>
                {sequenceHeaderMeta(sequence).text}
              </Tag>
              {sequence.total_duration_label && (
                <Tag color="blue">⏱ 总耗时 {sequence.total_duration_label}</Tag>
              )}
            </Space>
          ) : `执行详情 #${activeDetailId ?? ''}`
        }
        open={!!activeDetailId}
        onClose={() => setActiveDetailId(null)}
        width={1100}
        destroyOnClose
      >
        {!sequence ? (
          <Empty description="加载序列中..." />
        ) : (
          <Tabs
            defaultActiveKey="detail"
            items={[
              {
                key: 'detail',
                label: '执行详情',
                children: (
                  <>
                    {/* 顶部：时间轴 + 流水线全局变量（按 pipeline 隔离） */}
                    <div
                      style={{
                        padding: 12,
                        background: '#fafafa',
                        borderRadius: 6,
                        marginBottom: 12,
                      }}
                    >
                      <Row gutter={16}>
                        <Col span={6}>
                          <Space direction="vertical" size={2}>
                            <Text type="secondary" style={{ fontSize: 11 }}>触发时间</Text>
                            <Text style={{ fontSize: 12 }}>
                              {sequence.created_at ? dayjs(sequence.created_at).format('YYYY-MM-DD HH:mm:ss') : '—'}
                            </Text>
                          </Space>
                        </Col>
                        <Col span={6}>
                          <Space direction="vertical" size={2}>
                            <Text type="secondary" style={{ fontSize: 11 }}>开始时间</Text>
                            <Text style={{ fontSize: 12 }}>
                              {sequence.started_at ? dayjs(sequence.started_at).format('YYYY-MM-DD HH:mm:ss') : '—'}
                            </Text>
                          </Space>
                        </Col>
                        <Col span={6}>
                          <Space direction="vertical" size={2}>
                            <Text type="secondary" style={{ fontSize: 11 }}>结束时间</Text>
                            <Text style={{ fontSize: 12 }}>
                              {sequence.finished_at ? dayjs(sequence.finished_at).format('YYYY-MM-DD HH:mm:ss') : '执行中…'}
                            </Text>
                          </Space>
                        </Col>
                        <Col span={6}>
                          <Space direction="vertical" size={2}>
                            <Text type="secondary" style={{ fontSize: 11 }}>总耗时</Text>
                            <Text strong style={{ fontSize: 13, color: '#1677ff' }}>
                              {sequence.total_duration_label || '计算中…'}
                            </Text>
                          </Space>
                        </Col>
                      </Row>
                      {sequence.pipeline_variables && sequence.pipeline_variables.length > 0 && (
                        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e8e8e8' }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>🔧 流水线全局变量（{sequence.pipeline_name}）</Text>
                          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {sequence.pipeline_variables.map((v) => (
                              <Tag key={v.name} color="cyan" style={{ fontSize: 11 }}>
                                <strong>{v.name}</strong>: {v.value || '—'}
                              </Tag>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {sequence.error && (
                      <Alert
                        type="error"
                        showIcon
                        style={{ marginBottom: 12 }}
                        message="失败原因"
                        description={
                          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{sequence.error}</div>
                        }
                      />
                    )}

                    {/* 主体：左 stage→job→step 树 + 右 step 日志 */}
                    <Row gutter={12}>
                      <Col span={11} style={{ borderRight: '1px solid #f0f0f0', paddingRight: 8 }}>
                        {sequence.stages.map((stage, si) => (
                          <div key={si} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, marginBottom: 6, color: statusColor(stage.status) }}>
                              {stageIcon(stage.status)} {stage.name}
                              <Tag style={{ marginLeft: 8 }} color={statusColor(stage.status)}>
                                {statusMap[stage.status]?.text || stage.status}
                              </Tag>
                            </div>
                            {stage.jobs.map((job, ji) => (
                              <div
                                key={ji}
                                style={{
                                  marginLeft: 12,
                                  marginBottom: 8,
                                  padding: 8,
                                  background: '#fafafa',
                                  borderRadius: 4,
                                }}
                              >
                                <div style={{ fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center' }}>
                                  <span style={{ flex: 1 }}>
                                    🔨 {job.name}
                                    <Tag style={{ marginLeft: 6 }} color={statusColor(job.status)}>
                                      {statusMap[job.status]?.text || job.status}
                                    </Tag>
                                    <Tag>{agentDisplay(job.agent).text}</Tag>
                                  </span>
                                  {job.duration_label && (
                                    <Tag color="blue" style={{ fontFamily: 'monospace' }}>
                                      {job.duration_label}
                                    </Tag>
                                  )}
                                </div>
                                {job.steps.map((step, sti) => (
                                  <span key={sti} style={{ display: 'inline-block', marginRight: 6, marginBottom: 4 }}>
                                    <Tooltip title={step.plugin}>
                                      <Button
                                        size="small"
                                        type={
                                          selectedStep?.taskId === job.task_id &&
                                          selectedStep?.stepOrder === step.order
                                            ? 'primary'
                                            : 'default'
                                        }
                                        onClick={() =>
                                          setSelectedStep({ taskId: job.task_id, stepOrder: step.order })
                                        }
                                        style={{ fontFamily: 'monospace' }}
                                      >
                                        {stageIcon(step.status)} {step.order + 1}. {step.plugin}
                                      </Button>
                                    </Tooltip>
                                    {step.duration_label && (
                                      <span style={{ marginLeft: -2, fontSize: 11, color: '#999' }}>
                                        {' '}{step.duration_label}
                                      </span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            ))}
                          </div>
                        ))}
                      </Col>
                      <Col span={13}>
                        <div style={{ marginBottom: 8, fontSize: 13, color: '#666' }}>
                          {selectedStep
                            ? `步骤 ${(selectedStep.stepOrder + 1)} · Task #${selectedStep.taskId}`
                            : '选中左侧步骤查看日志'}
                          {sequence.is_running && (
                            <Tag color="processing" style={{ marginLeft: 8 }}>实时刷新</Tag>
                          )}
                        </div>
                        <pre
                          style={{
                            background: '#1e1e1e',
                            color: '#d4d4d4',
                            fontFamily: 'monospace',
                            fontSize: 12,
                            padding: 16,
                            borderRadius: 6,
                            maxHeight: 560,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                            lineHeight: 1.7,
                            minHeight: 400,
                          }}
                        >
                          {stepLogLines.length === 0
                            ? sequence.error
                              ? sequence.error
                              : '（暂无日志）'
                            : stepLogLines.join('\n')}
                        </pre>
                      </Col>
                    </Row>
                  </>
                ),
              },
              {
                key: 'commits',
                label: `代码变更${commitsData ? `（${commitsData.commits.length}）` : ''}`,
                children: commitsData ? (
                  <div style={{ padding: 4 }}>
                    <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fafafa', borderRadius: 6 }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        提示：本次流水线的版本号变化范围：
                      </Text>
                      <Tag color="cyan" style={{ marginLeft: 8, fontFamily: 'monospace', fontSize: 13 }}>
                        {commitsData.range}
                      </Tag>
                      {commitsData.provider && (
                        <Tag style={{ marginLeft: 4 }}>{commitsData.provider}</Tag>
                      )}
                    </div>
                    {commitsData.commits.length === 0 ? (
                      <Empty description="未取到 commit 区间" />
                    ) : (
                      <DataTable
                        chromeKey="release-commits"
                        rowKey="id"
                        size="small"
                        pagination={false}
                        dataSource={commitsData.commits}
                        columns={[
                          { title: '备注', dataIndex: 'title', ellipsis: true },
                          {
                            title: 'Commit',
                            dataIndex: 'short_id',
                            width: 110,
                            render: (v: string, r: CommitInfo) => (
                              <Tooltip title={r.id}>
                                <Tag color="cyan" style={{ fontFamily: 'monospace' }}>
                                  {v || r.id.slice(0, 7)}
                                </Tag>
                              </Tooltip>
                            ),
                          },
                          {
                            title: '提交人',
                            dataIndex: 'author_name',
                            width: 140,
                            render: (v: string) => <Tag>{v || '—'}</Tag>,
                          },
                          {
                            title: '提交时间',
                            dataIndex: 'created_at',
                            width: 180,
                            render: (v: string) =>
                              v ? (
                                <span style={{ color: '#999', fontSize: 12 }}>
                                  {dayjs(v).format('YYYY-MM-DD HH:mm:ss')}
                                </span>
                              ) : (
                                '—'
                              ),
                          },
                        ]}
                      />
                    )}
                  </div>
                ) : (
                  <Empty description="加载 commit 区间..." />
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  )
}

function statusColor(s: string): string {
  return statusMap[s]?.color || 'default'
}

function stageIcon(s: string): string {
  return ({ success: '✅', failed: '❌', running: '▶️', pending: '⏸' }[s] || '·')
}
