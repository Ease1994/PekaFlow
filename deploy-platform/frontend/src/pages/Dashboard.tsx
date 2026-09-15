import { Card, Col, Row, Statistic, Progress, Tag, Space } from 'antd'
import { RocketOutlined, CheckCircleOutlined, CloseCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import ReactECharts from 'echarts-for-react'
import { get } from '@/api/client'

interface DoraMetrics {
  deploy_frequency: number
  change_failure_rate: number
  change_lead_time_minutes: number
  mttr_minutes: number
  rollback_count: number
  success_rate: number
  window_days: number
}

interface TrendItem {
  date: string
  success: number
  failed: number
  total: number
}

export default function Dashboard() {
  const { data: dora } = useQuery({
    queryKey: ['dora'],
    queryFn: () => get<DoraMetrics>('/metrics/dora'),
  })

  const { data: trend } = useQuery({
    queryKey: ['trend'],
    queryFn: () => get<TrendItem[]>('/metrics/trend'),
  })

  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['成功', '失败'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: trend?.map((t) => t.date) ?? [] },
    yAxis: { type: 'value' },
    series: [
      {
        name: '成功',
        type: 'bar',
        stack: 'total',
        itemStyle: { color: '#1677ff' },
        data: trend?.map((t) => t.success) ?? [],
      },
      {
        name: '失败',
        type: 'bar',
        stack: 'total',
        itemStyle: { color: '#52c41a' },
        data: trend?.map((t) => t.failed) ?? [],
      },
    ],
  }

  const successRate = dora?.success_rate ?? 0

  return (
    <div>
      <Row gutter={16}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="部署频率（近30天）"
              value={dora?.deploy_frequency ?? 0}
              prefix={<RocketOutlined />}
              suffix="次"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="发布成功率"
              value={successRate}
              precision={1}
              prefix={<CheckCircleOutlined />}
              suffix="%"
              valueStyle={{ color: successRate >= 90 ? '#52c41a' : '#faad14' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="变更失败率"
              value={dora?.change_failure_rate ?? 0}
              precision={1}
              prefix={<CloseCircleOutlined />}
              suffix="%"
              valueStyle={{ color: (dora?.change_failure_rate ?? 0) < 5 ? '#52c41a' : '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="平均变更前置时间"
              value={dora?.change_lead_time_minutes ?? 0}
              prefix={<ClockCircleOutlined />}
              suffix="分钟"
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="发布趋势（近14天）">
            <ReactECharts option={trendOption} style={{ height: 320 }} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="DORA 指标总览">
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>发布成功率</span>
                  <Tag color={successRate >= 90 ? 'green' : 'orange'}>{successRate}%</Tag>
                </div>
                <Progress percent={successRate} status={successRate >= 90 ? 'success' : 'active'} />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>回滚次数</span>
                  <Tag color={dora?.rollback_count ? 'orange' : 'green'}>{dora?.rollback_count ?? 0} 次</Tag>
                </div>
                <Progress
                  percent={Math.min((dora?.rollback_count ?? 0) * 10, 100)}
                  showInfo={false}
                  strokeColor="#faad14"
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span>平均恢复时间 MTTR</span>
                  <Tag>{dora?.mttr_minutes ?? 0} 分钟</Tag>
                </div>
              </div>
            </Space>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
