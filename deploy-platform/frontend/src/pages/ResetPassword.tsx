import { useMemo, useState } from 'react'
import { Card, Form, Input, Button, Typography, message } from 'antd'
import { LockOutlined, DeploymentUnitOutlined } from '@ant-design/icons'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { postR } from '@/api/client'
import { resolveDisplayName, usePlatformBranding } from '@/hooks/usePlatformBranding'

const { Title, Text } = Typography

/**
 * 邮件重置链接落地页。token 在查询串里，一次性，用过即废。
 * 改密会清掉双因子绑定，下次登录重新扫码。
 */
export default function ResetPassword() {
  const [loading, setLoading] = useState(false)
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const token = useMemo(() => (search.get('token') || '').trim(), [search])
  const { data: branding } = usePlatformBranding()
  const displayName = resolveDisplayName(branding)

  const onFinish = async (values: { password: string }) => {
    if (!token) {
      message.error('重置链接无效，请重新申请')
      return
    }
    setLoading(true)
    try {
      const res = await postR('/auth/reset-password', {
        token,
        password: values.password,
      })
      message.success(res.message || '密码已重置，请使用新密码登录')
      navigate('/login', { replace: true })
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
          <Text type="secondary">设置新的登录密码</Text>
        </div>
        {!token ? (
          <>
            <Text type="danger">链接缺少令牌，请从邮件里重新打开，或再申请一次。</Text>
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Link to="/forgot-password">重新申请</Link>
            </div>
          </>
        ) : (
          <>
            <Form onFinish={onFinish} size="large">
              <Form.Item
                name="password"
                rules={[
                  { required: true, message: '请输入新密码' },
                  { min: 8, message: '密码至少 8 位' },
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="新密码，至少 8 位" />
              </Form.Item>
              <Form.Item
                name="confirm"
                dependencies={['password']}
                rules={[
                  { required: true, message: '请再输入一遍新密码' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('password') === value) {
                        return Promise.resolve()
                      }
                      return Promise.reject(new Error('两次输入的密码不一致'))
                    },
                  }),
                ]}
              >
                <Input.Password prefix={<LockOutlined />} placeholder="再输入一遍" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  重置密码
                </Button>
              </Form.Item>
            </Form>
            <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
              重置成功后，若平台开启了双因子，下次登录需要重新用 Authenticator 扫码绑定。
            </Text>
          </>
        )}
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Link to="/login">返回登录</Link>
        </div>
      </Card>
    </div>
  )
}
