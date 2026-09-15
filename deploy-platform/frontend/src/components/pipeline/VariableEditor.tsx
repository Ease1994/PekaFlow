import { useState, type CSSProperties } from 'react'
import { Alert, Button, Empty, Input, Select, Space, Switch, Tooltip, Typography } from 'antd'
import { CopyOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import type { Variable } from '@/api/types'
import { copyText } from '@/utils/clipboard'

const { Text } = Typography

/** 变量控件类型。执行弹窗按类型渲染输入框 / 下拉 / 多行文本。 */
const VARIABLE_TYPES = [
  { value: 'text', label: '文本' },
  { value: 'textarea', label: '多行文本' },
  { value: 'number', label: '数字' },
  { value: 'boolean', label: '是/否' },
  { value: 'select', label: '下拉选择' },
  { value: 'git_ref', label: 'Git 分支' },
  { value: 'code_lib', label: '代码库' },
  { value: 'artifact', label: '构建产物' },
  { value: 'pool', label: '构建机池' },
]

/** 步骤里引用时的占位符，例如 ${{VERSION}} */
function placeholderOf(name: string): string {
  return `\${{${name || '变量名'}}}`
}

/** 名称只能当占位符用，必须是标识符。 */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * 给新变量起一个还不占用的 paramN。
 */
function nextParamName(variables: Variable[]): string {
  const used = new Set(variables.map((v) => v.name))
  for (let i = 1; i < 100; i++) {
    const name = `param${i}`
    if (!used.has(name)) return name
  }
  return `param${variables.length + 1}`
}

/**
 * 名称是否能保存：空、非法字符、和别的变量撞名都不行。
 */
function nameIssue(name: string, idx: number, variables: Variable[]): string {
  const trimmed = name.trim()
  if (!trimmed) return '请填写名称'
  if (!NAME_RE.test(trimmed)) return '用英文字母或下划线开头'
  if (variables.some((v, i) => i !== idx && v.name === trimmed)) return '名称已存在'
  return ''
}

/**
 * 流水线变量编辑器。
 *
 * 一行里填类型、名称、默认值、是否执行时填写；说明和下拉选项叠在下面。
 * 卡片分组，避免原来那种整屏拉宽、每项占四行的排法。
 */
export function VariableEditor({
  variables,
  onChange,
}: {
  variables: Variable[]
  onChange: (next: Variable[]) => void
}) {
  const update = (idx: number, patch: Partial<Variable>) => {
    onChange(variables.map((v, i) => (i === idx ? { ...v, ...patch } : v)))
  }
  const remove = (idx: number) => {
    onChange(variables.filter((_, i) => i !== idx))
  }
  const add = () => {
    onChange([
      ...variables,
      {
        name: nextParamName(variables),
        type: 'text',
        default_value: '',
        description: '',
        show_on_execution: true,
      },
    ])
  }

  return (
    <div style={{ maxWidth: 880 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="步骤参数里写占位符，执行时替换成这里的值"
        description={
          <span>
            例如镜像 tag 填 <Text code>{'${{VERSION}}'}</Text>
            。勾选「执行时填写」的变量会在点执行时弹出来让人改，不勾就固定用默认值。
          </span>
        }
      />

      {variables.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有变量。需要每次执行填不同值（版本号、分支）时再加。"
          style={{ padding: '32px 0' }}
        />
      ) : (
        <div>
          <div style={HEADER}>
            <span style={{ width: COL.type }}>类型</span>
            <span style={{ width: COL.name }}>名称</span>
            <span style={{ flex: 1 }}>默认值</span>
            <span style={{ width: COL.runtime, textAlign: 'center' }}>执行时填写</span>
            <span style={{ width: COL.action }} />
          </div>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {variables.map((v, idx) => (
              <VariableCard
                key={idx}
                variable={v}
                issue={nameIssue(v.name, idx, variables)}
                onChange={(patch) => update(idx, patch)}
                onRemove={() => remove(idx)}
              />
            ))}
          </Space>
        </div>
      )}

      <Button type="dashed" icon={<PlusOutlined />} onClick={add} style={{ marginTop: 12 }}>
        添加变量
      </Button>
    </div>
  )
}

const COL = {
  type: 128,
  name: 188,
  runtime: 88,
  action: 36,
}

const HEADER: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '0 14px 8px',
  color: '#8c8c8c',
  fontSize: 12,
}

/**
 * 单条变量。主行填会反复改的字段，说明和下拉选项按需出现，不占默认视线。
 */
function VariableCard({
  variable,
  issue,
  onChange,
  onRemove,
}: {
  variable: Variable
  issue: string
  onChange: (patch: Partial<Variable>) => void
  onRemove: () => void
}) {
  const [hovered, setHovered] = useState(false)
  const refText = placeholderOf(variable.name)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: issue ? '1px solid #ffccc7' : '1px solid #e8edf3',
        borderRadius: 8,
        padding: '12px 14px 10px',
        background: hovered ? '#fafcff' : '#fff',
        boxShadow: hovered ? '0 4px 12px rgba(15, 23, 42, 0.06)' : '0 1px 2px rgba(15, 23, 42, 0.04)',
        transition: 'box-shadow 0.15s ease, background 0.15s ease',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8 }}>
        <Select
          value={variable.type}
          onChange={(t) => onChange({ type: t })}
          options={VARIABLE_TYPES}
          style={{ width: COL.type, flexShrink: 0 }}
        />
        <div style={{ width: COL.name, flexShrink: 0 }}>
          <Input
            value={variable.name}
            onChange={(e) => onChange({ name: e.target.value.trim() })}
            placeholder="VERSION"
            status={issue ? 'error' : undefined}
          />
          {issue ? <div style={{ color: '#ff4d4f', fontSize: 12, marginTop: 4 }}>{issue}</div> : null}
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <DefaultValueField variable={variable} onChange={onChange} />
        </div>
        <div style={{ width: COL.runtime, flexShrink: 0, display: 'flex', justifyContent: 'center', paddingTop: 5 }}>
          <Tooltip title={variable.show_on_execution ? '点执行时弹出，可改这次的值' : '不弹窗，一直用默认值'}>
            <Switch
              checked={variable.show_on_execution}
              onChange={(checked) => onChange({ show_on_execution: checked })}
            />
          </Tooltip>
        </div>
        <Button
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={onRemove}
          style={{ width: COL.action, flexShrink: 0 }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <Tooltip title="复制到步骤参数里">
          <Button
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={() => void copyText(refText, `已复制 ${refText}`)}
            style={{ color: '#1677ff', paddingInline: 6 }}
          >
            <Text code style={{ fontSize: 12 }}>
              {refText}
            </Text>
          </Button>
        </Tooltip>
        <Input
          value={variable.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="给协作的人看的说明，可空"
          variant="borderless"
          style={{ flex: 1, background: '#f7f8fa', borderRadius: 6 }}
        />
      </div>

      {variable.type === 'select' ? (
        <Select
          mode="tags"
          value={variable.options || []}
          onChange={(opts) => onChange({ options: opts })}
          tokenSeparators={[',']}
          placeholder="下拉选项，回车添加，例如 prod、test"
          style={{ width: '100%', marginTop: 8 }}
        />
      ) : null}
    </div>
  )
}

/**
 * 按类型换默认值控件。是/否用下拉，多行用自适应文本域，其余一行输入。
 */
function DefaultValueField({
  variable,
  onChange,
}: {
  variable: Variable
  onChange: (patch: Partial<Variable>) => void
}) {
  if (variable.type === 'boolean') {
    return (
      <Select
        allowClear
        value={variable.default_value || undefined}
        onChange={(val) => onChange({ default_value: val || '' })}
        placeholder="默认"
        options={[
          { value: 'true', label: '是' },
          { value: 'false', label: '否' },
        ]}
        style={{ width: '100%' }}
      />
    )
  }
  if (variable.type === 'textarea') {
    return (
      <Input.TextArea
        value={variable.default_value}
        onChange={(e) => onChange({ default_value: e.target.value })}
        placeholder="默认值"
        autoSize={{ minRows: 1, maxRows: 4 }}
      />
    )
  }
  if (variable.type === 'select') {
    const options = (variable.options || []).map((o) => ({ value: o, label: o }))
    return (
      <Select
        allowClear
        value={variable.default_value || undefined}
        onChange={(val) => onChange({ default_value: val || '' })}
        placeholder="默认选项"
        options={options}
        style={{ width: '100%' }}
      />
    )
  }
  return (
    <Input
      value={variable.default_value}
      onChange={(e) => onChange({ default_value: e.target.value })}
      placeholder="默认值，可空"
    />
  )
}
