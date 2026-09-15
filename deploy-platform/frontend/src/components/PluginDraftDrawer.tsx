import { useState } from 'react'
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { del, get, post } from '@/api/client'
import type { LintFinding, Pipeline, PluginDraft } from '@/api/types'
import { useAuthStore } from '@/stores/auth'

const { Text } = Typography

const LEVEL_META: Record<string, { color: string; text: string }> = {
  error: { color: 'error', text: '错误' },
  high: { color: 'volcano', text: '高危' },
  warn: { color: 'gold', text: '提醒' },
}

interface Props {
  draftId: number | null
  onClose: () => void
}

/**
 * 插件草稿审阅：看完整源码和体检结果，可挑一条流水线试跑，最后发布或驳回。
 * 发布只是让它进插件仓库（未安装状态），要流水线能用还得再点安装。
 */
export default function PluginDraftDrawer({ draftId, onClose }: Props) {
  const queryClient = useQueryClient()
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  const navigate = useNavigate()
  const [trialOpen, setTrialOpen] = useState(false)
  const [trialForm] = Form.useForm()
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data: draft, isLoading } = useQuery({
    queryKey: ['plugin-draft', draftId],
    queryFn: () => get<PluginDraft>(`/store/plugin-drafts/${draftId}`),
    enabled: !!draftId,
  })

  const { data: pipelines = [] } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => get<Pipeline[]>('/pipelines'),
    enabled: trialOpen,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['plugin-drafts'] })
    queryClient.invalidateQueries({ queryKey: ['plugin-draft', draftId] })
    queryClient.invalidateQueries({ queryKey: ['plugins'] })
  }

  const findings: LintFinding[] = draft?.lint?.findings || []
  const highCount = draft?.lint?.high_count || 0
  const errorCount = draft?.lint?.error_count || 0
  const pending = draft?.status === 'pending'

  const handleTrial = async () => {
    const values = await trialForm.validateFields()
    setBusy(true)
    try {
      const release = await post<{ id: number; pipeline_id: number }>(
        `/store/plugin-drafts/${draftId}/trial`,
        {
          pipeline_id: values.pipeline_id,
          agent_tag: values.agent_tag || 'linux',
          params: values.params ? JSON.parse(values.params) : {},
        },
      )
      setTrialOpen(false)
      refresh()
      message.success('已提交试跑，正在跳转执行详情')
      navigate(`/executions/${release.pipeline_id}/${release.id}`)
    } finally {
      setBusy(false)
    }
  }

  const handlePublish = async () => {
    setBusy(true)
    try {
      await post(`/store/plugin-drafts/${draftId}/publish`, { acknowledge_high: acknowledged })
      message.success('已发布到插件仓库，还需在插件列表点「安装」才会出现在编排器')
      refresh()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    if (!draftId) return
    setBusy(true)
    try {
      await del(`/store/plugin-drafts/${draftId}`)
      message.success('已删除草稿')
      refresh()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const handleReject = () => {
    let comment = ''
    Modal.confirm({
      title: '驳回该插件草稿',
      content: (
        <Input.TextArea
          rows={3}
          placeholder="必填：说明哪里有问题，便于重新起草"
          onChange={(e) => {
            comment = e.target.value
          }}
        />
      ),
      okText: '驳回',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        if (!comment.trim()) {
          message.error('请填写驳回原因')
          throw new Error('no comment')
        }
        await post(`/store/plugin-drafts/${draftId}/reject`, { comment: comment.trim() })
        message.success('已驳回')
        refresh()
        onClose()
      },
    })
  }

  return (
    <>
      <Drawer
        title={draft ? `插件草稿 #${draft.id}：${draft.display_name || draft.name}` : '插件草稿'}
        open={!!draftId}
        onClose={onClose}
        width={860}
        extra={
          <Space>
            {pending ? (
              <>
                <Button onClick={() => setTrialOpen(true)}>沙箱试跑</Button>
                {isAdmin ? (
                  <>
                    <Button danger onClick={handleReject}>
                      驳回
                    </Button>
                    <Button
                      type="primary"
                      loading={busy}
                      disabled={errorCount > 0 || (highCount > 0 && !acknowledged)}
                      onClick={handlePublish}
                    >
                      发布到仓库
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            <Popconfirm title="删除后无法恢复" onConfirm={handleDelete}>
              <Button danger loading={busy}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {isLoading || !draft ? (
          <div style={{ textAlign: 'center', padding: 60 }}>
            <Spin />
          </div>
        ) : (
          <>
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message="插件会在构建机上以 Agent 子进程执行"
              description="发布前请逐行读一遍代码，重点看它起了什么进程、访问了哪些地址、读了哪些文件。发布后仍需再点一次「安装」才会被流水线用到。"
            />

            <Descriptions size="small" column={2} bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="标识">
                <code>{draft.name}</code>
              </Descriptions.Item>
              <Descriptions.Item label="版本">{draft.version}</Descriptions.Item>
              <Descriptions.Item label="分类">{draft.category}</Descriptions.Item>
              <Descriptions.Item label="语言">{draft.language}</Descriptions.Item>
              <Descriptions.Item label="入口命令" span={2}>
                <code>{draft.entrypoint}</code>
              </Descriptions.Item>
              <Descriptions.Item label="来源">
                {draft.source === 'ai' ? <Tag color="purple">AI 起草</Tag> : <Tag>人工提交</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="试跑">
                {draft.trial_release_id ? (
                  <Tag color={draft.trial_status === 'success' ? 'green' : draft.trial_status === 'failed' ? 'red' : 'default'}>
                    发布 #{draft.trial_release_id} · {draft.trial_status || '未知'}
                  </Tag>
                ) : (
                  <Text type="secondary">未试跑</Text>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="原始诉求" span={2}>
                {draft.intent || <Text type="secondary">—</Text>}
              </Descriptions.Item>
            </Descriptions>

            <Tabs
              size="small"
              items={[
                {
                  key: 'lint',
                  label: `体检（${findings.length}）`,
                  children: findings.length === 0 ? (
                    <Empty description="没有发现问题" />
                  ) : (
                    <Space direction="vertical" style={{ width: '100%' }}>
                      {findings.map((f, idx) => {
                        const meta = LEVEL_META[f.level] || { color: 'default', text: f.level }
                        return (
                          <Alert
                            key={`${f.code}-${idx}`}
                            type={f.level === 'error' ? 'error' : f.level === 'high' ? 'warning' : 'info'}
                            showIcon
                            message={
                              <Space size={6}>
                                <Tag color={meta.color}>{meta.text}</Tag>
                                {f.message}
                              </Space>
                            }
                            description={f.where ? <code>{f.where}</code> : undefined}
                          />
                        )
                      })}
                      {highCount > 0 && pending && (
                        <Checkbox
                          checked={acknowledged}
                          onChange={(e) => setAcknowledged(e.target.checked)}
                        >
                          我已逐条读过上述 {highCount} 个高危项对应的代码，确认可以发布
                        </Checkbox>
                      )}
                    </Space>
                  ),
                },
                {
                  key: 'files',
                  label: `源码（${Object.keys(draft.files || {}).length}）`,
                  children: (
                    <Tabs
                      tabPosition="left"
                      size="small"
                      items={[
                        {
                          key: '__task_json__',
                          label: 'task.json',
                          children: <CodeBlock content={draft.task_json || ''} />,
                        },
                        ...Object.entries(draft.files || {}).map(([path, content]) => ({
                          key: path,
                          label: path,
                          children: <CodeBlock content={content} />,
                        })),
                      ]}
                    />
                  ),
                },
              ]}
            />

            {draft.status !== 'pending' && (
              <Alert
                style={{ marginTop: 16 }}
                type={draft.status === 'published' ? 'success' : 'error'}
                showIcon
                message={draft.status === 'published' ? '该草稿已发布到插件仓库' : '该草稿已驳回'}
                description={draft.review_comment || undefined}
              />
            )}
          </>
        )}
      </Drawer>

      <Modal
        title="沙箱试跑"
        open={trialOpen}
        onCancel={() => setTrialOpen(false)}
        onOk={handleTrial}
        confirmLoading={busy}
        okText="开始试跑"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="试跑会在选中的流水线上产生一条执行记录"
          description="建议专门建一条测试流水线用于试跑。插件会真的在构建机上跑起来，请先读过代码再试。"
        />
        <Form form={trialForm} layout="vertical" initialValues={{ agent_tag: 'linux', params: '{}' }}>
          <Form.Item
            name="pipeline_id"
            label="试跑流水线"
            rules={[{ required: true, message: '请选择一条流水线' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="建议选测试环境的流水线"
              options={pipelines.map((p) => ({ value: p.id, label: `${p.name}（#${p.id}）` }))}
            />
          </Form.Item>
          <Form.Item
            name="agent_tag"
            label="构建机标签"
            tooltip="任务按标签匹配构建机，填 linux / windows 或某台机器的标签"
          >
            <Input placeholder="linux" />
          </Form.Item>
          <Form.Item
            name="params"
            label="插件参数（JSON）"
            rules={[
              {
                validator: (_, v) => {
                  if (!v || !v.trim()) return Promise.resolve()
                  try {
                    JSON.parse(v)
                    return Promise.resolve()
                  } catch {
                    return Promise.reject(new Error('不是合法 JSON'))
                  }
                },
              },
            ]}
          >
            <Input.TextArea rows={4} style={{ fontFamily: 'monospace' }} placeholder='{"message": "hello"}' />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

function CodeBlock({ content }: { content: string }) {
  return (
    <pre
      style={{
        background: '#1e1e1e',
        color: '#d4d4d4',
        padding: 12,
        borderRadius: 4,
        fontSize: 12,
        maxHeight: 480,
        overflow: 'auto',
        margin: 0,
      }}
    >
      {content}
    </pre>
  )
}
