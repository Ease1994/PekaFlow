# 发布部署平台（release-platform）

[中文](README.md) · [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**发布部署平台** 是以 AI Agent 为交互核心的多形态发布部署平台。人用自然语言查询、申请权限、发起发布、诊断失败、编写插件；流水线编排与构建机 / 节点执行，把变更落到环境上。

界面语言可在登录页和顶栏切换：简体中文、繁体中文、English、日本語、हिन्दी、Português（巴西）、Deutsch。流水线等内页尚未全部抽出文案时，会回落到简体。

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

### Docker Compose（MySQL + Redis + Elasticsearch + 后端 + 前端 + harness-runner）

需要本机已装 [Docker](https://docs.docker.com/get-docker/)（含 Compose v2）。编排文件在 **`deploy-platform/`**，不要在仓库根目录执行。

**1. 复制环境文件**

```bash
cd release-platform/deploy-platform
cp .env.example .env
```

Windows 没有 `cp` 就手动复制 `.env.example` 为 `.env`。填了值的 `.env` 不要提交进 Git。

**2. 填写必填口令**

下面三项空着，`docker compose` 会直接退出。生成随机串：

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

打开 `.env`，至少写成这样（**两处 MySQL 口令必须逐字相同**，主机名在容器网里是 `mysql`）：

```bash
MYSQL_ROOT_PASSWORD=换成足够长的随机串
DATABASE_URL=mysql+pymysql://root:换成足够长的随机串@mysql:3306/deploy_platform?charset=utf8mb4
REDIS_PASSWORD=换成另一串随机口令
BOOTSTRAP_ADMIN_PASSWORD=换成管理员口令
```

`BOOTSTRAP_ADMIN_PASSWORD` 建议填上；空着则管理员仍是演示口令 `admin` / `admin123`，只适合本机。`JWT_SECRET`、`AES_KEY`、`HARNESS_RUNNER_TOKEN` 可以留空，首次启动会写入数据卷，重启仍用同一把。**已经在跑的环境不要重新随机 JWT/AES**，否则库里加密的 Git 凭证解不开。

**3. 启动并等就绪**

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

第一次会拉镜像、编前端和后端，可能要几分钟。看到 backend / frontend 为 `healthy` 或 `running`，且后端日志里建表、管理员就绪后再打开浏览器。

**4. 打开页面**

| 入口 | 地址 |
|------|------|
| 前端 | http://localhost:8000 |
| API | http://localhost:8080（默认不开 `/docs`） |
| 健康检查 | http://localhost:8080/api/v1/health |

登录账号 `admin`，口令是你在 `.env` 里写的 `BOOTSTRAP_ADMIN_PASSWORD`（没写就是 `admin123`）。然后：在「平台设置」填站点根地址 `http://localhost:8000`（局域网改成平台机 IP）；在「模型管理」配一个 OpenAI 兼容模型。生产不要把 MySQL 3306 / Redis 6379 / ES 9200 映射到宿主机。Compose 已带本栈 ES，构建日志写入 `rp-exec-logs-YYYY-MM-DD`。要换集群在平台设置改地址。

停服务用 `docker compose down`（**不要**加 `-v`，否则会删掉库、密钥和制品卷）。装构建机 / 节点、HTTPS、备份升级见 [部署文档](deploy-platform/docs/部署文档.md)。

## 文档

| 文档 | 内容 |
|------|------|
| [功能说明书](deploy-platform/docs/功能说明书.md) | 每个模块做什么、亮点；[Word 版](deploy-platform/docs/发布部署平台-功能说明书.docx) |
| [部署文档](deploy-platform/docs/部署文档.md) · [English](deploy-platform/docs/部署文档.en.md) | 从零安装、Compose、Agent、HTTPS、备份升级 |
| [开发者手册](docs/开发者手册.md) | 架构对照、模块表、数据库、踩坑 |
| [贡献指南](CONTRIBUTING.md) · [English](CONTRIBUTING.en.md) | 怎么跑测试、提交约定 |
| [安全披露](SECURITY.md) · [English](SECURITY.en.md) | 漏洞请走 GitHub Advisory，不要开公开 Issue |

## 技术栈

前端 React 18 + TypeScript + Vite + Ant Design 5；后端 FastAPI + SQLAlchemy 2；数据 MySQL 8 / SQLite + Redis 7 + Elasticsearch 8；执行层 Java Agent（JDK 8 单 jar）。

## 许可证

[MIT](LICENSE)
