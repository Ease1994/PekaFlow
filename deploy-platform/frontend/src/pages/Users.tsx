import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd'
import {
  CloudSyncOutlined,
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  SearchOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post, put } from '@/api/client'
import DataTable from '@/components/DataTable'

interface AccountUser {
  id: number
  username: string
  display_name: string
  email: string
  is_admin: boolean
  source: string
  identities?: string[]
  status: string
  last_login_at: string
  created_at: string
  has_password: boolean
}

interface LdapEntry {
  dn: string
  username: string
  email: string
  display_name: string
  upn: string
}

const SOURCE: Record<string, { color: string; text: string }> = {
  local: { color: 'default', text: '本地' },
  ldap: { color: 'blue', text: 'LDAP' },
  wecom: { color: 'green', text: '企微' },
}

export default function Users() {
  const qc = useQueryClient()
  const [kw, setKw] = useState('')
  const [source, setSource] = useState<string>()
  const [status, setStatus] = useState<string>()
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [editUser, setEditUser] = useState<AccountUser | null>(null)
  const [pwdUser, setPwdUser] = useState<AccountUser | null>(null)
  const [ldapOpen, setLdapOpen] = useState(false)
  const [ldapKw, setLdapKw] = useState('')
  const [ldapRows, setLdapRows] = useState<LdapEntry[]>([])
  const [ldapSelected, setLdapSelected] = useState<LdapEntry[]>([])
  const [createForm] = Form.useForm()
  const [editForm] = Form.useForm()
  const [pwdForm] = Form.useForm()

  const { data: users = [], isFetching } = useQuery({
    queryKey: ['account-users', kw, source, status],
    queryFn: () =>
      get<AccountUser[]>('/account/users', {
        keyword: kw || undefined,
        source: source || undefined,
        status: status || undefined,
      }),
  })

  // 搜完常常只剩几条，还停在原页码就是一张空表，看着像没搜到
  useEffect(() => {
    setPage(1)
  }, [kw, source, status])

  const stats = useMemo(() => {
    const all = users
    return {
      total: all.length,
      local: all.filter((u) => u.source === 'local').length,
      ldap: all.filter((u) => u.source === 'ldap').length,
      disabled: all.filter((u) => u.status === 'disabled').length,
    }
  }, [users])

  const invalidate = () => qc.invalidateQueries({ queryKey: ['account-users'] })

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => post<AccountUser>('/account/users', body),
    onSuccess: () => {
      message.success('已创建本地用户')
      setCreateOpen(false)
      createForm.resetFields()
      invalidate()
    },
  })
  const saveMut = useMutation({
    mutationFn: (body: { id: number } & Record<string, unknown>) => put<AccountUser>(`/account/users/${body.id}`, body),
    onSuccess: () => {
      message.success('已保存')
      setEditUser(null)
      invalidate()
    },
  })
  const pwdMut = useMutation({
    mutationFn: (body: { id: number; password: string }) =>
      post(`/account/users/${body.id}/reset-password`, { password: body.password }),
    onSuccess: () => {
      message.success('密码已重置')
      setPwdUser(null)
      pwdForm.resetFields()
    },
  })
  const delMut = useMutation({
    mutationFn: (id: number) => del(`/account/users/${id}`),
    onSuccess: () => {
      message.success('已删除')
      invalidate()
    },
  })
  const searchLdap = useMutation({
    mutationFn: () => post<LdapEntry[]>('/account/ldap/search', { keyword: ldapKw }),
    onSuccess: (rows) => {
      setLdapRows(rows)
      if (!rows.length) message.info('没有匹配的 LDAP 用户')
    },
  })
  const importLdap = useMutation({
    mutationFn: () => post<{ imported: number }>('/account/ldap/import', { users: ldapSelected }),
    onSuccess: (r) => {
      message.success(`已导入 ${r.imported} 人`)
      setLdapOpen(false)
      setLdapSelected([])
      invalidate()
    },
  })
  const testLdap = useMutation({
    mutationFn: () => post<{ ok: boolean }>('/account/ldap/test', {}),
    onSuccess: () => message.success('LDAP 绑定账号连通正常'),
  })

  return (
    <div>
      <Space wrap style={{ marginBottom: 12 }}>
        <Card size="small">{stats.total} 人</Card>
        <Card size="small">本地 {stats.local}</Card>
        <Card size="small">LDAP {stats.ldap}</Card>
        <Card size="small">已禁用 {stats.disabled}</Card>
      </Space>
      <Card
        title={
          <Space>
            <UserOutlined />
            用户管理
          </Space>
        }
        extra={
          <Space>
            <Button onClick={() => testLdap.mutate()} loading={testLdap.isPending}>
              测试 LDAP
            </Button>
            <Button icon={<CloudSyncOutlined />} onClick={() => setLdapOpen(true)}>
              导入 LDAP 用户
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新增本地用户
            </Button>
          </Space>
        }
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索账号 / 姓名 / 邮箱"
            style={{ width: 240 }}
            value={kw}
            onChange={(e) => setKw(e.target.value)}
          />
          <Select
            allowClear
            placeholder="来源"
            style={{ width: 120 }}
            value={source}
            onChange={setSource}
            options={[
              { value: 'local', label: '本地' },
              { value: 'ldap', label: 'LDAP' },
              { value: 'wecom', label: '企微' },
            ]}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '禁用' },
            ]}
          />
        </Space>
        <DataTable
          chromeKey="users"
          rowKey="id"
          size="small"
          loading={isFetching}
          dataSource={users}
          pagination={{ current: page, onChange: setPage }}
          columns={[
            { title: '账号', dataIndex: 'username', width: 140 },
            { title: '姓名', dataIndex: 'display_name', width: 120 },
            { title: '邮箱', dataIndex: 'email' },
            {
              title: '登录方式',
              dataIndex: 'identities',
              width: 140,
              render: (_: string[] | undefined, r: AccountUser) => (
                <>
                  {(r.identities?.length ? r.identities : [r.source]).map((s) => (
                    <Tag key={s} color={SOURCE[s]?.color}>
                      {SOURCE[s]?.text || s}
                    </Tag>
                  ))}
                </>
              ),
            },
            {
              title: '角色',
              dataIndex: 'is_admin',
              width: 90,
              render: (v: boolean) => (v ? <Tag color="gold">管理员</Tag> : <Tag>普通</Tag>),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (s: string, r: AccountUser) => (
                <Switch
                  checked={s === 'active'}
                  checkedChildren="启用"
                  unCheckedChildren="禁用"
                  // 连点会发出多个请求，响应乱序时开关显示的状态和库里的对不上
                  loading={saveMut.isPending}
                  disabled={saveMut.isPending}
                  onChange={(on) => saveMut.mutate({ id: r.id, status: on ? 'active' : 'disabled' })}
                />
              ),
            },
            { title: '最近登录', dataIndex: 'last_login_at', width: 170, render: (v: string) => v.replace('T', ' ').slice(0, 19) || '—' },
            {
              title: '操作',
              width: 220,
              render: (_: unknown, r: AccountUser) => (
                <Space>
                  <Button type="link" size="small" onClick={() => {
                    setEditUser(r)
                    editForm.setFieldsValue(r)
                  }}>
                    编辑
                  </Button>
                  {!(r.identities || []).includes('ldap') && r.source !== 'ldap' && (
                    <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => setPwdUser(r)}>
                      重置密码
                    </Button>
                  )}
                  <Popconfirm title="确定删除该用户？" onConfirm={() => delMut.mutate(r.id)}>
                    <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="新增本地用户"
        open={createOpen}
        onCancel={() => {
          setCreateOpen(false)
          createForm.resetFields()
        }}
        onOk={() => createForm.validateFields().then((v) => createMut.mutate(v))}
        confirmLoading={createMut.isPending}
        okText="创建"
      >
        <Form form={createForm} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true }]}>
            <Input placeholder="短账号，不要带 @" />
          </Form.Item>
          <Form.Item name="display_name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="password" label="初始密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item name="is_admin" label="管理员" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑用户"
        open={!!editUser}
        onCancel={() => setEditUser(null)}
        onOk={() =>
          editForm.validateFields().then((v) => editUser && saveMut.mutate({ id: editUser.id, ...v }))
        }
        confirmLoading={saveMut.isPending}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="账号">
            <Input disabled value={editUser?.username} />
          </Form.Item>
          <Form.Item name="display_name" label="姓名">
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="is_admin" label="管理员" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 · ${pwdUser?.username || ''}`}
        open={!!pwdUser}
        onCancel={() => setPwdUser(null)}
        onOk={() =>
          pwdForm.validateFields().then((v) => pwdUser && pwdMut.mutate({ id: pwdUser.id, password: v.password }))
        }
        confirmLoading={pwdMut.isPending}
      >
        <Form form={pwdForm} layout="vertical">
          <Form.Item name="password" label="新密码" rules={[{ required: true, min: 6 }]}>
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="从 LDAP 导入"
        width={720}
        open={ldapOpen}
        onCancel={() => {
          setLdapOpen(false)
          // 不清的话，下次打开还挂着上次的搜索结果和勾选，容易误导入
          setLdapKw('')
          setLdapRows([])
          setLdapSelected([])
        }}
        onOk={() => importLdap.mutate()}
        okButtonProps={{ disabled: !ldapSelected.length }}
        confirmLoading={importLdap.isPending}
        okText={`导入选中（${ldapSelected.length}）`}
      >
        <Space style={{ marginBottom: 12 }}>
          <Input
            placeholder="姓名 / 邮箱 / 域账号"
            value={ldapKw}
            onChange={(e) => setLdapKw(e.target.value)}
            onPressEnter={() => searchLdap.mutate()}
            style={{ width: 280 }}
          />
          <Button type="primary" loading={searchLdap.isPending} onClick={() => searchLdap.mutate()}>
            搜索
          </Button>
        </Space>
        <DataTable
          chromeKey="users-ldap"
          rowKey="dn"
          size="small"
          dataSource={ldapRows}
          pagination={false}
          rowSelection={{
            // 受控才能在关闭弹窗时真正清掉勾选，否则重新搜到同一个人还是选中态
            selectedRowKeys: ldapSelected.map((r) => r.dn),
            onChange: (_keys, rows) => setLdapSelected(rows),
          }}
          columns={[
            { title: '域账号', dataIndex: 'username', width: 120 },
            { title: '姓名', dataIndex: 'display_name' },
            { title: '邮箱', dataIndex: 'email' },
            { title: 'UPN', dataIndex: 'upn' },
          ]}
        />
      </Modal>
    </div>
  )
}
