import { useState } from 'react'
import { Card, Tag, Tooltip, Button, Space, Modal, Form, Input, Popconfirm, Radio, Select, message, Alert, Typography } from 'antd'
import DataTable from '@/components/DataTable'
import {
  CloudServerOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  PlusOutlined,
  CopyOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ConsoleSqlOutlined,
  LoadingOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, del, post, patch, getBlob } from '@/api/client'
import { copyText } from '@/utils/clipboard'
import type { BuildAgent } from '@/api/types'
import { envInstallArgs, envLabel, envOptions, envSelectOptions } from '@/env'
import { useAuthStore } from '@/stores/auth'

const { Paragraph, Text } = Typography

// 平台地址：默认取当前浏览器访问的 host（用户用 IP/域名访问前端，就生成对应 IP/域名的命令）
// 端口固定 8080（后端）；若走 nginx 反代可改为 80/域名，由用户在弹窗手动覆盖
const DEFAULT_SERVER_URL = `${window.location.protocol}//${window.location.hostname}:8080`

const TAG_OPTIONS = [
  'linux', 'maven', 'docker', 'gradle',
  'windows', 'dotnet', 'iis',
  'macos', 'xcode', 'node',
]

type RunMode = 'script' | 'foreground' | 'background'

export default function Agents() {
  const queryClient = useQueryClient()
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()
  const [mode, setMode] = useState<RunMode>('script')
  // 命令区是在 Form 外面渲染的，表单改了不会自然带动它重算
  const [, bumpForm] = useState(0)

  // 只看构建机；生产部署节点在「节点管理」页，两者机制相同但职责完全不同
  const { data: agents = [] } = useQuery({
    queryKey: ['agents', 'builder'],
    queryFn: () => get<BuildAgent[]>('/agents?role=builder'),
    refetchInterval: 10000,
  })

  // 接入凭证：只在打开接入弹窗时取，避免列表页把它挂在内存里
  const { data: enroll } = useQuery({
    queryKey: ['agent-enroll-token'],
    queryFn: () => get<{ token: string }>('/agents/enroll-token'),
    enabled: open,
  })
  const enrollToken = enroll?.token || ''

  const rotateToken = async () => {
    Modal.confirm({
      title: '轮换接入凭证',
      content: '轮换后旧凭证立即失效，新构建机需用新凭证接入。已登记的构建机不受影响。',
      okText: '轮换',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await post('/agents/enroll-token/rotate')
        queryClient.invalidateQueries({ queryKey: ['agent-enroll-token'] })
        message.success('已轮换')
      },
    })
  }

  const downloadJar = async () => {
    try {
      const blob = await getBlob('/agents/download')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'deploy-agent.jar'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      message.error('下载失败，请确认已登录且能打开本页')
    }
  }

  const handleDelete = async (id: number) => {
    await del(`/agents/${id}`)
    queryClient.invalidateQueries({ queryKey: ['agents', 'builder'] })
  }

  /** 版本落后时的按钮说明：卡住了要解释原因，升级中则说明会自己换。 */
  const upgradeHint = (r: BuildAgent) => {
    if (!r.outdated) {
      return '已经是平台当前版本'
    }
    if (r.upgrade_error) {
      return `自动升级没成功：${r.upgrade_error}`
    }
    if (r.effective_status !== 'online') {
      return '构建机离线收不到指令，恢复心跳后会自动升级'
    }
    return '构建机会在没有任务时自动换版本；点一下是催它越过熔断再试一次'
  }

  /**
   * 催构建机再下一遍新 jar。
   * 换包失败后 Agent 会熔断，不再理会 should_upgrade；这个接口会带 force_upgrade，
   * 让它立刻重试。守护进程本身坏了的话，重试也换不上，需要到机器上重跑安装脚本。
   */
  const handleUpgrade = (r: BuildAgent) => {
    Modal.confirm({
      title: `催一下构建机「${r.name}」升级`,
      content: r.upgrade_error
        ? `上次没升成功：${r.upgrade_error}。再试一次会让它越过失败熔断重新下载。若仍不行，请到机器上重跑安装脚本。`
        : `从 ${r.agent_version} 升到 ${r.latest_version}。构建机会等当前任务跑完再换版本并自动重启。`,
      okText: '重试升级',
      cancelText: '取消',
      onOk: async () => {
        await post(`/agents/${r.id}/upgrade`, {})
        message.success('已催促，换版本完成后这里会自动更新')
        queryClient.invalidateQueries({ queryKey: ['agents', 'builder'] })
      },
    })
  }

  // 构建机环境决定它能领哪种流水线的构建任务：必须和环境分组 type 全等。
  // 改动本身会进审计
  const changeEnv = (agent: BuildAgent, env: string) => {
    const label = envLabel(env)
    Modal.confirm({
      title: `把「${agent.name}」标记为${label}构建机`,
      content: `标记后，这台只能构建${label}环境的流水线。UAT 流水线不会发到生产机构建，反过来也不行。`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        await patch(`/agents/${agent.id}`, { env })
        queryClient.invalidateQueries({ queryKey: ['agents', 'builder'] })
        message.success('已更新')
      },
    })
  }

  // 命令实时从表单派生（不再需要「生成启动命令」按钮）
  const renderCommand = (): { cmd: string; note: string | null; os: string } | null => {
    const v = form.getFieldsValue()
    if (!v.name) return null
    const tags = (v.tags || []).join(',')
    // 平台地址：表单可编辑，默认取当前浏览器 host（虚拟机/其他机器要连到这台主机，不能是 localhost）
    const serverUrl = (v.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')
    // 标签为空时省略 --tags，避免生成空参数
    // 接入凭证只有首次注册要带，之后 Agent 用落盘的凭据续期
    const enrollArg = enrollToken ? ` --enroll-token ${enrollToken}` : ''
    const workspace = (v.workspace || '').trim()
    const wsArg = workspace ? ` --workspace "${workspace}"` : ''
    // 环境只在这台机器首次接入平台时生效，之后以列表里的设置为准
    const envArgs = envInstallArgs(v.env)
    const base = `java -jar deploy-agent.jar --server ${serverUrl} --name ${v.name}${tags ? ` --tags ${tags}` : ''}${wsArg}${envArgs.cli}${enrollArg}`
    const os = v.os || 'linux'

    if (mode === 'script') {
      // 脚本自己从平台下载 jar，不用先把 jar 和脚本传到机器上
      const tagArg = tags ? ` -Tags ${tags}` : ''
      const shTags = tags ? `TAGS=${tags} ` : ''
      // 显式带 Server：万一机器上留着旧脚本没被覆盖，也不会拿错平台地址
      if (os === 'windows') {
        return {
          cmd:
            `iwr "${serverUrl}/api/v1/agents/install-script?role=builder" -OutFile install-agent.ps1\n` +
            `.\\install-agent.ps1 -Server ${serverUrl} -Name ${v.name}${tagArg}${envArgs.ps}` +
            `${workspace ? ` -Workspace "${workspace}"` : ''}` +
            `${enrollToken ? ` -EnrollToken ${enrollToken}` : ''}`,
          note: '脚本会自己下载 jar、生成启动器并拉起，升级时重跑同样的命令。',
          os,
        }
      }
      return {
        cmd:
          `curl -fsSL "${serverUrl}/api/v1/agents/install-script?role=builder-linux" -o install-agent.sh\n` +
          `SERVER=${serverUrl} ${shTags}${envArgs.shPrefix}NAME=${v.name}` +
          `${workspace ? ` WORKSPACE=${workspace}` : ''}` +
          `${enrollToken ? ` ENROLL_TOKEN=${enrollToken}` : ''} bash install-agent.sh`,
        note: '脚本会自己下载 jar 并 nohup 启动，升级时重跑同样的命令。',
        os,
      }
    }

    if (mode === 'foreground') {
      return { cmd: base, note: '前台运行（关闭终端/SSH 进程会被杀死，仅用于调试）', os }
    }

    if (os === 'windows') {
      return {
        cmd: `start /B ${base} > agent.log 2>&1`,
        note: '查看日志：type agent.log\n停止 Agent：taskkill /F /FI "WINDOWTITLE eq deploy-agent*"',
        os,
      }
    }
    // Linux / macOS（nohup 通用）
    return {
      cmd: `nohup ${base} > agent.log 2>&1 &\necho "Agent 已在后台启动，日志输出到 agent.log"`,
      note: '查看日志：tail -f agent.log\n停止 Agent：pkill -f deploy-agent.jar',
      os,
    }
  }

  const copyCommand = async () => {
    const result = renderCommand()
    if (!result) {
      message.warning('请先填写机器名称')
      return
    }
    await copyText(result.cmd, '命令已复制，到目标机器上执行即可')
  }

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (v: string) => <Space><CloudServerOutlined />{v}</Space>,
    },
    { title: '主机', dataIndex: 'host' },
    {
      title: '系统',
      dataIndex: 'os',
      render: (v: string) =>
        v === 'linux' ? <Tag color="blue">🐧 Linux</Tag>
        : v === 'windows' ? <Tag color="purple">🪟 Windows</Tag>
        : <Tag color="orange">🍎 macOS</Tag>,
    },
    {
      title: '环境',
      dataIndex: 'env',
      width: 110,
      render: (v: string, r: BuildAgent) => (
        <Tooltip title={`只构建${envLabel(v)}环境的流水线`}>
          <Select
            size="small"
            value={v || undefined}
            placeholder="未标"
            style={{ width: 96 }}
            onChange={(next) => changeEnv(r, next)}
            options={envSelectOptions(agents.map((a) => a.env))}
            disabled={!isAdmin}
          />
        </Tooltip>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      render: (v: string) => {
        try {
          const tags = JSON.parse(v)
          return tags.map((t: string) => <Tag key={t}>{t}</Tag>)
        } catch {
          return v
        }
      },
    },
    {
      title: '状态',
      dataIndex: 'effective_status',
      render: (v: string, r: BuildAgent) => {
        // 后端 effective_status 已根据 last_heartbeat 推算：online 但超时 → offline
        const tag = v === 'online' ? <Tag color="success">在线</Tag> : <Tag>离线</Tag>
        const hb = r.last_heartbeat
          ? new Date(r.last_heartbeat).toLocaleString('zh-CN', { hour12: false })
          : '从未心跳'
        return (
          <Space direction="vertical" size={0}>
            {tag}
            <span style={{ fontSize: 11, color: '#999' }}>心跳：{hb}</span>
          </Space>
        )
      },
    },
    {
      title: '版本',
      dataIndex: 'agent_version',
      render: (v: string, r: BuildAgent) => {
        if (!v) {
          return <Tag color="warning">未知（旧版 Agent，需重装一次）</Tag>
        }
        return (
          <Space direction="vertical" size={0}>
            <Text code style={{ fontSize: 12 }}>
              {v}
            </Text>
            {r.outdated && r.upgrade_error && (
              <Tooltip title={`${r.upgrade_error}。点右侧「重试升级」可越过熔断再试；仍不行就到机器上重跑安装脚本`}>
                <Tag color="error">升级卡住了 → {r.latest_version}</Tag>
              </Tooltip>
            )}
            {r.outdated && !r.upgrade_error && (
              <Tooltip title={upgradeHint(r)}>
                <Tag color={r.effective_status === 'online' ? 'processing' : 'default'}>
                  {r.effective_status === 'online' ? '自动升级中' : '待升级'} → {r.latest_version}
                </Tag>
              </Tooltip>
            )}
            {r.upgrade_error && (
              <Text type="danger" style={{ fontSize: 11, maxWidth: 280 }} ellipsis>
                {r.upgrade_error}
              </Text>
            )}
          </Space>
        )
      },
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, r: BuildAgent) =>
        isAdmin ? (
        <Space wrap>
          <Tooltip title={upgradeHint(r)}>
            <span>
              <Button
                size="small"
                icon={r.upgrading ? <LoadingOutlined /> : <CloudUploadOutlined />}
                disabled={!r.outdated || r.effective_status !== 'online'}
                onClick={() => handleUpgrade(r)}
              >
                {r.upgrading ? '升级中' : r.upgrade_stalled ? '重试升级' : '升级'}
              </Button>
            </span>
          </Tooltip>
          <Popconfirm
            title={`删除构建机「${r.name}」？`}
            description="删除后这台机器上的 Agent 会失去登记，需要重新执行安装脚本才能接回来"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(r.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
        ) : null,
    },
  ]

  return (
    <div>
      <Card
        title="构建机管理（环境管理）"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新增构建机
          </Button>
        }
      >
        <DataTable chromeKey="agents" rowKey="id" columns={columns} dataSource={agents} pagination={false} />
      </Card>

      {/* 新增构建机弹窗 */}
      <Modal
        title="新增构建机"
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={720}
        destroyOnClose
      >
        <Alert
          type="info"
          showIcon
          message="统一 Agent jar + 启动参数区分构建机"
          description={
            <>
              所有构建机使用<b>同一个 jar 包</b>（下载按钮），
              通过 <code>--name</code>/<code>--tags</code>/<code>--server</code> 启动参数实例化为不同的构建机环境，
              升级 Agent 也只需替换同一份 jar。
            </>
          }
          style={{ marginBottom: 16 }}
        />

        <Alert
          type="warning"
          showIcon
          message="下方命令里的接入凭证等同于「可以领取构建任务」的授权"
          description={
            <>
              构建任务里带着仓库凭证，所以新构建机必须持凭证才能注册。
              凭证只有<b>首次注册</b>要带，之后 Agent 会把登记凭据存在
              <code>~/.release-agent/enrolled/</code>，重启和升级 jar 都不用再带。
              凭证外泄时点「轮换接入凭证」，已登记的构建机不受影响。
            </>
          }
          style={{ marginBottom: 16 }}
        />

        <Form
          form={form}
          layout="vertical"
          initialValues={{ os: 'linux', name: 'my-agent', env: 'prod' }}
          onValuesChange={() => bumpForm((n) => n + 1)}
        >
          <Form.Item label="机器名称（唯一）" name="name" rules={[{ required: true }]}>
            <Input placeholder="如：my-pc / linux-build-01" />
          </Form.Item>

          <Form.Item label="操作系统" name="os" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio value="linux">🐧 Linux</Radio>
              <Radio value="windows">🪟 Windows</Radio>
              <Radio value="macos">🍎 macOS</Radio>
            </Radio.Group>
          </Form.Item>

          <Form.Item
            label="环境"
            name="env"
            extra="流水线只能用同环境码的构建机：UAT 流水线不会发到生产机构建。只在首次接入时生效，之后随时能在列表里改（改动会进审计）。"
          >
            <Select options={envOptions()} />
          </Form.Item>

          <Form.Item label="标签（用于任务调度匹配）" name="tags">
            <Select
              mode="multiple"
              placeholder="选择标签，如 linux, maven, docker"
              options={TAG_OPTIONS.map((t) => ({ value: t, label: t }))}
            />
          </Form.Item>

          <Form.Item
            label="工作空间目录"
            name="workspace"
            extra="拉下来的代码和编译产物都放这里，很吃磁盘。留空则跟着安装目录走（Windows 在 C 盘），系统盘紧张时请指到数据盘"
          >
            <Input
              placeholder={
                form.getFieldValue('os') === 'windows'
                  ? '如 D:\\rp-workspace，留空用默认'
                  : '如 /data/release-workspace，留空用默认'
              }
            />
          </Form.Item>
        </Form>

        {/* 命令区：根据操作系统 + 运行模式实时派生 */}
        {(() => {
          const result = renderCommand()
          if (!result) {
            return (
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                填完「机器名称」后自动生成启动命令
              </Text>
            )
          }
          return (
            <>
              <Radio.Group
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                style={{ marginBottom: 8 }}
                size="small"
              >
                <Radio.Button value="script">一键安装脚本（推荐）</Radio.Button>
                <Radio.Button value="background">手动后台运行</Radio.Button>
                <Radio.Button value="foreground">手动前台运行（调试）</Radio.Button>
              </Radio.Group>
              {mode === 'background' && (
                <Paragraph style={{ marginBottom: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {result.os === 'windows'
                      ? 'Windows 用 cmd 内置 start /B，日志写入 agent.log'
                      : 'nohup 后台启动，日志写入 agent.log，关闭 SSH 不影响'}
                  </Text>
                </Paragraph>
              )}
              <Paragraph style={{ marginBottom: 4 }}>
                <pre
                  style={{
                    background: '#1e1e1e',
                    color: '#d4d4d4',
                    padding: 12,
                    borderRadius: 6,
                    fontSize: 12,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {result.cmd}
                </pre>
              </Paragraph>
              {result.note && (
                <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                  {result.note}
                </Text>
              )}
            </>
          )
        })()}

        <Space style={{ marginTop: 12 }} wrap>
          <Button icon={<CopyOutlined />} onClick={copyCommand}>复制命令</Button>
          <Button icon={<DownloadOutlined />} onClick={downloadJar}>
            下载 Agent（deploy-agent.jar）
          </Button>
          {isAdmin ? (
            <Button icon={<ReloadOutlined />} onClick={rotateToken} danger>
              轮换接入凭证
            </Button>
          ) : null}
          <Button
            icon={<ReloadOutlined />}
            onClick={() => queryClient.invalidateQueries({ queryKey: ['agents', 'builder'] })}
          >
            刷新列表
          </Button>
        </Space>

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          <b>步骤</b>：① 在目标机器上打开终端（需 JDK 8+） → ② 粘贴执行上方命令 → ③
          点刷新列表，看到机器自动注册上线，不必重启发布系统。手动方式才需要先下载 jar。
          <br />
          已装好的机器要换工作空间：填好目录后重跑上方命令即可，旧工作空间里的内容不会自动搬走，可手动删除。
        </Text>
      </Modal>
    </div>
  )
}