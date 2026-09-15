import { Card, Button, Modal, Form, Input, Space, Tag, Typography, Popconfirm, Empty } from 'antd'
import DataTable from '@/components/DataTable'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { del, get, post } from '@/api/client'
import type { Project } from '@/api/types'
import { useAuthStore } from '@/stores/auth'
import CatalogTransferButtons from '@/components/CatalogTransfer'
import { useIsMobile } from '@/hooks/useIsMobile'

export default function Projects() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isAdmin = !!useAuthStore((s) => s.user?.is_admin)
  /** 窄屏改卡片：宽表会把长项目名竖排成一字一行。 */
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => get<Project[]>('/projects'),
  })

  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)

  const handleCreate = async () => {
    const values = await form.validateFields()
    setCreating(true)
    try {
      await post('/projects', values)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setOpen(false)
      form.resetFields()
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (project: Project) => {
    setDeletingId(project.id)
    try {
      await del(`/projects/${project.id}`)
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    } finally {
      setDeletingId(null)
    }
  }

  const closeCreate = () => {
    setOpen(false)
    form.resetFields()
  }

  const columns = [
    {
      title: '项目名称',
      dataIndex: 'name',
      render: (v: string, r: Project) => (
        <a onClick={() => navigate(`/projects/${r.id}`)}>{v}</a>
      ),
    },
    { title: '编码', dataIndex: 'code', width: 120, render: (v: string) => <Tag>{v}</Tag> },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => (v === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '操作',
      width: isAdmin ? 180 : 100,
      render: (_: unknown, r: Project) => (
        <Space>
          <Button type="link" onClick={() => navigate(`/projects/${r.id}`)}>
            进入
          </Button>
          {isAdmin && (
            <Popconfirm
              title={`删除项目「${r.name}」？`}
              description="项目下不能有流水线（含回收站）。空的环境分组会一并删掉。"
              okText="删除"
              okButtonProps={{ danger: true, loading: deletingId === r.id }}
              cancelText="取消"
              onConfirm={() => handleDelete(r)}
            >
              <Button type="link" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Card
      title="项目列表"
      extra={
        <Space wrap>
          {!isMobile && (
            <CatalogTransferButtons
              onImported={() => queryClient.invalidateQueries({ queryKey: ['projects'] })}
            />
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新建项目
          </Button>
        </Space>
      }
    >
      {!isMobile && (
        <Typography.Paragraph type="secondary">
          项目（Project）是隔离边界，如「COP」「B2C」。项目下挂分组（生产/测试），分组下挂流水线。
        </Typography.Paragraph>
      )}
      {isMobile ? (
        projects.length === 0 ? (
          <Empty description="暂无项目" />
        ) : (
          <div className="mobile-entity-list">
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                className="mobile-entity-card"
                onClick={() => navigate(`/projects/${p.id}`)}
              >
                <div className="mobile-entity-title">{p.name}</div>
                <div className="mobile-entity-meta">
                  <Tag>{p.code}</Tag>
                  {p.status === 'active' ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>}
                </div>
              </button>
            ))}
          </div>
        )
      ) : (
        <DataTable chromeKey="projects" rowKey="id" columns={columns} dataSource={projects} pagination={false} />
      )}

      <Modal
        title="新建项目"
        open={open}
        onOk={handleCreate}
        onCancel={closeCreate}
        confirmLoading={creating}
        styles={{ content: { maxWidth: 'calc(100vw - 24px)' } }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true }]}>
            <Input placeholder="如：B2C 电商业务" />
          </Form.Item>
          <Form.Item name="code" label="项目编码" rules={[{ required: true }]}>
            <Input placeholder="如：B2C" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
