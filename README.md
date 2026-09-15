# 发布部署平台（release-platform）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**release-platform** is an AI-agent-first release platform for mixed targets: Kubernetes, Docker, VMs, Windows IIS, Tomcat, and jars. People talk to the agent; pipelines and pull-mode agents do the work.

**发布部署平台** 是以 AI Agent 为交互核心的多形态发布部署平台。人用自然语言查询、申请权限、发起发布、诊断失败、编写插件；流水线编排与构建机 / 节点执行，把变更落到环境上。

编排是 Stage → Job → Step。助手运行时按 [DeepSeek AI-Harness](https://github.com/deepseek-ai/deepseek-harness) 的思路落地（session 事件溯源、agent-loop、tools 守卫管线、compaction、Skills、MCP、sandbox），不是把 dsh 进程嵌进来。

## 能做什么

- **三种入口同一权限**：AI 助手、Web 页面、API Token 走同一套 RBAC；流水线执行权只能通过助手申请
- **变更先确认**：发布 / 回滚 / Rebuild / 节点传文件生成一次性签名卡片，点确认才执行
- **异构落地**：K8s、Docker、SSH、IIS 增量、制品与回滚
- **拉模式 Agent**：构建机与部署节点同一只 JDK 8 jar，机器主动拉任务，不必给平台开入站
- **失败即停**：步骤报错级联取消，取消真杀进程树
- **生产安全优先**：空发布清单不会按全量打包；没写明范围就拒绝执行

## 架构图

- [系统架构图](deploy-platform/docs/系统架构图.png)
- [全模块业务架构图](deploy-platform/docs/全模块业务架构图.png)
- [技术架构图](deploy-platform/docs/技术架构图.png)

## 快速开始

需要 Python 3.10+、Node.js 18+。Windows 用 `py`，不要用 `python3`。

```bash
git clone https://github.com/Ease1994/release-platform.git
cd release-platform

# 后端
cd deploy-platform/backend
py -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080

# 另开终端：前端
cd deploy-platform/frontend
npm install
npm run dev -- --host 0.0.0.0
```

浏览器打开 http://localhost:5173 。演示账号 `admin` / `admin123`（只适合本机；生产必须改密或设置 `BOOTSTRAP_ADMIN_PASSWORD`）。

先在「模型管理」配一个 OpenAI 兼容模型，再到 AI Agent 里对一条测试流水线说「发布一下」，核对确认卡片上的流水线 id。

完整栈（MySQL + Redis + 后端 + 前端 + harness-runner）：复制 [`deploy-platform/.env.example`](deploy-platform/.env.example) 为 `.env`，填口令后：

```bash
cd deploy-platform
docker compose up -d --build
```

前端 http://localhost:8000 ，API 默认不暴露 `/docs`。

## 文档

| 文档 | 内容 |
|------|------|
| [功能说明书](deploy-platform/docs/功能说明书.md) | 每个模块做什么、亮点；[Word 版](deploy-platform/docs/发布部署平台-功能说明书.docx) |
| [部署文档](deploy-platform/docs/部署文档.md) | 环境、Compose、生产配置 |
| [开发者手册](docs/开发者手册.md) | 架构对照、模块表、数据库、踩坑 |
| [贡献指南](CONTRIBUTING.md) | 怎么跑测试、提交约定 |
| [安全披露](SECURITY.md) | 漏洞请走 GitHub Advisory，不要开公开 Issue |

## 技术栈

前端 React 18 + TypeScript + Vite + Ant Design 5；后端 FastAPI + SQLAlchemy 2；数据 MySQL 8 / SQLite + Redis 7；执行层 Java Agent（JDK 8 单 jar）。

## 许可证

[MIT](LICENSE)
