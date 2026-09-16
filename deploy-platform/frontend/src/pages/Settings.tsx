import { useEffect } from 'react'
import { Card, Form, Input, Select, Button, message, Divider, Alert, Tag, Upload, Space } from 'antd'
import {
  SaveOutlined,
  DatabaseOutlined,
  ClusterOutlined,
  RedoOutlined,
  InboxOutlined,
  PictureOutlined,
  UploadOutlined,
  DeleteOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { del, get, post, postForm, put } from '@/api/client'
import { HEADER_NOTICE_COLORS } from '@/hooks/usePlatformBranding'

interface Settings {
  log_storage: string
  es_hosts: string
  es_index: string
  es_username: string
  es_password: string
  task_poll_interval: string
  redis_host: string
  redis_port: string
  redis_password: string
  redis_db: string
  ldap_enabled: string
  ldap_server_uri: string
  ldap_bind_dn: string
  ldap_bind_password: string
  ldap_user_search_base: string
  ldap_user_search_filter: string
  ldap_attr_username: string
  ldap_attr_email: string
  ldap_attr_display_name: string
  ldap_auto_provision: string
  wecom_enabled: string
  wecom_corp_id: string
  wecom_agent_id: string
  wecom_secret: string
  wecom_redirect_uri: string
  wecom_auto_provision: string
  wecom_notify_enabled: string
  wecom_app_base: string
  wecom_callback_token: string
  wecom_encoding_aes_key: string
  emergency_bypass_enabled: string
  artifact_prod_retention_days: string
  smtp_enabled: string
  smtp_host: string
  smtp_port: string
  smtp_user: string
  smtp_password: string
  smtp_from: string
  /** 邮件发件人显示名 */
  smtp_from_name: string
  smtp_ssl: string
  /** 侧栏 / 登录页 / 浏览器标题 */
  platform_display_name: string
  /** 顶栏通知横幅文案，空则不显示 */
  header_notice_text: string
  /** 横幅醒目色 */
  header_notice_color: string
  /** 是否已上传顶栏图（计算字段，不入库） */
  header_has_image?: boolean
  /** 顶栏图公开地址（计算字段） */
  header_image_url?: string
  /** 登录 JWT 有效天数 */
  session_expire_days: string
  /** 是否开启 Authenticator 双因子 */
  totp_2fa_enabled: string
  /** 忘记密码邮件里的站点根地址 */
  public_app_base: string
  /** 审计日志保留天数 */
  audit_retention_days: string
  bootstrap_database?: string
  bootstrap_version?: string
}

export default function Settings() {
  const queryClient = useQueryClient()
  const [form] = Form.useForm()

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => get<Settings>('/settings'),
  })

  // 数据返回后灌入表单（仅 initialValues 不会在异步加载后刷新）
  useEffect(() => {
    if (settings) {
      const {
        header_has_image: _hasImage,
        header_image_url: _imageUrl,
        bootstrap_database: _db,
        bootstrap_version: _ver,
        ...formValues
      } = settings
      form.setFieldsValue({
        ...formValues,
        es_index: settings.es_index || 'rp-exec-logs',
        artifact_prod_retention_days: settings.artifact_prod_retention_days || '10',
        session_expire_days: settings.session_expire_days || '1',
        totp_2fa_enabled: settings.totp_2fa_enabled || 'false',
        public_app_base: settings.public_app_base || '',
        audit_retention_days: settings.audit_retention_days || '180',
        platform_display_name: settings.platform_display_name || '发布部署平台',
        header_notice_text: settings.header_notice_text || '',
        header_notice_color: settings.header_notice_color || 'red',
      })
    }
  }, [settings, form])

  const saveMutation = useMutation({
    mutationFn: (values: Record<string, string>) => put('/settings', values),
    onSuccess: () => {
      message.success('配置已保存，立即生效（无需重启）')
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['platform-branding'] })
    },
  })

  const refreshHeader = () => {
    queryClient.invalidateQueries({ queryKey: ['settings'] })
    queryClient.invalidateQueries({ queryKey: ['platform-branding'] })
  }

  const uploadHeaderImage = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return postForm('/settings/header-image', formData)
    },
    onSuccess: () => {
      message.success('顶栏图片已更新')
      refreshHeader()
    },
  })

  const clearHeaderImage = useMutation({
    mutationFn: () => del('/settings/header-image'),
    onSuccess: () => {
      message.success('顶栏图片已清除')
      refreshHeader()
    },
  })

  const ldapTest = useMutation({
    mutationFn: () => post<{ ok: boolean; user_found?: boolean; user?: { username: string; email: string } }>('/account/ldap/test', {}),
    onSuccess: (r) => {
      message.success(r.user_found ? `LDAP 连通，并搜到 ${r.user?.username || ''}` : 'LDAP 绑定账号连通正常')
    },
  })

  const handleSave = async () => {
    const values = await form.validateFields()
    if (!values.es_index?.trim()) {
      values.es_index = 'rp-exec-logs'
    }
    saveMutation.mutate(values)
  }

  return (
    <div>
      <Alert
        type="info"
        showIcon
        message="运营配置（立即生效）"
        description="本页改品牌、登录过期、审计保留、Redis / LDAP / 企微 / 邮件 / 日志存储，保存即可，不必重启。业务库连接和 JWT 密钥是启动项，只能改环境变量 DATABASE_URL / JWT_SECRET 后重启后端。"
        style={{ marginBottom: 16 }}
      />

      <Card
        title="运营配置"
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={settings}
          onFinish={handleSave}
        >
          <Divider orientation="left">
            <PictureOutlined /> 品牌与会话
          </Divider>
          <Form.Item
            label="平台显示名"
            name="platform_display_name"
            extra="侧栏、登录页、浏览器标题用这个名字。最多 32 个字。"
            rules={[{ required: true, message: '请填写平台显示名' }]}
          >
            <Input placeholder="发布部署平台" maxLength={32} style={{ maxWidth: 360 }} />
          </Form.Item>
          <Form.Item
            label="顶栏图片"
            extra="登录后顶栏左侧。不上传就是空白，不会回退成文字。PNG / JPEG / GIF / WEBP，最大 1MB。"
          >
            <Space align="start" wrap>
              {settings?.header_has_image && settings.header_image_url ? (
                <img
                  src={settings.header_image_url}
                  alt="顶栏图片预览"
                  style={{ height: 36, maxWidth: 240, objectFit: 'contain', display: 'block' }}
                />
              ) : (
                <span style={{ color: '#8c8c8c', lineHeight: '32px' }}>当前空白</span>
              )}
              <Upload
                accept="image/png,image/jpeg,image/gif,image/webp,.png,.jpg,.jpeg,.gif,.webp"
                showUploadList={false}
                beforeUpload={(file) => {
                  uploadHeaderImage.mutate(file)
                  return false
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploadHeaderImage.isPending}>
                  上传图片
                </Button>
              </Upload>
              {settings?.header_has_image ? (
                <Button
                  icon={<DeleteOutlined />}
                  loading={clearHeaderImage.isPending}
                  onClick={() => clearHeaderImage.mutate()}
                >
                  清除
                </Button>
              ) : null}
            </Space>
          </Form.Item>
          <Form.Item
            label="顶栏通知"
            name="header_notice_text"
            extra="显示在顶栏图片右侧。留空则不显示横幅。最多 200 个字，保存后立即生效。"
          >
            <Input.TextArea
              placeholder="例如：今晚 22:00 系统维护，请提前提交发布"
              maxLength={200}
              showCount
              autoSize={{ minRows: 2, maxRows: 3 }}
              style={{ maxWidth: 560 }}
            />
          </Form.Item>
          <Form.Item
            label="通知醒目颜色"
            name="header_notice_color"
            extra="横幅用实心底色，保证一眼能看见。"
          >
            <Select
              style={{ maxWidth: 240 }}
              options={Object.entries(HEADER_NOTICE_COLORS).map(([value, theme]) => ({
                value,
                label: (
                  <Space size={8}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 14,
                        height: 14,
                        borderRadius: 3,
                        background: theme.bg,
                      }}
                    />
                    {theme.label}
                  </Space>
                ),
              }))}
            />
          </Form.Item>
          <Form.Item
            label="通知发件人显示名"
            name="smtp_from_name"
            extra="邮件收件箱里看到的名字。地址仍在下面「邮件通知」里配。"
          >
            <Input placeholder="发布部署平台" maxLength={64} style={{ maxWidth: 360 }} />
          </Form.Item>
          <Form.Item
            label="登录 Session 过期时间"
            name="session_expire_days"
            extra="新登录按此时长签发。已登录的人仍按当时那张 token 过期，不会被立刻踢下线。可填 1～30 天，默认 1 天。Session 有效期内不必再输双因子验证码。"
            rules={[{ required: true, message: '请填写过期时间' }]}
          >
            <Input type="number" min={1} max={30} addonAfter="天" placeholder="1" style={{ width: 200 }} />
          </Form.Item>
          <Form.Item
            label={
              <span>
                <SafetyCertificateOutlined /> 双因子登录（Authenticator）
              </span>
            }
            name="totp_2fa_enabled"
            extra="开启后，本地账号和 LDAP 密码登录都要扫 Authenticator。会话未过期期间不用再输码。企业微信扫码登录不受影响。关掉后登录恢复为只验密码；再打开时已绑定的人只需输码，不必重新扫。"
          >
            <Select
              style={{ maxWidth: 360 }}
              options={[
                { label: '关闭（只验账号密码）', value: 'false' },
                { label: '开启（登录需 6 位验证码）', value: 'true' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="对外站点根地址"
            name="public_app_base"
            extra="忘记密码邮件里的链接根地址，例如 https://deploy.example.com。留空则用申请时浏览器地址。生产环境建议填死，避免邮件链到内网 Origin。"
          >
            <Input placeholder="https://deploy.example.com" style={{ maxWidth: 360 }} />
          </Form.Item>
          <Form.Item
            label="审计日志保留天数"
            name="audit_retention_days"
            extra="超过这个天数的操作审计会被定时清理。可填 30～3650 天，默认 180 天。"
            rules={[{ required: true, message: '请填写保留天数' }]}
          >
            <Input type="number" min={30} max={3650} addonAfter="天" placeholder="180" style={{ width: 200 }} />
          </Form.Item>

          <Divider orientation="left">
            <DatabaseOutlined /> 日志存储后端
          </Divider>
          <Form.Item
            label="构建日志存储"
            extra="实时日志进 Redis（最多留 1 小时）；写入 ES 成功后立刻从 Redis 删掉。中间件挂了就丢这一批，不写业务库、不攒内存；发布照常跑。"
          >
            <Alert
              type="info"
              showIcon
              message="固定：Redis 实时 + Elasticsearch 归档"
              description="历史日志只在 Elasticsearch。Redis 只缓冲正在看的实时流，ES 写入成功即删除，并带 1 小时过期。不写业务库、不落进程内存。"
            />
          </Form.Item>

          <Divider orientation="left">
            <ClusterOutlined /> Elasticsearch 配置
          </Divider>
          <Form.Item
            label="ES 地址（多个用逗号分隔）"
            name="es_hosts"
            extra="Compose 默认 http://elasticsearch:9200（本栈单节点）。本机 uvicorn 默认 localhost:9200。改成自备集群后保存即生效，不必重启。"
          >
            <Input placeholder="http://elasticsearch:9200" />
          </Form.Item>
          <Form.Item
            label="ES 日志索引前缀"
            name="es_index"
            extra="构建日志写入 rp-exec-logs-当天日期（yyyy-mm-dd）。AI 助手审计日志固定走独立前缀 rp-assist-logs，不占用这项配置、也不进业务库。Compose 默认连本栈 ES，要换集群在上面改地址即可。"
          >
            <Input placeholder="rp-exec-logs" />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="ES 用户名（可空）" name="es_username" style={{ flex: 1 }}>
              <Input placeholder="elastic" />
            </Form.Item>
            <Form.Item label="ES 密码（可空）" name="es_password" style={{ flex: 1 }}>
              <Input.Password placeholder="密码" />
            </Form.Item>
          </div>

          <Divider orientation="left">Agent 调度</Divider>
          <Form.Item label="任务拉取间隔（秒）" name="task_poll_interval">
            <Input type="number" placeholder="2" />
          </Form.Item>

          <Divider orientation="left">发布审批</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="应急跳审总开关"
            description="缺省关闭。打开后，分组自己还能决定开不开跳审。项目经理要接管生产放行时保持关闭——任何环境都不能再跳审，只能走审批（含已打开的项目经理确认）。"
          />
          <Form.Item
            label="允许应急跳审"
            name="emergency_bypass_enabled"
            extra="关掉后，页面上的跳审按钮会消失，接口也会拒绝。分组上的「允许应急跳审」此时无效。"
          >
            <Select
              options={[
                { label: '开启（分组还可单独关）', value: 'true' },
                { label: '关闭（全平台禁止跳审，缺省）', value: 'false' },
              ]}
            />
          </Form.Item>

          <Divider orientation="left">
            <InboxOutlined /> 制品库
          </Divider>
          <Form.Item
            label="生产环境制品保留天数"
            name="artifact_prod_retention_days"
            extra="按流水线算：每条生产 / UAT / 预发流水线保留最近这些天的包，窗口外仍至少留下该线最新 2 个，避免服务很久没发、回滚时包没了。测试、开发仍只留当天。可填 1～365，默认 10 天。"
            rules={[{ required: true, message: '请填写保留天数' }]}
          >
            <Input type="number" min={1} max={365} addonAfter="天" placeholder="10" style={{ width: 200 }} />
          </Form.Item>

          <Divider orientation="left">
            <RedoOutlined /> Redis 配置（定时触发延迟队列）
          </Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="定时触发器（cron）依赖 Redis 延迟队列。配置好 Redis 后保存，定时触发才会真正生效。"
          />
          <div className="rp-field-row">
            <Form.Item label="Redis 主机" name="redis_host" style={{ flex: 2 }}>
              <Input placeholder="localhost" />
            </Form.Item>
            <Form.Item label="端口" name="redis_port" style={{ flex: 1 }}>
              <Input placeholder="6379" />
            </Form.Item>
          </div>
          <div className="rp-field-row">
            <Form.Item label="密码（可空）" name="redis_password" style={{ flex: 1 }}>
              <Input.Password placeholder="无密码留空" />
            </Form.Item>
            <Form.Item label="数据库编号" name="redis_db" style={{ flex: 1 }}>
              <Input placeholder="0" />
            </Form.Item>
          </div>

          <Divider orientation="left">LDAP 登录配置</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="LDAP 登录"
            description="开启后可用邮箱、UPN 或域短账号登录。过滤器支持 {username} 和 {sam}（@ 前面一段）。绑定账号密码必须填写。用户可在「用户管理」导入或禁用 LDAP 账号。"
          />
          <Form.Item label="启用 LDAP 登录" name="ldap_enabled">
            <Select
              options={[
                { label: '关闭（仅本地账号密码）', value: 'false' },
                { label: '开启', value: 'true' },
              ]}
            />
          </Form.Item>
          <Form.Item label="首次 LDAP 登录自动建档" name="ldap_auto_provision">
            <Select
              options={[
                { label: '开启（认证成功自动出现在用户列表）', value: 'true' },
                { label: '关闭（必须先在用户管理中导入）', value: 'false' },
              ]}
            />
          </Form.Item>
          <Form.Item label="LDAP 服务器地址" name="ldap_server_uri">
            <Input placeholder="ldap://ldap.example.com:389" />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="绑定账号 DN" name="ldap_bind_dn" style={{ flex: 1 }}>
              <Input placeholder="cn=ldap-bind,dc=example,dc=com" />
            </Form.Item>
            <Form.Item label="绑定账号密码" name="ldap_bind_password" style={{ flex: 1 }}>
              <Input.Password placeholder="绑定账号密码" />
            </Form.Item>
          </div>
          <Form.Item label="用户搜索基准 DN" name="ldap_user_search_base">
            <Input placeholder="ou=Users,dc=example,dc=com" />
          </Form.Item>
          <Form.Item label="用户搜索过滤器（{username}=登录名，{sam}=@ 前一段）" name="ldap_user_search_filter">
            <Input placeholder="(|(mail={username})(userPrincipalName={username})(sAMAccountName={sam}))" />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="属性：用户名" name="ldap_attr_username" style={{ flex: 1 }}>
              <Input placeholder="sAMAccountName" />
            </Form.Item>
            <Form.Item label="属性：邮箱" name="ldap_attr_email" style={{ flex: 1 }}>
              <Input placeholder="mail" />
            </Form.Item>
            <Form.Item label="属性：显示名" name="ldap_attr_display_name" style={{ flex: 1 }}>
              <Input placeholder="displayName" />
            </Form.Item>
          </div>
          <Button style={{ marginBottom: 16 }} onClick={() => ldapTest.mutate()} loading={ldapTest.isPending}>
            测试 LDAP 连通（请先保存配置）
          </Button>

          <Divider orientation="left">企业微信登录配置</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="企微 OAuth2 网页授权登录。redirect_uri 域名须配置在企微「网页授权及JS-SDK」可信域名内。"
          />
          <Form.Item label="启用企业微信登录" name="wecom_enabled">
            <Select
              options={[
                { label: '关闭', value: 'false' },
                { label: '开启', value: 'true' },
              ]}
            />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="企业 ID（CorpId）" name="wecom_corp_id" style={{ flex: 2 }}>
              <Input placeholder="ww1234567890abcdef" />
            </Form.Item>
            <Form.Item label="应用 AgentId" name="wecom_agent_id" style={{ flex: 1 }}>
              <Input placeholder="1000002" />
            </Form.Item>
          </div>
          <Form.Item label="应用 Secret（gettoken 用）" name="wecom_secret">
            <Input.Password placeholder="自建应用 Secret" />
          </Form.Item>
          <Form.Item label="OAuth 回调地址（redirect_uri，须在可信域名内）" name="wecom_redirect_uri">
            <Input placeholder="https://your-domain.com/api/v1/auth/wecom/callback" />
          </Form.Item>
          <Form.Item label="首次登录自动建档" name="wecom_auto_provision">
            <Select
              options={[
                { label: '开启（无匹配用户自动建档）', value: 'true' },
                { label: '关闭（无匹配则拒绝）', value: 'false' },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="企微应用消息推送"
            name="wecom_notify_enabled"
            extra="默认关。打开后，待审/业务确认/上线通报会推到已绑定企微的账号。点卡片用 H5 打开本系统，在手机上审批。"
          >
            <Select
              options={[
                { label: '关闭', value: 'false' },
                { label: '开启', value: 'true' },
              ]}
            />
          </Form.Item>
          <Form.Item label="平台访问根地址（卡片跳转）" name="wecom_app_base">
            <Input placeholder="https://your-domain.com ，空则从 OAuth 回调地址推断" />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="回调 Token" name="wecom_callback_token" style={{ flex: 1 }}>
              <Input placeholder="配置企微回调 URL 时用" />
            </Form.Item>
            <Form.Item label="EncodingAESKey" name="wecom_encoding_aes_key" style={{ flex: 1 }}>
              <Input placeholder="43 位，配置回调校验用" />
            </Form.Item>
          </div>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="回调 URL 填：https://你的域名/api/v1/pm/wecom/callback 。卡片在企微里用 H5 打开发布系统，不在聊天里审批。"
          />

          <Divider orientation="left">邮件通知（SMTP）</Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="发布结束会站内通知当前发布人，并按此 SMTP 发到其邮箱。失败时正文含错误摘要与 AI 建议。"
          />
          <Form.Item label="启用邮件通知" name="smtp_enabled">
            <Select
              options={[
                { label: '开启', value: 'true' },
                { label: '关闭', value: 'false' },
              ]}
            />
          </Form.Item>
          <div className="rp-field-row">
            <Form.Item label="SMTP 服务器" name="smtp_host" style={{ flex: 2 }}>
              <Input placeholder="smtp.exmail.qq.com" />
            </Form.Item>
            <Form.Item label="端口" name="smtp_port" style={{ flex: 1 }}>
              <Input placeholder="465" />
            </Form.Item>
            <Form.Item label="SSL" name="smtp_ssl" style={{ flex: 1 }}>
              <Select
                options={[
                  { label: '开启（465）', value: 'true' },
                  { label: '关闭（587 STARTTLS）', value: 'false' },
                ]}
              />
            </Form.Item>
          </div>
          <div className="rp-field-row">
            <Form.Item label="发信账号" name="smtp_user" style={{ flex: 1 }}>
              <Input placeholder="mailer@example.com" />
            </Form.Item>
            <Form.Item label="发信地址" name="smtp_from" style={{ flex: 1 }}>
              <Input placeholder="mailer@example.com" />
            </Form.Item>
          </div>
          <Form.Item label="发信密码" name="smtp_password">
            <Input.Password placeholder="SMTP 密码" />
          </Form.Item>

          <Button
            type="primary"
            icon={<SaveOutlined />}
            htmlType="submit"
            loading={saveMutation.isPending}
          >
            保存配置
          </Button>
        </Form>
      </Card>

      <Card title="当前生效配置" style={{ marginTop: 16 }}>
        {settings ? (
          <div>
            <Tag color="green">日志：Redis 实时 + ES 归档</Tag>
            <Tag>ES：{settings.es_hosts}</Tag>
            <Tag>索引：{(settings.es_index || 'rp-exec-logs').replace(/-\d{4}-\d{2}-\d{2}$/, '')}-YYYY-MM-DD</Tag>
            <Tag>AI 日志：rp-assist-logs-YYYY-MM-DD</Tag>
            <Tag>业务库（启动项）：{settings.bootstrap_database || '—'}</Tag>
            <Tag>版本：{settings.bootstrap_version || '—'}</Tag>
            <Tag>平台名：{settings.platform_display_name || '发布部署平台'}</Tag>
            <Tag>顶栏图：{settings.header_has_image ? '已上传' : '空白'}</Tag>
            <Tag>
              顶栏通知：
              {settings.header_notice_text
                ? `${HEADER_NOTICE_COLORS[settings.header_notice_color as keyof typeof HEADER_NOTICE_COLORS]?.label || settings.header_notice_color}`
                : '关闭'}
            </Tag>
            <Tag>Session：{settings.session_expire_days || 1} 天</Tag>
            <Tag color={settings.totp_2fa_enabled === 'true' ? 'green' : 'default'}>
              双因子：{settings.totp_2fa_enabled === 'true' ? '开启' : '关闭'}
            </Tag>
            <Tag>审计保留：{settings.audit_retention_days || 180} 天</Tag>
            <Tag>轮询：{settings.task_poll_interval}s</Tag>
            <Tag>生产制品：{settings.artifact_prod_retention_days || 10} 天</Tag>
            <Tag>Redis：{settings.redis_host}:{settings.redis_port}/{settings.redis_db}</Tag>
            <Tag color={settings.smtp_enabled === 'true' ? 'green' : 'default'}>
              邮件：{settings.smtp_enabled === 'true' ? settings.smtp_host : '关闭'}
            </Tag>
          </div>
        ) : (
          '加载中...'
        )}
      </Card>
    </div>
  )
}
