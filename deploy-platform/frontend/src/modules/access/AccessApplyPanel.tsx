import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Radio,
  Select,
  Space,
  Tag,
  message,
} from 'antd'
import { AuditOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post } from '@/api/client'
import { envLabel } from '@/env'
import { useAuthStore } from '@/stores/auth'

/** 申请覆盖范围：整项目 / 环境分组 / 单条流水线。 */
type ApplyScope = 'project' | 'group' | 'pipeline'
/** 一张单只申请一种东西：资源直授或项目角色。 */
type ApplyKind = 'resource' | 'role'

interface CatalogRole {
  id: number
  project_id: number
  name: string
  description: string
  permissions: Record<string, string[]>
}

interface Catalog {
  projects: { id: number; name: string; code: string }[]
  groups: { id: number; name: string; type: string; project_id: number }[]
  pipelines: {
    id: number
    name: string
    project_id: number
    group_id: number
    project: string
    group: string
    env: string
  }[]
  roles: CatalogRole[]
}

interface DirectGrant {
  resource_type: string
  resource_id: number
  resource_name: string
  actions: string[]
}

interface RoleGrant {
  role_id: number
  name: string
  description: string
  permissions: Record<string, string[]>
}

interface Entitlements {
  is_admin: boolean
  projects: {
    project_id: number
    project_name: string
    roles: RoleGrant[]
    direct: DirectGrant[]
  }[]
  nodes: DirectGrant[]
}

interface Application {
  id: number
}

const APPLY_ACTION_OPTIONS = [
  { value: 'read', label: '查看' },
  { value: 'create', label: '创建' },
  { value: 'update', label: '更新' },
  { value: 'delete', label: '删除' },
  { value: 'execute', label: '执行' },
  { value: 'approve', label: '审批' },
  { value: 'approval_exempt', label: '豁免审批' },
]

const TYPE_LABEL: Record<string, string> = {
  project: '项目',
  group: '分组',
  pipeline: '流水线',
  node: '节点',
  node_group: '节点组',
  repository: '代码库',
  credential: '凭证',
}

const ACTION_LABEL: Record<string, string> = {
  read: '查看',
  create: '创建',
  update: '更新',
  delete: '删除',
  execute: '执行',
  approve: '审批',
  approval_exempt: '豁免审批',
  deploy: '下发文件',
}

/**
 * 角色权限包收成一排标签，方便申请人看这个角色实际能干什么。
 */
function permissionTags(permissions: Record<string, string[]>) {
  const entries = Object.entries(permissions || {})
  if (!entries.length) return <span style={{ color: '#999' }}>未配置权限</span>
  return entries.flatMap(([rtype, actions]) =>
    (actions || []).map((a) => (
      <Tag key={`${rtype}-${a}`}>
        {TYPE_LABEL[rtype] || rtype} · {ACTION_LABEL[a] || a}
      </Tag>
    )),
  )
}

/**
 * 权限申请 Tab：上半提交（资源权或项目角色），下半看自己已经有的授权。
 */
export default function AccessApplyPanel() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const isAdmin = !!user?.is_admin
  const [applyKind, setApplyKind] = useState<ApplyKind>('resource')
  const [applyScope, setApplyScope] = useState<ApplyScope>('pipeline')
  const [projectId, setProjectId] = useState<number>()
  const [groupId, setGroupId] = useState<number>()
  const [pipelineId, setPipelineId] = useState<number>()
  const [roleId, setRoleId] = useState<number>()
  const [applyActions, setApplyActions] = useState<string[]>(['read', 'execute'])
  const [reason, setReason] = useState('')

  const { data: catalog } = useQuery({
    queryKey: ['access-catalog'],
    queryFn: () => get<Catalog>('/access/catalog'),
    enabled: !isAdmin,
  })
  const { data: entitlements } = useQuery({
    queryKey: ['access-me'],
    queryFn: () => get<Entitlements>('/access/me'),
  })

  const groups = useMemo(
    () => (catalog?.groups || []).filter((g) => !projectId || g.project_id === projectId),
    [catalog, projectId],
  )
  const pipelines = useMemo(
    () =>
      (catalog?.pipelines || []).filter((p) => {
        if (projectId && p.project_id !== projectId) return false
        if (groupId && p.group_id !== groupId) return false
        return true
      }),
    [catalog, projectId, groupId],
  )
  const projectRoles = useMemo(
    () => (catalog?.roles || []).filter((r) => r.project_id === projectId),
    [catalog, projectId],
  )
  const selectedRole = projectRoles.find((r) => r.id === roleId)

  const canSubmitResource =
    applyKind === 'resource' &&
    ((applyScope === 'project' && !!projectId) ||
      (applyScope === 'group' && !!groupId) ||
      (applyScope === 'pipeline' && !!pipelineId))
  const canSubmitRole = applyKind === 'role' && !!roleId
  const canSubmit = !isAdmin && (canSubmitResource || canSubmitRole)

  const applyMut = useMutation({
    mutationFn: () => {
      if (applyKind === 'role') {
        return post<Application>('/access/applications', { role_id: roleId, reason })
      }
      if (applyScope === 'project') {
        return post<Application>('/access/applications', {
          project_id: projectId,
          reason,
          actions: applyActions,
        })
      }
      if (applyScope === 'group') {
        return post<Application>('/access/applications', {
          group_id: groupId,
          reason,
          actions: applyActions,
        })
      }
      return post<Application>('/access/applications', {
        pipeline_id: pipelineId,
        reason,
        actions: applyActions,
      })
    },
    onSuccess: (row) => {
      message.success(`已提交申请 #${row.id}，等待审批`)
      setReason('')
      qc.invalidateQueries({ queryKey: ['access-applications'] })
      qc.invalidateQueries({ queryKey: ['access-me'] })
      qc.invalidateQueries({ queryKey: ['notices'] })
    },
  })

  const mineEmpty =
    !entitlements?.is_admin &&
    !(entitlements?.projects || []).length &&
    !(entitlements?.nodes || []).length

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="申请权限"
        description="一次只申请一种东西：资源权限（项目 / 环境 / 流水线，默认查看+执行）或项目角色。审批通过后资源权写入直授，角色成为该角色成员。也可以对 AI 助手说「申请某某执行权限」或「申请某某角色」。"
      />

      <Card title={<><AuditOutlined /> 发起申请</>} style={{ marginBottom: 16 }}>
        {isAdmin ? (
          <Alert type="success" showIcon message="你是管理员，已有全部权限，无需申请。" />
        ) : (
          <Form layout="vertical">
            <Form.Item label="申请类型" style={{ marginBottom: 16 }}>
              <Radio.Group
                value={applyKind}
                onChange={(e) => {
                  setApplyKind(e.target.value)
                  setRoleId(undefined)
                }}
                optionType="button"
                options={[
                  { value: 'resource', label: '资源权限' },
                  { value: 'role', label: '项目角色' },
                ]}
              />
            </Form.Item>
            {applyKind === 'resource' ? (
              <>
                <Form.Item label="申请范围" style={{ marginBottom: 16 }}>
                  <Radio.Group
                    value={applyScope}
                    onChange={(e) => setApplyScope(e.target.value)}
                    optionType="button"
                    options={[
                      { value: 'pipeline', label: '单条流水线' },
                      { value: 'group', label: '整个环境' },
                      { value: 'project', label: '整个项目' },
                    ]}
                  />
                </Form.Item>
                <Space wrap size="middle" style={{ width: '100%' }} align="start">
                  <Form.Item label="项目" style={{ marginBottom: 0, minWidth: 220 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="选择项目"
                      value={projectId}
                      onChange={(v) => {
                        setProjectId(v)
                        setGroupId(undefined)
                        setPipelineId(undefined)
                        setRoleId(undefined)
                      }}
                      options={(catalog?.projects || []).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </Form.Item>
                  {applyScope !== 'project' ? (
                    <Form.Item label="分组" style={{ marginBottom: 0, minWidth: 220 }}>
                      <Select
                        allowClear
                        placeholder="选择分组"
                        value={groupId}
                        onChange={(v) => {
                          setGroupId(v)
                          setPipelineId(undefined)
                        }}
                        options={groups.map((g) => ({
                          value: g.id,
                          label: `${g.name}（${envLabel(g.type)}）`,
                        }))}
                      />
                    </Form.Item>
                  ) : null}
                  {applyScope === 'pipeline' ? (
                    <Form.Item label="流水线" style={{ marginBottom: 0, minWidth: 260 }}>
                      <Select
                        allowClear
                        showSearch
                        optionFilterProp="label"
                        placeholder="选择流水线"
                        value={pipelineId}
                        onChange={setPipelineId}
                        options={pipelines.map((p) => ({
                          value: p.id,
                          label: `${p.name}${p.env ? ` · ${envLabel(p.env)}` : ''}`,
                        }))}
                      />
                    </Form.Item>
                  ) : null}
                </Space>
                <Form.Item label="申请权限" style={{ marginTop: 16 }}>
                  <Checkbox.Group
                    options={APPLY_ACTION_OPTIONS}
                    value={applyActions}
                    onChange={(v) => {
                      const next = v as string[]
                      if (!next.length) {
                        setApplyActions(['read', 'execute'])
                        return
                      }
                      setApplyActions(next.includes('read') ? next : ['read', ...next])
                    }}
                  />
                </Form.Item>
              </>
            ) : (
              <>
                <Space wrap size="middle" style={{ width: '100%' }} align="start">
                  <Form.Item label="项目" style={{ marginBottom: 0, minWidth: 220 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder="选择项目"
                      value={projectId}
                      onChange={(v) => {
                        setProjectId(v)
                        setRoleId(undefined)
                      }}
                      options={(catalog?.projects || []).map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </Form.Item>
                  <Form.Item label="角色" style={{ marginBottom: 0, minWidth: 260 }}>
                    <Select
                      allowClear
                      showSearch
                      optionFilterProp="label"
                      placeholder={projectId ? '选择角色' : '先选项目'}
                      disabled={!projectId}
                      value={roleId}
                      onChange={setRoleId}
                      options={projectRoles.map((r) => ({
                        value: r.id,
                        label: r.description ? `${r.name}（${r.description}）` : r.name,
                      }))}
                    />
                  </Form.Item>
                </Space>
                {projectId && !projectRoles.length ? (
                  <Alert
                    style={{ marginTop: 16 }}
                    type="warning"
                    showIcon
                    message="该项目还没有角色。请改申请资源权限，或请管理员先在「项目角色」里建模板。"
                  />
                ) : null}
                {selectedRole ? (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ marginBottom: 8, color: '#666' }}>
                      加入后获得该角色当前配置的权限，角色以后改权限包会跟着变。
                    </div>
                    {permissionTags(selectedRole.permissions)}
                  </div>
                ) : null}
              </>
            )}
            <Form.Item label="申请说明" style={{ marginTop: 16, maxWidth: 720 }}>
              <Input.TextArea
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="说明用途，便于审批人判断"
              />
            </Form.Item>
            <Button
              type="primary"
              disabled={!canSubmit}
              loading={applyMut.isPending}
              onClick={() => applyMut.mutate()}
            >
              提交申请
            </Button>
          </Form>
        )}
      </Card>

      <Card title="我已有的权限">
        {entitlements?.is_admin ? (
          <Alert type="success" showIcon message="管理员拥有全部权限，不逐条列出。" />
        ) : mineEmpty ? (
          <Empty description="还没有任何授权。在上方提交申请，或对 AI 助手说「申请某某执行权限」。" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {(entitlements?.projects || []).map((p) => (
              <div key={p.project_id}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.project_name}</div>
                {p.roles.map((r) => (
                  <div key={`role-${r.role_id}`} style={{ marginBottom: 8 }}>
                    <Tag color="purple">角色</Tag>
                    <span style={{ marginRight: 8 }}>{r.name}</span>
                    {permissionTags(r.permissions)}
                  </div>
                ))}
                {p.direct.map((d) => (
                  <div key={`${d.resource_type}-${d.resource_id}`} style={{ marginBottom: 8 }}>
                    <Tag>直接授权</Tag>
                    <span style={{ marginRight: 8 }}>
                      {TYPE_LABEL[d.resource_type] || d.resource_type} · {d.resource_name}
                    </span>
                    {d.actions.map((a) => (
                      <Tag color="cyan" key={a}>
                        {ACTION_LABEL[a] || a}
                      </Tag>
                    ))}
                  </div>
                ))}
                {!p.roles.length && !p.direct.length ? (
                  <div style={{ color: '#999' }}>该项目下暂无明细</div>
                ) : null}
              </div>
            ))}
            {(entitlements?.nodes || []).length ? (
              <div>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>节点下发</div>
                {entitlements!.nodes.map((d) => (
                  <div key={`${d.resource_type}-${d.resource_id}`} style={{ marginBottom: 8 }}>
                    <Tag>直接授权</Tag>
                    <span style={{ marginRight: 8 }}>
                      {TYPE_LABEL[d.resource_type] || d.resource_type} · {d.resource_name}
                    </span>
                    {d.actions.map((a) => (
                      <Tag color="cyan" key={a}>
                        {ACTION_LABEL[a] || a}
                      </Tag>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </Space>
        )}
      </Card>
    </div>
  )
}
