import { Radio, Input, Space, Alert, Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import { get } from '@/api/client'
import type { GraphTrigger } from '@/api/types'

const { Text } = Typography

interface TriggerPanelProps {
  triggers: GraphTrigger[]
  onChange: (next: GraphTrigger[]) => void
  pipelineId?: number
}

/**
 * 一条流水线只能选手动或定时，两种不能并存。
 * 选定时后到点自动跑；列表里的「执行」按钮两种都能用。
 */
export default function TriggerPanel({ triggers, onChange, pipelineId }: TriggerPanelProps) {
  const current = triggers[0] || { type: 'manual', cron: null, label: '手动触发' }
  const isCron = current.type === 'cron'

  const { data: nextRun } = useQuery({
    queryKey: ['next-run', pipelineId],
    queryFn: () => get<{ next_run_at: string | null }>(`/pipelines/${pipelineId}/next-run`),
    enabled: !!pipelineId && isCron,
    refetchInterval: isCron ? 30000 : false,
  })

  const setType = (type: 'manual' | 'cron') => {
    if (type === 'cron') {
      onChange([
        {
          type: 'cron',
          cron: current.cron || '0 2 * * *',
          label: '定时触发',
        },
      ])
      return
    }
    onChange([{ type: 'manual', cron: null, label: '手动触发' }])
  }

  return (
    <div style={{ padding: 16, maxWidth: 640 }}>
      <div style={{ marginBottom: 16, color: '#666', fontSize: 13 }}>
        <ThunderboltOutlined /> 触发方式是流水线级配置：手动或定时，只能选一种。
      </div>

      <Radio.Group
        value={isCron ? 'cron' : 'manual'}
        onChange={(e) => setType(e.target.value)}
        optionType="button"
        buttonStyle="solid"
        style={{ marginBottom: 16 }}
      >
        <Radio.Button value="manual">手动触发</Radio.Button>
        <Radio.Button value="cron">定时触发</Radio.Button>
      </Radio.Group>

      {isCron ? (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text type="secondary">Cron 表达式</Text>
            <Input
              value={current.cron || ''}
              onChange={(e) =>
                onChange([{ type: 'cron', cron: e.target.value, label: '定时触发' }])
              }
              placeholder="0 2 * * *"
              style={{ marginTop: 6, maxWidth: 280 }}
            />
            <div style={{ color: '#999', fontSize: 12, marginTop: 6 }}>
              例：每天 2 点 <code>0 2 * * *</code>，每 15 分钟 <code>*/15 * * * *</code>
            </div>
          </div>
          <Alert
            type={nextRun?.next_run_at ? 'success' : 'warning'}
            showIcon
            message={
              nextRun?.next_run_at
                ? `已生效，下次执行：${new Date(nextRun.next_run_at).toLocaleString()}`
                : '保存编排后才会写入定时队列。需在「平台设置」配置 Redis。'
            }
            description="到点自动跑。流水线列表里仍可以手动点「执行」。"
          />
        </Space>
      ) : (
        <Alert
          type="info"
          showIcon
          message="手动触发"
          description="在项目流水线列表或执行历史页点击「执行」。不会按时间自动跑。"
        />
      )}
    </div>
  )
}
