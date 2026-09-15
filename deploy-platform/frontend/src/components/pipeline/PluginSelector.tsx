import { useEffect, useMemo, useState } from 'react'
import { Modal, Input, Menu, Button, Tag, Empty } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/api/client'
import type { Plugin } from '@/api/types'

interface PluginSelectorProps {
  open: boolean
  onClose: () => void
  onSelect: (plugin: Plugin) => void
}

const CATEGORY_LABELS: Record<string, string> = {
  source: '源代码',
  build: '构建',
  deploy: '部署',
  notify: '通知',
  trigger: '触发器',
  exec: '命令',
  artifact: '制品',
  pipeline: '流水线',
}

/**
 * 插件选择器（对应蓝盾"请选择一个插件"弹窗）
 * - 左侧分类导航
 * - 右侧插件列表：图标 + 名称 + 描述 + 评分
 * - 顶部搜索 + 引用变量
 */
export default function PluginSelector({ open, onClose, onSelect }: PluginSelectorProps) {
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState<string>('source')

  const { data: plugins = [] } = useQuery({
    queryKey: ['plugins', 'installed'],
    queryFn: () => get<Plugin[]>('/store/plugins', { installed: true }),
    enabled: open,
  })

  const categories = useMemo(() => {
    return Array.from(new Set(plugins.map((p) => p.category)))
  }, [plugins])

  // 关键词搜索跨分类：在「源代码」里搜 shell 也该搜得到，否则等于搜不到
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return plugins.filter((p) => p.category === category)
    return plugins.filter(
      (p) =>
        p.name.toLowerCase().includes(kw) ||
        p.display_name.toLowerCase().includes(kw) ||
        (p.description || '').toLowerCase().includes(kw),
    )
  }, [plugins, category, keyword])

  // 分类是动态的，默认的 source 不一定存在
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) setCategory(categories[0])
  }, [categories, category])

  return (
    <Modal
      title="请选择一个插件"
      open={open}
      onCancel={onClose}
      footer={null}
      width={840}
      destroyOnClose
    >
      <div style={{ display: 'flex', gap: 16, height: 480 }}>
        {/* 左侧分类 */}
        <div style={{ width: 140, borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            selectedKeys={[category]}
            style={{ borderRight: 0 }}
            items={categories.map((c) => ({
              key: c,
              label: CATEGORY_LABELS[c] || c,
            }))}
            onClick={({ key }) => setCategory(key)}
          />
        </div>

        {/* 右侧列表 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Input
              placeholder="搜索插件（跨全部分类）"
              prefix={<SearchOutlined />}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              allowClear
              style={{ width: 240 }}
            />
            {keyword.trim() && (
              <span style={{ color: '#999', fontSize: 12 }}>
                全部分类中匹配到 {filtered.length} 个
              </span>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto' }}>
            {filtered.length === 0 ? (
              <Empty description="未找到匹配的插件" />
            ) : (
              filtered.map((p) => (
                <div
                  key={p.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px 8px',
                    borderBottom: '1px solid #f5f5f5',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: '#e6f4ff',
                      color: '#1677ff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    {getCategoryEmoji(p.category)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {p.display_name} <span style={{ color: '#999', fontWeight: 400 }}>· {p.name}</span>
                    </div>
                    <div style={{ color: '#666', fontSize: 12 }}>{p.description || '暂无描述'}</div>
                    <div style={{ marginTop: 4 }}>
                      <Tag>{CATEGORY_LABELS[p.category] || p.category}</Tag>
                      {p.version ? <Tag color="blue">v{p.version}</Tag> : null}
                    </div>
                  </div>
                  <Button
                    type="primary"
                    onClick={() => {
                      onSelect(p)
                      onClose()
                    }}
                  >
                    选择
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function getCategoryEmoji(category: string): string {
  const map: Record<string, string> = {
    source: '📦',
    build: '☕',
    deploy: '☸️',
    notify: '💬',
    trigger: '▶️',
    exec: '💻',
    artifact: '🗂️',
    pipeline: '🔁',
  }
  return map[category] || '🔧'
}
