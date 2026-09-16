# Release Platform

[中文](README.md) · [English](README.en.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**release-platform** is an AI-agent-first release platform for mixed targets: Kubernetes, Docker, VMs, Windows IIS, Tomcat, and jars. People talk to the agent; pipelines and pull-mode agents do the work.

The web app has a language switcher on the sign-in page and in the header: Simplified Chinese, Traditional Chinese, English, Japanese, Hindi, Brazilian Portuguese, and German. Pipeline pages still fall back to Simplified Chinese where strings are not extracted yet.

Orchestration is Stage → Job → Step. The assistant runtime follows [DeepSeek AI-Harness](https://github.com/deepseek-ai/deepseek-harness) (session event sourcing, agent-loop, tool guards, compaction, Skills, MCP, sandbox). It is not an embedded dsh process.

## What it does

- **Three doors, one permission model**: AI assistant, web UI, and API tokens share RBAC. Pipeline execute rights are requested only through the assistant
- **Confirm before change**: release / rollback / rebuild / node file push produce a one-shot signed card; nothing runs until you confirm
- **Heterogeneous targets**: Kubernetes, Docker, SSH, IIS incremental, artifacts and rollback
- **Pull-mode agent**: builders and deploy nodes share one JDK 8 jar; machines pull work, the platform needs no inbound ports to them
- **Fail closed**: a failed step cancels the rest and kills the process tree
- **Production safety**: an empty deploy manifest is refused, never silently packed as everything

## Architecture diagrams

- [System](deploy-platform/docs/系统架构图.png)
- [Business modules](deploy-platform/docs/全模块业务架构图.png)
- [Technical](deploy-platform/docs/技术架构图.png)

## Quick start (local)

You need Python 3.10+ and Node.js 18+. On Windows use `py`, not `python3`.

```bash
git clone https://github.com/Ease1994/release-platform.git
cd release-platform

# Backend
cd deploy-platform/backend
py -m venv .venv
# Windows: .venv\Scripts\activate
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8080

# Another terminal: frontend
cd deploy-platform/frontend
npm install
npm run dev -- --host 0.0.0.0
```

Open http://localhost:5173 . Demo login `admin` / `admin123` (local only; production must change the password or set `BOOTSTRAP_ADMIN_PASSWORD`).

Configure an OpenAI-compatible model under Models, then in AI Agent ask to release a test pipeline and check the pipeline id on the confirm card.

### Docker Compose (MySQL + Redis + Elasticsearch + backend + frontend + harness-runner)

Install [Docker](https://docs.docker.com/get-docker/) with Compose v2. Compose files live under **`deploy-platform/`**. Do not run them from the repo root.

**1. Copy the env file**

```bash
cd release-platform/deploy-platform
cp .env.example .env
```

On Windows, copy `.env.example` to `.env` by hand. Never commit a filled `.env`.

**2. Fill required secrets**

Compose exits if these three are empty. Generate a random string:

```bash
python -c "import secrets; print(secrets.token_urlsafe(24))"
```

Edit `.env`. The two MySQL passwords must match character for character. Inside Compose the hostname is `mysql`:

```bash
MYSQL_ROOT_PASSWORD=a-long-random-string
DATABASE_URL=mysql+pymysql://root:a-long-random-string@mysql:3306/deploy_platform?charset=utf8mb4
REDIS_PASSWORD=another-random-string
BOOTSTRAP_ADMIN_PASSWORD=admin-password
```

Set `BOOTSTRAP_ADMIN_PASSWORD`. If you leave it empty, the admin password stays `admin` / `admin123` (local only). `JWT_SECRET`, `AES_KEY`, and `HARNESS_RUNNER_TOKEN` may stay empty; first boot writes them to the data volume. **Do not rotate JWT/AES on a running install**, or Git credentials already encrypted in the database will not decrypt.

**3. Start and wait**

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f backend
```

The first build pulls images and compiles frontend and backend; it can take several minutes. Open the browser after backend/frontend are `healthy` or `running` and the backend log shows tables and the admin user.

**4. Open the UI**

| Entry | URL |
|------|------|
| Frontend | http://localhost:8000 |
| API | http://localhost:8080 (`/docs` is off by default) |
| Health | http://localhost:8080/api/v1/health |

Sign in as `admin` with `BOOTSTRAP_ADMIN_PASSWORD` (or `admin123` if you left it empty). Then set the public site URL in Settings (`http://localhost:8000`, or the host IP on a LAN) and add a model. Do not publish MySQL 3306 / Redis 6379 / ES 9200 on the host in production. Compose already runs ES; build logs go to `rp-exec-logs-YYYY-MM-DD`. Change the cluster in Settings if you have your own.

Stop with `docker compose down` (**do not** add `-v`, or you wipe the database, secrets, and artifact volume). Installing agents, HTTPS, backup and upgrades: [deployment guide](deploy-platform/docs/部署文档.en.md).

## Docs

| Doc | Contents |
|------|------|
| [Feature spec](deploy-platform/docs/功能说明书.md) | What each module does (Chinese); [Word](deploy-platform/docs/发布部署平台-功能说明书.docx) |
| [Deployment](deploy-platform/docs/部署文档.en.md) · [中文](deploy-platform/docs/部署文档.md) | Install, Compose, agents, HTTPS, backup |
| [Developer handbook](docs/开发者手册.md) | Architecture, modules, database, pitfalls (Chinese) |
| [Contributing](CONTRIBUTING.en.md) | Tests and commit rules |
| [Security](SECURITY.en.md) | Report vulnerabilities via GitHub Advisory, not public issues |

## Stack

React 18 + TypeScript + Vite + Ant Design 5; FastAPI + SQLAlchemy 2; MySQL 8 / SQLite + Redis 7 + Elasticsearch 8; Java agent (JDK 8 single jar).

## License

[MIT](LICENSE)
