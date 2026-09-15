import { useState } from 'react'
import { Card, Form, Input, Button, Typography, message } from 'antd'
import { MailOutlined, DeploymentUnitOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import { postR } from '@/api/client'
import { resolveDisplayName, usePlatformBranding } from '@/hooks/usePlatformBranding'

const { Title, Text } = Typography

/**
 * 忘记密码。只对有本系统密码且配了真实邮箱的账号发信。
 * 无论账号在不在都显示同一句成功，避免被人用来枚举用户。
 */
export default function ForgotPassword() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const { data: branding } = usePlatformBranding()
  const displayName = resolveDisplayName(branding)

  const onFinish = async (values: { username: string }) => {
    setLoading(true)
    try {
      const res = await postR('/auth/forgot-password', {
        username: values.username,
        origin: window.location.origin,
      })
      setSent(true)
      message.success(res.message || '如果该账号可以找回，重置邮件已发出。')
    } catch {
      // 错误已由拦截器提示
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <Card className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: '#1677ff' }}>
            <DeploymentUnitOutlined style={{ fontSize: 48 }} />
          </div>
          <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
            {displayName}
          </Title>
          <Text type="secondary">通过邮箱重置本系统登录密码</Text>
        </div>
        {sent ? (
          <>
            <Text>
              如果该账号可以找回，重置邮件已发出。请检查邮箱（含垃圾箱），链接 2 小时内有效。
            </Text>
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Link to="/login">返回登录</Link>
            </div>
          </>
        ) : (
          <>
            <Form onFinish={onFinish} size="large">
              <Form.Item
                name="username"
                rules={[{ required: true, message: '请输入用户名或邮箱' }]}
              >
                <Input prefix={<MailOutlined />} placeholder="本系统用户名或邮箱" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  发送重置邮件
                </Button>
              </Form.Item>
            </Form>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              仅本系统密码账号可通过邮箱找回。LDAP 账号请联系域管理员改密。重置成功后需要重新绑定 Authenticator。
            </Text>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Link to="/login">返回登录</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
