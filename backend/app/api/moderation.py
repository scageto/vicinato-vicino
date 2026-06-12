"""
Moderazione e amministrazione.

Tre router montati nello stesso file:
- /reports         (utenti loggati): creano/leggono le proprie segnalazioni
- /moderation/*    (moderatori): gestiscono report e contenuti altrui
- /admin/*         (admin): site settings, gestione admin/mod, audit log
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from .. import models, auth
from ..database import get_db

# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================

class ReportCreate(BaseModel):
    target_type: str       # user | job | item | event | chat_message
    target_id: int
    reason: str
    description: Optional[str] = None

class ReportUpdate(BaseModel):
    status: Optional[str] = None
    resolution_note: Optional[str] = None

class ReportOut(BaseModel):
    id: int
    reporter_id: int
    target_type: str
    target_id: int
    reason: str
    description: Optional[str]
    status: str
    resolution_note: Optional[str]
    resolved_by_id: Optional[int]
    created_at: Optional[datetime]
    resolved_at: Optional[datetime]

    class Config:
        from_attributes = True

class UserAdminOut(BaseModel):
    id: int
    email: str
    username: Optional[str]
    full_name: str
    is_active: bool
    is_moderator: bool
    is_admin: bool
    is_banned: bool
    ban_reason: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

class UserRoleUpdate(BaseModel):
    is_moderator: Optional[bool] = None
    is_admin: Optional[bool] = None

class UserBanUpdate(BaseModel):
    is_banned: bool
    reason: Optional[str] = None

class SettingUpdate(BaseModel):
    value: Any
    is_public: Optional[bool] = None

class AuditLogOut(BaseModel):
    id: int
    actor_id: int
    action: str
    target_type: Optional[str]
    target_id: Optional[int]
    note: Optional[str]
    created_at: Optional[datetime]

    class Config:
        from_attributes = True

# Tipi di target validi per i report
VALID_TARGET_TYPES = {"user", "job", "item", "event", "chat_message"}

# Mapping target_type -> modello (usato per la moderazione)
_TARGET_MODELS = {
    "user": models.User,
    "job": models.JobPost,
    "item": models.ExchangeItem,
    "event": models.Event,
    "chat_message": models.ChatMessage,
}

# Chiavi che salviamo come JSON in site_settings (default keys conosciute).
_JSON_KEYS = {"zones", "job_categories", "event_categories"}

def _audit(db: Session, actor: models.User, action: str, target_type: str | None = None,
           target_id: int | None = None, note: str | None = None) -> None:
    db.add(models.AuditLog(
        actor_id=actor.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        note=note,
    ))

# =====================================================================
# /reports — utenti normali
# =====================================================================

reports_router = APIRouter(prefix="/reports", tags=["reports"])

@reports_router.post("", response_model=ReportOut)
def create_report(
    payload: ReportCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if payload.target_type not in VALID_TARGET_TYPES:
        raise HTTPException(status_code=400, detail="target_type non valido")

    # Verifica che il target esista davvero (no spam con id inventati)
    target_model = _TARGET_MODELS[payload.target_type]
    if not db.query(target_model).filter(target_model.id == payload.target_id).first():
        raise HTTPException(status_code=404, detail="Contenuto non trovato")

    report = models.Report(
        reporter_id=current_user.id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        reason=payload.reason.strip()[:200] or "non_specificato",
        description=(payload.description or "").strip()[:2000] or None,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report

@reports_router.get("/mine", response_model=List[ReportOut])
def my_reports(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    return (
        db.query(models.Report)
        .filter(models.Report.reporter_id == current_user.id)
        .order_by(models.Report.created_at.desc())
        .all()
    )

# =====================================================================
# /moderation — moderatori e admin
# =====================================================================

moderation_router = APIRouter(prefix="/moderation", tags=["moderation"])

@moderation_router.get("/reports", response_model=List[ReportOut])
def list_reports(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_moderator),
):
    q = db.query(models.Report)
    if status:
        q = q.filter(models.Report.status == status)
    return q.order_by(models.Report.created_at.desc()).all()

@moderation_router.patch("/reports/{report_id}", response_model=ReportOut)
def update_report(
    report_id: int,
    payload: ReportUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_moderator),
):
    report = db.query(models.Report).filter(models.Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Segnalazione non trovata")

    if payload.status is not None:
        if payload.status not in {"open", "reviewing", "resolved", "dismissed"}:
            raise HTTPException(status_code=400, detail="status non valido")
        report.status = payload.status
        if payload.status in {"resolved", "dismissed"}:
            report.resolved_by_id = current_user.id
            report.resolved_at = datetime.utcnow()

    if payload.resolution_note is not None:
        report.resolution_note = payload.resolution_note

    db.add(report)
    _audit(db, current_user, "update_report", "report", report.id, payload.status)
    db.commit()
    db.refresh(report)
    return report

@moderation_router.delete("/content/{target_type}/{target_id}")
def delete_any_content(
    target_type: str,
    target_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_moderator),
):
    """Elimina un contenuto qualsiasi (job, item, event, chat_message)
    indipendentemente dal proprietario. NON puo' eliminare utenti: per
    quello c'e' /admin/users/{id}."""
    if target_type == "user":
        raise HTTPException(status_code=400, detail="Usa /admin/users per gli utenti")
    if target_type not in _TARGET_MODELS:
        raise HTTPException(status_code=400, detail="target_type non valido")

    target_model = _TARGET_MODELS[target_type]
    obj = db.query(target_model).filter(target_model.id == target_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Contenuto non trovato")

    db.delete(obj)
    _audit(db, current_user, f"delete_{target_type}", target_type, target_id)
    db.commit()
    return {"detail": "Contenuto eliminato"}

# =====================================================================
# /admin — solo admin (settings, ruoli, audit, ban)
# =====================================================================

admin_router = APIRouter(prefix="/admin", tags=["admin"])

# ---------- Site settings ----------

def _decode_setting(key: str, raw: str | None):
    if raw is None:
        return None
    if key in _JSON_KEYS:
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return []
    return raw

def _encode_setting(key: str, value: Any) -> str:
    if key in _JSON_KEYS or isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return ""
    return str(value)

@admin_router.get("/settings")
def list_all_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    rows = db.query(models.SiteSetting).all()
    return [
        {
            "key": r.key,
            "value": _decode_setting(r.key, r.value),
            "is_public": r.is_public,
            "updated_at": r.updated_at,
        }
        for r in rows
    ]

@admin_router.put("/settings/{key}")
def set_setting(
    key: str,
    payload: SettingUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    row = db.query(models.SiteSetting).filter(models.SiteSetting.key == key).first()
    if row is None:
        row = models.SiteSetting(
            key=key,
            value=_encode_setting(key, payload.value),
            is_public=payload.is_public if payload.is_public is not None else True,
        )
        db.add(row)
    else:
        row.value = _encode_setting(key, payload.value)
        if payload.is_public is not None:
            row.is_public = payload.is_public

    _audit(db, current_user, "update_setting", "setting", None, key)
    db.commit()
    db.refresh(row)
    return {
        "key": row.key,
        "value": _decode_setting(row.key, row.value),
        "is_public": row.is_public,
    }

@admin_router.delete("/settings/{key}")
def delete_setting(
    key: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    row = db.query(models.SiteSetting).filter(models.SiteSetting.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail="Setting non trovata")
    db.delete(row)
    _audit(db, current_user, "delete_setting", "setting", None, key)
    db.commit()
    return {"detail": "Setting eliminata"}

# ---------- Gestione utenti ----------

@admin_router.get("/users", response_model=List[UserAdminOut])
def admin_list_users(
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    q = db.query(models.User)
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(or_(
            models.User.email.ilike(like),
            models.User.username.ilike(like),
            models.User.full_name.ilike(like),
        ))
    return q.order_by(models.User.created_at.desc()).all()

@admin_router.patch("/users/{user_id}/role", response_model=UserAdminOut)
def admin_update_role(
    user_id: int,
    payload: UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    if payload.is_admin is False and user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi rimuovere te stesso da admin")

    if payload.is_moderator is not None:
        user.is_moderator = bool(payload.is_moderator)
    if payload.is_admin is not None:
        user.is_admin = bool(payload.is_admin)
        # Coerenza: admin implica moderatore
        if user.is_admin and not user.is_moderator:
            user.is_moderator = True

    db.add(user)
    _audit(db, current_user, "update_role", "user", user.id,
           f"mod={user.is_moderator} admin={user.is_admin}")
    db.commit()
    db.refresh(user)
    return user

@admin_router.patch("/users/{user_id}/ban", response_model=UserAdminOut)
def admin_ban_user(
    user_id: int,
    payload: UserBanUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if user.id == current_user.id and payload.is_banned:
        raise HTTPException(status_code=400, detail="Non puoi bannare te stesso")
    if user.is_admin and payload.is_banned:
        raise HTTPException(status_code=400, detail="Rimuovi prima i privilegi admin")

    user.is_banned = bool(payload.is_banned)
    user.ban_reason = payload.reason if payload.is_banned else None

    db.add(user)
    _audit(db, current_user, "ban_user" if payload.is_banned else "unban_user",
           "user", user.id, payload.reason)
    db.commit()
    db.refresh(user)
    return user

@admin_router.delete("/users/{user_id}")
def admin_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi eliminare te stesso")
    if user.is_admin:
        raise HTTPException(status_code=400, detail="Rimuovi prima i privilegi admin")

    # Cancellazioni a cascata "best-effort", in linea con users/me
    db.query(models.JobPost).filter(models.JobPost.user_id == user.id).delete()
    db.query(models.ChatMessage).filter(models.ChatMessage.sender_id == user.id).delete()
    db.query(models.ChatRoom).filter(or_(
        models.ChatRoom.participant1_id == user.id,
        models.ChatRoom.participant2_id == user.id,
    )).delete()
    db.query(models.ExchangeItem).filter(models.ExchangeItem.user_id == user.id).delete()

    _audit(db, current_user, "delete_user", "user", user.id, user.email)
    db.delete(user)
    db.commit()
    return {"detail": "Utente eliminato"}

# ---------- Audit log ----------

@admin_router.get("/audit-log", response_model=List[AuditLogOut])
def admin_audit_log(
    limit: int = 100,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    return (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.created_at.desc())
        .limit(min(max(limit, 1), 500))
        .all()
    )

@admin_router.delete("/audit-log")
def admin_clear_audit_log(
    older_than_days: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_admin),
):
    """Cancella le voci dell'audit log.
    Senza parametri: pulisce tutto. Con `older_than_days=N`: pulisce solo
    le voci piu' vecchie di N giorni."""
    q = db.query(models.AuditLog)
    if older_than_days is not None and older_than_days > 0:
        cutoff = datetime.utcnow() - timedelta(days=older_than_days)
        q = q.filter(models.AuditLog.created_at < cutoff)
    deleted = q.delete(synchronize_session=False)
    # Audit auto-referenziale: tracciamo anche l'azione di pulizia
    db.add(models.AuditLog(
        actor_id=current_user.id,
        action="clear_audit_log",
        note=f"deleted={deleted} older_than_days={older_than_days}",
    ))
    db.commit()
    return {"detail": f"{deleted} voci eliminate"}

# ---------- Stats overview ----------

@admin_router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    return {
        "users": db.query(models.User).count(),
        "users_banned": db.query(models.User).filter(models.User.is_banned == True).count(),  # noqa: E712
        "admins": db.query(models.User).filter(models.User.is_admin == True).count(),  # noqa: E712
        "moderators": db.query(models.User).filter(models.User.is_moderator == True).count(),  # noqa: E712
        "jobs": db.query(models.JobPost).count(),
        "items": db.query(models.ExchangeItem).count(),
        "events": db.query(models.Event).count(),
        "chat_rooms": db.query(models.ChatRoom).count(),
        "chat_messages": db.query(models.ChatMessage).count(),
        "reports_open": db.query(models.Report).filter(models.Report.status == "open").count(),
        "reports_total": db.query(models.Report).count(),
    }

# Router "ufficiale" esposto a main.py
router = moderation_router  # back-compat con eventuali import esterni
