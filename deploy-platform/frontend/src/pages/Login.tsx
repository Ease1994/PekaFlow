import { useState, useEffect } from 'react'
import { Card, Form, Input, Button, Typography, message, Divider } from 'antd'
import {
  UserOutlined,
  LockOutlined,
  DeploymentUnitOutlined,
  WechatOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { post, get } from '@/api/client'
import { useAuthStore } from '@/stores/auth'
import type { LoginResponse, UserInfo } from '@/api/types'
import { resolveDisplayName, usePlatformBranding } from '@/hooks/usePlatformBranding'
import { isWecomWebView, safeNextPath } from '@/utils/h5'

const { Title, Text, Paragraph } = Typography

/** 登录过程：先账号密码，平台开了双因子再扫码或输码。 */
type LoginStep = 'password' | 'totp_setup' | 'totp_required'

/**
 * 登录页。
 * 密码对了之后若平台开启双因子：未绑定要扫 Authenticator，已绑定只输 6 位码。
 * 正式 JWT 下发前不写入 auth store，避免把 5 分钟的 pending 票当成 30 天会话。
 */
export default function Login() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const setAuth = useAuthStore((s) => s.setAuth)
  const [loading, setLoading] = useState(false)
  const [step, setStep] = useState<LoginStep>('password')
  const [pendingToken, setPendingToken] = useState('')
  const [qrSvg, setQrSvg] = useState('')
  const [otpauthUri, setOtpauthUri] = useState('')
  const [hint, setHint] = useState('')
  const { data: branding } = usePlatformBranding()
  const displayName = resolveDisplayName(branding)

  const { data: wecomStatus } = useQuery({
    queryKey: ['wecom-status'],
    queryFn: () => get<{ enabled: boolean }>('/auth/wecom/status'),
    retry: false,
  })

  /** 登录完成后回到卡片原来的页，例如 /approvals。 */
  const goAfterLogin = () => {
    const stored = sessionStorage.getItem('auth_next')
    sessionStorage.removeItem('auth_next')
    navigate(safeNextPath(params.get('next') || stored), { replace: true })
  }

  /** 拿到正式 token 才进工作台。pending 票不能当登录态。 */
  const enterSession = (data: LoginResponse) => {
    if (!data.token || !data.user) {
      message.error('登录未完成，请重新输入账号密码')
      return
    }
    setAuth(data.token, data.user)
    message.success(`欢迎回来，${data.user.display_name || data.user.username}`)
    goAfterLogin()
  }

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true)
    try {
      const data = await post<LoginResponse>('/auth/login', values)
      if (data.status === 'totp_setup' || data.status === 'totp_required') {
        setPendingToken(data.pending_token || '')
        setQrSvg(data.qr_svg || '')
        setOtpauthUri(data.otpauth_uri || '')
        setHint(data.message || '')
        setStep(data.status)
        return
      }
      enterSession(data)
    } catch {
      // 错误已由拦截器提示
    } finally {
      setLoading(false)
    }
  }

  /** 校验 Authenticator 当前 6 位码，首次成功即完成绑定。 */
  const submitTotp = async (code: string) => {
    const digits = code.replace(/\D/g, '')
    if (digits.length !== 6 || !pendingToken) return
    setLoading(true)
    try {
      const data = await post<LoginResponse>('/auth/login/totp', {
        pending_token: pendingToken,
        code: digits,
      })
      enterSession(data)
    } catch {
      // 错码是 400，拦截器只弹错误，pending 票还在，可以再输
    } finally {
      setLoading(false)
    }
  }

  const handleWecomLogin = async () => {
    try {
      const { authorize_url } = await get<{ authorize_url: string }>('/auth/wecom/authorize-url')
      sessionStorage.setItem('auth_next', safeNextPath(params.get('next')))
      if (isWecomWebView()) {
        window.location.href = authorize_url
        return
      }
      window.open(authorize_url, '_blank', 'width=600,height=700')
    } catch {
      // 错误已提示
    }
  }

  /**
   * 用企微返回的 JWT 进站。
   * 桌面弹窗走 postMessage；企微 H5 没有 opener，回调会跳回 /login#wecom_token=。
   */
  const enterWithToken = async (token: string) => {
    const resp = await fetch('/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await resp.json()
    if (body.code === 0 && body.data) {
      setAuth(token, body.data as UserInfo)
      message.success('企业微信登录成功')
      goAfterLogin()
      return
    }
    message.error('企业微信登录失败')
  }

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '')
    const token = new URLSearchParams(hash).get('wecom_token')
    if (!token) return
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    void enterWithToken(token)
    // 只在进页时消化一次 hash，避免把 token 留在地址栏
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handler = async (e: MessageEvent) => {
      if (e.data?.type === 'wecom_token' && e.data.access_token) {
        try {
          await enterWithToken(e.data.access_token as string)
        } catch {
          message.error('企业微信登录失败')
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const backToPassword = () => {
    setStep('password')
    setPendingToken('')
    setQrSvg('')
    setOtpauthUri('')
    setHint('')
  }

  return (
    <div className="login-page">
      <Card className={step === 'totp_setup' ? 'login-card is-totp-setup' : 'login-card'}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ color: '#1677ff' }}>
            {step === 'password' ? (
              <DeploymentUnitOutlined style={{ fontSize: 48 }} />
            ) : (
              <SafetyCertificateOutlined style={{ fontSize: 48 }} />
            )}
          </div>
          <Title level={3} style={{ marginTop: 12, marginBottom: 4 }}>
            {displayName}
          </Title>
          <Text type="secondary">
            {step === 'password'
              ? '任何应用、任何环境，一次定义、一键发布'
              : step === 'totp_setup'
                ? '首次登录请用 Authenticator 扫描二维码'
                : '请输入 Authenticator 中的 6 位验证码'}
          </Text>
        </div>

        {step === 'password' ? (
          <>
            <Form onFinish={onFinish} size="large">
              <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input prefix={<UserOutlined />} placeholder="本地账号或域账号 / 邮箱" />
              </Form.Item>
              <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password prefix={<LockOutlined />} placeholder="密码" />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  登录
                </Button>
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'right', marginTop: -8, marginBottom: 8 }}>
              <Link to="/forgot-password">忘记密码</Link>
            </div>

            {wecomStatus?.enabled && (
              <>
                <Divider plain style={{ fontSize: 12, color: '#999' }}>或</Divider>
                <Button block icon={<WechatOutlined />} onClick={handleWecomLogin} style={{ color: '#07c160' }}>
                  企业微信登录
                </Button>
              </>
            )}

            <Text type="secondary" style={{ fontSize: 12, display: 'block', textAlign: 'center', marginTop: 16 }}>
              本地账号用短名（如 admin）。域账号请先让管理员开启 LDAP，可用邮箱或域账号登录。
            </Text>
          </>
        ) : (
          <>
            {hint ? (
              <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginBottom: 16 }}>
                {hint}
              </Text>
            ) : null}
            {step === 'totp_setup' && qrSvg ? (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'center',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{ width: 200, height: 200 }}
                  className="totp-qr"
                  dangerouslySetInnerHTML={{ __html: qrSvg }}
                />
              </div>
            ) : null}
            {step === 'totp_setup' && otpauthUri ? (
              <Paragraph
                copyable
                ellipsis
                type="secondary"
                style={{ fontSize: 12, marginBottom: 16 }}
              >
                {otpauthUri}
              </Paragraph>
            ) : null}
            <Form
              size="large"
              onFinish={(values: { code: string }) => void submitTotp(values.code || '')}
            >
              <Form.Item
                name="code"
                rules={[{ required: true, message: '请输入 6 位验证码' }]}
                style={{ display: 'flex', justifyContent: 'center' }}
              >
                <Input.OTP length={6} disabled={loading} />
              </Form.Item>
              <Form.Item>
                <Button type="primary" htmlType="submit" block loading={loading}>
                  验证并登录
                </Button>
              </Form.Item>
            </Form>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <Button type="link" onClick={backToPassword} style={{ padding: 0 }}>
                返回账号密码
              </Button>
              <Link to="/forgot-password">忘记密码 / 手机丢了</Link>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
