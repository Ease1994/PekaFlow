import { useState } from 'react'
import { Form, Input, Modal, message } from 'antd'
import { MailOutlined } from '@ant-design/icons'
import { put } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { UserInfo } from '@/api/types'

/**
 * 本地管理员第一次登录必须留下真实邮箱。
 * 弹窗不能关：丢了密码或 Authenticator 时，邮件是唯一找回入口。
 */
export default function AdminEmailGate() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const open = Boolean(user?.must_set_email)

  const onOk = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const next = await put<UserInfo>('/auth/email', { email: values.email })
      setUser(next)
      message.success('管理员邮箱已保存，忘记密码时会发到这个地址')
    } catch {
      // 错误已由拦截器提示
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="请先配置管理员邮箱"
      open={open}
      closable={false}
      maskClosable={false}
      keyboard={false}
      okText="保存邮箱"
      cancelButtonProps={{ style: { display: 'none' } }}
      confirmLoading={saving}
      onOk={() => void onOk()}
    >
      <p>
        管理员账号必须留下真实邮箱。手机丢了或密码忘了，只能通过这封邮箱找回（非 LDAP 账号）。
        占位域名（如 example.com）不能当找回地址。
      </p>
      <Form form={form} layout="vertical">
        <Form.Item
          name="email"
          label="管理员邮箱"
          rules={[
            { required: true, message: '请填写邮箱' },
            { type: 'email', message: '请填写真实邮箱，例如 admin@company.com' },
          ]}
        >
          <Input prefix={<MailOutlined />} placeholder="admin@company.com" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
