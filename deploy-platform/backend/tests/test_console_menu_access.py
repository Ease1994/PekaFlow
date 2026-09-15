# -*- coding: utf-8 -*-
"""菜单按范围开放：默认全员可见资源页，系统管理和危险接口仍仅管理员。

菜单管理是侧栏树，不再塞进「添加授权」。默认可见范围由 MENU_ITEMS 决定，
管理员可把资源与工具改成仅管理员。轮换凭证、删机器、上传插件 zip、改模型 Key 不能跟着放开。
技能库上传、查看接入凭证跟菜单走。
"""
from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.deps import get_current_admin, get_current_user
from app.modules.account.router import router as account_router
from app.modules.agent.router import router as agent_router
from app.modules.ai.router import router as ai_router
from app.modules.artifact.router import router as artifact_router
from app.modules.audit.models import AuditLog
from app.modules.auth.menus import CONSOLE_MODULES, MENU_ITEMS, catalog_public, save_audience, visible_keys
from app.modules.auth.permission_router import router as permission_router
from app.modules.auth.permission_service import RESOURCE_ACTIONS, resource_name, resource_names
from app.modules.credential.router import router as credential_router
from app.modules.harness.router import router as harness_router
from app.modules.llm.router import router as llm_router
from app.modules.metric.router import router as metric_router
from app.modules.settings.models import PlatformSetting
from app.modules.settings.router import router as settings_router
from app.modules.store.router import router as store_router

FRONTEND = Path(__file__).resolve().parents[2] / "frontend" / "src"

OPEN_MENU_KEYS = ("artifacts", "agents", "nodes", "skills", "credentials", "models", "ai")
ADMIN_MENU_KEYS = ("dashboard", "releases", "users", "settings")
ADMIN_ROUTE_PATHS = ("releases", "settings", "users")
OPEN_ROUTE_PATHS = ("artifacts", "agents", "nodes", "skills", "credentials", "models", "ai", "permissions")


def _dep_level(route) -> str | None:
    """admin 优先：get_current_admin 内部也会挂 get_current_user。"""
    names: list[str] = []

    def walk(dep) -> None:
        call = getattr(dep, "call", None)
        if call is not None:
            names.append(getattr(call, "__name__", ""))
        for child in getattr(dep, "dependencies", None) or []:
            walk(child)

    walk(route.dependant)
    if "get_current_admin" in names:
        return "admin"
    if "get_current_user" in names:
        return "user"
    return None


def _route_level(router, path: str, method: str = "GET") -> str | None:
    """按路径取鉴权级别。路径要和 FastAPI 路由表里的一致，含前缀。"""
    method = method.upper()
    for route in router.routes:
        if getattr(route, "path", None) != path:
            continue
        if method not in (getattr(route, "methods", None) or set()):
            continue
        return _dep_level(route)
    raise AssertionError(f"没有 {method} {path}")


def _menu_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")
    PlatformSetting.__table__.create(engine)
    AuditLog.__table__.create(engine)
    return Session(engine)


def test_console_modules_keep_stable_ids() -> None:
    """旧 console 授权的 resource_id 仍能解析成菜单名。"""
    assert RESOURCE_ACTIONS["console"] == ["read"]
    assert CONSOLE_MODULES == {
        1: "制品库",
        2: "构建机管理",
        3: "节点管理",
        4: "凭证管理",
        5: "模型管理",
        6: "AI Agent",
        7: "技能库",
    }
    assert resource_name(None, "console", 2) == "构建机管理"
    assert resource_names(None, "console", {1, 7, 99}) == {1: "制品库", 7: "技能库"}


def test_frontend_menu_catalog_matches_backend() -> None:
    """前后端菜单树必须同一套 key 和标题，否则侧栏和菜单管理对不上。"""
    text = (FRONTEND / "menus.tsx").read_text(encoding="utf-8")
    block = re.search(r"export const FALLBACK_MENU_ITEMS[^=]*= \[([\s\S]*?)\]", text)
    assert block, "前端缺少 FALLBACK_MENU_ITEMS"
    found = re.findall(r"key:\s*'([^']+)',\s*label:\s*'([^']+)'", block.group(1))
    assert found == [(item.key, item.label) for item in MENU_ITEMS]


def test_grant_modal_does_not_grant_menus() -> None:
    """添加授权只管项目/节点，菜单改走独立页。"""
    text = (FRONTEND / "pages" / "PermissionManagement.tsx").read_text(encoding="utf-8")
    assert "菜单管理" in text
    assert "MenuManagement" in text
    assert 'value="console"' not in text
    assert "控制台模块" not in text


def test_sidebar_uses_server_visible_keys() -> None:
    """侧栏必须按 GET /menus 的 visible 过滤，不能再写死 is_admin 两套清单。"""
    text = (FRONTEND / "layouts" / "MainLayout.tsx").read_text(encoding="utf-8")
    assert "canSeeMenu" in text
    assert "queryKey: ['menus']" in text or 'queryKey: ["menus"]' in text
    app = (FRONTEND / "App.tsx").read_text(encoding="utf-8")
    for key in OPEN_MENU_KEYS:
        assert f'menu="{key}"' in app, f"/{key} 应套 RequireMenu"


def test_default_visible_keys_match_open_menus() -> None:
    """没改过配置时，普通人看见工作台和七个资源页，看不见系统管理。"""
    db = _menu_db()
    staff = visible_keys(db, is_admin=False)
    admin = visible_keys(db, is_admin=True)
    for key in OPEN_MENU_KEYS:
        assert key in staff
    for key in ADMIN_MENU_KEYS:
        assert key not in staff
        assert key in admin
    for key in ("projects", "pm", "deploy-requests", "approvals", "permissions"):
        assert key in staff


def test_admin_can_hide_tool_menu_from_staff() -> None:
    """把 AI Agent 改成仅管理员后，普通人侧栏和路由都不应再放行。"""
    db = _menu_db()
    save_audience(db, {"ai": "admin", "dashboard": "all"})
    staff = visible_keys(db, is_admin=False)
    assert "ai" not in staff
    assert "artifacts" in staff
    assert "dashboard" not in staff
    catalog = catalog_public(db, is_admin=False)
    assert "ai" not in catalog["visible"]
    ai = next(item for item in catalog["items"] if item["key"] == "ai")
    assert ai["audience"] == "admin"
    assert ai["locked"] is False


def test_routes_keep_admin_pages_gated() -> None:
    """路由上：放开的页不要套 RequireAdmin；发布/用户/设置必须套。"""
    text = (FRONTEND / "App.tsx").read_text(encoding="utf-8")
    blocks = re.findall(
        r'<Route\s+path="([^"]+)"\s+element=\{\s*(.*?)\s*\}\s*/>',
        text,
        re.S,
    )
    gated = {path for path, body in blocks if "RequireAdmin" in body}
    for path in ADMIN_ROUTE_PATHS:
        assert path in gated, f"/{path} 必须 RequireAdmin"
    for path in OPEN_ROUTE_PATHS:
        assert path not in gated, f"/{path} 不应 RequireAdmin"


def test_opened_menu_list_apis_are_for_logged_in_users() -> None:
    """菜单能点进去，对应的列表接口必须接受普通登录用户，不能再挂 get_current_admin。"""
    assert _route_level(artifact_router, "/artifacts") == "user"
    assert _route_level(agent_router, "/agents") == "user"
    assert _route_level(credential_router, "/credentials") == "user"
    assert _route_level(llm_router, "/llm/models") == "user"
    assert _route_level(llm_router, "/llm/providers") == "user"
    assert _route_level(harness_router, "/harness/components") == "user"
    assert _route_level(store_router, "/store/plugins") == "user"
    assert _route_level(ai_router, "/ai/sessions") == "user"
    assert _route_level(permission_router, "/menus") == "user"


def test_dangerous_ops_stay_admin() -> None:
    """可执行包的上架/安装、轮换凭证、改 Key 仍仅管理员。技能库上传走登录用户。"""
    assert _route_level(agent_router, "/agents/enroll-token") == "user"
    assert _route_level(agent_router, "/agents/enroll-token/rotate", "POST") == "admin"
    assert _route_level(agent_router, "/agents/{agent_id}", "DELETE") == "admin"
    assert _route_level(store_router, "/store/plugins/upload", "POST") == "admin"
    assert _route_level(store_router, "/store/plugins/{plugin_id}/install", "POST") == "admin"
    assert _route_level(store_router, "/store/plugins/{plugin_id}/uninstall", "POST") == "admin"
    assert _route_level(store_router, "/store/plugins/{plugin_id}", "DELETE") == "admin"
    assert _route_level(harness_router, "/harness/components/upload", "POST") == "user"
    assert _route_level(llm_router, "/llm/providers/{provider_id}", "PUT") == "admin"
    assert _route_level(metric_router, "/metrics/dora") == "admin"
    assert _route_level(account_router, "/account/users") == "admin"
    assert _route_level(settings_router, "/settings") == "admin"
    assert _route_level(permission_router, "/permissions") == "admin"
    assert _route_level(permission_router, "/menus", "PUT") == "admin"


def test_menu_gates_staff_install() -> None:
    """技能库上传、查看接入凭证跟菜单走：改成仅管理员后普通人 403。"""
    from app.core.deps import CurrentUser, assert_visible_menu, sees_menu
    from app.core.response import BizException
    from app.modules.auth.menus import save_audience

    db = _menu_db()
    staff = CurrentUser(id=7, username="dev", is_admin=False)
    admin = CurrentUser(id=1, username="admin", is_admin=True)
    assert sees_menu(db, staff, "skills")
    assert_visible_menu(db, staff, "skills")
    save_audience(db, {"skills": "admin", "agents": "admin", "nodes": "admin"})
    assert not sees_menu(db, staff, "skills")
    assert not sees_menu(db, staff, "agents", "nodes")
    try:
        assert_visible_menu(db, staff, "skills")
        raise AssertionError("看不见技能库的人不该能安装")
    except BizException as exc:
        assert exc.code == 403
    assert_visible_menu(db, admin, "skills", "agents")
    db.close()


def test_admin_gate_rejects_plain_user() -> None:
    """get_current_admin 本身对普通人是 403，侧栏放开后这条不能软化。"""
    from app.core.response import BizException
    from types import SimpleNamespace

    try:
        get_current_admin(SimpleNamespace(id=7, username="dev", is_admin=False))
        raise AssertionError("普通人不应通过 get_current_admin")
    except BizException as exc:
        assert exc.code == 403
    assert get_current_admin(SimpleNamespace(id=1, username="admin", is_admin=True)).is_admin
    assert get_current_user.__name__ == "get_current_user"
