import { Tag, Button, Modal, Form, Input, Select, Space, Popconfirm } from 'antd'
import DataTable from '@/components/DataTable'
import { PlusOutlined, EditOutlined, DeleteOutlined, LinkOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/api/client'
import type { Repository, Credential } from '@/api/types'

/** 项目详情页的「代码库」Tab：仅显示/管理本项目代码库。 */
/** 从 Git URL 派生别名（蓝盾规范：group/project）。前端镜像逻辑，保持 UI 实时响应。 */
function deriveAlias(url: string): string {
  if (!url) return ''
  const u = url.trim()
  // https / http
  const m1 = u.match(/^https?:\/\/[^/]+\/(.+?)(?:\.git)?\/?$/)
  if (m1) return m1[1]
  // ssh:// or git@
  const m2 = u.match(/^(?:ssh:\/\/[^@/]+@[^/:]+(?::\d+)?\/|[\w-]+@[^:]+:)(.+?)(?:\.git)?\/?$/)
  if (m2) return m2[1]
  return ''
}

export default function RepositoryPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Repository | null>(null)
  const [form] = Form.useForm()

  const { data: repos = [] } = useQuery({
    queryKey: ['repositories', projectId],
    queryFn: () => get<Repository[]>('/repositories', { project_id: projectId }),
  })

  const { data: creds = [] } = useQuery({
    queryKey: ['credentials', projectId],
    queryFn: () => get<Credential[]>('/credentials', { project_id: projectId }),
  })

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ provider: 'gitlab', default_branch: 'master' })
    setOpen(true)
  }

  const openEdit = (r: Repository) => {
    setEditing(r)
    form.setFieldsValue({
      name: r.name,
      alias: r.alias,
      url: r.url,
      provider: r.provider,
      default_branch: r.default_branch,
      credential_id: r.credential_id ?? undefined,
    })
    setOpen(true)
  }

  // URL 变化时实时同步别名（仅当 alias 为空或与旧 URL 派生结果一致时）
  const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const url = e.target.value
    const currentAlias = form.getFieldValue('alias')
    const prevUrl = editing?.url || ''
    const expectedAlias = deriveAlias(prevUrl)
    // 如果当前 alias 还没手动改过（仍是上一份 URL 派生的结果），则跟随更新
    if (!currentAlias || currentAlias === expectedAlias) {
      form.setFieldsValue({ alias: deriveAlias(url) })
    }
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    const payload = { ...values, project_id: projectId }
    if (editing) {
      await put(`/repositories/${editing.id}`, payload)
    } else {
      await post('/repositories', payload)
    }
    queryClient.invalidateQueries({ queryKey: ['repositories', projectId] })
    setOpen(false)
  }

  const handleDelete = async (id: number) => {
    await del(`/repositories/${id}`)
    queryClient.invalidateQueries({ queryKey: ['repositories', projectId] })
  }

  const columns = [
    {
      title: '别名',
      dataIndex: 'alias',
      render: (v: string) => (
        <Space>
          <LinkOutlined />
          <code style={{ color: '#1677ff' }}>{v || '-'}</code>
        </Space>
      ),
    },
    { title: '仓库地址', dataIndex: 'url', ellipsis: true },
    {
      title: '类型',
      dataIndex: 'provider',
      render: (v: string) => <Tag color="blue">{v}</Tag>,
    },
    { title: '默认分支', dataIndex: 'default_branch' },
    {
      title: '关联凭证',
      dataIndex: 'credential_name',
      render: (v: string | null) =>
        v ? <Tag color="green">{v}</Tag> : <span style={{ color: '#999' }}>未关联</span>,
    },
    {
      title: '操作',
      width: 170,
      render: (_: unknown, r: Repository) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Popconfirm title="确认删除该代码库？" onConfirm={() => handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          关联代码库
        </Button>
        <span style={{ marginLeft: 12, color: '#999', fontSize: 12 }}>
          配置真实 GitLab 地址并关联访问凭证，流水线 git-checkout 步骤即可真拉代码
        </span>
      </div>
      <DataTable chromeKey="project-repos" rowKey="id" columns={columns} dataSource={repos} pagination={false} />

      <Modal
        title={editing ? '编辑代码库' : '关联代码库'}
        open={open}
        onOk={handleSave}
        onCancel={() => setOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="url"
            label="仓库地址（GitLab HTTPS）"
            rules={[{ required: true, message: '请输入仓库地址' }]}
          >
            <Input placeholder="https://gitlab.example.com/group/repo.git" onChange={handleUrlChange} />
          </Form.Item>
          <Form.Item
            name="alias"
            label="别名（自动从 URL 派生 group/project，可手动覆盖）"
            tooltip="蓝盾规范：自动从仓库地址提取 group/project 作为别名，流水线下拉直接展示别名"
          >
            <Input placeholder="输入 URL 后自动生成" />
          </Form.Item>
          <Form.Item name="provider" label="类型" initialValue="gitlab">
            <Select
              options={[
                { label: 'GitLab', value: 'gitlab' },
                { label: 'GitHub', value: 'github' },
              ]}
            />
          </Form.Item>
          <Form.Item name="default_branch" label="默认分支" initialValue="master">
            <Input placeholder="master / main" />
          </Form.Item>
          <Form.Item name="credential_id" label="关联凭证（访问密钥）">
            <Select
              allowClear
              placeholder="选择本项目或全局凭证（Token）"
              options={creds.map((c) => ({
                label: `${c.name}（${c.project_id ? '项目' : '全局'}）`,
                value: c.id,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
