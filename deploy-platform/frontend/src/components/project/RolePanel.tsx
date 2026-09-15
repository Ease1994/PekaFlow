import { Tag, Button, Modal, Form, Input, Select, Space, Popconfirm, Checkbox, Divider, Empty } from 'antd'
import DataTable from '@/components/DataTable'
import { PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, put, del } from '@/api/client'
import type { Role, RoleUser } from '@/api/types'

const RESOURCE_LABELS: Record<string, string> = {
  project: '项目',
  group: '环境分组',
  pipeline: '流水线',
  repository: '代码库',
  credential: '凭证',
}
const ACTION_LABELS: Record<string, string> = {
  read: '查看',
  create: '创建',
  update: '更新',
  delete: '删除',
  execute: '执行',
  approve: '审批',
  approval_exempt: '豁免审批',
}

interface UserItem {
  id: number
  username: string
  display_name: string
  is_admin: boolean
}

function userLabel(u: { username: string; display_name?: string }) {
  const name = u.display_name || u.username
  return name === u.username ? name : `${name}（${u.username}）`
}

/** 权限管理页的「项目角色」Tab：角色跟项目绑定，成员在编辑框里搜、加、点 × 去掉。 */
export default function RolePanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const [roleModalOpen, setRoleModalOpen] = useState(false)
  const [editing, setEditing] = useState<Role | null>(null)
  const [members, setMembers] = useState<RoleUser[]>([])
  const [pickUser, setPickUser] = useState<number | undefined>()
  const [roleForm] = Form.useForm()

  const { data: roles = [] } = useQuery({
    queryKey: ['roles', projectId],
    queryFn: () => get<Role[]>('/roles', { project_id: projectId }),
  })

  const { data: resourceActions = {} } = useQuery({
    queryKey: ['roles-resource-actions'],
    queryFn: () => get<Record<string, string[]>>('/roles/resource-actions'),
  })

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => get<UserItem[]>('/users'),
  })

  const openCreate = () => {
    setEditing(null)
    setMembers([])
    setPickUser(undefined)
    roleForm.resetFields()
    roleForm.setFieldsValue({ permissions: {} })
    setRoleModalOpen(true)
  }

  const openEdit = (r: Role) => {
    setEditing(r)
    setMembers(r.users || [])
    setPickUser(undefined)
    roleForm.setFieldsValue({ name: r.name, description: r.description, permissions: r.permissions })
    setRoleModalOpen(true)
  }

  const addMember = (userId: number) => {
    const u = users.find((item) => item.id === userId)
    if (!u || members.some((m) => m.id === u.id)) return
    setMembers((prev) => [
      ...prev,
      { id: u.id, username: u.username, display_name: u.display_name },
    ])
  }

  const removeMember = (userId: number) => {
    setMembers((prev) => prev.filter((m) => m.id !== userId))
  }

  const syncMembers = async (roleId: number, original: RoleUser[]) => {
    const prev = new Set(original.map((u) => u.id))
    const next = new Set(members.map((u) => u.id))
    const toAdd = members.filter((u) => !prev.has(u.id)).map((u) => u.id)
    const toRemove = original.filter((u) => !next.has(u.id)).map((u) => u.id)
    if (toAdd.length) {
      await post(`/roles/${roleId}/users`, { user_ids: toAdd })
    }
    await Promise.all(toRemove.map((uid) => del(`/roles/${roleId}/users/${uid}`)))
  }

  const handleSaveRole = async () => {
    const values = await roleForm.validateFields()
    const original = editing?.users || []
    if (editing) {
      await put(`/roles/${editing.id}`, values)
      await syncMembers(editing.id, original)
    } else {
      const created = await post<Role>('/roles', { ...values, project_id: projectId })
      if (created?.id) await syncMembers(created.id, [])
    }
    queryClient.invalidateQueries({ queryKey: ['roles', projectId] })
    setRoleModalOpen(false)
  }

  const handleDeleteRole = async (id: number) => {
    await del(`/roles/${id}`)
    queryClient.invalidateQueries({ queryKey: ['roles', projectId] })
  }

  const renderPerms = (perms: Record<string, string[]>) => {
    const chips: JSX.Element[] = []
    for (const [res, actions] of Object.entries(perms || {})) {
      for (const a of actions) {
        chips.push(
          <Tag key={`${res}-${a}`} color="blue" style={{ marginBottom: 4 }}>
            {RESOURCE_LABELS[res] ?? res}·{ACTION_LABELS[a] ?? a}
          </Tag>,
        )
      }
    }
    return chips.length ? chips : <span style={{ color: '#999' }}>无权限</span>
  }

  const assignable = users.filter(
    (u) => !u.is_admin && !members.some((m) => m.id === u.id),
  )

  const columns = [
    { title: '角色名', dataIndex: 'name', render: (v: string) => <b>{v}</b> },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '权限',
      dataIndex: 'permissions',
      render: (v: Record<string, string[]>) => renderPerms(v),
    },
    {
      title: '成员',
      dataIndex: 'users',
      render: (v: Role['users']) =>
        v.length ? (
          <Space size={4} wrap>
            {v.slice(0, 5).map((u) => (
              <Tag key={u.id} icon={<UserOutlined />}>{u.display_name || u.username}</Tag>
            ))}
            {v.length > 5 && <span style={{ color: '#999' }}>+{v.length - 5}</span>}
          </Space>
        ) : (
          <span style={{ color: '#999' }}>暂无成员</span>
        ),
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, r: Role) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该角色？" onConfirm={() => handleDeleteRole(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建角色</Button>
        <span style={{ marginLeft: 12, color: '#999', fontSize: 12 }}>
          角色跟项目绑定。点编辑即可搜人加入、点名字上的 × 去掉。
        </span>
      </div>
      <DataTable chromeKey="project-roles" rowKey="id" columns={columns} dataSource={roles} pagination={false} />

      <Modal
        title={editing ? '编辑角色' : '新建角色'}
        open={roleModalOpen}
        onOk={handleSaveRole}
        onCancel={() => setRoleModalOpen(false)}
        width={680}
        destroyOnClose
        okText="确定"
        cancelText="取消"
      >
        <Form form={roleForm} layout="vertical">
          <Form.Item name="name" label="角色名" rules={[{ required: true, message: '请输入角色名' }]}>
            <Input placeholder="如：开发 / 测试 / 运维 / 审批人" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input placeholder="角色职责说明" />
          </Form.Item>
          <Divider style={{ margin: '12px 0' }}>权限配置（按资源类型勾选操作）</Divider>
          <Form.Item name="permissions" label={null}>
            <PermissionMatrix resourceActions={resourceActions} form={roleForm} />
          </Form.Item>
          <Divider style={{ margin: '12px 0' }}>成员</Divider>
          <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>
            搜姓名或账号加入。点名字上的 × 会从该角色去掉，点确定后生效。管理员不必加入，已有全部权限。
          </div>
          <Select
            showSearch
            allowClear
            placeholder="搜索并选择人员"
            optionFilterProp="label"
            style={{ width: '100%', marginBottom: 12 }}
            options={assignable.map((u) => ({
              label: userLabel(u),
              value: u.id,
            }))}
            value={pickUser}
            onChange={(id) => {
              if (id != null) addMember(Number(id))
              setPickUser(undefined)
            }}
          />
          {members.length ? (
            <Space size={[8, 8]} wrap>
              {members.map((u) => (
                <Tag
                  key={u.id}
                  icon={<UserOutlined />}
                  closable
                  onClose={(e) => {
                    e.preventDefault()
                    removeMember(u.id)
                  }}
                >
                  {u.display_name || u.username}
                </Tag>
              ))}
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有成员" />
          )}
        </Form>
      </Modal>
    </div>
  )
}

function PermissionMatrix({
  resourceActions,
  form,
}: {
  resourceActions: Record<string, string[]>
  form: any
}) {
  const value: Record<string, string[]> = form.getFieldValue('permissions') || {}
  return (
    <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, padding: '4px 12px' }}>
      {Object.entries(resourceActions).map(([res, actions]) => (
        <div
          key={res}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '6px 0',
            borderBottom: '1px solid #f5f5f5',
          }}
        >
          <span style={{ width: 80, fontWeight: 600 }}>{RESOURCE_LABELS[res] ?? res}</span>
          <Checkbox.Group
            value={value[res] || []}
            onChange={(vals) => {
              const next = { ...value }
              next[res] = vals as string[]
              form.setFieldsValue({ permissions: next })
            }}
            options={actions.map((a) => ({ label: ACTION_LABELS[a] ?? a, value: a }))}
          />
        </div>
      ))}
    </div>
  )
}
