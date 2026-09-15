import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/api/client'

/** 公开品牌信息：登录页不要求登录也能拉。侧栏图标是前端固定资源，不走配置。 */
export interface PlatformBranding {
  /** 侧栏 / 登录页 / 浏览器标题 */
  display_name: string
  /** 有图才有地址；空表示顶栏左侧空白 */
  header_image_url: string
  /** 空则不显示顶栏通知横幅 */
  header_notice_text: string
  /** 横幅醒目色：red / orange / gold / magenta / volcano */
  header_notice_color: string
}

const FALLBACK_NAME = '发布部署平台'
/** 与侧栏同一构图的固定网站图标，不能在平台设置里改。 */
export const PLATFORM_FAVICON = '/favicon.svg'

/** 顶栏通知可选的醒目色：实心底、浅字，保证一眼能看见。 */
export const HEADER_NOTICE_COLORS = {
  red: { label: '红色警示', bg: '#cf1322', fg: '#fff' },
  orange: { label: '橙色提醒', bg: '#d46b08', fg: '#fff' },
  gold: { label: '金色公告', bg: '#d4b106', fg: '#1f1f1f' },
  magenta: { label: '玫红突出', bg: '#c41d7f', fg: '#fff' },
  volcano: { label: '火山醒目', bg: '#d4380d', fg: '#fff' },
} as const

export type HeaderNoticeColor = keyof typeof HEADER_NOTICE_COLORS

/**
 * 读取平台显示名、顶栏图和通知横幅。
 * 失败时用内置默认值，避免登录页因为配置接口挂了整页空白。
 */
export function usePlatformBranding() {
  return useQuery({
    queryKey: ['platform-branding'],
    queryFn: () => get<PlatformBranding>('/settings/branding', undefined, { skipErrorToast: true }),
    staleTime: 60_000,
  })
}

/** 把查询结果收成一定有值的显示名。 */
export function resolveDisplayName(data: PlatformBranding | undefined): string {
  return (data?.display_name || '').trim() || FALLBACK_NAME
}

/** 不在预设里的颜色回落到红色警示。 */
export function resolveNoticeColor(raw: string | undefined): HeaderNoticeColor {
  if (raw && raw in HEADER_NOTICE_COLORS) return raw as HeaderNoticeColor
  return 'red'
}

/**
 * 浏览器标题跟平台显示名走；标签页图标永远用侧栏那张固定图。
 */
export function ApplyPlatformBranding() {
  const { data } = usePlatformBranding()
  const name = resolveDisplayName(data)

  useEffect(() => {
    document.title = name
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
    if (!link) {
      link = document.createElement('link')
      link.rel = 'icon'
      document.head.appendChild(link)
    }
    link.type = 'image/svg+xml'
    link.href = PLATFORM_FAVICON
  }, [name])

  return null
}
