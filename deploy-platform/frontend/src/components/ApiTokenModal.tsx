import { Modal, Form, Input, InputNumber, Button, Tag, Space, Popconfirm, Alert, message } from 'antd'
import DataTable from '@/components/DataTable'
import { PlusOutlined, DeleteOutlined, CopyOutlined, KeyOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { get, post, del } from '@/api/client'
import { copyText } from '@/utils/clipboard'

interface ApiToken {
  id: number
  name: string
  expires_at: string | null
  last_used_at: string | null
  revoked: boolean
  created_at: string
}

/** 用户下拉框弹出的 API Token 管理（创建/列表/吊销）。 */
export default function ApiTokenModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [form] = Form.useForm()
  const [newToken, setNewToken] = useState<string | null>(null)

  const { data: tokens = [] } = useQuery({
    queryKey: ['api-tokens'],
    queryFn: () => get<ApiToken[]>('/api-tokens'),
    enabled: open,
  })

  const handleCreate = async () => {
    const values = await form.validateFields()
    const r = await post<ApiToken & { token: string }>('/api-tokens', {
      name: values.name,
      days: values.days,
    })
    setNewToken(r.token)
    form.resetFields()
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
  }

  const handleRevoke = async (id: number) => {
    await del(`/api-tokens/${id}`)
    queryClient.invalidateQueries({ queryKey: ['api-tokens'] })
  }

  const copyToken = () => {
    if (!newToken) return
    void copyText(newToken)
  }

  const columns = [
    { title: '名称', dataIndex: 'name' },
    {
      title: '过期时间',
      dataIndex: 'expires_at',
      render: (v: string | null) =>
        v ? new Date(v).toLocaleDateString() : <Tag color="purple">永久</Tag>,
    },
    {
      title: '最后使用',
      dataIndex: 'last_used_at',
      render: (v: string | null) => (v ? new Date(v).toLocaleString() : <span style={{ color: '#999' }}>未使用</span>),
    },
    {
      title: '操作',
      width: 90,
      render: (_: unknown, r: ApiToken) => (
        <Popconfirm title="吊销后该 token 立即失效，确认？" onConfirm={() => handleRevoke(r.id)}>
          <Button size="small" danger icon={<DeleteOutlined />}>
            吊销
          </Button>
        </Popconfirm>
      ),
    },
  ]

  return (
    <Modal title={<Space><KeyOutlined />API Token</Space>} open={open} onCancel={onClose} footer={null} width={680} destroyOnClose>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="API Token 拥有与您账号同等的权限，可用于脚本 / CI 调用 API。"
        description="格式：Authorization: Bearer <token>。出于安全只存哈希：明文仅在创建时显示一次，请妥善保存；过期后会自动删除。"
      />

      {/* 创建 */}
      <Form form={form} layout="inline" style={{ marginBottom: 8, rowGap: 8 }}>
        <Form.Item name="name" rules={[{ required: true, message: '请输入名称' }]} style={{ flex: 1 }}>
          <Input placeholder="Token 名称，如：ci-deploy-script" prefix={<KeyOutlined />} />
        </Form.Item>
        <Form.Item name="days" initialValue={365} rules={[{ required: true }]}>
          <InputNumber min={1} max={1095} addonAfter="天" style={{ width: 140 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            创建
          </Button>
        </Form.Item>
      </Form>
      <div style={{ marginBottom: 12, color: '#999', fontSize: 12 }}>
        有效期默认 1 年（365 天），最长 3 年（1095 天）。
      </div>

      {/* 创建成功后的明文展示 */}
      {newToken && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="请立即复制保存，关闭后无法再次查看"
          description={
            <Space.Compact style={{ width: '100%' }}>
              <Input value={newToken} readOnly onFocus={(e) => e.target.select()} />
              <Button icon={<CopyOutlined />} onClick={copyToken}>
                复制
              </Button>
            </Space.Compact>
          }
        />
      )}

      {/* 列表 */}
      <DataTable chromeKey="api-tokens" rowKey="id" columns={columns} dataSource={tokens} pagination={false} size="small" />
    </Modal>
  )
}
