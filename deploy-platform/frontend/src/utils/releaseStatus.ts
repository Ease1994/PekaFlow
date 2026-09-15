/** 发布自身状态。明细顶栏必须认这个，不能从步骤树猜。 */

export const RELEASE_STATUS_META: Record<string, { color: string; text: string }> = {
  pending: { color: 'orange', text: '待审批' },
  queued: { color: 'cyan', text: '排队中' },
  assigned: { color: 'processing', text: '执行中' },
  running: { color: 'processing', text: '执行中' },
  success: { color: 'success', text: '成功' },
  failed: { color: 'error', text: '失败' },
  rejected: { color: 'error', text: '审批驳回' },
  rolling_back: { color: 'warning', text: '回滚中' },
  rolled_back: { color: 'default', text: '已回滚' },
  cancelled: { color: 'default', text: '已取消' },
}

export function releaseStatusMeta(status?: string | null): { color: string; text: string } {
  if (status && RELEASE_STATUS_META[status]) return RELEASE_STATUS_META[status]
  return { color: 'default', text: status || '未知' }
}

/** 明细/抽屉顶栏：优先用 sequence.status。启动失败时步骤全是 pending，从树猜会变成「已完成」。 */
export function sequenceHeaderMeta(seq: {
  status?: string
  is_running?: boolean
  stages?: { status: string }[]
}): { color: string; text: string } {
  if (seq.status) return releaseStatusMeta(seq.status)
  if (seq.is_running) return RELEASE_STATUS_META.running
  const stages = seq.stages || []
  if (stages.length && stages.every((s) => s.status === 'success')) return RELEASE_STATUS_META.success
  if (stages.some((s) => s.status === 'failed')) return RELEASE_STATUS_META.failed
  return { color: 'default', text: '已完成' }
}
