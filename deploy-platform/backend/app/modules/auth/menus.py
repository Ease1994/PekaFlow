"""侧栏菜单：按可见范围管理，不跟项目流水线授权混在一起。

市面上后台（若依、Ant Design Pro、钉钉管理）都是「菜单树 + 谁能看见」，
不是在「给某人授执行权」的弹窗里再勾一遍页面。业务数据权限仍走用户授权。
"""
from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.settings.models import PlatformSetting

# 落在 platform_setting 里的 JSON：{"artifacts":"admin","ai":"all"}
SETTING_KEY = "menu_audience"
# all = 登录即可看见；admin = 仅管理员。锁定项不允许改。
AUDIENCE_ALL = "all"
AUDIENCE_ADMIN = "admin"


@dataclass(frozen=True)
class MenuItem:
    """侧栏上的一项。key 和前端路由一致。"""

    key: str
    label: str
    group: str
    group_label: str
    default_audience: str
    locked: bool
    console_id: int | None = None


# 和工作台 / 资源 / 系统三组对应侧栏从上到下的顺序。
MENU_ITEMS: tuple[MenuItem, ...] = (
    MenuItem("projects", "项目与流水线", "workbench", "工作台", AUDIENCE_ALL, True),
    MenuItem("pm", "项目工作台", "workbench", "工作台", AUDIENCE_ALL, True),
    MenuItem("deploy-requests", "发布提交", "workbench", "工作台", AUDIENCE_ALL, True),
    MenuItem("approvals", "发布审批", "workbench", "工作台", AUDIENCE_ALL, True),
    MenuItem("permissions", "权限管理", "workbench", "工作台", AUDIENCE_ALL, True),
    MenuItem("artifacts", "制品库", "tools", "资源与工具", AUDIENCE_ALL, False, 1),
    MenuItem("agents", "构建机管理", "tools", "资源与工具", AUDIENCE_ALL, False, 2),
    MenuItem("nodes", "节点管理", "tools", "资源与工具", AUDIENCE_ALL, False, 3),
    MenuItem("skills", "技能库", "tools", "资源与工具", AUDIENCE_ALL, False, 7),
    MenuItem("credentials", "凭证管理", "tools", "资源与工具", AUDIENCE_ALL, False, 4),
    MenuItem("models", "模型管理", "tools", "资源与工具", AUDIENCE_ALL, False, 5),
    MenuItem("ai", "AI Agent", "tools", "资源与工具", AUDIENCE_ALL, False, 6),
    MenuItem("dashboard", "指标大盘", "system", "系统管理", AUDIENCE_ADMIN, True),
    MenuItem("releases", "发布管理", "system", "系统管理", AUDIENCE_ADMIN, True),
    MenuItem("users", "用户管理", "system", "系统管理", AUDIENCE_ADMIN, True),
    MenuItem("settings", "平台设置", "system", "系统管理", AUDIENCE_ADMIN, True),
)

# 旧的 console 授权 resource_id 仍用这张表显示名字，不再拿来控制侧栏。
CONSOLE_MODULES: dict[int, str] = {
    item.console_id: item.label for item in MENU_ITEMS if item.console_id is not None
}
_BY_KEY = {item.key: item for item in MENU_ITEMS}


def _parse_audience(raw: str) -> dict[str, str]:
    """读库里的 JSON。坏数据当没配过，回落到每项的默认可见范围。"""
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, str] = {}
    for key, value in data.items():
        if key not in _BY_KEY:
            continue
        text = str(value).strip().lower()
        if text in {AUDIENCE_ALL, AUDIENCE_ADMIN}:
            out[str(key)] = text
    return out


def load_audience(db: Session) -> dict[str, str]:
    """当前生效的可见范围。锁定项永远用目录里的默认值。"""
    row = db.scalar(select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY))
    stored = _parse_audience(row.value if row is not None else "")
    out: dict[str, str] = {}
    for item in MENU_ITEMS:
        if item.locked:
            out[item.key] = item.default_audience
        else:
            out[item.key] = stored.get(item.key, item.default_audience)
    return out


def save_audience(db: Session, audience: dict) -> dict[str, str]:
    """只保存未锁定项。锁定项即使传上来也忽略。"""
    cleaned: dict[str, str] = {}
    for key, value in (audience or {}).items():
        item = _BY_KEY.get(str(key))
        if item is None or item.locked:
            continue
        text = str(value).strip().lower()
        if text not in {AUDIENCE_ALL, AUDIENCE_ADMIN}:
            continue
        cleaned[item.key] = text
    payload = json.dumps(cleaned, ensure_ascii=False, sort_keys=True)
    row = db.scalar(select(PlatformSetting).where(PlatformSetting.key == SETTING_KEY))
    if row is None:
        db.add(PlatformSetting(key=SETTING_KEY, value=payload, description="侧栏菜单可见范围"))
    else:
        row.value = payload
    from app.modules.audit.service import write as write_audit

    write_audit(db, "menu.audience", "menu", None, f"菜单可见范围 {payload}")
    db.commit()
    return load_audience(db)


def visible_keys(db: Session, *, is_admin: bool) -> list[str]:
    """当前用户侧栏该出现哪些 key。管理员看见全部。"""
    audience = load_audience(db)
    keys: list[str] = []
    for item in MENU_ITEMS:
        who = audience.get(item.key, item.default_audience)
        if is_admin or who == AUDIENCE_ALL:
            keys.append(item.key)
    return keys


def catalog_public(db: Session, *, is_admin: bool) -> dict:
    """给前端的菜单树 + 当前用户可见列表。"""
    audience = load_audience(db)
    items = []
    for item in MENU_ITEMS:
        who = audience.get(item.key, item.default_audience)
        items.append(
            {
                "key": item.key,
                "label": item.label,
                "group": item.group,
                "group_label": item.group_label,
                "audience": who,
                "locked": item.locked,
            }
        )
    return {
        "items": items,
        "visible": visible_keys(db, is_admin=is_admin),
    }
