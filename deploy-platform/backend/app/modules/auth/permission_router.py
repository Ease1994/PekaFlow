"""权限管理路由。

业务授权的增删改查仅管理员。侧栏菜单树登录即可读，保存可见范围仍仅管理员。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.deps import CurrentUser, get_current_admin, get_current_user
from app.core.response import R
from app.db.session import get_db
from app.modules.auth import permission_service

router = APIRouter(tags=["权限管理"])


@router.get("/users", summary="用户列表（仅管理员）")
def list_users(
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_admin),
):
    return R.ok(permission_service.list_users(db))


@router.get("/permissions", summary="权限列表（仅管理员）")
def list_permissions(
    user_id: int | None = Query(None, description="只看某个用户的授权；不传则返回前若干条"),
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_admin),
):
    return R.ok(permission_service.list_permissions(db, user_id=user_id))


@router.post("/permissions/batch", summary="批量赋权（仅管理员）")
def grant_permissions(
    body: dict,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_admin),
):
    """body: {"user_ids":[], "resource_type":"pipeline", "resource_ids":[], "actions":[]}"""
    user_ids = [int(u) for u in body.get("user_ids", [])]
    resource_ids = [int(r) for r in body.get("resource_ids", [])]
    actions = [str(a) for a in body.get("actions", [])]
    resource_type = str(body.get("resource_type", "pipeline"))

    if not user_ids or not resource_ids or not actions:
        from app.core.response import BizException
        raise BizException.bad_request("用户、资源、操作均不能为空")

    # 校验资源类型合法
    if resource_type not in permission_service.RESOURCE_ACTIONS:
        from app.core.response import BizException
        raise BizException.bad_request(f"非法的资源类型：{resource_type}")

    # 校验操作合法（只允许该资源类型定义的操作）
    valid_actions = set(permission_service.RESOURCE_ACTIONS[resource_type])
    for a in actions:
        if a not in valid_actions and a != "*":
            from app.core.response import BizException
            raise BizException.bad_request(
                f"资源类型 {resource_type} 不支持操作 {a}，可选：{sorted(valid_actions)}"
            )

    result = permission_service.grant_permissions(
        db, user_ids=user_ids, resource_type=resource_type,
        resource_ids=resource_ids, actions=actions,
    )
    return R.ok(result)


@router.post("/permissions/revoke", summary="批量删除权限（仅管理员）")
def revoke_permissions(
    body: dict,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_admin),
):
    """body: {"permission_ids":[]}"""
    permission_ids = [int(i) for i in body.get("permission_ids", [])]
    if not permission_ids:
        from app.core.response import BizException
        raise BizException.bad_request("permission_ids 不能为空")
    result = permission_service.revoke_permissions(db, permission_ids=permission_ids)
    return R.ok(result)


@router.get("/menus", summary="侧栏菜单树和当前用户可见项")
def get_menus(
    db: Session = Depends(get_db),
    current: CurrentUser = Depends(get_current_user),
):
    """登录即可读。侧栏靠 visible，菜单管理页用 items。"""
    from app.modules.auth.menus import catalog_public

    return R.ok(catalog_public(db, is_admin=bool(current.is_admin)))


@router.put("/menus", summary="保存菜单可见范围（仅管理员）")
def put_menus(
    body: dict,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(get_current_admin),
):
    """body: {"audience": {"artifacts": "all", "ai": "admin"}}。锁定项忽略。"""
    from app.modules.auth.menus import catalog_public, save_audience

    audience = body.get("audience") if isinstance(body.get("audience"), dict) else body
    if not isinstance(audience, dict):
        from app.core.response import BizException

        raise BizException.bad_request("audience 必须是对象")
    save_audience(db, audience)
    return R.ok(catalog_public(db, is_admin=True))
