# -*- coding: utf-8 -*-
"""空库启动必须能登录、有默认配置，再跑一遍不能重复建管理员。"""
from __future__ import annotations

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

import app.db.models  # noqa: F401
from app.core.security import verify_password
from app.db.base import Base
from app.db.bootstrap import ensure_admin, ensure_runtime_ready, wait_for_database
from app.db.models import Group, Project, User
from app.main import _backfill_prod_self_approval, _seed_if_empty
from app.modules.settings import get_setting


def _bind(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    monkeypatch.setattr("app.db.session.engine", engine)
    monkeypatch.setattr("app.db.session.SessionLocal", sessionmaker(bind=engine))
    return engine


def test_fresh_database_is_ready_to_login(tmp_path, monkeypatch):
    engine = _bind(tmp_path, monkeypatch)
    wait_for_database(engine, attempts=3, delay=0.01)
    Base.metadata.create_all(engine)
    _seed_if_empty()
    _backfill_prod_self_approval()
    ensure_runtime_ready()

    with Session(engine) as db:
        admin = db.scalar(select(User).where(User.username == "admin"))
        assert admin is not None
        assert admin.is_admin
        assert verify_password("admin123", admin.password_hash)
        assert db.scalar(select(func.count()).select_from(Project)) >= 1
        assert get_setting(db, "agent_enroll_token").strip()
        assert get_setting(db, "harness_runner_token").strip()
        prods = db.scalars(select(Group).where(Group.type == "prod")).all()
        assert prods
        assert all(g.allow_self_approval for g in prods)

    _seed_if_empty()
    ensure_runtime_ready()
    with Session(engine) as db:
        n = db.scalar(select(func.count()).select_from(User).where(User.username == "admin"))
        assert n == 1


def test_ensure_admin_when_only_ordinary_users(tmp_path, monkeypatch):
    engine = _bind(tmp_path, monkeypatch)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(username="dev", display_name="开发", password_hash="x", is_admin=False))
        db.commit()
        ensure_admin(db)
        admin = db.scalar(select(User).where(User.username == "admin"))
        assert admin is not None and admin.is_admin
        assert verify_password("admin123", admin.password_hash)
        assert db.scalar(select(User).where(User.username == "dev")) is not None
