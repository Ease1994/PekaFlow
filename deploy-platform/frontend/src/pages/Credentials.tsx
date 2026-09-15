import { Alert, Card, Tabs, Tag, Button, Modal, Form, Input, Select, Space, Popconfirm, message } from 'antd'
import DataTable from '@/components/DataTable'
import { PlusOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/api/client'
import { useAuthStore } from '@/stores/auth'

interface Credential {
  id: number
  project_id: number | null
  project_name: string
  name: string
  type: string
  description: string
  ciphertext: string
  created_at: string
}

interface ProjectItem {
  id: number
  name: string
  code: string
}

const TYPE_OPTIONS = [
  { label: 'Token', value: 'token' },
  { label: 'SSH Key', value: 'ssh' },
  { label: '账号密码', value: 'password' },
]

const TYPE_TAG: Record<string, JSX.Element> = {
  token: <Tag color="blue">Token</Tag>,
  ssh: <Tag color="green">SSH Key</Tag>,
  password: <Tag color="orange">账号密码</Tag>,
}

/**
 * 按凭证类型切换录入框。
 *
 * 账号密码给华为云 SWR / 阿里云 ACR 等镜像仓库 docker login 用，必须分开填用户名和密码。
 * 编辑时留空表示不改密文。
 *
 * @param editing 是否正在改已有凭证；新建时用户名密码必填
 */
function CredentialSecretFields({ editing }: { editing: boolean }) {
  const form = Form.useFormInstance()
  const type = Form.useWatch('type', form) || 'token'
  if (type === 'password') {
    return (
      <>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="华为云 SWR、阿里云 ACR 等镜像仓库用账号密码登录。流水线里 Docker 构建 / 编译 / 部署步骤可以选择这份凭证，不必把密码写进步骤参数。"
        />
        <Form.Item
          name="username"
          label="用户名"
          rules={editing ? [] : [{ required: true, message: '请填写镜像仓库用户名' }]}
        >
          <Input placeholder="镜像仓库登录用户名" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="password"
          label="密码"
          rules={editing ? [] : [{ required: true, message: '请填写镜像仓库密码' }]}
          extra={editing ? '留空则保留原账号密码；要改就用户名和密码一起填' : '加密存储，不回显'}
        >
          <Input.Password placeholder={editing ? '留空表示不修改' : '镜像仓库登录密码'} />
        </Form.Item>
      </>
    )
  }
  const label = type === 'ssh' ? 'SSH 私钥' : 'Token'
  return (
    <Form.Item
      name="secret"
      label={label}
      rules={editing ? [] : [{ required: true, message: `请输入${label}` }]}
      extra={editing ? '留空则保留原密文；填写则覆盖（加密存储，不回显）' : '加密存储，不回显'}
    >
      {type === 'ssh' ? (
        <Input.TextArea rows={4} placeholder={editing ? '留空表示不修改密文' : '粘贴私钥全文'} />
      ) : (
        <Input.Password placeholder={editing ? '留空表示不修改密文' : '输入 Token（加密存储，不回显）'} />
      )}
    </Form.Item>
  )
}

export default function Credentials() {
  const queryClient = useQueryClient()
  const isAdmin = useAuthStore((s) => s.user?.is_admin)
  const [tab, setTab] = useState('project')
  const [projectFilter, setProjectFilter] = useState<number>()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [form] = Form.useForm()

  const { data: credentials = [] } = useQuery({
    queryKey: ['credentials', 'all'],
    queryFn: () => get<Credential[]>('/credentials', { scope: 'all' }),
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<ProjectItem[]>('/projects'),
  })

  const globalCreds = useMemo(() => credentials.filter((c) => !c.project_id), [credentials])
  const projectCreds = useMemo(
    () =>
      credentials.filter(
        (c) => c.project_id && (!projectFilter || c.project_id === projectFilter),
      ),
    [credentials, projectFilter],
  )

  const closeModal = () => {
    setOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      const credType = values.type || 'token'
      const payload: Record<string, unknown> = {
        name: values.name,
        type: credType,
        description: values.description || '',
      }
      if (credType === 'password') {
        if (values.username || values.password) {
          if (!values.username || !values.password) {
            message.warning('要改账号密码请用户名和密码一起填')
            return
          }
          payload.username = values.username
          payload.password = values.password
        } else if (!editing) {
          message.warning('请填写用户名和密码')
          return
        }
      } else if (values.secret) {
        payload.secret = values.secret
      }
      if (editing) {
        await put(`/credentials/${editing.id}`, payload)
        message.success('已更新，引用该凭证的代码库/流水线下次执行即用新值')
      } else {
        await post('/credentials', { ...payload, project_id: values.project_id ?? null })
        message.success('已创建')
      }
      queryClient.invalidateQueries({ queryKey: ['credentials'] })
      closeModal()
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (id: number) => {
    await del(`/credentials/${id}`)
    queryClient.invalidateQueries({ queryKey: ['credentials'] })
  }

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({
      type: 'token',
      project_id: tab === 'project' ? projectFilter ?? projects[0]?.id : null,
    })
    setOpen(true)
  }

  const openEdit = (row: Credential) => {
    setEditing(row)
    form.setFieldsValue({
      name: row.name,
      type: row.type,
      description: row.description,
      project_id: row.project_id,
      secret: '',
    })
    setOpen(true)
  }

  const baseColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      render: (v: string) => (
        <Space>
          <SafetyCertificateOutlined />
          {v}
        </Space>
      ),
    },
    { title: '类型', dataIndex: 'type', width: 120, render: (v: string) => TYPE_TAG[v] || v },
    { title: '密文（脱敏）', dataIndex: 'ciphertext', render: (v: string) => <code>{v}</code> },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, r: Credential) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            修改
          </Button>
          <Popconfirm title="确认删除该凭证？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const projectColumns = [
    baseColumns[0],
    {
      title: '所属项目',
      dataIndex: 'project_name',
      width: 180,
      render: (v: string) => <Tag color="geekblue">{v || '-'}</Tag>,
    },
    ...baseColumns.slice(1),
  ]

  return (
    <Card
      title="凭证管理"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建凭证
        </Button>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'project',
            label: `项目凭证 (${credentials.filter((c) => c.project_id).length})`,
            children: (
              <div>
                <Space style={{ marginBottom: 12 }}>
                  <span style={{ color: '#666' }}>项目：</span>
                  <Select
                    style={{ width: 260 }}
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder="全部项目"
                    value={projectFilter}
                    onChange={setProjectFilter}
                    options={projects.map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
                  />
                </Space>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="项目凭证只对所属项目可见，项目下的代码库和流水线步骤可以直接引用。"
                />
                <DataTable chromeKey="credentials-project" rowKey="id" columns={projectColumns} dataSource={projectCreds} pagination={false} />
              </div>
            ),
          },
          {
            key: 'global',
            label: `全局凭证 (${globalCreds.length})`,
            children: (
              <div>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 12 }}
                  message="全局凭证可被所有项目引用，仅管理员可维护。Token 过期后改这里的密文即可，已关联的代码库和流水线自动使用新值。"
                />
                <DataTable chromeKey="credentials-global" rowKey="id" columns={baseColumns} dataSource={globalCreds} pagination={false} />
              </div>
            ),
          },
        ]}
      />

      <Modal
        title={editing ? '修改凭证' : '新建凭证'}
        open={open}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="project_id"
            label="归属"
            extra={isAdmin ? '选具体项目=项目凭证；留空=全局凭证（所有项目可引用）' : '普通用户只能创建项目凭证'}
          >
            <Select
              allowClear={!!isAdmin}
              disabled={!!editing}
              showSearch
              optionFilterProp="label"
              placeholder={isAdmin ? '留空表示全局凭证' : '选择项目'}
              options={projects.map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
            />
          </Form.Item>
          <Form.Item name="name" label="凭证名称" rules={[{ required: true }]}>
            <Input placeholder="如：阿里云 ACR、华为云 SWR" />
          </Form.Item>
          <Form.Item name="type" label="类型" initialValue="token">
            <Select options={TYPE_OPTIONS} />
          </Form.Item>
          <CredentialSecretFields editing={!!editing} />
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
