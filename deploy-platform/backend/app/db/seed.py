"""种子数据：首次启动（空库）时写入演示项目/流水线，用户只建 admin。

真实用户由 LDAP / 企微登录或管理员在「用户管理」创建，姓名和邮箱以目录为准，不在代码里写死任何人。
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import encrypt, hash_password
from app.db.models import (
    Artifact,
    BuildAgent,
    Credential,
    Group,
    Pipeline,
    PipelineTemplate,
    Plugin,
    Project,
    Release,
    Repository,
    Role,
    User,
)

DEMO_PASSWORD = "admin123"


def seed(db: Session) -> None:
    """写入演示项目数据；用户仅 admin。"""
    pwd = hash_password(DEMO_PASSWORD)
    admin = User(
        username="admin",
        display_name="系统管理员",
        email="",
        password_hash=pwd,
        is_admin=True,
        source="local",
    )
    db.add(admin)
    db.flush()

    # ---- 项目 ----
    cop = Project(name="DMS 经销商协同运营平台", code="COP", description="经销商协同运营平台")
    b2c = Project(name="B2C 电商业务", code="B2C", description="面向 C 端的电商业务")
    db.add_all([cop, b2c])
    db.flush()

    # ---- 分组 ----
    groups = [
        Group(
            project_id=cop.id, name="生产", type="prod",
            approval_required=True, allow_self_approval=True,
        ),
        Group(project_id=cop.id, name="测试", type="test", approval_required=False),
        Group(
            project_id=b2c.id, name="生产", type="prod",
            approval_required=True, allow_self_approval=True,
        ),
        Group(project_id=b2c.id, name="测试", type="test", approval_required=False),
    ]
    db.add_all(groups)
    db.flush()
    cop_prod, cop_test, b2c_prod, b2c_test = groups

    # ---- 凭证（先建，供仓库关联）----
    cipher, iv = encrypt("glpat-demo-token-123456")
    gitlab_cred = Credential(name="GitLab 通用 Token", type="token", ciphertext=cipher, iv=iv, created_by=admin.id)
    db.add(gitlab_cred)
    db.flush()

    # ---- 代码仓库（示例 URL，上线后请改成真实仓库）----
    db.add_all([
        Repository(project_id=cop.id, name="order-service", url="https://gitlab.example.com/cop/order-service.git", provider="gitlab", default_branch="master", credential_id=gitlab_cred.id),
        Repository(project_id=cop.id, name="pay-service", url="https://gitlab.example.com/cop/pay-service.git", provider="gitlab", default_branch="master"),
        Repository(project_id=cop.id, name="gateway", url="https://gitlab.example.com/cop/gateway.git", provider="gitlab", default_branch="master"),
        Repository(project_id=b2c.id, name="b2c-front", url="https://gitlab.example.com/b2c/b2c-front.git", provider="gitlab", default_branch="main"),
    ])

    # ---- 构建机 ----
    # 只作示意，一律离线。标 online 会让页面以为有真实构建机在领任务。
    db.add_all([
        BuildAgent(name="linux-build-01", host="10.0.1.10", port=22, os="linux", tags=json.dumps(["linux", "maven", "docker"]), status="offline"),
        BuildAgent(name="linux-build-02", host="10.0.1.11", port=22, os="linux", tags=json.dumps(["linux", "maven", "gradle"]), status="offline"),
        BuildAgent(name="win-build-01", host="10.0.2.10", port=5985, os="windows", tags=json.dumps(["windows", "dotnet", "iis"]), status="offline"),
    ])

    # ---- 插件 ----
    # 真实实现由 sync_builtin_plugins 从 plugins/ 打 zip 登记。
    # 这里只放 Agent jar 内置、没有 zip 的步骤，避免再插入「已安装但跑不了」的空壳。
    plugins_data = [
        ("shell-exec", "Shell 命令执行", "exec", "在构建机上执行 Shell 脚本", _SCHEMA_SHELL_EXEC),
        ("bat-exec", "Bat 命令执行", "exec", "在 Windows 构建机上执行 Bat", None),
    ]
    # 启动时已经先同步过内置插件目录，同名的不能再插一遍（plugin.name 唯一）
    existing_plugins = set(db.scalars(select(Plugin.name)).all())
    db.add_all([
        Plugin(
            name=n, display_name=d, category=c, description=desc,
            config_schema=json.dumps(s, ensure_ascii=False) if s else "{}",
            installed=True,
            enabled=True,
            status="installed",
        )
        for n, d, c, desc, s in plugins_data
        if n not in existing_plugins
    ])

    # ---- 流水线模板 ----
    db.add(PipelineTemplate(
        name="Java + Maven + K8s 通用模板",
        description="Java 后端服务标准发布模板",
        yaml=_TEMPLATE_YAML,
        version="1.0.0",
        scope="public",
        created_by=admin.id,
    ))

    # ---- 流水线（蓝盾风格示例）----
    # 同一服务在生产/测试分组各一条流水线，体现"分组级审批"差异
    import uuid as _uuid

    p_order_prod = Pipeline(
        project_id=cop.id, group_id=cop_prod.id, name="new-from-test",
        description="DMS 经销商订单服务（蓝盾截图示例，生产）",
        yaml=_PIPELINE_YAML_BLUESHIELD, version=3, created_by=admin.id,
        workspace_uuid=_uuid.uuid4().hex,
    )
    p_order_test = Pipeline(
        project_id=cop.id, group_id=cop_test.id, name="order-service-test",
        description="订单服务测试流水线（免审批）",
        yaml=_PIPELINE_YAML_ORDER_TEST, version=1, created_by=admin.id,
        workspace_uuid=_uuid.uuid4().hex,
    )
    p_pay_test = Pipeline(
        project_id=cop.id, group_id=cop_test.id, name="pay-service-ci",
        description="支付服务测试流水线",
        yaml=_PIPELINE_YAML_PAY, version=1, created_by=admin.id,
        workspace_uuid=_uuid.uuid4().hex,
    )
    p_b2c_front = Pipeline(
        project_id=b2c.id, group_id=b2c_test.id, name="b2c-front-deploy",
        description="B2C 前端部署",
        yaml=_PIPELINE_YAML_FRONT, version=1, created_by=admin.id,
        workspace_uuid=_uuid.uuid4().hex,
    )
    db.add_all([p_order_prod, p_order_test, p_pay_test, p_b2c_front])
    db.flush()

    # ---- 制品 ----
    db.add_all([
        Artifact(pipeline_id=p_order_prod.id, name="order-service", type="jar", version="v1.4.2", git_commit="a1b2c3d", storage_key="cop/order-service/v1.4.2.jar", size_bytes=52428800),
        Artifact(pipeline_id=p_order_prod.id, name="order-service", type="jar", version="v1.4.1", git_commit="f0e1d2c", storage_key="cop/order-service/v1.4.1.jar", size_bytes=52400000),
        Artifact(pipeline_id=p_pay_test.id, name="pay-service", type="jar", version="v2.1.0", git_commit="b9c8d7e", storage_key="cop/pay-service/v2.1.0.jar", size_bytes=41943040),
    ])

    # ---- 发布任务 ----
    db.add_all([
        Release(
            pipeline_id=p_order_prod.id, group_id=cop_prod.id, version="v1.4.2",
            strategy="rolling", status="success", trigger_by="manual",
            operator_id=admin.id, build_number=1,
        ),
    ])

    # ---- 项目级角色模板（不预分配给任何人，由管理员在权限管理里绑定）----
    role_cop_dev = Role(project_id=cop.id, name="开发", description="COP 开发：可执行，不可增删改",
                        permissions=json.dumps({
                            "project": ["read"],
                            "group": ["read"],
                            "pipeline": ["read", "execute"],
                            "repository": ["read"],
                            "credential": ["read"],
                        }, ensure_ascii=False))
    role_cop_ops = Role(project_id=cop.id, name="运维", description="COP 运维：流水线全权限",
                        permissions=json.dumps({
                            "project": ["read", "create", "update", "delete"],
                            "group": ["read", "create", "update", "delete", "approve"],
                            "pipeline": ["read", "create", "update", "delete", "execute"],
                            "repository": ["read", "create", "update", "delete"],
                            "credential": ["read", "create", "delete"],
                        }, ensure_ascii=False))
    role_cop_approver = Role(project_id=cop.id, name="审批人", description="COP 生产审批",
                             permissions=json.dumps({
                                 "project": ["read"],
                                 "group": ["read", "approve"],
                                 "pipeline": ["read"],
                             }, ensure_ascii=False))
    role_b2c_dev = Role(project_id=b2c.id, name="开发", description="B2C 开发：含删除权限（项目级差异）",
                        permissions=json.dumps({
                            "project": ["read", "create"],
                            "group": ["read"],
                            "pipeline": ["read", "create", "update", "delete", "execute"],
                            "repository": ["read", "create", "update", "delete"],
                            "credential": ["read", "create", "delete"],
                        }, ensure_ascii=False))
    db.add_all([role_cop_dev, role_cop_ops, role_cop_approver, role_b2c_dev])

    db.commit()
    print("[seed] 演示数据已写入：1 用户(admin) / 2 项目 / 4 分组 / 4 流水线 / 14 插件 / 4 角色")


# ============================================================
# 示例 YAML（Pipeline as Code）
# ============================================================
_PIPELINE_YAML_BLUESHIELD = """\
pipeline:
  name: order-service
  triggers:
    - type: cron
      cron: "0 2 * * *"
  variables:
    - name: deploy_env
      type: select
      default_value: prod
      options: [prod, test]
      description: 部署环境
      show_on_execution: true
    - name: image_tag
      type: text
      default_value: latest
      description: 镜像标签
      show_on_execution: true
  stages:
    - name: 拉取代码
      jobs:
        - id: "1-1"
          name: 构建环境-Linux
          agent: linux
          steps:
            - plugin: git-checkout
              with:
                repo: order-service
                branch: master
    - name: 构建与测试
      jobs:
        - id: "2-1"
          name: 编译打包
          agent: linux
          steps:
            - plugin: maven-build
              with:
                goal: package
            - plugin: archive-artifact
        - id: "2-2"
          name: 单元测试
          agent: linux
          steps:
            - plugin: shell-exec
              with:
                script: "# 单元测试\\nmvn test"
    - name: 部署
      jobs:
        - id: "3-1"
          name: 部署到生产
          agent: linux
          steps:
            - plugin: k8s-deploy
              with:
                namespace: ${deploy_env}
                workload: order-service
                image: registry.local/order-service:${{BK_CI_BUILD_NUM}}
"""

_PIPELINE_YAML_ORDER_TEST = """\
pipeline:
  name: order-service
  triggers:
    - type: manual
  stages:
    - name: 拉代码
      jobs:
        - name: Git Checkout
          agent: linux
          steps:
            - plugin: git-checkout
              with:
                repo: order-service
                branch: master
    - name: 构建
      jobs:
        - name: Maven Build
          agent: linux
          steps:
            - plugin: maven-build
              with:
                goal: package
            - plugin: archive-artifact
    - name: 部署
      jobs:
        - name: Deploy to Test
          agent: linux
          steps:
            - plugin: k8s-deploy
              with:
                namespace: cop-test
                workload: order-service
                image: registry.local/order-service:${{BK_CI_BUILD_NUM}}
"""

_PIPELINE_YAML_PAY = """\
pipeline:
  name: pay-service
  triggers:
    - type: cron
      cron: "0 2 * * *"
  stages:
    - name: 拉代码
      jobs:
        - name: Git Checkout
          agent: linux
          steps:
            - plugin: git-checkout
              with:
                repo: pay-service
                branch: master
    - name: 构建
      jobs:
        - name: Maven Build
          agent: linux
          steps:
            - plugin: maven-build
              with:
                goal: package
            - plugin: archive-artifact
    - name: 部署
      jobs:
        - name: Deploy to Test
          agent: linux
          steps:
            - plugin: k8s-deploy
              with:
                namespace: cop-test
                workload: pay-service
                image: registry.local/pay-service:${{BK_CI_BUILD_NUM}}
"""

_PIPELINE_YAML_FRONT = """\
pipeline:
  name: b2c-front
  triggers:
    - type: manual
  stages:
    - name: 构建
      jobs:
        - name: npm build
          agent: linux
          steps:
            - plugin: git-checkout
              with:
                repo: b2c-front
                branch: main
            - plugin: shell-exec
              with:
                script: "npm ci && npm run build"
    - name: 部署
      jobs:
        - name: nginx 部署
          agent: linux
          steps:
            - plugin: shell-exec
              with:
                content: echo deploy-to-nginx
"""

_TEMPLATE_YAML = """\
pipeline:
  name: ${service}
  stages:
    - name: checkout
      jobs:
        - agent: linux
          steps:
            - plugin: git-checkout
              with:
                repo: ${repo}
                branch: ${branch}
    - name: build
      jobs:
        - agent: linux
          steps:
            - plugin: maven-build
              with:
                goal: package -DskipTests
            - plugin: archive-artifact
    - name: deploy
      jobs:
        - agent: linux
          steps:
            - plugin: k8s-deploy
              with:
                namespace: ${namespace}
                workload: ${service}
                image: registry.local/${service}:${{BK_CI_BUILD_NUM}}
"""


# ============================================================
# 插件 config_schema DSL（前端通用渲染器用）
#   支持的 field.type：text/textarea/number/password/radio/select/checkbox/switch/code
#   字段：key label type required default options placeholder help
# ============================================================
def _schema(*fields):
    return {"fields": list(fields)}


def _opt(value, label):
    return {"value": value, "label": label}


_SCHEMA_GIT_CHECKOUT = _schema(
    {"key": "repoType", "label": "代码库", "type": "radio", "required": True,
     "options": [_opt("byRepo", "按代码库选择"), _opt("byAlias", "按代码库别名输入"), _opt("byUrl", "按仓库URL输入")],
     "default": "byRepo"},
    # 关键：代码库字段改为 select，options 由前端从 /repositories 动态加载（按 alias 展示）
    {"key": "repoName", "label": "代码库", "type": "select", "required": True,
     "placeholder": "从项目代码库选择（按别名 group/project）", "default": ""},
    {"key": "persistenceCredential", "label": "是否将持久化凭证", "type": "checkbox", "default": True},
    {"key": "strategyType", "label": "指定拉取方式", "type": "select",
     "options": [_opt("BRANCH", "BRANCH"), _opt("TAG", "TAG"), _opt("COMMIT", "COMMIT")],
     "default": "BRANCH"},
    {"key": "ref", "label": "分支/TAG/COMMIT", "type": "text", "required": True, "default": "master"},
    {"key": "workspacePath", "label": "代码保存路径", "type": "text",
     "placeholder": "请填写工作空间相对目录，不填则默认为工作空间目录"},
    {"key": "strategy", "label": "拉取策略", "type": "radio",
     "options": [_opt("REVERT_UPDATE", "Revert Update"), _opt("FRESH_CHECKOUT", "Fresh Checkout"), _opt("INCREMENT_UPDATE", "Increment Update")],
     "default": "REVERT_UPDATE"},
    {"key": "fetch", "label": "Fetch", "type": "group", "children": [
        {"key": "depth", "label": "git fetch 的 depth 参数值", "type": "text", "default": ""},
        {"key": "enableSpecificBranch", "label": "启用拉取指定分支", "type": "checkbox", "default": False},
    ]},
)

_SCHEMA_MAVEN_BUILD = _schema(
    {"key": "goal", "label": "Maven 目标", "type": "text", "required": True, "default": "package"},
    {"key": "skipTests", "label": "跳过测试", "type": "checkbox", "default": False},
    {"key": "settingsFile", "label": "settings.xml 路径", "type": "text",
     "placeholder": "留空 = 构建机本机 settings",
     "help": "不要把带密码的 settings.xml 放进仓库。留空用本机 ~/.m2；指定时填构建机绝对路径"},
    {"key": "jdk", "label": "JDK 版本", "type": "select",
     "options": [_opt("8", "JDK 8"), _opt("11", "JDK 11"), _opt("17", "JDK 17")], "default": "11"},
)

_SCHEMA_ARCHIVE_ARTIFACT = _schema(
    {"key": "sourcePath", "label": "归档源路径", "type": "text", "required": True, "placeholder": "如：target/*.jar"},
    {"key": "artifactName", "label": "制品名称", "type": "text", "required": True, "placeholder": "如：order-service"},
    {"key": "version", "label": "版本", "type": "text", "placeholder": "如：v1.0.0"},
    {"key": "bucket", "label": "存储桶", "type": "text", "default": "deploy-artifacts"},
    {"key": "archive", "label": "归档前是否构建", "type": "checkbox", "default": True},
)

_SCHEMA_SSH_DEPLOY = _schema(
    {"key": "host", "label": "目标主机", "type": "text", "required": True, "placeholder": "如：10.0.3.10"},
    {"key": "port", "label": "SSH 端口", "type": "number", "default": 22},
    {"key": "credential", "label": "SSH 凭证", "type": "select", "options": []},
    {"key": "script", "label": "执行脚本", "type": "textarea", "rows": 4, "required": True,
     "placeholder": "systemctl restart order-service"},
    {"key": "uploadSource", "label": "上传源文件", "type": "text", "placeholder": "如：target/*.jar"},
    {"key": "uploadTarget", "label": "上传目标路径", "type": "text", "placeholder": "如：/opt/app/"},
)

_SCHEMA_SHELL_EXEC = _schema(
    {"key": "shellType", "label": "脚本类型", "type": "radio", "required": True,
     "options": [_opt("shell", "Shell")], "default": "shell"},
    {"key": "content", "label": "脚本内容", "type": "code", "required": True, "rows": 12,
     "placeholder": "#!/usr/bin/env bash\nset -e\necho 'hello'"},
    {"key": "continueOnError", "label": "失败时继续", "type": "checkbox", "default": False},
    {"key": "uploadOnError", "label": "失败时上传日志", "type": "checkbox", "default": False},
)

_SCHEMA_CRON = _schema(
    {"key": "cron", "label": "Cron 表达式", "type": "text", "required": True, "default": "0 2 * * *"},
    {"key": "timezone", "label": "时区", "type": "select",
     "options": [_opt("Asia/Shanghai", "Asia/Shanghai"), _opt("UTC", "UTC")], "default": "Asia/Shanghai"},
)

_SCHEMA_NOTIFY_IM = _schema(
    {"key": "channel", "label": "渠道", "type": "select",
     "options": [_opt("wecom", "企业微信"), _opt("dingtalk", "钉钉"), _opt("feishu", "飞书")],
     "default": "wecom"},
    {"key": "content", "label": "通知内容", "type": "textarea",
     "placeholder": "蓝盾流水线 [${pipeline.name}] #${pipeline.build.num} 构建通知"},
)

_SCHEMA_RUN_PIPELINE = _schema(
    {"key": "projectId", "label": "项目", "type": "select", "required": True, "placeholder": "选择项目"},
    {"key": "pipelineId", "label": "流水线", "type": "select", "required": True, "placeholder": "选择要启动的流水线"},
    {"key": "runMode", "label": "执行方式", "type": "radio", "required": True, "default": "sync",
     "options": [_opt("sync", "同步（等待子流水线结束）"), _opt("async", "异步（启动后立即继续）")]},
    {"key": "pollInterval", "label": "轮询间隔（秒）", "type": "number", "default": 10,
     "help": "仅同步执行有效，默认 10 秒"},
    {"key": "outputNamespace", "label": "输出变量命名空间", "type": "text", "default": "sub_pipeline_",
     "help": "末尾不是下划线时会自动补上"},
    {"key": "outputVars", "label": "子流水线输出变量", "type": "text",
     "placeholder": "多个变量用英文逗号分隔，空则导出全部启动参数"},
)
