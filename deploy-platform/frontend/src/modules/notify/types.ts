export interface Notice {
  id: number
  title: string
  content: string
  kind: string
  link: string
  related_type: string
  related_id: number | null
  is_read: boolean
  created_at: string
}

export function kindTitle(kind: string) {
  if ((kind || '').startsWith('release.approval') || (kind || '').startsWith('pm.confirm')) {
    return kind.includes('pending') ? '待审批' : '发布系统'
  }
  if ((kind || '').startsWith('release')) return '发布系统'
  if ((kind || '').startsWith('access')) return '权限申请'
  return '系统通知'
}

/**
 * 铃铛「查看详情」按种类进该办事的页面。
 * 库里旧的待审通知 link 仍指向执行画布，不能信。
 */
export function noticeHref(n: Notice): string {
  const kind = n.kind || ''
  const id = n.related_id
  if (kind === 'release.approval.pending') {
    return id ? `/approvals?release_id=${id}` : '/approvals'
  }
  if (kind === 'pm.confirm.pending') {
    return '/approvals?tab=pm'
  }
  if (kind === 'access.apply') {
    return id ? `/permissions?tab=pending&id=${id}` : '/permissions?tab=pending'
  }
  if (kind === 'access.review') {
    return '/permissions?tab=history'
  }
  return n.link || (n.id ? `/notifications?id=${n.id}` : '/notifications')
}

export function fromNow(iso: string) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return iso.replace('T', ' ').slice(0, 16)
  const diff = Date.now() - t
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour}小时前`
  const day = Math.floor(hour / 24)
  if (day === 1) {
    const d = new Date(t)
    return `昨天 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }
  if (day < 7) return `${day}天前`
  return iso.replace('T', ' ').slice(0, 16)
}
