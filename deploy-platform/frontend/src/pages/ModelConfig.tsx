import { useState } from 'react'
import {
  Card,
  Tabs,
  Tag,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Switch,
  Select,
  Space,
  message,
  Alert,
  Empty,
  Popconfirm,
  Statistic,
  Tooltip,
} from 'antd'
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  StarOutlined,
  ApiOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { get, del, post, postLong, put } from '@/api/client'
import type { ModelAdapter, ModelRoute } from '@/api/types'
import DataTable from '@/components/DataTable'
import { useAuthStore } from '@/stores/auth'

interface TestResult {
  ok: boolean
  latency_ms: number
  reply: string
  error: string
  provider_name: string
  model_name: string
  model_id: string
}

function showTestResult(r: TestResult) {
  if (r.ok) {
    Modal.success({
      title: '连通正常',
      content: `${r.provider_name} / ${r.model_name}（${r.model_id}）耗时 ${r.latency_ms}ms。回复：${r.reply || '（无文本）'}`,
    })
  } else {
    Modal.error({
      title: '连通失败',
      content: `${r.provider_name} / ${r.model_name}（${r.model_id}）${r.latency_ms ? ` 耗时 ${r.latency_ms}ms。` : ''}${r.error || '未知错误'}`,
    })
  }
}

interface Provider {
  id: number
  name: string
  code: string
  api_base_url: string
  api_key_masked: string
  has_api_key: boolean
  description: string
  website: string
  is_active: boolean
}

interface LlmModel {
  id: number
  name: string
  model_id: string
  provider_id: number
  provider_code: string
  provider_name: string
  description: string
  max_tokens: number
  context_window?: number
  temperature: number
  capabilities?: string[]
  supports_vision?: boolean
  is_active: boolean
  is_default: boolean
  ready: boolean
}

interface UsageUserRow {
  user_id: number
  username: string
  display_name: string
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  last_used_at: string
}

interface UsageSummary {
  days: number
  since: string
  totals: {
    users: number
    requests: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
  }
  users: UsageUserRow[]
}

interface ObservationRow {
  id: number
  username?: string
  user_id?: number
  model_id?: string
  task?: string
  status?: string
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  duration_ms?: number
  usage_source?: string
  finished_at?: string
}

function formatTokens(n: number) {
  return (n || 0).toLocaleString()
}

export default function ModelConfig() {
  const qc = useQueryClient()
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  const [providerOpen, setProviderOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [routeOpen, setRouteOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  /** 正在编辑的模型；为空表示弹窗是「添加」。 */
  const [editingModel, setEditingModel] = useState<LlmModel | null>(null)
  const [pForm] = Form.useForm()
  const [mForm] = Form.useForm()
  const [routeForm] = Form.useForm()
  const [usageDays, setUsageDays] = useState(7)

  const { data: providers = [] } = useQuery({
    queryKey: ['llm-providers'],
    queryFn: () => get<Provider[]>('/llm/providers'),
  })
  const { data: models = [] } = useQuery({
    queryKey: ['llm-models'],
    queryFn: () => get<LlmModel[]>('/llm/models'),
  })
  const routesQuery = useQuery({
    queryKey: ['llm-routes'],
    queryFn: () => get<ModelRoute[]>('/llm/routes'),
    retry: false,
  })
  const adaptersQuery = useQuery({
    queryKey: ['llm-adapters'],
    queryFn: async () => {
      try {
        return await get<ModelAdapter[]>('/llm/adapters')
      } catch {
        const extensions = await get<Array<{
          id: number
          name: string
          version: string
          source?: string
          enabled?: boolean
          status?: string
          manifest?: { display_name?: string; capabilities?: string[] }
        }>>('/harness/components', { kind: 'model-adapter' })
        return extensions.map((item) => ({
          id: item.id,
          name: item.manifest?.display_name || item.name,
          source: item.source,
          version: item.version,
          enabled: item.enabled,
          status: item.status,
          capabilities: item.manifest?.capabilities,
        }))
      }
    },
    retry: false,
  })
  const observationsQuery = useQuery({
    queryKey: ['llm-observations'],
    queryFn: () => get<ObservationRow[]>('/llm/observations', { limit: 100 }),
    retry: false,
    enabled: isAdmin,
  })
  const usageQuery = useQuery({
    queryKey: ['llm-usage-users', usageDays],
    queryFn: () => get<UsageSummary>('/llm/usage/users', { days: usageDays }),
    retry: false,
    enabled: isAdmin,
  })

  const saveProvider = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      put(`/llm/providers/${editingProvider!.id}`, values),
    onSuccess: () => {
      message.success('厂商已保存')
      qc.invalidateQueries({ queryKey: ['llm-providers'] })
      qc.invalidateQueries({ queryKey: ['llm-models'] })
      setProviderOpen(false)
    },
  })

  const saveModel = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      editingModel ? put(`/llm/models/${editingModel.id}`, values) : post('/llm/models', values),
    onSuccess: () => {
      message.success(editingModel ? '模型已保存' : '模型已添加')
      qc.invalidateQueries({ queryKey: ['llm-models'] })
      qc.invalidateQueries({ queryKey: ['assistant-models'] })
      setModelOpen(false)
      setEditingModel(null)
      mForm.resetFields()
    },
  })

  const patchModel = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      put(`/llm/models/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['llm-models'] })
      qc.invalidateQueries({ queryKey: ['assistant-models'] })
    },
  })

  const deleteModel = useMutation({
    mutationFn: (id: number) => del(`/llm/models/${id}`),
    onSuccess: () => {
      message.success('模型已删除')
      qc.invalidateQueries({ queryKey: ['llm-models'] })
      qc.invalidateQueries({ queryKey: ['assistant-models'] })
    },
  })
  const saveRoute = useMutation({
    mutationFn: (values: Record<string, unknown>) => post('/llm/routes', values),
    onSuccess: () => {
      message.success('任务路由已保存')
      qc.invalidateQueries({ queryKey: ['llm-routes'] })
      setRouteOpen(false)
      routeForm.resetFields()
    },
  })

  const [testingId, setTestingId] = useState<string | null>(null)
  const runTest = async (url: string, body?: Record<string, unknown>, id?: string) => {
    const key = id || url
    setTestingId(key)
    try {
      const r = await postLong<TestResult>(url, body || {}, 40000)
      showTestResult(r)
    } catch (e) {
      Modal.error({ title: '连通失败', content: e instanceof Error ? e.message : String(e) })
    } finally {
      setTestingId(null)
    }
  }

  const openEditProvider = (p: Provider) => {
    setEditingProvider(p)
    pForm.setFieldsValue({
      name: p.name,
      api_base_url: p.api_base_url,
      api_key: '',
      is_active: p.is_active,
      description: p.description,
    })
    setProviderOpen(true)
  }

  /** 打开添加模型弹窗，清空表单。 */
  const openAddModel = () => {
    setEditingModel(null)
    mForm.resetFields()
    mForm.setFieldsValue({ max_tokens: 4096, temperature: 0.2, is_default: false, supports_vision: false })
    setModelOpen(true)
  }

  /** 用当前行填表，弹窗改成编辑已有模型。 */
  const openEditModel = (r: LlmModel) => {
    setEditingModel(r)
    mForm.setFieldsValue({
      provider_id: r.provider_id,
      name: r.name,
      model_id: r.model_id,
      max_tokens: r.max_tokens,
      context_window: r.context_window || 0,
      supports_vision: !!r.supports_vision,
      is_default: r.is_default,
    })
    setModelOpen(true)
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="模型管理"
        description="统一管理厂商连接、模型目录、任务路由、适配器，以及每个用户的 Token 用量。"
      />
      <Tabs
        items={[
          {
            key: 'providers',
            label: `厂商（${providers.length}）`,
            children: (
              <Card>
                <DataTable
                  chromeKey="model-providers"
                  rowKey="id"
                  dataSource={providers}
                  pagination={false}
                  columns={[
                    { title: '厂商', dataIndex: 'name', render: (v: string, r: Provider) => (
                      <Space>
                        {v}
                        <Tag>{r.code}</Tag>
                      </Space>
                    ) },
                    { title: 'API 地址', dataIndex: 'api_base_url', ellipsis: true },
                    {
                      title: 'API Key',
                      dataIndex: 'api_key_masked',
                      width: 160,
                      render: (v: string, r: Provider) =>
                        r.has_api_key ? <code>{v}</code> : <Tag>未配置</Tag>,
                    },
                    {
                      title: '启用',
                      dataIndex: 'is_active',
                      width: 80,
                      render: (v: boolean) => (v ? <Tag color="green">是</Tag> : <Tag>否</Tag>),
                    },
                    {
                      title: '操作',
                      width: 180,
                      render: (_: unknown, r: Provider) =>
                        isAdmin ? (
                        <Space>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEditProvider(r)}>
                            配置
                          </Button>
                          <Button
                            size="small"
                            icon={<ApiOutlined />}
                            loading={testingId === `p-${r.id}`}
                            disabled={!r.has_api_key}
                            onClick={() => runTest(`/llm/providers/${r.id}/test`, {}, `p-${r.id}`)}
                          >
                            测试
                          </Button>
                        </Space>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'models',
            label: `模型（${models.length}）`,
            children: (
              <Card
                extra={
                  isAdmin ? (
                    <Button type="primary" icon={<PlusOutlined />} onClick={openAddModel}>
                      添加模型
                    </Button>
                  ) : null
                }
              >
                <DataTable
                  chromeKey="model-models"
                  rowKey="id"
                  dataSource={models}
                  pagination={false}
                  columns={[
                    {
                      title: '模型',
                      dataIndex: 'name',
                      render: (v: string, r: LlmModel) => (
                        <Space>
                          {v}
                          {r.is_default && (
                            <Tag color="gold" icon={<StarOutlined />}>
                              默认
                            </Tag>
                          )}
                          {r.ready ? <Tag color="green">可用</Tag> : <Tag>缺 Key</Tag>}
                        </Space>
                      ),
                    },
                    { title: 'model_id', dataIndex: 'model_id', render: (v: string) => <code>{v}</code> },
                    { title: '厂商', dataIndex: 'provider_name' },
                    { title: 'max_tokens', dataIndex: 'max_tokens', width: 110 },
                    {
                      title: '能力',
                      width: 120,
                      render: (_: unknown, r: LlmModel) => (
                        <Tag
                          color={r.supports_vision ? 'purple' : 'default'}
                          style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                          onClick={() =>
                            isAdmin &&
                            patchModel.mutate({
                              id: r.id,
                              body: { capabilities: r.supports_vision ? [] : ['vision'] },
                            })
                          }
                        >
                          {r.supports_vision ? '看图' : '纯文本'}
                        </Tag>
                      ),
                    },
                    {
                      title: '操作',
                      width: 360,
                      render: (_: unknown, r: LlmModel) =>
                        isAdmin ? (
                        <Space wrap size={4}>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModel(r)}>
                            修改
                          </Button>
                          <Button
                            size="small"
                            icon={<ApiOutlined />}
                            loading={testingId === `m-${r.id}`}
                            disabled={!r.ready}
                            onClick={() => runTest(`/llm/models/${r.id}/test`, {}, `m-${r.id}`)}
                          >
                            测试
                          </Button>
                          {!r.is_default && (
                            <Popconfirm title="设为诊断默认模型？" onConfirm={() => patchModel.mutate({ id: r.id, body: { is_default: true } })}>
                              <Button size="small">设为默认</Button>
                            </Popconfirm>
                          )}
                          <Button
                            size="small"
                            onClick={() =>
                              patchModel.mutate({ id: r.id, body: { is_active: !r.is_active } })
                            }
                          >
                            {r.is_active ? '停用' : '启用'}
                          </Button>
                          <Tooltip title={r.is_default ? '请先把别的模型设为默认，再删这条' : undefined}>
                            <span>
                              <Popconfirm
                                title="删除这个模型？"
                                description="目录里会去掉这条。任务路由还在用时删不掉。"
                                disabled={r.is_default}
                                onConfirm={() => deleteModel.mutate(r.id)}
                              >
                                <Button
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  disabled={r.is_default || deleteModel.isPending}
                                >
                                  删除
                                </Button>
                              </Popconfirm>
                            </span>
                          </Tooltip>
                        </Space>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'routes',
            label: `任务路由（${routesQuery.data?.length || 0}）`,
            children: (
              <Card
                extra={
                  isAdmin ? (
                    <Button type="primary" icon={<PlusOutlined />} disabled={routesQuery.isError} onClick={() => setRouteOpen(true)}>
                      添加路由
                    </Button>
                  ) : null
                }
              >
                {routesQuery.isError ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="任务路由 API 暂不可用"
                    description="系统继续使用现有默认模型；厂商和模型 CRUD 不受影响。"
                  />
                ) : (
                  <DataTable
                    chromeKey="model-routes"
                    rowKey="id"
                    dataSource={routesQuery.data || []}
                    pagination={false}
                    columns={[
                      { title: '任务', dataIndex: 'task', render: (value: string) => <code>{value}</code> },
                      { title: '主模型', dataIndex: 'model_name' },
                      { title: '回退模型', dataIndex: 'fallback_model', render: (value: string) => value || '—' },
                      { title: '策略', dataIndex: 'strategy', render: (value: string) => <Tag color="blue">{value || 'priority'}</Tag> },
                      { title: '状态', dataIndex: 'enabled', width: 90, render: (value: boolean) => <Tag color={value === false ? 'default' : 'green'}>{value === false ? '停用' : '启用'}</Tag> },
                    ]}
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'adapters',
            label: `适配器（${adaptersQuery.data?.length || 0}）`,
            children: (
              <Card>
                {adaptersQuery.isError ? (
                  <Empty description="模型适配器目录不可用，现有 OpenAI 兼容调用仍可使用" />
                ) : (
                  <DataTable
                    chromeKey="model-adapters"
                    rowKey="id"
                    dataSource={adaptersQuery.data || []}
                    pagination={false}
                    columns={[
                      { title: '适配器', dataIndex: 'name' },
                      { title: '版本', dataIndex: 'version', width: 100 },
                      { title: '来源', dataIndex: 'source' },
                      { title: '能力', dataIndex: 'capabilities', render: (values: string[] = []) => <Space wrap>{values.map((value) => <Tag key={value}>{value}</Tag>)}</Space> },
                      { title: '状态', render: (_: unknown, row: ModelAdapter) => <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '已启用' : row.status || '未启用'}</Tag> },
                      {
                        title: '操作',
                        width: 100,
                        render: (_: unknown, row: ModelAdapter) =>
                          isAdmin ? (
                          <Button
                            size="small"
                            onClick={async () => {
                              try {
                                await post(`/harness/components/${row.id}/enabled`, { enabled: !row.enabled })
                                message.success(row.enabled ? '适配器已停用' : '适配器已启用')
                                adaptersQuery.refetch()
                              } catch {
                                message.error('适配器状态更新失败')
                              }
                            }}
                          >
                            {row.enabled ? '停用' : '启用'}
                          </Button>
                          ) : null,
                      },
                    ]}
                  />
                )}
              </Card>
            ),
          },
          {
            key: 'usage',
            label: '用量',
            children: (
              <Card
                extra={
                  <Space>
                    <Select
                      value={usageDays}
                      style={{ width: 120 }}
                      onChange={setUsageDays}
                      options={[
                        { value: 1, label: '今天' },
                        { value: 7, label: '近 7 天' },
                        { value: 30, label: '近 30 天' },
                        { value: 90, label: '近 90 天' },
                      ]}
                    />
                    <Button icon={<ReloadOutlined />} onClick={() => usageQuery.refetch()}>刷新</Button>
                  </Space>
                }
              >
                {usageQuery.isError ? (
                  <Alert type="warning" showIcon message="用量接口暂不可用" description="升级后端后可按用户查看 Token 消耗。" />
                ) : (
                  <>
                    <Space size={32} style={{ marginBottom: 20 }} wrap>
                      <Statistic title="用户数" value={usageQuery.data?.totals.users || 0} />
                      <Statistic title="调用次数" value={usageQuery.data?.totals.requests || 0} />
                      <Statistic title="输入 Token" value={usageQuery.data?.totals.input_tokens || 0} />
                      <Statistic title="输出 Token" value={usageQuery.data?.totals.output_tokens || 0} />
                      <Statistic title="合计 Token" value={usageQuery.data?.totals.total_tokens || 0} />
                    </Space>
                    <DataTable
                      chromeKey="model-usage-users"
                      rowKey={(row) => String(row.user_id || row.username)}
                      dataSource={usageQuery.data?.users || []}
                      pagination={false}
                      locale={{ emptyText: <Empty description="这段时间还没有记到调用。助手对话产生的用量会写在这里。" /> }}
                      columns={[
                        {
                          title: '用户',
                          dataIndex: 'display_name',
                          render: (_: string, row: UsageUserRow) => (
                            <Space>
                              {row.display_name || row.username}
                              {row.username && row.display_name !== row.username ? <Tag>{row.username}</Tag> : null}
                            </Space>
                          ),
                        },
                        { title: '调用', dataIndex: 'requests', width: 90 },
                        { title: '输入', dataIndex: 'input_tokens', render: (v: number) => formatTokens(v) },
                        { title: '输出', dataIndex: 'output_tokens', render: (v: number) => formatTokens(v) },
                        { title: '合计', dataIndex: 'total_tokens', render: (v: number) => formatTokens(v) },
                        { title: '最近一次', dataIndex: 'last_used_at', ellipsis: true },
                      ]}
                    />
                  </>
                )}
              </Card>
            ),
          },
          {
            key: 'observability',
            label: '观测',
            children: (
              <Card
                extra={<Button icon={<ReloadOutlined />} onClick={() => observationsQuery.refetch()}>刷新</Button>}
              >
                {observationsQuery.isError ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="模型观测 API 暂不可用"
                    description="这不会影响模型调用；升级服务后可查看每次调用的 Token。"
                  />
                ) : (
                  <>
                    <Space size={32} style={{ marginBottom: 20 }}>
                      <Statistic title="近期调用" value={(observationsQuery.data || []).length} />
                      <Statistic
                        title="Token"
                        value={(observationsQuery.data || []).reduce((sum, item) => sum + (item.total_tokens || 0), 0)}
                      />
                    </Space>
                    <DataTable
                      chromeKey="model-observations"
                      rowKey={(row) => String(row.id)}
                      dataSource={observationsQuery.data || []}
                      pagination={false}
                      columns={[
                        { title: '时间', dataIndex: 'finished_at', ellipsis: true },
                        { title: '用户', dataIndex: 'username', width: 120, render: (v: string) => v || '—' },
                        { title: '模型', dataIndex: 'model_id' },
                        { title: '任务', dataIndex: 'task', width: 100 },
                        { title: '状态', dataIndex: 'status', width: 90 },
                        { title: '输入', dataIndex: 'input_tokens', render: (v: number) => formatTokens(v || 0) },
                        { title: '输出', dataIndex: 'output_tokens', render: (v: number) => formatTokens(v || 0) },
                        { title: '合计', dataIndex: 'total_tokens', render: (v: number) => formatTokens(v || 0) },
                        { title: '耗时', dataIndex: 'duration_ms', render: (v: number) => `${v ?? 0} ms` },
                      ]}
                    />
                  </>
                )}
              </Card>
            ),
          },
        ]}
      />

      <Modal
        title={`配置厂商${editingProvider ? ` · ${editingProvider.name}` : ''}`}
        open={providerOpen}
        onCancel={() => setProviderOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setProviderOpen(false)}>
            取消
          </Button>,
          <Button
            key="test"
            icon={<ApiOutlined />}
            loading={testingId === `pform-${editingProvider?.id}`}
            onClick={async () => {
              if (!editingProvider) return
              const values = await pForm.validateFields(['api_base_url'])
              const body: Record<string, unknown> = { api_base_url: values.api_base_url }
              const key = pForm.getFieldValue('api_key')
              if (key) body.api_key = key
              await runTest(`/llm/providers/${editingProvider.id}/test`, body, `pform-${editingProvider.id}`)
            }}
          >
            测试连接
          </Button>,
          <Button
            key="ok"
            type="primary"
            loading={saveProvider.isPending}
            onClick={async () => {
              const values = await pForm.validateFields()
              if (!values.api_key) delete values.api_key
              saveProvider.mutate(values)
            }}
          >
            保存
          </Button>,
        ]}
        destroyOnClose
      >
        <Form form={pForm} layout="vertical">
          <Form.Item name="name" label="显示名">
            <Input />
          </Form.Item>
          <Form.Item
            name="api_base_url"
            label="API 地址"
            extra={
              editingProvider?.code === 'tencent-lkeap'
                ? '腾讯云 DeepSeek：https://tokenhub.tencentmaas.com/v1 ；Token Plan 用 https://api.lkeap.cloud.tencent.com/plan/v3'
                : 'OpenAI 兼容根路径，如 https://tokenhub.tencentmaas.com/v1'
            }
          >
            <Input placeholder="https://tokenhub.tencentmaas.com/v1" />
          </Form.Item>
          <Form.Item name="api_key" label="API Key" extra="留空表示不修改已保存的密钥">
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item name="is_active" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingModel ? `修改模型 · ${editingModel.name}` : '添加模型'}
        open={modelOpen}
        onCancel={() => {
          setModelOpen(false)
          setEditingModel(null)
        }}
        onOk={async () => {
          const values = await mForm.validateFields()
          const { supports_vision, ...rest } = values
          saveModel.mutate({
            ...rest,
            capabilities: supports_vision ? ['vision'] : [],
          })
        }}
        confirmLoading={saveModel.isPending}
        destroyOnClose
      >
        <Form form={mForm} layout="vertical" initialValues={{ max_tokens: 4096, temperature: 0.2, is_default: false }}>
          <Form.Item name="provider_id" label="厂商" rules={[{ required: true }]}>
            <Select
              options={providers.map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
            />
          </Form.Item>
          <Form.Item name="name" label="显示名" rules={[{ required: true }]}>
            <Input placeholder="DeepSeek Chat" />
          </Form.Item>
          <Form.Item
            name="model_id"
            label="model_id"
            rules={[{ required: true }]}
            extra="腾讯云 DeepSeek 常用：deepseek-v4-pro / deepseek-v4-flash"
          >
            <Input placeholder="deepseek-v4-pro" />
          </Form.Item>
          <Form.Item name="max_tokens" label="max_tokens">
            <InputNumber min={256} max={32768} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="context_window" label="上下文窗口" extra="0 表示未填写，助手会用默认预算">
            <InputNumber min={0} max={2000000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="supports_vision"
            label="支持看图"
            valuePropName="checked"
            extra="打开后，助手对话框可粘贴或拖入图片给这个模型看。不勾选时按模型名猜测。"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="is_default" label="设为默认" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="添加任务路由"
        open={routeOpen}
        onCancel={() => setRouteOpen(false)}
        confirmLoading={saveRoute.isPending}
        onOk={async () => saveRoute.mutate(await routeForm.validateFields())}
        destroyOnClose
      >
        <Form form={routeForm} layout="vertical" initialValues={{ strategy: 'priority', enabled: true }}>
          <Form.Item name="task" label="任务标识" rules={[{ required: true }]}>
            <Input placeholder="assistant.chat / pipeline.diagnose" />
          </Form.Item>
          <Form.Item name="model_id" label="主模型" rules={[{ required: true }]}>
            <Select options={models.map((model) => ({ value: model.id, label: `${model.provider_name} / ${model.name}` }))} />
          </Form.Item>
          <Form.Item name="fallback_model_id" label="回退模型">
            <Select allowClear options={models.map((model) => ({ value: model.id, label: `${model.provider_name} / ${model.name}` }))} />
          </Form.Item>
          <Form.Item name="strategy" label="路由策略">
            <Select options={[
              { value: 'priority', label: '优先级' },
              { value: 'round-robin', label: '轮询' },
              { value: 'latency', label: '最低延迟' },
            ]} />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
