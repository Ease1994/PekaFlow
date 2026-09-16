import { t } from '@/i18n'

/** 环境码：分组、构建机、节点共用。匹配必须全等，禁止「不是 test 就当 prod」。 */

/** 内置环境码。句子走 t('env.*')，不要把中文写死在这里。 */
export const KNOWN_ENV_CODES = ['prod', 'test', 'uat', 'staging', 'dev'] as const

const ENV_I18N: Record<string, string> = {
  prod: 'env.prod',
  test: 'env.test',
  uat: 'env.uat',
  staging: 'env.staging',
  dev: 'env.dev',
}

/** @deprecated 只留下码表兼容旧引用；显示名请用 envLabel()。 */
export const KNOWN_ENV: Record<string, string> = {
  prod: 'prod',
  test: 'test',
  uat: 'uat',
  staging: 'staging',
  dev: 'dev',
}

export const ENV_COLOR: Record<string, string> = {
  prod: 'red',
  test: 'green',
  uat: 'purple',
  staging: 'orange',
  dev: 'blue',
}

/** 这些环境的节点，AI 下发文件可以免审批。其余一律要审。 */
export const SKIP_NODE_PUSH_APPROVAL = new Set(['test', 'dev'])

export const ENV_SLUG = /^[a-z][a-z0-9_-]{0,15}$/

export function envLabel(code?: string | null): string {
  const c = (code || '').trim().toLowerCase()
  if (!c) return t('env.unlabeled')
  return ENV_I18N[c] ? t(ENV_I18N[c]) : c
}

export function envColor(code?: string | null): string {
  const c = (code || '').trim().toLowerCase()
  if (!c) return 'default'
  return ENV_COLOR[c] || 'geekblue'
}

export function envOptions(): { value: string; label: string }[] {
  return KNOWN_ENV_CODES.map((value) => ({ value, label: t(ENV_I18N[value]) }))
}

/** 列表/下拉里带上已经存在的自定义码，避免选中值突然空白。 */
export function envSelectOptions(extra: (string | undefined | null)[] = []) {
  const seen = new Set(Object.keys(KNOWN_ENV))
  const opts = envOptions()
  for (const raw of extra) {
    const c = (raw || '').trim().toLowerCase()
    if (c && !seen.has(c)) {
      seen.add(c)
      opts.push({ value: c, label: envLabel(c) })
    }
  }
  return opts
}

export function skipNodePushApproval(code?: string | null): boolean {
  return SKIP_NODE_PUSH_APPROVAL.has((code || 'prod').trim().toLowerCase())
}

export function defaultApprovalRequired(code?: string | null): boolean {
  return !skipNodePushApproval(code)
}

export function groupOptionLabel(g: { name: string; type?: string | null }): string {
  return t('env.groupWithEnv', { name: g.name, env: envLabel(g.type) })
}

/** 机器没标环境时不能当成生产；空串表示未隔离，下拉里匹配不到任何流水线。 */
export function machineEnv(code?: string | null): string {
  return (code || '').trim().toLowerCase()
}

/** 安装命令始终带上 --env，避免新机器 env 为空被哪边任务都领不走。 */
export function envInstallArgs(code?: string | null) {
  const value = (code || 'prod').trim().toLowerCase() || 'prod'
  return {
    value,
    cli: ` --env ${value}`,
    ps: ` -Env ${value}`,
    shPrefix: `ENV=${value} `,
    shInline: ` ENV=${value}`,
  }
}
