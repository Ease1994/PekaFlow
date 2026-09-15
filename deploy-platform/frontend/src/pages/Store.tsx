import { useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Popconfirm,
  Space,
  Tabs,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'antd'
import { ApiOutlined, CloudServerOutlined, DownloadOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { del, get, getBlob, post, postForm } from '@/api/client'
import type {
  HarnessComponent,
  HarnessLifecycleEvent,
  HarnessRuntime,
  HarnessTool,
  Plugin,
  PluginDraft,
} from '@/api/types'
import PluginDraftDrawer from '@/components/PluginDraftDrawer'
import DataTable from '@/components/DataTable'
import { useAuthStore } from '@/stores/auth'

const categoryMap: Record<string, { color: string; text: string }> = {
  source: { color: 'blue', text: '代码' },
  build: { color: 'geekblue', text: '构建' },
  deploy: { color: 'red', text: '部署' },
  notify: { color: 'purple', text: '通知' },
  trigger: { color: 'cyan', text: '触发' },
  exec: { color: 'gold', text: '命令' },
  artifact: { color: 'magenta', text: '制品' },
  pipeline: { color: 'orange', text: '流水线' },
}

const draftStatusMap: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审' },
  published: { color: 'green', text: '已发布' },
  rejected: { color: 'red', text: '已驳回' },
}

const builtinCategoryMap: Record<string, string> = {
  catalog: '目录',
  observe: '观测',
  diagnose: '诊断',
  delivery: '交付',
  access: '权限',
  authoring: '编写',
  meta: '元能力',
}

const riskMap: Record<string, { color: string; text: string }> = {
  read: { color: 'blue', text: '只读' },
  write: { color: 'orange', text: '写入' },
  destructive: { color: 'red', text: '高风险' },
}

const healthMap: Record<string, { color: string; text: string }> = {
  healthy: { color: 'green', text: '正常' },
  degraded: { color: 'gold', text: '降级' },
  unhealthy: { color: 'red', text: '异常' },
  unknown: { color: 'default', text: '未检查' },
}

/**
 * 运行时健康标签。unknown 是还没检查，不是故障。
 * @param status 后端 health_status
 * @param message 检查说明，作悬停说明
 */
function healthTag(status?: string, message?: string) {
  if (!status) return null
  const item = healthMap[status] || { color: 'default', text: status }
  const tag = <Tag color={item.color}>{item.text}</Tag>
  return message ? <Tooltip title={message}>{tag}</Tooltip> : tag
}

/** 启用 / 停用 / 卸载，不把英文 status 直接铺到页面上。 */
function lifecycleStatusTag(row: HarnessComponent) {
  if (row.enabled) return <Tag color="green">已启用</Tag>
  if (row.status === 'uninstalled') return <Tag>已卸载</Tag>
  if (row.status === 'error') return <Tag color="red">异常</Tag>
  return <Tag>已停用</Tag>
}

/**
 * 带 JWT 拉取 zip 并触发浏览器下载。
 * 内置插件/技能不能改平台副本，下载下来改标识后再上传才是第三方包。
 */
async function downloadTemplate(path: string, filename: string) {
  try {
    const blob = await getBlob(path)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    message.success(`已开始下载 ${filename}`)
  } catch {
    /* 错误已由请求拦截器提示 */
  }
}

/** 拼下载文件名：{标识}-{版本}.zip */
function storeZipName(name: string, version?: string) {
  return `${name}-${version || '1.0.0'}.zip`
}

export default function Store() {
  const queryClient = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = !!user?.is_admin
  const userId = user?.id
  const [draftId, setDraftId] = useState<number | null>(null)
  const [resourceComponent, setResourceComponent] = useState<HarnessComponent | null>(null)
  const { data: plugins = [] } = useQuery({
    queryKey: ['plugins'],
    queryFn: () => get<Plugin[]>('/store/plugins'),
  })

  const { data: drafts = [] } = useQuery({
    queryKey: ['plugin-drafts'],
    queryFn: () => get<PluginDraft[]>('/store/plugin-drafts'),
  })

  const { data: templates = [] } = useQuery({
    queryKey: ['templates'],
    queryFn: () => get<Plugin[]>('/store/templates'),
  })

  const componentsQuery = useQuery({
    queryKey: ['harness-components'],
    queryFn: () => get<HarnessComponent[]>('/harness/components'),
    retry: false,
  })
  const runtimeQuery = useQuery({
    queryKey: ['harness-runtime'],
    queryFn: () => get<HarnessRuntime>('/harness/runtime'),
    retry: false,
  })
  const eventsQuery = useQuery({
    queryKey: ['harness-events'],
    queryFn: () => get<HarnessLifecycleEvent[]>('/harness/events'),
    retry: false,
  })
  const builtinToolsQuery = useQuery({
    queryKey: ['harness-tools'],
    queryFn: () => get<HarnessTool[]>('/harness/tools'),
    retry: false,
  })

  const refreshHarness = () => {
    queryClient.invalidateQueries({ queryKey: ['harness-components'] })
    queryClient.invalidateQueries({ queryKey: ['harness-runtime'] })
    queryClient.invalidateQueries({ queryKey: ['harness-events'] })
    queryClient.invalidateQueries({ queryKey: ['harness-tools'] })
    queryClient.invalidateQueries({ queryKey: ['ai-skills'] })
  }

  /** 商店安装会改 installed 标记，编排器读的是 ['plugins','installed']，必须一起刷。 */
  const refreshPlugins = () => {
    queryClient.invalidateQueries({ queryKey: ['plugins'] })
    refreshHarness()
  }

  const lifecycleMut = useMutation({
    mutationFn: ({
      component,
      action,
    }: {
      component: HarnessComponent
      action: 'enable' | 'disable' | 'uninstall' | 'health' | 'reinstall' | 'purge'
    }) => {
      if (action === 'purge') {
        return del(`/harness/components/${component.id}`)
      }
      if (action === 'enable' || action === 'disable') {
        return post(`/harness/components/${component.id}/enabled`, { enabled: action === 'enable' })
      }
      return post(`/harness/components/${component.id}/${action}`)
    },
    onSuccess: (_, variables) => {
      const tips: Record<string, string> = {
        uninstall: '已卸载组件',
        reinstall: '已安装并启用，可立即使用',
        enable: '已启用，可立即使用',
        purge: '已从技能库删除',
      }
      message.success(tips[variables.action] || '组件状态已更新')
      refreshHarness()
    },
  })

  const installMut = useMutation({
    mutationFn: (id: number) => post(`/store/plugins/${id}/install`),
    onSuccess: () => {
      message.success('已安装，可立即在流水线中选用，无需重启')
      refreshPlugins()
    },
  })
  const uninstallMut = useMutation({
    mutationFn: (id: number) => post(`/store/plugins/${id}/uninstall`),
    onSuccess: () => {
      message.success('已卸载')
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      refreshHarness()
    },
  })
  const deletePluginMut = useMutation({
    mutationFn: (id: number) => del(`/store/plugins/${id}`),
    onSuccess: () => {
      message.success('已从仓库删除')
      queryClient.invalidateQueries({ queryKey: ['plugins'] })
      refreshHarness()
    },
  })
  const deleteDraftMut = useMutation({
    mutationFn: (id: number) => del(`/store/plugin-drafts/${id}`),
    onSuccess: () => {
      message.success('已删除草稿')
      queryClient.invalidateQueries({ queryKey: ['plugin-drafts'] })
    },
  })

  const pluginColumns = [
    { title: '插件', dataIndex: 'display_name' },
    {
      title: '分类',
      dataIndex: 'category',
      render: (v: string) => {
        const c = categoryMap[v] || { color: 'default', text: v }
        return <Tag color={c.color}>{c.text}</Tag>
      },
    },
    { title: '标识', dataIndex: 'name', render: (v: string) => <code>{v}</code> },
    { title: '版本', dataIndex: 'version', width: 90 },
    { title: '语言', dataIndex: 'language', width: 80, render: (v: string) => v || '—' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 150,
      render: (_: string, row: Plugin) => (
        <Space size={4}>
          {row.installed ? <Tag color="green">已安装</Tag> : <Tag>未安装</Tag>}
          {row.builtin ? <Tag>内置</Tag> : <Tag color="cyan">第三方</Tag>}
        </Space>
      ),
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      width: 360,
      render: (_: unknown, row: Plugin) => {
        const canDownload = Boolean(row.has_package)
        return (
          <Space size={4} wrap>
            <Tooltip
              title={
                canDownload
                  ? '下载源码包。改 task.json 的 name（不能与内置同名），签名后上传即成第三方插件'
                  : '该插件实现在 Agent 内，没有可下载源码。请用「下载插件开发模板」'
              }
            >
              <span>
                <Button
                  size="small"
                  icon={<DownloadOutlined />}
                  disabled={!canDownload}
                  onClick={() =>
                    downloadTemplate(
                      `/store/plugins/${encodeURIComponent(row.name)}/package`,
                      storeZipName(row.name, row.version),
                    )
                  }
                >
                  下载
                </Button>
              </span>
            </Tooltip>
            {row.builtin ? (
              <span style={{ color: '#999' }}>不可卸载</span>
            ) : isAdmin ? (
              <>
                {row.installed ? (
                  <Popconfirm title="卸载后流水线将无法执行该插件" onConfirm={() => uninstallMut.mutate(row.id)}>
                    <Button size="small">卸载</Button>
                  </Popconfirm>
                ) : (
                  <Button
                    size="small"
                    type="primary"
                    disabled={!row.package_path}
                    onClick={() => installMut.mutate(row.id)}
                  >
                    安装
                  </Button>
                )}
                <Popconfirm
                  title="将从仓库删除该插件及其安装包，无法恢复"
                  onConfirm={() => deletePluginMut.mutate(row.id)}
                >
                  <Button size="small" danger>
                    删除
                  </Button>
                </Popconfirm>
              </>
            ) : row.installed ? (
              <span style={{ color: '#999' }}>已安装</span>
            ) : (
              <span style={{ color: '#999' }}>待管理员安装</span>
            )}
          </Space>
        )
      },
    },
  ]

  const draftColumns = [
    { title: '插件', dataIndex: 'display_name', render: (v: string, row: PluginDraft) => v || row.name },
    { title: '标识', dataIndex: 'name', render: (v: string) => <code>{v}</code> },
    { title: '版本', dataIndex: 'version', width: 90 },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (v: string) => (v === 'ai' ? <Tag color="purple">AI 起草</Tag> : <Tag>人工</Tag>),
    },
    {
      title: '体检',
      width: 160,
      render: (_: unknown, row: PluginDraft) => {
        const high = row.lint?.high_count || 0
        const warn = row.lint?.warn_count || 0
        return (
          <Space size={4}>
            {high > 0 ? <Tag color="volcano">高危 {high}</Tag> : <Tag color="green">无高危</Tag>}
            {warn > 0 ? <Tag color="gold">提醒 {warn}</Tag> : null}
          </Space>
        )
      },
    },
    {
      title: '试跑',
      dataIndex: 'trial_status',
      width: 100,
      render: (v: string) =>
        v ? (
          <Tag color={v === 'success' ? 'green' : v === 'failed' ? 'red' : 'blue'}>{v}</Tag>
        ) : (
          <span style={{ color: '#999' }}>未试跑</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const s = draftStatusMap[v] || { color: 'default', text: v }
        return <Tag color={s.color}>{s.text}</Tag>
      },
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, row: PluginDraft) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => setDraftId(row.id)}>
            审阅代码
          </Button>
          <Popconfirm title="删除后无法恢复" onConfirm={() => deleteDraftMut.mutate(row.id)}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const templateColumns = [
    { title: '模板名称', dataIndex: 'name' },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    { title: '版本', dataIndex: 'version', width: 90 },
    {
      title: '共享范围',
      dataIndex: 'scope',
      render: (v: string) => (v === 'public' ? <Tag color="green">公开</Tag> : <Tag>私有</Tag>),
    },
  ]

  const components = componentsQuery.data || []
  const skills = components.filter((item) => item.kind === 'agent-skill')
  const tools = components.filter((item) => item.kind === 'agent-tool')
  /** 内置助手工具，不是技能包。展示在 Agent 工具 → 内置工具。 */
  const builtinTools = (builtinToolsQuery.data || []).filter((item) => item.source === 'builtin')
  const componentName = (row: HarnessComponent) => row.manifest.display_name || row.name
  const canManageComponent = (row: HarnessComponent) =>
    isAdmin ||
    (row.kind === 'agent-skill' &&
      (row.owner_user_id === userId || (!row.owner_user_id && row.publisher_id === userId)))

  /** 卸载只改状态；删除才从仓库拿走。个人技能主人、全员技能发布者或管理员可下架。别人不能删。 */
  const lifecycleActions = (row: HarnessComponent) =>
    canManageComponent(row) ? (
    <Space size={4} wrap>
      {row.status === 'uninstalled' ? (
        <Button
          size="small"
          type="primary"
          onClick={() => lifecycleMut.mutate({ component: row, action: 'reinstall' })}
        >
          安装
        </Button>
      ) : (
        <Button
          size="small"
          onClick={() =>
            lifecycleMut.mutate({ component: row, action: row.enabled ? 'disable' : 'enable' })
          }
        >
          {row.enabled ? '停用' : '启用'}
        </Button>
      )}
      {row.status !== 'uninstalled' ? (
        <Button size="small" onClick={() => lifecycleMut.mutate({ component: row, action: 'health' })}>
          检查
        </Button>
      ) : null}
      {row.status === 'uninstalled' ? null : (
        <Popconfirm title={`确认卸载 ${componentName(row)}？卸载后可再安装，包仍留在列表里。`} onConfirm={() => lifecycleMut.mutate({ component: row, action: 'uninstall' })}>
          <Button size="small">卸载</Button>
        </Popconfirm>
      )}
      <Popconfirm
        title={`将彻底删除「${componentName(row)}」，无法恢复`}
        onConfirm={() => lifecycleMut.mutate({ component: row, action: 'purge' })}
      >
        <Button size="small" danger>
          删除
        </Button>
      </Popconfirm>
    </Space>
    ) : null

  const skillColumns = [
    {
      title: '技能',
      render: (_: unknown, row: HarnessComponent) => (
        <Space direction="vertical" size={0}>
          <b>{componentName(row)}</b>
          <span style={{ color: '#999', fontSize: 12 }}>{row.manifest.description || row.key}</span>
        </Space>
      ),
    },
    { title: '版本', dataIndex: 'version', width: 90 },
    {
      title: '范围',
      width: 90,
      render: (_: unknown, row: HarnessComponent) =>
        row.owner_user_id ? <Tag color="purple">个人</Tag> : <Tag>全员</Tag>,
    },
    {
      title: '能力',
      width: 220,
      render: (_: unknown, row: HarnessComponent) => (
        <Space size={[4, 4]} wrap>
          {(row.manifest.capabilities || []).map((value) => <Tag key={value}>{value}</Tag>)}
        </Space>
      ),
    },
    {
      title: '状态',
      width: 160,
      render: (_: unknown, row: HarnessComponent) => (
        <Space size={4}>
          {lifecycleStatusTag(row)}
          {row.status === 'uninstalled' ? null : healthTag(row.health_status, row.health_message)}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 420,
      render: (_: unknown, row: HarnessComponent) => (
        <Space wrap>
          <Tooltip title="下载技能包，改 name 后可再上传">
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadTemplate(
                  `/harness/components/${row.id}/package`,
                  storeZipName(row.name, row.version),
                )
              }
            >
              下载
            </Button>
          </Tooltip>
          <Button size="small" onClick={() => setResourceComponent(row)}>资源</Button>
          {lifecycleActions(row)}
        </Space>
      ),
    },
  ]

  const toolColumns = [
    {
      title: '工具',
      render: (_: unknown, row: HarnessComponent) => (
        <Space direction="vertical" size={0}>
          <b>{componentName(row)}</b>
          <code style={{ fontSize: 12 }}>{row.manifest.entrypoint || row.key}</code>
        </Space>
      ),
    },
    {
      title: '签名',
      width: 120,
      render: (_: unknown, row: HarnessComponent) => {
        const metadata = row.manifest.metadata || {}
        const signed = Boolean(metadata.signed ?? metadata.signature)
        return <Tag color={signed ? 'green' : 'red'}>{signed ? '已验证' : '未验证'}</Tag>
      },
    },
    {
      title: '隔离',
      width: 130,
      render: (_: unknown, row: HarnessComponent) => {
        const metadata = row.manifest.metadata || {}
        return <Tag color="blue">{String(metadata.isolation || metadata.sandbox || '进程隔离')}</Tag>
      },
    },
    {
      title: 'Schema',
      width: 100,
      render: (_: unknown, row: HarnessComponent) => (
        <Tag color={Object.keys(row.manifest.config_schema || {}).length ? 'cyan' : 'default'}>
          {Object.keys(row.manifest.config_schema || {}).length ? '已声明' : '无'}
        </Tag>
      ),
    },
    {
      title: '指标',
      width: 180,
      render: (_: unknown, row: HarnessComponent) => {
        const metrics = (row.manifest.metadata?.metrics || {}) as Record<string, unknown>
        return Object.keys(metrics).length ? (
          <span>{Object.entries(metrics).slice(0, 2).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}</span>
        ) : <span style={{ color: '#999' }}>暂无采样</span>
      },
    },
    {
      title: '状态',
      width: 160,
      render: (_: unknown, row: HarnessComponent) => (
        <Space size={4}>
          {lifecycleStatusTag(row)}
          {row.status === 'uninstalled' ? null : healthTag(row.health_status, row.health_message)}
        </Space>
      ),
    },
    { title: '操作', width: 360, render: (_: unknown, row: HarnessComponent) => (
      <Space wrap>
        <Tooltip title="下载原 zip，改 name 并重新签名后上传">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadTemplate(
                `/harness/components/${row.id}/package`,
                storeZipName(row.name, row.version),
              )
            }
          >
            下载
          </Button>
        </Tooltip>
        {lifecycleActions(row)}
      </Space>
    ) },
  ]

  const builtinColumns = [
    {
      title: '工具',
      render: (_: unknown, row: HarnessTool) => (
        <Space direction="vertical" size={0}>
          <Space size={8}>
            <b>{row.display_name || row.name}</b>
            <Tag>内置</Tag>
          </Space>
          <code style={{ fontSize: 12 }}>{row.name}</code>
        </Space>
      ),
    },
    {
      title: '分类',
      width: 90,
      render: (_: unknown, row: HarnessTool) => builtinCategoryMap[row.category || ''] || row.category || '-',
    },
    {
      title: '风险',
      width: 90,
      render: (_: unknown, row: HarnessTool) => {
        const risk = riskMap[row.risk || 'read'] || { color: 'default', text: row.risk || '只读' }
        return <Tag color={risk.color}>{risk.text}</Tag>
      },
    },
    {
      title: '隔离',
      width: 100,
      render: () => <Tag color="geekblue">进程内</Tag>,
    },
    {
      title: '说明',
      ellipsis: true,
      dataIndex: 'description',
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, row: HarnessTool) => (
        <Tooltip title="下载成技能包。改 manifest.yaml 的 name 后上传，不会替换内置工具本身">
          <Button
            size="small"
            icon={<DownloadOutlined />}
            onClick={() =>
              downloadTemplate(
                `/harness/tools/${encodeURIComponent(row.name)}/skill-package`,
                `${row.name}-skill-1.0.0.zip`,
              )
            }
          >
            下载
          </Button>
        </Tooltip>
      ),
    },
  ]

  const harnessFallback = componentsQuery.isError

  return (
    <Card
      title="技能库"
      extra={
        <Button icon={<ReloadOutlined />} onClick={refreshHarness}>
          刷新运行状态
        </Button>
      }
    >
      {harnessFallback && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Harness 目录暂不可用"
          description="Agent 技能、工具及运行时将以只读空状态降级；流水线插件、草稿和模板仍可正常使用。"
        />
      )}
      <Tabs
        items={[
          {
            key: 'pipeline',
            label: `流水线插件（${plugins.length}） / 草稿（${drafts.filter((d) => d.status === 'pending').length}）`,
            children: (
              <>
                <p style={{ color: '#666' }}>
                  平台自带的流水线插件不可卸载、不可删除，但可以下载源码。
                  第三方插件会在构建机上执行，必须签名；上架和安装只有管理员能做。
                  安装后编排器立刻能选，不必重启。真正跑流水线仍要有该流水线的执行权。
                </p>
                <Tabs
                  type="card"
                  defaultActiveKey={drafts.some((d) => d.status === 'pending') ? 'drafts' : 'plugins'}
                  items={[
                    {
                      key: 'plugins',
                      label: `插件（${plugins.length}）`,
                      children: (
                        <>
                          <div style={{ marginBottom: 12, textAlign: 'right' }}>
                            <Space>
                              <Button
                                icon={<DownloadOutlined />}
                                onClick={() =>
                                  downloadTemplate('/store/plugins/template', 'rp-pipeline-plugin-template.zip')
                                }
                              >
                                下载插件开发模板
                              </Button>
                              {isAdmin ? (
                              <Upload
                                accept=".zip"
                                showUploadList={false}
                                customRequest={async (opt) => {
                                  try {
                                    const form = new FormData()
                                    form.append('file', opt.file as File)
                                    await postForm('/store/plugins/upload', form)
                                    message.success('已上传，请点击安装')
                                    refreshPlugins()
                                    opt.onSuccess?.(undefined)
                                  } catch (e) {
                                    opt.onError?.(e as Error)
                                  }
                                }}
                              >
                                <Button icon={<UploadOutlined />} type="primary">上传插件 zip</Button>
                              </Upload>
                              ) : null}
                            </Space>
                          </div>
                          <DataTable chromeKey="store-plugins" rowKey="id" columns={pluginColumns} dataSource={plugins} pagination={false} />
                        </>
                      ),
                    },
                    {
                      key: 'drafts',
                      label: `插件草稿（${drafts.filter((d) => d.status === 'pending').length}）`,
                      children: (
                        <>
                          <p style={{ color: '#666' }}>
                            AI 草稿不会进入插件仓库；请审阅源码并试跑后再发布。不要的草稿可以直接删除。
                          </p>
                          <DataTable chromeKey="store-drafts" rowKey="id" columns={draftColumns} dataSource={drafts} pagination={false} />
                        </>
                      ),
                    },
                    {
                      key: 'templates',
                      label: `流水线模板（${templates.length}）`,
                      children: <DataTable chromeKey="store-templates" rowKey="id" columns={templateColumns} dataSource={templates} pagination={false} />,
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'skills',
            label: `Agent 技能（${skills.length}）`,
            children: (
              <>
                <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ color: '#666' }}>
                    技能包只有说明书，不含可执行代码。对话里真正调用的工具在「Agent 工具」。
                    技能库上传会共享给全部人员，立刻可用；删除只有发布者或管理员。
                    只给自己用的技能走 AI 助手确认卡，不会出现在别人的目录里。
                  </span>
                  <Space>
                    <Button
                      icon={<DownloadOutlined />}
                      onClick={() =>
                        downloadTemplate('/harness/templates/agent-skill', 'release-agent-skill-template.zip')
                      }
                    >
                      下载技能包模板
                    </Button>
                    <Upload
                      accept=".zip,.json"
                      showUploadList={false}
                      customRequest={async (opt) => {
                        try {
                          const form = new FormData()
                          form.append('file', opt.file as File)
                          await postForm('/harness/components/upload', form)
                          message.success('技能已共享给全部人员，可立即使用')
                          refreshHarness()
                          opt.onSuccess?.(undefined)
                        } catch (error) {
                          message.warning('当前服务不支持技能包上传，请升级 Harness API')
                          opt.onError?.(error as Error)
                        }
                      }}
                    >
                      <Button type="primary" icon={<UploadOutlined />}>上传技能包</Button>
                    </Upload>
                  </Space>
                </Space>
                {skills.length ? (
                  <DataTable chromeKey="store-skills" rowKey="key" columns={skillColumns} dataSource={skills} pagination={false} />
                ) : (
                  <Empty description={harnessFallback ? '兼容模式下暂不提供技能目录' : '暂无已安装技能包'} />
                )}
              </>
            ),
          },
          {
            key: 'tools',
            label: `Agent 工具（${builtinTools.length + tools.length}）`,
            children: (
              <Tabs
                type="card"
                items={[
                  {
                    key: 'builtin-tools',
                    label: `内置工具（${builtinTools.length}）`,
                    children: (
                      <>
                        <p style={{ color: '#666' }}>
                          平台自带的助手工具，对话里可直接调用。跑在 API 进程内，不能卸载、不能删除。
                          可以下载成技能包，改掉 manifest.yaml 的 name 后上传，用来教模型怎么用这些能力。
                        </p>
                        {builtinTools.length ? (
                          <DataTable
                            chromeKey="store-builtin-tools"
                            rowKey="name"
                            columns={builtinColumns}
                            dataSource={builtinTools}
                            pagination={false}
                          />
                        ) : (
                          <Empty description={builtinToolsQuery.isError ? '工具目录暂不可用' : '暂无内置工具'} />
                        )}
                      </>
                    ),
                  },
                  {
                    key: 'package-tools',
                    label: `第三方工具（${tools.length}）`,
                    children: (
                      <>
                        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
                          <span style={{ color: '#666' }}>
                            第三方工具在隔离容器里执行，必须签名。上传、启用、删除只有管理员能做。
                          </span>
                          <Space>
                            <Button
                              icon={<DownloadOutlined />}
                              onClick={() =>
                                downloadTemplate('/harness/templates/agent-tool', 'release-agent-tool-template.zip')
                              }
                            >
                              下载工具包模板
                            </Button>
                            {isAdmin ? (
                            <Upload
                              accept=".zip"
                              showUploadList={false}
                              customRequest={async (opt) => {
                                try {
                                  const form = new FormData()
                                  form.append('file', opt.file as File)
                                  await postForm('/harness/components/upload', form)
                                  message.success('工具包已上传并进入安装流程')
                                  refreshHarness()
                                  opt.onSuccess?.(undefined)
                                } catch (error) {
                                  message.warning('当前服务不支持工具包上传，请升级 Harness API')
                                  opt.onError?.(error as Error)
                                }
                              }}
                            >
                              <Button type="primary" icon={<UploadOutlined />}>上传工具包</Button>
                            </Upload>
                            ) : null}
                          </Space>
                        </Space>
                        {tools.length ? (
                          <DataTable chromeKey="store-tools" rowKey="key" columns={toolColumns} dataSource={tools} pagination={false} scroll={{ x: 1100 }} />
                        ) : (
                          <Empty description={harnessFallback ? '兼容模式下暂不提供工具目录' : '暂无第三方 Agent 工具'} />
                        )}
                      </>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'runtime',
            label: '运行时',
            children: (
              <>
                {runtimeQuery.isError ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="运行时 API 不可用"
                    description="组件生命周期仍可通过兼容接口管理；会话执行继续使用现有 AI 服务。"
                  />
                ) : runtimeQuery.data ? (
                  <>
                    {runtimeQuery.data.isolation !== 'ready' && (
                      <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="隔离 Runner 不可用，第三方 Agent 工具将拒绝执行"
                        description={runtimeQuery.data.isolation_error || '请在平台设置里配置 harness_runner_url 和 harness_runner_token。'}
                      />
                    )}
                    <Descriptions bordered column={{ xs: 1, sm: 2, md: 3 }} style={{ marginBottom: 16 }}>
                      <Descriptions.Item label="状态">
                        <Tag color={runtimeQuery.data.status === 'healthy' ? 'green' : 'orange'}>
                          {runtimeQuery.data.status === 'healthy' ? '正常' : '降级'}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="隔离">
                        <Tag color={runtimeQuery.data.isolation === 'ready' ? 'green' : 'red'}>
                          {runtimeQuery.data.isolation === 'ready' ? '就绪' : '不可用'}
                        </Tag>
                      </Descriptions.Item>
                      <Descriptions.Item label="活动运行实例">{runtimeQuery.data.active_runtimes ?? 0}</Descriptions.Item>
                      <Descriptions.Item label="已安装组件">{runtimeQuery.data.loaded_components ?? components.length}</Descriptions.Item>
                      <Descriptions.Item label="按类型" span={2}>
                        {Object.entries(runtimeQuery.data.by_kind || {}).map(([kind, count]) => (
                          <Tag key={kind}>{kind} · {count}</Tag>
                        ))}
                      </Descriptions.Item>
                    </Descriptions>
                  </>
                ) : null}
                <Card size="small" title={<Space><CloudServerOutlined />生命周期事件</Space>}>
                  <DataTable
                    chromeKey="store-lifecycle"
                    size="small"
                    rowKey="id"
                    loading={eventsQuery.isLoading}
                    dataSource={eventsQuery.data || []}
                    columns={[
                      { title: '组件', dataIndex: 'extension_key' },
                      { title: '动作', dataIndex: 'action', width: 100 },
                      { title: '状态', width: 100, render: (_: unknown, row: HarnessLifecycleEvent) => <Tag color={row.success ? 'green' : 'red'}>{row.success ? '成功' : '失败'}</Tag> },
                      { title: '说明', dataIndex: 'message', ellipsis: true },
                      { title: '操作人', dataIndex: 'actor_name', width: 100 },
                      { title: '时间', dataIndex: 'created_at', width: 180 },
                    ]}
                    locale={{ emptyText: eventsQuery.isError ? '生命周期事件接口不可用' : '暂无事件' }}
                  />
                </Card>
              </>
            ),
          },
        ]}
      />
      <PluginDraftDrawer draftId={draftId} onClose={() => setDraftId(null)} />
      <Drawer
        title={resourceComponent ? `${componentName(resourceComponent)} · 资源` : '技能资源'}
        open={!!resourceComponent}
        width={560}
        onClose={() => setResourceComponent(null)}
      >
        {resourceComponent && (
          <>
            <Descriptions column={1} bordered size="small">
              <Descriptions.Item label="入口">{resourceComponent.manifest.entrypoint || '声明式技能'}</Descriptions.Item>
              <Descriptions.Item label="来源">{resourceComponent.source_ref || resourceComponent.source || '—'}</Descriptions.Item>
              <Descriptions.Item label="能力">{(resourceComponent.manifest.capabilities || []).join('、') || '—'}</Descriptions.Item>
            </Descriptions>
            <Card size="small" title={<Space><ApiOutlined />资源声明</Space>} style={{ marginTop: 16 }}>
              <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                {JSON.stringify(resourceComponent.manifest.metadata?.resources || resourceComponent.manifest.config_schema || {}, null, 2)}
              </pre>
            </Card>
          </>
        )}
      </Drawer>
    </Card>
  )
}
