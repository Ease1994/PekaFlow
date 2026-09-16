/**
 * 界面文案表。每种语言一份，缺键时回落到简体中文。
 *
 * 点号路径对应嵌套字段，例如 t('layout.logout')。
 * `{name}` 由 t() 第二参数替换。
 */
export type Messages = {
  layout: {
    expandMenu: string
    collapseMenu: string
    openMenu: string
    apiToken: string
    logout: string
    notSignedIn: string
    admin: string
  }
  menu: Record<string, string>
  login: {
    tagline: string
    totpSetup: string
    totpRequired: string
    usernameRequired: string
    usernamePlaceholder: string
    passwordRequired: string
    passwordPlaceholder: string
    submit: string
    forgot: string
    or: string
    wecom: string
    localHint: string
    totpCodeRequired: string
    verify: string
    backToPassword: string
    forgotLostPhone: string
    incomplete: string
    welcomeBack: string
    wecomOk: string
    wecomFail: string
  }
  forgot: {
    subtitle: string
    usernameRequired: string
    usernamePlaceholder: string
    send: string
    sent: string
    hint: string
    back: string
  }
  reset: {
    subtitle: string
    invalidLink: string
    missingToken: string
    reapply: string
    newPassword: string
    min8: string
    confirmRequired: string
    mismatch: string
    confirmPlaceholder: string
    submit: string
    hint: string
    back: string
    done: string
  }
  token: {
    title: string
    info: string
    infoDetail: string
    nameRequired: string
    namePlaceholder: string
    days: string
    create: string
    ttlHint: string
    copyNow: string
    copy: string
    colName: string
    colExpires: string
    forever: string
    colLastUsed: string
    unused: string
    colAction: string
    revokeConfirm: string
    revoke: string
  }
  health: {
    abnormal: string
    details: string
    drawerTitle: string
    checkedAt: string
    hint: string
    ok: string
    bad: string
  }
  common: {
    language: string
  }
}

/** 界面语言。印度用印地语，巴西用葡萄牙语。 */
export type AppLocale = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'hi' | 'pt-BR' | 'de'
