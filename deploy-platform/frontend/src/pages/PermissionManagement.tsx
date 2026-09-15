import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Empty,
  Input,
  List,
  Popconfirm,
  Select,
  Space,
  Tabs,
  Tag,
  message,
} from 'antd'
import { CheckOutlined, CloseOutlined, DeleteOutlined, PlusOutlined, SearchOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { get, post } from '@/api/client'
import RolePanel from '@/components/project/RolePanel'
import DataTable from '@/components/DataTable'
import GrantPermissionModal, {
  type GrantKind,
  type GrantPayload,
} from '@/components/GrantPermissionModal'
import { useIsMobile } from '@/hooks/useIsMobile'
import MenuManagement from '@/pages/MenuManagement'
import AccessApplyPanel from '@/modules/access/AccessApplyPanel'
import { useAuthStore } from '@/stores/auth'

interface UserItem { id: number; username: string; display_name: string; is_admin: boolean }
interface ProjectItem { id: number; name: string; code: string }
interface GroupItem { id: number; name: string; type: string; project_id: number }
interface NodeItem { id: number; name: string; env?: string; allow_paths?: string[] }
interface NodeGroupItem { id: number; name: string; description: string; member_count: number; agent_ids?: number[] }
interface PermissionItem {
  id: number
  user_id: number
  username: string
  display_name: string
  resource_type: string
  resource_id: number
  resource_name: string
  action: string
  action_label: string
  effect: string
}
interface Application {
  id: number
  applicant_id: number
  applicant: string
  project_name: string
  group_name: string
  pipeline_name: string
  pipeline_id: number
  apply_type: string
  role_id?: number
  role_name?: string
  scope_label?: string
  scope_text?: string
  reason: string
  status: string
  source: string
  granted_actions: string
  granted_action_list: string[]
  review_comment: string
  reviewer: string
  created_at: string
  reviewed_at: string
}

const TYPE_LABEL: Record<string, string> = {
  project: '项目', group: '分组', pipeline: '流水线', node: '节点', node_group: '节点组',
}
const ACTION_LABEL: Record<string, string> = {
  read: '查看', create: '创建', update: '更新', delete: '删除', execute: '执行', approve: '审批',
  approval_exempt: '豁免审批', deploy: '下发文件',
}
const STATUS: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  approved: { color: 'success', text: '已通过' },
  rejected: { color: 'error', text: '已驳回' },
  cancelled: { color: 'default', text: '已撤销' },
}
const SOURCE: Record<string, { color: string; text: string }> = {
  ai: { color: 'blue', text: 'AI助手' },
  web: { color: 'default', text: '手动' },
  api: { color: 'cyan', text: 'API' },
}

type GroupedPerm = PermissionItem & { actions: string[]; ids: number[] }
/** 节点授权落在这两类资源上，和流水线的项目/分组/流水线分开列。 */
const NODE_TYPES = new Set(['node', 'node_group'])

/**
 * 写类动作会带上查看：没有查看就进不了流水线页。
 */

function withRead(actions: string[]) {
  if (actions.length && !actions.includes('read')) return ['read', ...actions]
  return actions
}

const REVIEW_ACTION_OPTIONS = [
  { value: 'read', label: '查看' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'execute', label: '执行' },
  { value: 'approve', label: '审批' },
  { value: 'approval_exempt', label: '豁免审批' },
]

/** 列表范围列：角色单走 scope_text，资源单仍是项目/分组/流水线。 */
function scopeText(row: Application) {
  if (row.scope_text) return row.scope_text
  if (row.apply_type === 'role') return `${row.project_name} / 角色 ${row.role_name || row.pipeline_name}`
  return `${row.project_name} / ${row.group_name} / ${row.pipeline_name}`
}

export default function PermissionManagement() {
  const qc = useQueryClient()
  const isMobile = useIsMobile()
  const user = useAuthStore((s) => s.user)
  const isAdmin = !!user?.is_admin
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'apply'
  const focusId = Number(params.get('id') || 0)
  const [userKw, setUserKw] = useState('')
  const [selectedUserId, setSelectedUserId] = useState<number>()
  /** 添加授权弹窗是否打开。 */
  const [grantOpen, setGrantOpen] = useState(false)
  /** 弹窗授流水线还是节点，跟当前页签一致。 */
  const [grantKind, setGrantKind] = useState<GrantKind>('pipeline')
  const [roleProjectId, setRoleProjectId] = useState<number>()
  const [review, setReview] = useState<Application | null>(null)
  const [reviewActions, setReviewActions] = useState<string[]>(['read', 'execute'])
  const [reviewComment, setReviewComment] = useState('')
  /** 管理员在申请记录里可只看自己的单。 */
  const [historyMineOnly, setHistoryMineOnly] = useState(false)

  const adminGrantTab = isAdmin && (tab === 'users' || tab === 'nodes' || tab === 'roles')
  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => get<UserItem[]>('/users'),
    enabled: adminGrantTab,
  })
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<ProjectItem[]>('/projects'),
    enabled: isAdmin,
  })
  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: () => get<GroupItem[]>('/groups'),
    enabled: isAdmin,
  })
  const { data: nodes = [] } = useQuery({
    queryKey: ['agents', 'node'],
    queryFn: () => get<NodeItem[]>('/agents?role=node'),
    enabled: isAdmin && tab === 'nodes',
  })
  const { data: nodeGroups = [] } = useQuery({
    queryKey: ['node-groups'],
    queryFn: () => get<NodeGroupItem[]>('/node-groups'),
    enabled: isAdmin && tab === 'nodes',
  })
  // 只拉当前选中用户的授权。以前是把整张权限表拉回来再在前端 filter，
  // 用户和资源一多就是几十万行走网络
  const { data: userPerms = [] } = useQuery({
    queryKey: ['permissions', selectedUserId],
    queryFn: () => get<PermissionItem[]>('/permissions', { user_id: selectedUserId }),
    enabled: isAdmin && !!selectedUserId,
  })
  const { data: pending = [] } = useQuery({
    queryKey: ['access-applications', 'pending'],
    queryFn: () => get<Application[]>('/access/applications', { scope: 'pending' }),
  })
  const historyScope = isAdmin && !historyMineOnly ? 'all' : 'mine'
  const { data: historyApps = [] } = useQuery({
    queryKey: ['access-applications', historyScope],
    queryFn: () => get<Application[]>('/access/applications', { scope: historyScope }),
    enabled: tab === 'history' || (!!focusId && tab !== 'pending'),
  })

  const filteredUsers = useMemo(() => {
    const kw = userKw.trim().toLowerCase()
    return users.filter((u) => {
      if (u.is_admin) return false
      if (!kw) return true
      return `${u.display_name} ${u.username}`.toLowerCase().includes(kw)
    })
  }, [users, userKw])

  const selectedUser = users.find((u) => u.id === selectedUserId)
  const grouped = useMemo(() => {
    const map = new Map<string, GroupedPerm>()
    for (const p of userPerms) {
      if (p.resource_type === 'console') continue
      const key = `${p.resource_type}:${p.resource_id}`
      const cur = map.get(key)
      if (cur) {
        cur.actions.push(p.action)
        cur.ids.push(p.id)
      } else {
        map.set(key, { ...p, actions: [p.action], ids: [p.id] })
      }
    }
    return [...map.values()]
  }, [userPerms])
  /** 用户授权页签只看项目/分组/流水线。 */
  const pipelinePerms = grouped.filter((p) => !NODE_TYPES.has(p.resource_type))
  /** 节点授权页签只看节点和节点组。 */
  const nodePerms = grouped.filter((p) => NODE_TYPES.has(p.resource_type))

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['permissions'] })
    qc.invalidateQueries({ queryKey: ['access-applications'] })
    qc.invalidateQueries({ queryKey: ['access-me'] })
    qc.invalidateQueries({ queryKey: ['notices'] })
    qc.invalidateQueries({ queryKey: ['notices-brief'] })
    qc.invalidateQueries({ queryKey: ['notices-unread'] })
  }

  const grantMut = useMutation({
    mutationFn: (payload: GrantPayload) =>
      post<{ created: number }>('/permissions/batch', {
        user_ids: selectedUserId ? [selectedUserId] : [],
        resource_type: payload.resource_type,
        resource_ids: payload.resource_ids,
        actions: payload.actions,
      }),
    onSuccess: (r) => {
      message.success(`已授权 ${r.created} 项`)
      setGrantOpen(false)
      invalidate()
    },
  })

  const revokeMut = useMutation({
    mutationFn: (ids: number[]) => post<{ deleted: number }>('/permissions/revoke', { permission_ids: ids }),
    onSuccess: (r) => {
      message.success(`已移除 ${r.deleted} 项`)
      invalidate()
    },
  })

  const reviewMut = useMutation({
    mutationFn: (body: { id: number; action: 'approve' | 'reject'; actions?: string[]; comment?: string }) =>
      post<Application>(`/access/applications/${body.id}/${body.action}`, {
        comment: body.comment || '',
        actions: body.actions,
      }),
    onSuccess: () => {
      message.success('已处理')
      setReview(null)
      invalidate()
    },
  })

  const cancelMut = useMutation({
    mutationFn: (id: number) => post<Application>(`/access/applications/${id}/cancel`),
    onSuccess: () => {
      message.success('已撤销')
      invalidate()
    },
  })

  const openReview = (row: Application) => {
    setReview(row)
    const picked = (row.granted_action_list || []).filter(Boolean)
    setReviewActions(picked.length ? picked : ['read', 'execute'])
    setReviewComment('')
  }

  useEffect(() => {
    const adminOnly = new Set(['users', 'nodes', 'menus', 'roles'])
    if (!isAdmin && adminOnly.has(tab)) {
      setParams({ tab: 'apply' }, { replace: true })
    }
  }, [isAdmin, tab, setParams])

  useEffect(() => {
    if (!focusId) return
    const row = pending.find((p) => p.id === focusId) || historyApps.find((p) => p.id === focusId)
    if (!row) return
    if (row.status === 'pending') openReview(row)
    const next = new URLSearchParams(params)
    next.delete('id')
    setParams(next, { replace: true })
  }, [focusId, pending, historyApps])

  /**
   * 打开添加授权。kind 由当前页签决定：用户授权走流水线联动，节点授权走节点组联动。
   */
  const openGrant = (kind: GrantKind) => {
    setGrantKind(kind)
    setGrantOpen(true)
  }

  /** 授权列表列：类型、资源名、已授操作、整组移除。 */
  const permColumns = [
    {
      title: '类型',
      dataIndex: 'resource_type',
      width: 90,
      render: (v: string) => <Tag>{TYPE_LABEL[v] || v}</Tag>,
    },
    { title: '资源', dataIndex: 'resource_name' },
    {
      title: '权限',
      render: (_: unknown, r: GroupedPerm) =>
        r.actions.map((a) => (
          <Tag color="cyan" key={a}>
            {ACTION_LABEL[a] || a}
          </Tag>
        )),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, r: GroupedPerm) => (
        <Popconfirm title="移除该资源上的全部权限？" onConfirm={() => revokeMut.mutate(r.ids)}>
          <Button type="link" size="small" danger icon={<DeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      ),
    },
  ]

  /**
   * 左侧选人、右侧看授权。用户授权和节点授权共用这一套，只是表格数据不同。
   */
  const userGrantPanel = (kind: GrantKind) => (
    <div className="perm-user-grant">
      <Card size="small" className="perm-user-list" title="用户">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索姓名/账号"
          value={userKw}
          onChange={(e) => setUserKw(e.target.value)}
          style={{ marginBottom: 8 }}
        />
        <List
          size="small"
          dataSource={filteredUsers}
          locale={{ emptyText: '无匹配用户' }}
          renderItem={(u) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: u.id === selectedUserId ? '#e6f4ff' : undefined,
                padding: '8px 10px',
                borderRadius: 6,
              }}
              onClick={() => setSelectedUserId(u.id)}
            >
              <List.Item.Meta
                avatar={<UserOutlined />}
                title={u.display_name || u.username}
                description={u.username}
              />
            </List.Item>
          )}
        />
      </Card>
      <Card
        size="small"
        style={{ flex: 1 }}
        title={selectedUser ? `${selectedUser.display_name || selectedUser.username} 的权限` : '选择左侧用户'}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!selectedUserId}
            onClick={() => openGrant(kind)}
          >
            添加授权
          </Button>
        }
      >
        {!selectedUserId ? (
          <Empty description="从左侧选择用户，查看并管理其权限" />
        ) : (
          <DataTable<GroupedPerm>
            chromeKey={kind === 'node' ? 'perm-nodes' : 'perm-grouped'}
            rowKey={(r) => `${r.resource_type}-${r.resource_id}`}
            size="small"
            dataSource={kind === 'node' ? nodePerms : pipelinePerms}
            pagination={false}
            locale={{
              emptyText: kind === 'node' ? '还没有节点下发权限' : '还没有流水线相关权限',
            }}
            columns={permColumns}
          />
        )}
      </Card>
    </div>
  )

  return (
    <div>
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams({ tab: k })}
        items={[
          {
            key: 'apply',
            label: '权限申请',
            children: <AccessApplyPanel />,
          },
          {
            key: 'history',
            label: '申请记录',
            children: (
              <Card
                extra={
                  isAdmin ? (
                    <Checkbox checked={historyMineOnly} onChange={(e) => setHistoryMineOnly(e.target.checked)}>
                      只看我的
                    </Checkbox>
                  ) : null
                }
              >
                <DataTable
                  chromeKey="perm-apps"
                  rowKey="id"
                  size="small"
                  dataSource={historyApps}
                  columns={[
                    { title: '单号', dataIndex: 'id', width: 70 },
                    { title: '申请人', dataIndex: 'applicant', width: 120 },
                    {
                      title: '范围',
                      render: (_: unknown, r: Application) => scopeText(r),
                    },
                    {
                      title: '类型',
                      width: 100,
                      render: (_: unknown, r: Application) => r.scope_label || (r.apply_type === 'role' ? '项目角色' : '资源权限'),
                    },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (s: string) => <Tag color={STATUS[s]?.color}>{STATUS[s]?.text || s}</Tag>,
                    },
                    {
                      title: '实授',
                      width: 180,
                      render: (_: unknown, r: Application) => {
                        if (r.status !== 'approved') return '—'
                        if (r.apply_type === 'role') return <Tag color="purple">{r.role_name || r.pipeline_name}</Tag>
                        return (r.granted_action_list || []).map((a) => <Tag key={a}>{ACTION_LABEL[a] || a}</Tag>)
                      },
                    },
                    {
                      title: '来源',
                      dataIndex: 'source',
                      width: 90,
                      render: (s: string) => <Tag color={SOURCE[s]?.color}>{SOURCE[s]?.text || s}</Tag>,
                    },
                    { title: '审批人', dataIndex: 'reviewer', width: 100 },
                    { title: '意见', dataIndex: 'review_comment', ellipsis: true },
                    {
                      title: '操作',
                      width: 90,
                      render: (_: unknown, r: Application) =>
                        r.status === 'pending' && r.applicant_id === user?.id ? (
                          <Popconfirm title="撤销这张待审申请？" onConfirm={() => cancelMut.mutate(r.id)}>
                            <Button type="link" size="small" icon={<StopOutlined />}>
                              撤销
                            </Button>
                          </Popconfirm>
                        ) : null,
                    },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'pending',
            label: (
              <span>
                待审批 <Badge count={pending.length} size="small" offset={[6, -2]} />
              </span>
            ),
            children: (
              <Card>
                <DataTable
                  chromeKey="perm-pending"
                  rowKey="id"
                  size="small"
                  scroll={{ x: 1100 }}
                  dataSource={pending}
                  locale={{ emptyText: '暂无待你审批的申请。' }}
                  columns={[
                    { title: '单号', dataIndex: 'id', width: 70 },
                    { title: '申请人', dataIndex: 'applicant', width: 120 },
                    {
                      title: '申请范围',
                      render: (_: unknown, r: Application) => scopeText(r),
                    },
                    {
                      title: '拟授',
                      width: 180,
                      render: (_: unknown, r: Application) =>
                        r.apply_type === 'role' ? (
                          <Tag color="purple">{r.role_name || r.pipeline_name}</Tag>
                        ) : (
                          (r.granted_action_list || []).map((a) => (
                            <Tag key={a}>{ACTION_LABEL[a] || a}</Tag>
                          ))
                        ),
                    },
                    {
                      title: '来源',
                      dataIndex: 'source',
                      width: 90,
                      render: (s: string) => <Tag color={SOURCE[s]?.color}>{SOURCE[s]?.text || s}</Tag>,
                    },
                    { title: '说明', dataIndex: 'reason', ellipsis: true },
                    { title: '提交时间', dataIndex: 'created_at', width: 170 },
                    {
                      title: '操作',
                      width: 90,
                      render: (_: unknown, r: Application) => (
                        <Button type="link" size="small" onClick={() => openReview(r)}>
                          审核
                        </Button>
                      ),
                    },
                  ]}
                />
              </Card>
            ),
          },
          ...(isAdmin
            ? [
                {
                  key: 'users',
                  label: '用户授权',
                  children: userGrantPanel('pipeline'),
                },
                {
                  key: 'nodes',
                  label: '节点授权',
                  children: userGrantPanel('node'),
                },
                {
                  key: 'menus',
                  label: '菜单管理',
                  children: (
                    <Card>
                      <MenuManagement />
                    </Card>
                  ),
                },
                {
                  key: 'roles',
                  label: '项目角色',
                  children: (
                    <Card
                      title={
                        <Space>
                          <span>项目角色</span>
                          <Select
                            style={{ width: 260 }}
                            showSearch
                            optionFilterProp="label"
                            placeholder="选择项目"
                            value={roleProjectId}
                            onChange={setRoleProjectId}
                            options={projects.map((p) => ({ value: p.id, label: `${p.name}（${p.code}）` }))}
                          />
                        </Space>
                      }
                    >
                      <div style={{ marginBottom: 12, color: '#999', fontSize: 12 }}>
                        角色是「一组权限模板 + 成员」，跟项目绑定：成员对该项目下的资源自动获得角色里勾选的操作。
                        管理员可在这里直接加人，跳过审批；普通人走「权限申请」申请加入角色。
                      </div>
                      {roleProjectId ? (
                        <RolePanel projectId={roleProjectId} />
                      ) : (
                        <Empty description="先选择一个项目" />
                      )}
                    </Card>
                  ),
                },
              ]
            : []),
        ]}
      />

      <GrantPermissionModal
        open={grantOpen}
        kind={grantKind}
        user={selectedUser}
        projects={projects}
        groups={groups}
        nodes={nodes}
        nodeGroups={nodeGroups}
        confirmLoading={grantMut.isPending}
        onCancel={() => setGrantOpen(false)}
        onSubmit={(payload) => grantMut.mutate(payload)}
      />

      <Drawer
        title={review ? `审核申请 #${review.id}` : '审核'}
        width={isMobile ? '100%' : 480}
        open={!!review}
        onClose={() => setReview(null)}
        extra={
          review ? (
            <Space>
              <Button
                danger
                icon={<CloseOutlined />}
                onClick={() => reviewMut.mutate({ id: review.id, action: 'reject', comment: reviewComment })}
                loading={reviewMut.isPending}
              >
                驳回
              </Button>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() =>
                  reviewMut.mutate({
                    id: review.id,
                    action: 'approve',
                    comment: reviewComment,
                    actions: review.apply_type === 'role' ? undefined : withRead(reviewActions),
                  })
                }
                loading={reviewMut.isPending}
              >
                通过
              </Button>
            </Space>
          ) : null
        }
      >
        {review && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="申请人">{review.applicant}</Descriptions.Item>
              <Descriptions.Item label="范围">{scopeText(review)}</Descriptions.Item>
              <Descriptions.Item label="类型">{review.scope_label || (review.apply_type === 'role' ? '项目角色' : '资源权限')}</Descriptions.Item>
              <Descriptions.Item label="来源">
                <Tag color={SOURCE[review.source]?.color}>{SOURCE[review.source]?.text || review.source}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="说明">{review.reason || '（无）'}</Descriptions.Item>
              <Descriptions.Item label="提交时间">{review.created_at}</Descriptions.Item>
            </Descriptions>
            {review.apply_type === 'role' ? (
              <div style={{ marginBottom: 16, color: '#666' }}>通过后申请人成为该角色成员，权限随角色模板走，不能在这里改动作。</div>
            ) : (
              <>
                <div style={{ marginBottom: 8, fontWeight: 500 }}>实授权限（可改）</div>
                <Checkbox.Group
                  value={reviewActions}
                  onChange={(v) => setReviewActions(withRead(v as string[]))}
                  options={REVIEW_ACTION_OPTIONS}
                  style={{ marginBottom: 16 }}
                />
              </>
            )}
            <div style={{ marginBottom: 8, fontWeight: 500 }}>审批意见</div>
            <Input.TextArea rows={3} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="可选" />
          </>
        )}
      </Drawer>
    </div>
  )
}
