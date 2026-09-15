import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd'
import {
  ApartmentOutlined,
  CloudUploadOutlined,
  CopyOutlined,
  DeleteOutlined,
  DesktopOutlined,
  DownloadOutlined,
  EditOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, getBlob, patch, post, postForm } from '@/api/client'
import DataTable from '@/components/DataTable'
import { copyText } from '@/utils/clipboard'
import type { BuildAgent, NodeGroup } from '@/api/types'
import {
  envInstallArgs,
  envLabel,
  envOptions,
  envSelectOptions,
  skipNodePushApproval,
} from '@/env'
import { useAuthStore } from '@/stores/auth'

const { Paragraph, Text } = Typography

const DEFAULT_SERVER_URL = `${window.location.protocol}//${window.location.hostname}:8080`

/** 节点名称会进 sudo env / systemd。拦空格和分号，中文名称放行。 */
const NODE_NAME_UNSAFE = /[\s"'`$;&|<>\\/]/

/** POSIX 单引号：把值原样交给 env，避免 NAME=web RUN_USER=root 这种拆分。 */
function shSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/** PowerShell 单引号：内部单引号写成两个。 */
function psSingleQuote(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`
}

type RunMode = 'script' | 'manual'

/**
 * 节点管理：装了节点 Agent 的生产服务器。
 *
 * 节点不是构建机——它不编译、不跑脚本、不拉代码，只执行发布动作（发文件、启停 IIS），
 * 而且所有写操作都被限制在允许目录内。目录安装时声明，之后可在列表里改，心跳下发给 Agent。
 */
export default function Nodes() {
  const queryClient = useQueryClient()
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  const [open, setOpen] = useState(false)
  /** 弹窗正在改的已有节点；空表示新增。重跑安装必须用原来的名称，否则会登记成另一台。 */
  const [editingNode, setEditingNode] = useState<BuildAgent | null>(null)
  const [savingNode, setSavingNode] = useState(false)
  const [form] = Form.useForm()
  const [mode, setMode] = useState<RunMode>('script')
  // 两套安装方式差别不小：Windows 走 PowerShell + IIS，Linux 走 systemd + sudoers 白名单
  const [os, setOs] = useState<'windows' | 'linux'>('windows')
  // 表单实时派生启动命令，改任意一项都要重算
  const [, forceRender] = useState(0)

  // 机器一多，列表就得能筛能翻，否则几百行全渲染出来页面直接卡住
  const [keyword, setKeyword] = useState('')
  const [groupFilter, setGroupFilter] = useState<number>()
  const [envFilter, setEnvFilter] = useState<string>()
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [groupPanelOpen, setGroupPanelOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignGroupId, setAssignGroupId] = useState<number>()
  /** 加入弹窗里待创建的分组名；创建后只选中，不自动把机器加进去。 */
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [editingGroup, setEditingGroup] = useState<NodeGroup | null>(null)
  const [groupForm] = Form.useForm()
  const [pathsNode, setPathsNode] = useState<BuildAgent | null>(null)
  const [pathsText, setPathsText] = useState('')
  const [savingPaths, setSavingPaths] = useState(false)

  const { data: nodes = [] } = useQuery({
    queryKey: ['agents', 'node'],
    queryFn: () => get<BuildAgent[]>('/agents?role=node'),
    refetchInterval: 10000,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['node-groups'],
    queryFn: () => get<NodeGroup[]>('/node-groups'),
  })

  const { data: enroll } = useQuery({
    queryKey: ['agent-enroll-token'],
    queryFn: () => get<{ token: string }>('/agents/enroll-token'),
    enabled: open,
  })
  const enrollToken = enroll?.token || ''

  const { data: jdkLinux, refetch: refetchJdkLinux } = useQuery({
    queryKey: ['agents-jdk-linux'],
    queryFn: () =>
      get<{ ready: boolean; filename: string; size_bytes: number; persistent: boolean }>(
        '/agents/jdk-linux/status',
      ),
  })

  /** 上传 Linux 节点 JDK 包。file: 用户选的 tar.gz。 */
  const uploadJdkLinux = async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    await postForm('/agents/jdk-linux', form, 600000)
    message.success('JDK 包已保存，重建平台也不会丢')
    refetchJdkLinux()
    return false
  }

  const jdkUploadButton = (
    <Upload
      accept=".tar.gz"
      showUploadList={false}
      beforeUpload={(file) => {
        uploadJdkLinux(file as unknown as File)
        return false
      }}
    >
      <Button icon={<UploadOutlined />}>上传 JDK 包</Button>
    </Upload>
  )

  useEffect(() => {
    if (!open || !editingNode) return
    form.setFieldsValue({
      name: editingNode.name,
      serverUrl: DEFAULT_SERVER_URL,
      env: editingNode.env || 'prod',
      allowPaths: (editingNode.allow_paths || []).join('\n'),
      allowServices: (editingNode.allow_services || []).join('\n'),
      allowIis: '',
    })
    forceRender((n) => n + 1)
  }, [open, editingNode, form])

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['agents', 'node'] })
  const refreshGroups = () => {
    queryClient.invalidateQueries({ queryKey: ['node-groups'] })
    refresh()
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return nodes.filter((n) => {
      if (groupFilter && !(n.groups || []).some((g) => g.id === groupFilter)) return false
      // 老节点可能没有 env 值，按后端默认的 prod 算，别让它们在筛选里凭空消失
      if (envFilter && (n.env || 'prod') !== envFilter) return false
      if (!kw) return true
      return (
        (n.name || '').toLowerCase().includes(kw) ||
        (n.host || '').toLowerCase().includes(kw) ||
        (n.groups || []).some((g) => g.name.toLowerCase().includes(kw))
      )
    })
  }, [nodes, keyword, groupFilter, envFilter])

  const envCount = useMemo(() => {
    const m: Record<string, number> = {}
    for (const n of nodes) {
      const e = n.env || 'prod'
      m[e] = (m[e] || 0) + 1
    }
    return m
  }, [nodes])

  // 批量进出组：几百台机器时这是唯一还能用的操作方式
  const applyAssign = async (join: boolean) => {
    const target = groups.find((g) => g.id === assignGroupId)
    if (!target) {
      message.warning('请先选择分组')
      return
    }
    const current = new Set(target.agent_ids)
    selectedIds.forEach((id) => (join ? current.add(id) : current.delete(id)))
    await patch(`/node-groups/${target.id}`, { agent_ids: [...current] })
    setAssignOpen(false)
    setSelectedIds([])
    refreshGroups()
    message.success(join ? `已加入「${target.name}」` : `已移出「${target.name}」`)
  }

  /**
   * 在加入弹窗里新建空分组并选中。
   * 不自动入组：新建组还没有下发授权，误触加入会把生产节点先绑上去，以后有人给这个组授权范围已经铺开了。
   */
  const createAssignGroup = async () => {
    const name = newGroupName.trim()
    if (!name) {
      message.warning('请填写分组名称')
      return
    }
    setCreatingGroup(true)
    try {
      const created = await post<NodeGroup>('/node-groups', { name })
      setNewGroupName('')
      queryClient.setQueryData<NodeGroup[]>(['node-groups'], (old) => {
        const list = old || []
        if (list.some((g) => g.id === created.id)) return list
        return [...list, created]
      })
      setAssignGroupId(created.id)
      refreshGroups()
      message.success(`已创建「${created.name}」，确认后点「加入该分组」`)
    } finally {
      setCreatingGroup(false)
    }
  }

  const saveGroup = async () => {
    const v = await groupForm.validateFields()
    if (editingGroup) {
      await patch(`/node-groups/${editingGroup.id}`, { name: v.name, description: v.description })
      message.success('已保存')
    } else {
      await post('/node-groups', { name: v.name, description: v.description })
      message.success('已创建')
    }
    setEditingGroup(null)
    groupForm.resetFields()
    refreshGroups()
  }

  const removeGroup = async (g: NodeGroup) => {
    const res = await del<{ revoked: number }>(`/node-groups/${g.id}`)
    refreshGroups()
    message.success(
      res?.revoked ? `已删除，并撤销了 ${res.revoked} 条相关授权` : '已删除',
    )
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

  const rotateToken = () => {
    Modal.confirm({
      title: '轮换接入凭证',
      content: '轮换后旧凭证立即失效，新节点需用新凭证接入。已登记的节点和构建机不受影响。',
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

  /** 把多行/逗号分隔的目录或服务名拆成数组。 */
  const splitLines = (raw: unknown) =>
    String(raw || '')
      .split(/[\n;,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

  /** 打开新增弹窗：清空表单，按 Windows 起步，需要时再切 Linux。 */
  const openCreate = () => {
    setEditingNode(null)
    setOs('windows')
    setMode('script')
    form.resetFields()
    form.setFieldsValue({ serverUrl: DEFAULT_SERVER_URL, env: 'prod' })
    setOpen(true)
  }

  /**
   * 打开已有节点的修改弹窗。
   * 名称不能改：它是这台机器在平台上的身份，systemd 启动参数和凭据文件都按这个名字。
   * 目录和环境可以立刻保存，随心跳生效；服务名单写在机器上的 sudoers 里，必须重跑安装脚本。
   */
  const openEdit = (node: BuildAgent) => {
    setEditingNode(node)
    setOs(node.os === 'linux' ? 'linux' : 'windows')
    setMode('script')
    form.setFieldsValue({
      name: node.name,
      serverUrl: DEFAULT_SERVER_URL,
      env: node.env || 'prod',
      allowPaths: (node.allow_paths || []).join('\n'),
      allowServices: (node.allow_services || []).join('\n'),
      allowIis: '',
    })
    setOpen(true)
  }

  const closeNodeModal = () => {
    setOpen(false)
    setEditingNode(null)
  }

  /** 把弹窗里改过的环境和允许目录写回平台。服务名单只出现在安装命令里，保存改不了 sudoers。 */
  const saveEditingNode = async () => {
    if (!editingNode) return
    const v = await form.validateFields()
    const paths = splitLines(v.allowPaths)
    setSavingNode(true)
    try {
      await patch(`/agents/${editingNode.id}`, {
        env: v.env,
        allow_paths: paths,
      })
      message.success('已保存。目录和环境随心跳生效；Linux 服务名单要重跑安装脚本才会写入 sudoers')
      refresh()
    } finally {
      setSavingNode(false)
    }
  }

  const handleDelete = (node: BuildAgent) => {
    Modal.confirm({
      title: `移除节点「${node.name}」`,
      content: '移除后流水线里选中该节点的步骤会执行失败，请先确认没有流水线在用它。',
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await del(`/agents/${node.id}`)
        refresh()
        message.success('已移除')
      },
    })
  }

  const renderCommand = (): { cmd: string; note: string } | null => {
    const v = form.getFieldsValue()
    if (!v.name || !v.allowPaths) return null
    const serverUrl = (v.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '')
    const paths = splitLines(v.allowPaths)
    const services = splitLines(v.allowServices)
    const iis = splitLines(v.allowIis)
    const envArgs = envInstallArgs(v.env)
    const envNote = skipNodePushApproval(envArgs.value)
      ? `\n标记为${envLabel(envArgs.value)}节点：往这台机器下发文件不需要审批。`
      : `\n标记为${envLabel(envArgs.value)}节点：往这台机器下发文件都要先审批。`
    const rerunNote = editingNode
      ? '\n这是重装命令：到这台机器上再跑一遍即可换上平台当前 jar，已登记的凭据会续上，不用先删节点。'
      : ''

    if (os === 'linux') {
      // Linux 节点必须 root 装：要写 systemd unit 和 sudoers 白名单。
      // Agent 本身跑在普通用户下，root 只是安装期需要
      const svcEnv = services.length ? ` ALLOW_SERVICES=${shSingleQuote(services.join(','))}` : ''
      const tokenEnv = enrollToken ? ` ENROLL_TOKEN=${shSingleQuote(enrollToken)}` : ''
      if (mode === 'script') {
        return {
          cmd:
            `curl -fsSL "${serverUrl}/api/v1/agents/install-script?role=node-linux" -o install-node.sh\n` +
            // 走 sudo env 而不是 sudo VAR=x：后者要看 sudoers 的 env_reset / SETENV 脸色，
            // 有的机器上变量根本传不进去。丢了 SERVER 或 ALLOW_PATHS 脚本会当场报错，
            // 但丢了 ALLOW_SERVICES 是静默的——装完看着成功，到发布时才发现服务停不动
            `sudo env SERVER=${shSingleQuote(serverUrl)} NAME=${shSingleQuote(v.name)} ALLOW_PATHS=${shSingleQuote(paths.join(','))}` +
            ` INSTALL_DIR=$(pwd)` +
            ` ENV=${shSingleQuote(envArgs.value)}${svcEnv}${tokenEnv} bash install-node.sh`,
          note:
            '先 cd 到大盘上的 release 目录再执行这两行，例如 /data/soft/release 或 /mnt/release。\n' +
            '备份会建在该路径第一层下的 release-backup（/data/soft/release → /data/release-backup），安装脚本会交给 release 账号，不必再手工赋权。\n' +
            '需要 systemd。没有可用 JDK 时会从平台自动安装 JDK 8，校验 java -version 通过后才继续装 Agent。\n' +
            'JDK 包在「节点管理」上传一次即可，重建平台也不会丢。\n' +
            'Agent 会以专用普通账号 release 运行，不是 root；要停的服务通过 sudoers 白名单精确放行。\n' +
            '想复用已有的部署账号，在命令里加 RUN_USER=你的账号。' +
            envNote +
            rerunNote,
        }
      }
      const enrollArg = enrollToken ? ` --enroll-token ${shSingleQuote(enrollToken)}` : ''
      const svcArg = services.length ? ` --allow-services ${shSingleQuote(services.join(';'))}` : ''
      return {
        cmd:
          `java -jar deploy-agent.jar --server ${shSingleQuote(serverUrl)} --name ${shSingleQuote(v.name)}` +
          ` --role node${envArgs.cli} --allow-paths ${shSingleQuote(paths.join(';'))}${svcArg}${enrollArg}`,
        note:
          '手动方式：需本机已有 JDK 8+，自己下载 jar 并放到当前目录。\n' +
          '这样跑起来没有 sudoers 白名单，服务启停会失败；关掉窗口进程也就没了。\n' +
          '建议只用于首次连通性验证，正式安装请用脚本。' +
          envNote +
          rerunNote,
      }
    }

    if (mode === 'script') {
      // 脚本自己从平台下载 jar，平台地址已烤进脚本，不用人肉传文件
      const tokenArg = enrollToken ? ` -EnrollToken ${psSingleQuote(enrollToken)}` : ''
      const iisArg = iis.length ? ` -AllowIis ${psSingleQuote(iis.join(','))}` : ''
      return {
        cmd:
          // 显式带 -Server：万一机器上留着旧脚本没被覆盖，也不会拿错平台地址
          `iwr "${serverUrl}/api/v1/agents/install-script?role=node" -OutFile install-node.ps1\n` +
          `.\\install-node.ps1 -Server ${psSingleQuote(serverUrl)} -Name ${psSingleQuote(v.name)} -AllowPaths ${psSingleQuote(paths.join(','))}` +
          `${iisArg}${envArgs.ps}${tokenArg}`,
        note:
          '在节点服务器上「以管理员身份运行」PowerShell，粘贴执行这两行即可。\n' +
          '脚本会自己下载 jar、生成启动器并拉起，升级时重跑同样的命令。\n' +
          'IIS 启停按站点物理路径是否在允许目录内判断；「允许控制的 IIS」可留空，只有老机器需要额外收紧时才填。' +
          envNote +
          rerunNote,
      }
    }

    // 多个目录用分号分隔，和 Windows 的 PATH 习惯一致。手动方式走 cmd，不能用 PowerShell 单引号。
    const enrollArg = enrollToken ? ` --enroll-token "${String(enrollToken).replace(/"/g, '')}"` : ''
    const iisArg = iis.length ? ` --allow-iis "${iis.join(';')}"` : ''
    const base =
      `java -jar deploy-agent.jar --server ${serverUrl} --name ${v.name}` +
      ` --role node${envArgs.cli} --allow-paths "${paths.join(';')}"${iisArg}${enrollArg}`
    return {
      cmd: base,
      note:
        '手动方式：需自己下载 jar 并放到当前目录，且要在「以管理员身份运行」的 cmd 里执行。\n' +
        '关掉窗口进程就没了，建议只用于首次连通性验证。' +
        envNote +
        rerunNote,
    }
  }

  const copyCommand = async () => {
    const result = renderCommand()
    if (!result) {
      message.warning('请先填写节点名称和允许操作的目录')
      return
    }
    await copyText(
      result.cmd,
      editingNode
        ? '命令已复制，到这台服务器上以管理员/root 重跑即可换上当前 jar'
        : '命令已复制，到生产服务器上以管理员身份执行',
    )
  }

  const upgradeHint = (r: BuildAgent) => {
    if (!r.outdated) {
      return '已经是平台当前版本'
    }
    if (r.upgrade_error) {
      return `自动升级没成功：${r.upgrade_error}`
    }
    if (r.effective_status !== 'online') {
      return '节点离线收不到指令。它可能正是换版本后没起来，去机器上重跑安装脚本最快'
    }
    return '节点会在手上的发布跑完后自动换版本，不用管；点一下是催它重试'
  }

  // 版本落后的节点本来就会自己升，这里是「自动升级卡住了想再推一把」的手动重试
  const handleUpgrade = (r: BuildAgent) => {
    Modal.confirm({
      title: `催一下节点「${r.name}」升级`,
      content: r.upgrade_error
        ? `上次没升成功：${r.upgrade_error}。再试一次会让它越过失败熔断重新下载。若仍不行，请到机器上重跑安装脚本。`
        : `从 ${r.agent_version} 升到 ${r.latest_version}。节点会等当前发布任务跑完再换版本并自动重启，期间不会中断正在进行的发布。`,
      okText: '重试升级',
      cancelText: '取消',
      onOk: async () => {
        await post(`/agents/${r.id}/upgrade`, {})
        message.success('已催促，换版本完成后这里会自动更新')
        refresh()
      },
    })
  }

  // 环境决定往这台机器传文件要不要审批，改动本身也会进审计
  const changeEnv = (node: BuildAgent, env: string) => {
    const skip = skipNodePushApproval(env)
    Modal.confirm({
      title: `把「${node.name}」标记为${envLabel(env)}节点`,
      content: skip
        ? `标记为${envLabel(env)}后，有下发权限的人可以直接往这台机器传文件，不再需要审批。请确认这台确实不是生产机。`
        : `标记为${envLabel(env)}后，往这台机器下发文件都要先经过审批。`,
      okText: '确认',
      okButtonProps: { danger: skip },
      cancelText: '取消',
      onOk: async () => {
        await patch(`/agents/${node.id}`, { env })
        refresh()
        message.success('已更新')
      },
    })
  }

  const openAllowPaths = (node: BuildAgent) => {
    setPathsNode(node)
    setPathsText((node.allow_paths || []).join('\n'))
  }

  const saveAllowPaths = async () => {
    if (!pathsNode) return
    const paths = pathsText
      .split(/[\n;,]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    setSavingPaths(true)
    try {
      await patch(`/agents/${pathsNode.id}`, { allow_paths: paths })
      setPathsNode(null)
      refresh()
      message.success('已保存。在线节点大约 10 秒内心跳生效，不用重装')
    } finally {
      setSavingPaths(false)
    }
  }

  const copyEnrollToken = async () => {
    if (!enrollToken) {
      message.warning('没取到接入凭证')
      return
    }
    await copyText(enrollToken, '接入凭证已复制，安装脚本问起时粘贴进去')
  }

  const columns = [
    {
      title: '节点名称',
      dataIndex: 'name',
      render: (v: string) => (
        <Space>
          <DesktopOutlined />
          {v}
        </Space>
      ),
    },
    { title: 'IP / 主机', dataIndex: 'host' },
    {
      title: '所属分组',
      dataIndex: 'groups',
      width: 200,
      render: (v: { id: number; name: string }[] = []) =>
        v.length === 0 ? (
          <Tooltip title="不在任何分组里，只能一台台单独授权">
            <Tag>未分组</Tag>
          </Tooltip>
        ) : (
          <Space size={4} wrap>
            {v.map((g) => (
              <Tag key={g.id} color="geekblue">
                {g.name}
              </Tag>
            ))}
          </Space>
        ),
    },
    {
      title: '系统',
      dataIndex: 'os',
      render: (v: string) =>
        v === 'windows' ? <Tag color="purple">🪟 Windows</Tag> : <Tag color="blue">{v}</Tag>,
    },
    {
      title: '环境',
      dataIndex: 'env',
      width: 130,
      render: (v: string, r: BuildAgent) => (
        <Tooltip title={skipNodePushApproval(v) ? '往这台传文件不用审批' : '往这台传文件要先审批'}>
          <Select
            size="small"
            value={v || undefined}
            placeholder="未标"
            style={{ width: 96 }}
            onChange={(next) => changeEnv(r, next)}
            options={envSelectOptions(nodes.map((n) => n.env))}
            disabled={!isAdmin}
          />
        </Tooltip>
      ),
    },
    {
      title: '允许操作的目录',
      dataIndex: 'allow_paths',
      render: (v: string[] = [], r: BuildAgent) => (
        <Space align="start">
          {v.length === 0 ? (
            <Tag color="error">未配置（所有写操作会被拒绝）</Tag>
          ) : (
            <Space direction="vertical" size={0}>
              {v.map((p) => (
                <Text key={p} code style={{ fontSize: 12 }}>
                  {p}
                </Text>
              ))}
            </Space>
          )}
          <Tooltip title="改完随心跳下发给 Agent，不用重装">
            {isAdmin ? (
              <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openAllowPaths(r)}>
                改目录
              </Button>
            ) : null}
          </Tooltip>
        </Space>
      ),
    },
    {
      title: '允许控制的服务',
      dataIndex: 'allow_services',
      render: (v: string[] = [], r: BuildAgent) => {
        if (r.os === 'windows') {
          return (
            <Tooltip title="IIS 启停看站点物理路径是否落在允许目录内。老安装若启动参数还写了 --allow-iis，会额外收紧。">
              <Text type="secondary">按允许目录判断</Text>
            </Tooltip>
          )
        }
        return v.length === 0 ? (
          <Tooltip title="没声明允许控制的服务，服务启停步骤会被拒绝。只传文件的话这是正常的">
            <Tag>未配置</Tag>
          </Tooltip>
        ) : (
          <Space direction="vertical" size={0}>
            {v.map((s) => (
              <Text key={s} code style={{ fontSize: 12 }}>
                {s}
              </Text>
            ))}
          </Space>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'effective_status',
      render: (v: string, r: BuildAgent) => {
        const hb = r.last_heartbeat
          ? new Date(r.last_heartbeat).toLocaleString('zh-CN', { hour12: false })
          : '从未心跳'
        return (
          <Space direction="vertical" size={0}>
            {v === 'online' ? <Tag color="success">在线</Tag> : <Tag>离线</Tag>}
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
            {r.upgrading && <Tag color="processing">自动升级中 → {r.latest_version}</Tag>}
            {r.upgrade_stalled && (
              <Tooltip title={r.upgrade_error || '节点离线，收不到升级指令'}>
                <Tag color="error">升级卡住了 → {r.latest_version}</Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
    },
    {
      title: '操作',
      width: 230,
      render: (_: unknown, r: BuildAgent) =>
        isAdmin ? (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            修改
          </Button>
          <Tooltip title={upgradeHint(r)}>
            {/* span 包一层：按钮 disabled 时不触发鼠标事件，Tooltip 就不显示了 */}
            <span>
              {/* 不禁用「升级中」：自动升级卡住时（守护进程换不上包）按钮一禁，
                  管理员就只能干等，连重试的入口都没有 */}
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
          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>
            移除
          </Button>
        </Space>
        ) : null,
    },
  ]

  return (
    <div>
      <Card
        title="节点管理（发布目标服务器）"
        extra={
          <Space>
            <Button icon={<ApartmentOutlined />} onClick={() => setGroupPanelOpen(true)}>
              分组管理
            </Button>
            <Button icon={<ReloadOutlined />} onClick={refresh}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增节点
            </Button>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          message="节点是发布的目标机器，不是构建机"
          description={
            <>
              节点 Agent 装在生产服务器上，只执行「发送文件到节点」「还原备份」和启停服务
              （Windows 用 IIS，Linux 用 systemd / Docker）：不编译、不拉代码、不执行任意脚本，
              写操作也只能落在安装时声明的目录内。编译打包请放在<b>构建机</b>上完成。
            </>
          }
          style={{ marginBottom: 16 }}
        />

        {jdkLinux && !jdkLinux.ready ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="还没有 Linux 节点用的 JDK 包"
            description="没有可用 Java 的 Linux 机器装节点时会从平台下载。包写进数据卷，重建镜像不会丢。请上传 jdk-8u271-linux-x64.tar.gz（大约 80～200MB）。"
            action={jdkUploadButton}
          />
        ) : null}

        <Space style={{ marginBottom: 12 }} wrap>
          <Input.Search
            allowClear
            placeholder="搜索节点名 / IP / 分组名"
            style={{ width: 260 }}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Select
            allowClear
            placeholder="按分组筛选"
            style={{ width: 200 }}
            value={groupFilter}
            onChange={setGroupFilter}
            options={groups.map((g) => ({
              value: g.id,
              label: `${g.name}（${g.member_count} 台）`,
            }))}
          />
          <Select
            allowClear
            placeholder="按环境筛选"
            style={{ width: 170 }}
            value={envFilter}
            onChange={setEnvFilter}
            options={envSelectOptions(Object.keys(envCount)).map((o) => ({
              value: o.value,
              label: `${o.label}（${envCount[o.value] || 0} 台）`,
            }))}
          />
          {isAdmin && selectedIds.length > 0 && (
            <>
              <Text type="secondary">已选 {selectedIds.length} 台</Text>
              <Button
                type="primary"
                icon={<ApartmentOutlined />}
                onClick={() => {
                  setAssignGroupId(undefined)
                  setNewGroupName('')
                  setAssignOpen(true)
                }}
              >
                加入 / 移出分组
              </Button>
              <Button onClick={() => setSelectedIds([])}>取消选择</Button>
            </>
          )}
        </Space>

        <DataTable
          chromeKey="nodes"
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          rowSelection={
            isAdmin
              ? {
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys as number[]),
                }
              : undefined
          }
          // 几百台时不分页会把整张表一次渲染出来，页面会卡死
          pagination={{
            showTotal: (t) => `共计 ${t} 台`,
          }}
          locale={{
            emptyText: nodes.length
              ? '没有匹配的节点'
              : '还没有节点，点右上角「新增节点」拿安装命令',
          }}
        />
      </Card>

      <Modal
        title={`把选中的 ${selectedIds.length} 台节点加入或移出分组`}
        open={assignOpen}
        onCancel={() => setAssignOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setAssignOpen(false)}>
            取消
          </Button>,
          <Button key="remove" danger disabled={!assignGroupId} onClick={() => applyAssign(false)}>
            移出该分组
          </Button>,
          <Button
            key="add"
            type="primary"
            disabled={!assignGroupId}
            onClick={() => applyAssign(true)}
          >
            加入该分组
          </Button>,
        ]}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="进出分组会直接改变下发权限"
          description="下发权限授在分组上，机器一入组，所有持有该组权限的人立刻就能往这台机器写文件；移出则立刻失效。"
        />
        <Select
          style={{ width: '100%' }}
          placeholder="选择分组"
          value={assignGroupId}
          onChange={setAssignGroupId}
          options={groups.map((g) => ({
            value: g.id,
            label: `${g.name}（当前 ${g.member_count} 台）`,
          }))}
          notFoundContent={<Empty description="还没有分组，可在下方直接新建" />}
          dropdownRender={(menu) => (
            <>
              {menu}
              {isAdmin ? (
                <>
                  <Divider style={{ margin: '8px 0' }} />
                  <Space.Compact
                    style={{ width: '100%', padding: '0 8px 8px' }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Input
                      placeholder="新分组名称，如 O2O 生产 Web"
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      onPressEnter={() => createAssignGroup()}
                    />
                    <Button type="primary" loading={creatingGroup} onClick={createAssignGroup}>
                      新建
                    </Button>
                  </Space.Compact>
                </>
              ) : null}
            </>
          )}
        />
      </Modal>

      <Modal
        title="节点分组管理"
        open={groupPanelOpen}
        onCancel={() => {
          setGroupPanelOpen(false)
          setEditingGroup(null)
          groupForm.resetFields()
        }}
        footer={null}
        width={640}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="下发权限授在分组上"
          description="机器多了以后按台授权维护不动：扩容要给每个人补一遍，下线了授权还留着。授在分组上，机器进出组权限自动跟着走。授权本身在「权限管理 → 节点授权」里配。"
        />

        <Form form={groupForm} layout="inline" style={{ marginBottom: 16 }}>
          {isAdmin ? (
            <>
              <Form.Item name="name" rules={[{ required: true, message: '请填名称' }]}>
                <Input placeholder="分组名称，如 O2O 生产 Web" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item name="description">
                <Input placeholder="说明（可选）" style={{ width: 200 }} />
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button type="primary" onClick={saveGroup}>
                    {editingGroup ? '保存修改' : '新建分组'}
                  </Button>
                  {editingGroup && (
                    <Button
                      onClick={() => {
                        setEditingGroup(null)
                        groupForm.resetFields()
                      }}
                    >
                      取消编辑
                    </Button>
                  )}
                </Space>
              </Form.Item>
            </>
          ) : null}
        </Form>

        <List
          bordered
          dataSource={groups}
          locale={{ emptyText: '还没有分组' }}
          renderItem={(g) => (
            <List.Item
              actions={
                isAdmin
                  ? [
                <Button
                  key="edit"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setEditingGroup(g)
                    groupForm.setFieldsValue({ name: g.name, description: g.description })
                  }}
                >
                  改名
                </Button>,
                <Popconfirm
                  key="del"
                  title={`删除分组「${g.name}」`}
                  description="挂在这个分组上的授权会一并撤销，组内机器本身不受影响。"
                  okText="删除"
                  okButtonProps={{ danger: true }}
                  cancelText="取消"
                  onConfirm={() => removeGroup(g)}
                >
                  <Button size="small" danger icon={<DeleteOutlined />}>
                    删除
                  </Button>
                </Popconfirm>,
                  ]
                : undefined
              }
            >
              <List.Item.Meta
                title={
                  <Space>
                    <Tag color="geekblue">{g.name}</Tag>
                    <Text type="secondary">{g.member_count} 台</Text>
                  </Space>
                }
                description={g.description || <Text type="secondary">（无说明）</Text>}
              />
            </List.Item>
          )}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          调整组内成员：关掉这个窗口，在列表里勾选节点后点「加入 / 移出分组」。
        </Text>
      </Modal>

      <Modal
        title={editingNode ? `修改节点「${editingNode.name}」` : '新增节点'}
        open={open}
        onCancel={closeNodeModal}
        footer={null}
        width={760}
        destroyOnClose
      >
        {editingNode && (editingNode.effective_status !== 'online' || editingNode.upgrade_stalled) ? (
          <Alert
            type="error"
            showIcon
            message="这台节点离线或升级卡住，页面点升级收不到指令"
            description="复制下方安装脚本，到机器上以 root / 管理员重跑即可换上平台当前 jar。名称不要改，否则会登记成另一台。"
            style={{ marginBottom: 16 }}
          />
        ) : null}
        <Alert
          type="warning"
          showIcon
          message="允许操作的目录决定了这台机器的安全边界"
          description={
            <>
              节点只会在这些目录里写文件，其它路径一律拒绝——就算流水线里填错了目标目录，
              也动不到系统盘。请<b>只填站点根目录</b>，不要图省事填整个盘符。
              {editingNode ? (
                <>
                  <br />
                  改完点「保存到平台」后，目录和环境随心跳生效；Linux 要改可停的服务，必须重跑安装脚本才会写入 sudoers。
                </>
              ) : null}
            </>
          }
          style={{ marginBottom: 16 }}
        />

        <Radio.Group
          value={os}
          disabled={!!editingNode}
          onChange={(e) => {
            setOs(e.target.value)
            forceRender((n) => n + 1)
          }}
          style={{ marginBottom: 16 }}
        >
          <Radio.Button value="windows">🪟 Windows（IIS）</Radio.Button>
          <Radio.Button value="linux">🐧 Linux（systemd / Docker）</Radio.Button>
        </Radio.Group>

        {os === 'linux' && jdkLinux && !jdkLinux.ready ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="先上传 JDK 包，再装没有 Java 的 Linux 节点"
            description="安装脚本会从平台拉 JDK 8。包保存在数据卷，重建平台也不会丢。"
            action={jdkUploadButton}
          />
        ) : null}

        <Form
          key={editingNode ? `edit-${editingNode.id}` : 'create'}
          form={form}
          layout="vertical"
          initialValues={
            editingNode
              ? {
                  name: editingNode.name,
                  serverUrl: DEFAULT_SERVER_URL,
                  env: editingNode.env || 'prod',
                  allowPaths: (editingNode.allow_paths || []).join('\n'),
                  allowServices: (editingNode.allow_services || []).join('\n'),
                }
              : { serverUrl: DEFAULT_SERVER_URL, env: 'prod' }
          }
          onValuesChange={() => forceRender((n) => n + 1)}
        >
          <Form.Item
            label="节点名称（唯一）"
            name="name"
            extra={editingNode ? '名称是这台机器的身份，重装必须用同一个名字' : undefined}
            rules={[
              { required: true, message: '请填名称' },
              {
                validator: (_, value) => {
                  const name = String(value || '')
                  if (!name) return Promise.resolve()
                  if (name.length > 64) return Promise.reject(new Error('最多 64 个字'))
                  if (NODE_NAME_UNSAFE.test(name)) {
                    return Promise.reject(new Error('不能含空格或分号、引号这类会拆开安装命令的字符'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input
              disabled={!!editingNode}
              placeholder={os === 'linux' ? '如：web-prod-01' : '如：iis-prod-01'}
            />
          </Form.Item>

          <Form.Item label="平台地址" name="serverUrl" rules={[{ required: true }]}>
            <Input placeholder={DEFAULT_SERVER_URL} />
          </Form.Item>

          <Form.Item
            label="环境"
            name="env"
            extra={
              <>
                决定往这台机器下发文件要不要审批：<b>测试/开发免审，生产/UAT/预发要审</b>。
                只在这台机器首次接入时生效，之后随时能在列表里改（改动会进审计）。
              </>
            }
          >
            <Select options={envOptions()} />
          </Form.Item>

          <Form.Item
            label="允许操作的目录（一行一个）"
            name="allowPaths"
            rules={[{ required: true }]}
            extra="节点只能在这些目录里覆盖站点文件。备份不在这个名单里：安装时会按执行命令的目录第一层另建 release-backup（例如 /data/soft/release → /data/release-backup）"
          >
            <Input.TextArea
              rows={3}
              placeholder={
                os === 'linux'
                  ? '/var/www/o2o\n/opt/app/api'
                  : 'D:\\wwwroot\\o2o\nD:\\wwwroot\\api'
              }
            />
          </Form.Item>

          {os === 'windows' && (
            <Form.Item
              label="允许控制的 IIS（一行一个，可留空）"
              name="allowIis"
              extra={
                <>
                  可留空。启停是否放行，看站点物理路径是否在上方允许目录内。
                  只有老机器需要再收紧时才写池名，或 <Text code>site:站点名</Text> /{' '}
                  <Text code>apppool:池名</Text>。
                </>
              }
            >
              <Input.TextArea rows={3} placeholder={'可留空；老机器额外收紧时再填'} />
            </Form.Item>
          )}

          {os === 'linux' && (
            <Form.Item
              label="允许控制的服务（一行一个，可留空）"
              name="allowServices"
              extra={
                <>
                  只有写在这里的服务才停得动。安装脚本会据此生成 sudoers 白名单——
                  Agent 以普通账号运行，<b>这条线连启动参数被改了也绕不开</b>。
                  只传文件不停服务可以留空。
                  <br />
                  控制容器要写成 <Text code>docker:容器名</Text>；
                  只写 <Text code>docker</Text> 会被当成 systemd 服务
                  <Text code>docker.service</Text>，那是放行启停 Docker 守护进程本身。
                </>
              }
              rules={[
                {
                  validator: (_, value) => {
                    // 裸类型名按「省略类型即 systemd」的规则会变成 systemd:docker，
                    // 也就是允许停掉整个 Docker，机器上所有容器跟着下线。
                    // 装完才发现和本意差这么远太晚了，在这儿就拦住
                    const bad = String(value || '')
                      .split(/[\n;,]+/)
                      .map((s) => s.trim().toLowerCase())
                      .filter((s) => s === 'docker' || s === 'systemd')
                    if (bad.length) {
                      return Promise.reject(
                        new Error(
                          `「${bad[0]}」写法不明确：控制容器请写 docker:容器名（如 docker:web）；` +
                            '若真要放行启停 Docker 守护进程本身，请显式写 systemd:docker',
                        ),
                      )
                    }
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <Input.TextArea rows={3} placeholder={'systemd:nginx\nsystemd:tomcat\ndocker:web'} />
            </Form.Item>
          )}
        </Form>

        {(() => {
          const result = renderCommand()
          if (!result) {
            return (
              <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                填完「节点名称」和「允许操作的目录」后自动生成安装命令
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
                <Radio.Button value="script">安装脚本（推荐）</Radio.Button>
                <Radio.Button value="manual">手动命令</Radio.Button>
              </Radio.Group>
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
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                {result.note}
              </Text>
            </>
          )
        })()}

        <Space style={{ marginTop: 12 }} wrap>
          {editingNode ? (
            <Button type="primary" loading={savingNode} onClick={saveEditingNode}>
              保存到平台
            </Button>
          ) : null}
          <Button type={editingNode ? 'default' : 'primary'} icon={<CopyOutlined />} onClick={copyCommand}>
            {editingNode ? '复制重装命令' : '复制命令'}
          </Button>
          <Button icon={<CopyOutlined />} onClick={copyEnrollToken}>
            复制接入凭证
          </Button>
          <Button icon={<DownloadOutlined />} onClick={downloadJar}>
            下载 Agent（deploy-agent.jar）
          </Button>
          {isAdmin ? (
            <Button icon={<ReloadOutlined />} onClick={rotateToken} danger>
              轮换接入凭证
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新列表
          </Button>
        </Space>

        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          {os === 'linux' ? (
            <>
              <b>步骤</b>：① 在节点服务器上以 root 登录（需 systemd；没有 JDK 会自动安装并校验） → ②
              粘贴执行上方命令 → ③ 点刷新，看到节点上线即可在插件里选用，不必重启发布系统。
              {editingNode ? ' 升级卡住时直接重跑，不必先停服务、也不必先删节点。' : ''}
              <br />
              停服务用「服务启停控制（Linux）」步骤，IIS 那个用不了。
            </>
          ) : (
            <>
              <b>步骤</b>：① 在节点服务器上<b>以管理员身份</b>打开 PowerShell（需 JRE 8+） → ②
              粘贴执行上方命令 → ③ 点刷新，看到节点上线即可在插件里选用，不必重启发布系统。
            </>
          )}
        </Text>
      </Modal>

      <Modal
        title={pathsNode ? `修改「${pathsNode.name}」的允许目录` : '修改允许目录'}
        open={!!pathsNode}
        onCancel={() => setPathsNode(null)}
        onOk={saveAllowPaths}
        confirmLoading={savingPaths}
        okText="保存"
        destroyOnClose
      >
        <Input.TextArea
          rows={5}
          value={pathsText}
          onChange={(e) => setPathsText(e.target.value)}
          placeholder={'D:\\wwwroot\\o2o\nD:\\wwwroot\\api'}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          一行一个绝对路径。在线节点大约 10 秒内心跳生效，不用重装、也不用改启动参数。
          IIS 启停也按这些目录判断物理路径。
        </Text>
      </Modal>
    </div>
  )
}
