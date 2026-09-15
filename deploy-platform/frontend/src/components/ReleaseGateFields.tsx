import { Alert, Checkbox, Form, Input, Space } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { MANIFEST_PLACEHOLDER } from '@/utils/releaseGate'

type BypassKind = 'execute' | 'rebuild' | 'rollback'

/**
 * 执行 / 保存并执行 / Rebuild 共用的发布清单和应急跳审。
 * 有增量包步骤才出清单；需要审批时才出跳审。
 */
export default function ReleaseGateFields({
  needManifest,
  manifest,
  onManifestChange,
  needApproval,
  allowBypass,
  allowSelfApproval,
  bypass,
  onBypassChange,
  reason,
  onReasonChange,
  kind = 'execute',
}: {
  needManifest: boolean
  manifest: string
  onManifestChange: (value: string) => void
  needApproval: boolean
  allowBypass: boolean
  allowSelfApproval?: boolean
  bypass: boolean
  onBypassChange: (value: boolean) => void
  reason: string
  onReasonChange: (value: string) => void
  kind?: BypassKind
}) {
  const action = kind === 'rollback' ? '回滚' : kind === 'rebuild' ? 'Rebuild' : '上线'
  return (
    <>
      {needManifest && (
        <Form layout="vertical" style={{ marginBottom: needApproval ? 16 : 0 }}>
          <Form.Item
            label="发布清单"
            extra="填写则覆盖本次执行。留空则沿用步骤里已写死的文件列表。步骤仍是占位、未写死文件时必须填写，否则拒绝执行，不会按产物全量打包。"
          >
            <Input.TextArea
              rows={6}
              value={manifest}
              onChange={(e) => onManifestChange(e.target.value)}
              placeholder={MANIFEST_PLACEHOLDER}
            />
          </Form.Item>
        </Form>
      )}

      {needApproval && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message={
            kind === 'execute'
              ? '该流水线所在分组开启了发布审批'
              : `该分组开启了发布审批，${action}同样需要过审`
          }
          description={
            kind === 'execute'
              ? allowSelfApproval
                ? '提交后进入待审批。分组开启了允许发起人自审，有审批权的发起人也可以批自己的单。'
                : '提交后进入待审批，需要具备该分组审批权限的人处理。'
              : `提交后生成一张${action}单，审批通过才会执行。`
          }
        />
      )}

      {!needApproval ? null : allowBypass ? (
        <>
          <Checkbox checked={bypass} onChange={(e) => onBypassChange(e.target.checked)}>
            <Space size={4}>
              <ThunderboltOutlined style={{ color: '#fa8c16' }} />
              {kind === 'execute'
                ? '应急跳审（紧急上线，无人可审时使用）'
                : '应急跳审（线上故障等不及审批时使用）'}
            </Space>
          </Checkbox>
          {bypass && (
            <div style={{ marginTop: 12 }}>
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 8 }}
                message="跳审会跳过审批直接执行，全程记录审计并通知审批人"
              />
              <Input.TextArea
                rows={3}
                value={reason}
                onChange={(e) => onReasonChange(e.target.value)}
                placeholder={
                  kind === 'execute'
                    ? '必填：说明为什么需要紧急上线，例如线上故障修复'
                    : `必填：说明为什么需要立刻${action}，例如线上故障恢复`
                }
              />
            </div>
          )}
        </>
      ) : (
        <Alert
          type="warning"
          showIcon
          message="该分组未开启应急跳审"
          description="如需紧急上线通道，请让管理员在环境分组中开启应急跳审。"
        />
      )}
    </>
  )
}
