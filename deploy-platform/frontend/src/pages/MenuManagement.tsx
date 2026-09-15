/**
 * 菜单管理：按侧栏树设置「全部登录用户 / 仅管理员」。
 * 不在用户授权弹窗里勾页面，业务数据权限仍走左侧用户授权。
 */
import { useMemo, useState } from 'react'
import { Button, Radio, Space, Tag, Typography, message } from 'antd'
import DataTable from '@/components/DataTable'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, put } from '@/api/client'
import { MENU_ICONS, type MenuCatalog, type MenuNode } from '@/menus'

interface GroupedMenus {
  group: string
  group_label: string
  items: MenuNode[]
}

export default function MenuManagement() {
  const qc = useQueryClient()
  const { data, isFetching } = useQuery({
    queryKey: ['menus'],
    queryFn: () => get<MenuCatalog>('/menus'),
  })
  const items = data?.items || []
  const [draft, setDraft] = useState<Record<string, 'all' | 'admin'> | null>(null)

  const audience = useMemo(() => {
    const next: Record<string, 'all' | 'admin'> = {}
    for (const item of items) next[item.key] = item.audience
    return { ...next, ...(draft || {}) }
  }, [items, draft])

  const groups = useMemo(() => {
    const order: GroupedMenus[] = []
    const index = new Map<string, GroupedMenus>()
    for (const item of items) {
      let group = index.get(item.group)
      if (!group) {
        group = { group: item.group, group_label: item.group_label, items: [] }
        index.set(item.group, group)
        order.push(group)
      }
      group.items.push({ ...item, audience: audience[item.key] || item.audience })
    }
    return order
  }, [items, audience])

  const dirty = useMemo(() => {
    if (!draft) return false
    return items.some((item) => !item.locked && draft[item.key] && draft[item.key] !== item.audience)
  }, [draft, items])

  const saveMut = useMutation({
    mutationFn: () =>
      put<MenuCatalog>('/menus', {
        audience: Object.fromEntries(
          items.filter((item) => !item.locked).map((item) => [item.key, audience[item.key]]),
        ),
      }),
    onSuccess: (next) => {
      qc.setQueryData(['menus'], next)
      setDraft(null)
      message.success('菜单可见范围已保存，全员侧栏按新规则显示')
    },
  })

  return (
    <div>
      <div style={{ marginBottom: 12, color: '#666', fontSize: 13, lineHeight: 1.7 }}>
        菜单按范围开放，不要在「添加授权」里给个人勾页面。工作台给所有登录用户；系统管理固定仅管理员。
        资源与工具可以改成仅管理员。看得见技能库的人可以共享技能给全员，删除只有发布者或管理员。
        第三方插件和工具含可执行代码，上架和安装始终只有管理员能做。轮换接入凭证、改模型 Key 也是。
      </div>
      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" disabled={!dirty} loading={saveMut.isPending} onClick={() => saveMut.mutate()}>
          保存
        </Button>
        <Button disabled={!dirty || saveMut.isPending} onClick={() => setDraft(null)}>
          取消
        </Button>
      </Space>
      {groups.map((group) => (
        <div key={group.group} style={{ marginBottom: 20 }}>
          <Typography.Title level={5} style={{ marginBottom: 8 }}>
            {group.group_label}
          </Typography.Title>
          <DataTable
            chromeKey={`menus-${group.group}`}
            rowKey="key"
            size="small"
            pagination={false}
            loading={isFetching && !items.length}
            dataSource={group.items}
            columns={[
              {
                title: '菜单',
                dataIndex: 'label',
                render: (label: string, row) => (
                  <Space>
                    {MENU_ICONS[row.key]}
                    <span>{label}</span>
                  </Space>
                ),
              },
              {
                title: '可见范围',
                width: 360,
                render: (_: unknown, row) =>
                  row.locked ? (
                    <Tag color={row.audience === 'admin' ? 'gold' : 'blue'}>
                      {row.audience === 'admin' ? '仅管理员' : '全部登录用户'}
                    </Tag>
                  ) : (
                    <Radio.Group
                      style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}
                      value={audience[row.key]}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...(prev || {}), [row.key]: e.target.value }))
                      }
                    >
                      <Radio value="all">全部登录用户</Radio>
                      <Radio value="admin">仅管理员</Radio>
                    </Radio.Group>
                  ),
              },
            ]}
          />
        </div>
      ))}
    </div>
  )
}
