import { Drawer, Button, Alert, Spin, Typography, Empty } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { get, postLong } from '@/api/client'

const { Paragraph, Title, Text } = Typography

/** 失败诊断抽屉：默认展示站内通知已生成的摘要+建议，不再另跑一轮模型。 */

export interface DiagnoseResult {
  release_id: number
  pipeline_id: number
  model: { name: string; model_id: string; provider_name: string }
  failed_steps: { task_id: number; label: string; plugins: string[]; trim: string }[]
  success_steps: string[]
  diagnosis: string
  source?: 'notice' | 'generated'
}

export default function DiagnoseDrawer({
  releaseId,
  open,
  onClose,
}: {
  releaseId: number | null
  open: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { data, isFetching, isError, error } = useQuery({
    queryKey: ['diagnose', releaseId],
    queryFn: () =>
      get<DiagnoseResult>(`/releases/${releaseId}/diagnose`, undefined, { timeout: 120000 }),
    enabled: open && !!releaseId,
    staleTime: Infinity,
    retry: false,
  })
  const regen = useMutation({
    mutationFn: () =>
      postLong<DiagnoseResult>(`/releases/${releaseId}/diagnose`, { force: true }),
    onSuccess: (next) => {
      queryClient.setQueryData(['diagnose', releaseId], next)
    },
  })
  const reused = data?.source === 'notice'
  const busy = (isFetching && !data) || regen.isPending

  return (
    <Drawer
      title={
        <span>
          <RobotOutlined style={{ marginRight: 8 }} />
          AI 诊断 · 构建 #{releaseId ?? ''}
        </span>
      }
      open={open}
      onClose={onClose}
      width={560}
      extra={
        <Button size="small" onClick={() => regen.mutate()} loading={regen.isPending}>
          重新诊断
        </Button>
      }
    >
      {busy && !data && (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <Spin />
          <div style={{ marginTop: 12, color: '#666' }}>正在读取已生成的诊断…</div>
        </div>
      )}
      {isError && (
        <Alert
          type="error"
          showIcon
          message="诊断失败"
          description={(error as Error)?.message || '请检查「模型配置」是否已填写厂商 API Key'}
        />
      )}
      {data && (
        <>
          <Alert
            type={reused ? 'success' : 'info'}
            showIcon
            style={{ marginBottom: 12 }}
            message={
              reused ? (
                <span>
                  与站内通知相同，未再次请求模型
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {data.model.provider_name} / {data.model.name}
                  </Text>
                </span>
              ) : (
                <span>
                  已按失败日志生成摘要与建议
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {data.model.provider_name} / {data.model.name}
                  </Text>
                </span>
              )
            }
          />
          {data.diagnosis ? (
            <div
              style={{
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 8,
                padding: 16,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.7,
                fontSize: 13,
              }}
            >
              {data.diagnosis.split('\n').map((line, i) => {
                if (line.startsWith('## ') || /^【.+】$/.test(line.trim())) {
                  return (
                    <Title key={i} level={5} style={{ marginTop: 12, marginBottom: 8 }}>
                      {line.replace(/^##\s+/, '')}
                    </Title>
                  )
                }
                return (
                  <Paragraph key={i} style={{ marginBottom: 4 }}>
                    {line || ' '}
                  </Paragraph>
                )
              })}
            </div>
          ) : (
            <Empty description="还没有诊断内容" />
          )}
        </>
      )}
    </Drawer>
  )
}
