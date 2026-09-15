import { useMemo, useState } from 'react'
import { Alert, Modal, Tabs, Empty, Button, Tooltip, Input } from 'antd'
import { CopyOutlined, SearchOutlined } from '@ant-design/icons'
import { copyText } from '@/utils/clipboard'
import type { Variable } from '@/api/types'

interface VariableReferenceProps {
  open: boolean
  onClose: () => void
  /** 流水线级全局变量（自定义变量） */
  variables?: Variable[]
}

/**
 * 蓝盾风格的「引用变量」弹窗。
 * - 系统变量（BK_CI_*）：只列后端 pipeline/variables.py 真正会注入的，
 *   列了填不出来的变量，用户拿到的是空串，比不支持更难排查
 * - 自定义变量：流水线级全局变量
 * - 支持搜索过滤，每行右侧「复制」按钮把占位符写入剪贴板
 */
export default function VariableReference({ open, onClose, variables = [] }: VariableReferenceProps) {
  const [keyword, setKeyword] = useState('')

  const filter = (list: { name: string; desc: string; placeholder: string }[]) => {
    if (!keyword) return list
    const kw = keyword.toLowerCase()
    return list.filter(
      (v) => v.name.toLowerCase().includes(kw) || v.desc.toLowerCase().includes(kw)
    )
  }

  const customVars = variables.map((v) => ({
    name: v.name,
    desc: v.description || '—',
    placeholder: `\${{${v.name}}}`,
  }))

  const copy = (text: string, label: string) => {
    void copyText(text, `已复制 ${label}`)
  }

  return (
    <Modal
      title="引用变量"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="占位符 ${{变量名}} 与 ${变量名} 都可以用，执行时由平台替换成真实值"
        description="平台只替换下面列出的变量，认不出来的原样传给脚本，所以 ${HOME} 这类 shell 自己的变量不受影响。"
      />
      <Input
        placeholder="搜索变量（按名称或描述）"
        prefix={<SearchOutlined />}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 12 }}
        allowClear
      />
      <Tabs
        items={[
          {
            key: 'system',
            label: `系统变量（${SYSTEM_VARS.length}）`,
            children: <VariableList items={filter(SYSTEM_VARS)} onCopy={copy} />,
          },
          {
            key: 'custom',
            label: `自定义变量（${customVars.length}）`,
            children:
              customVars.length === 0 ? (
                <Empty description="流水线尚未定义变量，请在「变量」页添加" />
              ) : (
                <VariableList items={filter(customVars)} onCopy={copy} />
              ),
          },
        ]}
      />
    </Modal>
  )
}

// ============================================================
// 系统变量：与后端 app/modules/pipeline/variables.py 的 system_variables() 一一对应。
// 改后端记得同步这里，两边对不上用户就会拿到没被替换的占位符。
// ============================================================
const SYSTEM_VARS: { name: string; desc: string; placeholder: string }[] = [
  { name: 'BK_CI_BUILD_NUM', desc: '构建号，按流水线各自从 1 自增', placeholder: '${{BK_CI_BUILD_NUM}}' },
  { name: 'BK_CI_BUILD_NO', desc: '同构建号', placeholder: '${{BK_CI_BUILD_NO}}' },
  { name: 'BK_CI_BUILD_ID', desc: '发布记录 ID，全局唯一', placeholder: '${{BK_CI_BUILD_ID}}' },
  { name: 'BK_CI_BUILD_START_TIME', desc: '本次构建开始时间（毫秒时间戳）', placeholder: '${{BK_CI_BUILD_START_TIME}}' },
  { name: 'BK_CI_VERSION', desc: '本次发布的版本号', placeholder: '${{BK_CI_VERSION}}' },
  { name: 'BK_CI_PIPELINE_ID', desc: '流水线 ID', placeholder: '${{BK_CI_PIPELINE_ID}}' },
  { name: 'BK_CI_PIPELINE_NAME', desc: '流水线名称', placeholder: '${{BK_CI_PIPELINE_NAME}}' },
  { name: 'BK_CI_PIPELINE_VERSION', desc: '流水线保存时刻，形如 V20260826160732', placeholder: '${{BK_CI_PIPELINE_VERSION}}' },
  { name: 'BK_CI_PROJECT_NAME', desc: '项目名称', placeholder: '${{BK_CI_PROJECT_NAME}}' },
  { name: 'BK_CI_PROJECT_NAME_CN', desc: '项目名称（同上）', placeholder: '${{BK_CI_PROJECT_NAME_CN}}' },
  { name: 'BK_CI_START_TYPE', desc: '启动方式：MANUAL / TIME_TRIGGER / WEB_HOOK / SERVICE / PIPELINE', placeholder: '${{BK_CI_START_TYPE}}' },
  { name: 'BK_CI_START_USER_ID', desc: '发起人用户 ID', placeholder: '${{BK_CI_START_USER_ID}}' },
  { name: 'BK_CI_START_USER_NAME', desc: '发起人用户名', placeholder: '${{BK_CI_START_USER_NAME}}' },
  {
    name: 'BK_CI_GIT_REPO_HEAD_COMMIT_ID',
    desc: '本次构建的 commit（Rebuild / 回滚这类锁定了代码版本的构建才有值）',
    placeholder: '${{BK_CI_GIT_REPO_HEAD_COMMIT_ID}}',
  },
]

function VariableList({
  items,
  onCopy,
}: {
  items: { name: string; desc: string; placeholder: string }[]
  onCopy: (text: string, label: string) => void
}) {
  if (items.length === 0) {
    return <Empty description="未找到匹配的变量" />
  }
  return (
    <div style={{ maxHeight: 480, overflow: 'auto' }}>
      {items.map((it) => (
        <div
          key={it.name}
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '8px 12px',
            borderBottom: '1px solid #f5f5f5',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 2 }}>{it.name}</div>
            <div style={{ color: '#999', fontSize: 12 }}>{it.desc}</div>
          </div>
          <Tooltip title="复制占位符，粘贴到任意步骤参数里">
            <Button
              type="text"
              icon={<CopyOutlined />}
              onClick={() => onCopy(it.placeholder, it.name)}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  )
}
