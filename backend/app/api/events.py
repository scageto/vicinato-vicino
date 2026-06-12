"""
API per la sezione Eventi.

Schema simile a items/jobs:
    GET    /events/                      lista (filtri zone, category, year, month)
    GET    /events/me                    eventi che ho organizzato
    GET    /events/joined                eventi a cui partecipo
    GET    /events/{id}                  dettaglio
    POST   /events/                      crea (utente loggato)
    PUT    /events/{id}                  modifica (organizzatore)
    DELETE /events/{id}                  cancella (organizzatore)
    POST   /events/{id}/join             mi iscrivo
    DELETE /events/{id}/join             annullo iscrizione
"""

from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import (
    APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status,
)
from pydantic import BaseModel, field_validator
from sqlalchemy import and_
from sqlalchemy.orm import Session

from .. import auth, models
from ..database import get_db
from ..media_utils import save_uploaded_media, cleanup_saved_files

# Locandine eventi: backend/uploads/events/  →  /uploads/events/<file>
EVENT_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "events"
EVENT_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
EVENT_PROJECT_ROOT = Path(__file__).resolve().parents[2]

router = APIRouter(prefix="/events", tags=["events"])

# ==========================================================
# CONFIG
# ==========================================================

ALLOWED_CATEGORIES = {"festa", "mercatino", "corso", "pulizia", "sport", "cultura", "altro"}
ALLOWED_STATUSES = {"open", "cancelled", "full"}

# ==========================================================
# PYDANTIC
# ==========================================================

class EventBase(BaseModel):
    title: str
    description: str
    date: datetime
    end_date: Optional[datetime] = None
    location: str
    location_zone: Optional[str] = None
    category: Optional[str] = "altro"
    image_url: Optional[str] = None
    max_participants: Optional[int] = None

    @field_validator("title")
    @classmethod
    def _title_not_empty(cls, v: str) -> str:
        v = (v or "").strip()
        if not v:
            raise ValueError("Il titolo non puo' essere vuoto")
        return v

    @field_validator("category")
    @classmethod
    def _category_known(cls, v):
        if v is None or v == "":
            return "altro"
        if v not in ALLOWED_CATEGORIES:
            raise ValueError(
                f"Categoria non valida. Ammesse: {', '.join(sorted(ALLOWED_CATEGORIES))}"
            )
        return v

class EventCreate(EventBase):
    pass

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    location: Optional[str] = None
    location_zone: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    max_participants: Optional[int] = None
    status: Optional[str] = None

class EventResponse(BaseModel):
    id: int
    title: str
    description: str
    date: datetime
    end_date: Optional[datetime] = None
    location: str
    location_zone: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    max_participants: Optional[int] = None
    status: str
    organizer_id: Optional[int] = None
    organizer_name: Optional[str] = None
    organizer_zone: Optional[str] = None
    participants_count: int = 0
    is_participating: bool = False
    is_organizer: bool = False
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True

# ==========================================================
# HELPERS
# ==========================================================

def _build_response(
    event: models.Event,
    db: Session,
    current_user: Optional[models.User] = None,
) -> EventResponse:
    organizer = (
        db.query(models.User).filter(models.User.id == event.organizer_id).first()
        if event.organizer_id
        else None
    )
    participants_count = (
        db.query(models.EventParticipant)
        .filter(models.EventParticipant.event_id == event.id)
        .count()
    )
    is_participating = False
    is_organizer = False
    if current_user:
        is_organizer = current_user.id == event.organizer_id
        is_participating = (
            db.query(models.EventParticipant)
            .filter(
                models.EventParticipant.event_id == event.id,
                models.EventParticipant.user_id == current_user.id,
            )
            .first()
            is not None
        )
    return EventResponse(
        id=event.id,
        title=event.title,
        description=event.description,
        date=event.date,
        end_date=event.end_date,
        location=event.location,
        location_zone=event.location_zone,
        category=event.category,
        image_url=event.image_url,
        max_participants=event.max_participants,
        status=event.status or "open",
        organizer_id=event.organizer_id,
        organizer_name=organizer.full_name if organizer else None,
        organizer_zone=organizer.zone if organizer else None,
        participants_count=participants_count,
        is_participating=is_participating,
        is_organizer=is_organizer,
        created_at=event.created_at,
    )

def _maybe_user(token_user: Optional[models.User]) -> Optional[models.User]:
    return token_user

def _check_owner_or_moderator(event: models.Event, current_user: models.User) -> None:
    auth.ensure_owner_or_moderator(
        event.organizer_id, current_user,
        detail="Non hai i permessi per modificare questo evento",
    )

def _month_window(year: int, month: int) -> tuple[datetime, datetime]:
    """Ritorna (inizio_mese, inizio_mese_successivo) come UTC naive."""
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Mese non valido")
    start = datetime(year, month, 1)
    if month == 12:
        end = datetime(year + 1, 1, 1)
    else:
        end = datetime(year, month + 1, 1)
    return start, end

# ==========================================================
# ENDPOINTS
# ==========================================================

@router.get("/", response_model=List[EventResponse])
def list_events(
    year: Optional[int] = Query(None, description="Anno (con month) per filtrare il mese"),
    month: Optional[int] = Query(None, description="Mese 1-12"),
    category: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    upcoming_only: bool = Query(False, description="Solo eventi futuri"),
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    query = db.query(models.Event)

    if year is not None and month is not None:
        start, end = _month_window(year, month)
        query = query.filter(and_(models.Event.date >= start, models.Event.date < end))
    elif upcoming_only:
        query = query.filter(models.Event.date >= datetime.utcnow())

    if category:
        query = query.filter(models.Event.category == category)
    if zone:
        query = query.filter(models.Event.location_zone == zone)

    events = query.order_by(models.Event.date.asc()).all()
    return [_build_response(e, db, current_user) for e in events]

@router.get("/me", response_model=List[EventResponse])
def my_events(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    events = (
        db.query(models.Event)
        .filter(models.Event.organizer_id == current_user.id)
        .order_by(models.Event.date.asc())
        .all()
    )
    return [_build_response(e, db, current_user) for e in events]

@router.get("/joined", response_model=List[EventResponse])
def my_subscriptions(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    rows = (
        db.query(models.Event)
        .join(models.EventParticipant, models.EventParticipant.event_id == models.Event.id)
        .filter(models.EventParticipant.user_id == current_user.id)
        .order_by(models.Event.date.asc())
        .all()
    )
    return [_build_response(e, db, current_user) for e in rows]

@router.get("/{event_id}", response_model=EventResponse)
def get_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: Optional[models.User] = Depends(auth.get_current_user_optional),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    return _build_response(event, db, current_user)

@router.post("/", response_model=EventResponse)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if payload.end_date and payload.end_date < payload.date:
        raise HTTPException(status_code=400, detail="La fine non puo' precedere l'inizio")

    event = models.Event(
        title=payload.title,
        description=payload.description.strip() if payload.description else "",
        date=payload.date,
        end_date=payload.end_date,
        location=payload.location.strip(),
        location_zone=payload.location_zone,
        category=payload.category or "altro",
        image_url=payload.image_url,
        max_participants=payload.max_participants,
        organizer_id=current_user.id,
        status="open",
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return _build_response(event, db, current_user)

@router.put("/{event_id}", response_model=EventResponse)
def update_event(
    event_id: int,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    _check_owner_or_moderator(event, current_user)

    data = payload.model_dump(exclude_unset=True)
    if "category" in data and data["category"] not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Categoria non valida")
    if "status" in data and data["status"] not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")

    for field, value in data.items():
        if isinstance(value, str):
            value = value.strip() or None
        setattr(event, field, value)

    if event.end_date and event.date and event.end_date < event.date:
        raise HTTPException(status_code=400, detail="La fine non puo' precedere l'inizio")

    db.add(event)
    db.commit()
    db.refresh(event)
    return _build_response(event, db, current_user)

@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    _check_owner_or_moderator(event, current_user)

    db.delete(event)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.post("/{event_id}/join", response_model=EventResponse)
def join_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    if event.status == "cancelled":
        raise HTTPException(status_code=400, detail="L'evento e' stato annullato")

    already = (
        db.query(models.EventParticipant)
        .filter(
            models.EventParticipant.event_id == event_id,
            models.EventParticipant.user_id == current_user.id,
        )
        .first()
    )
    if already:
        return _build_response(event, db, current_user)

    if event.max_participants:
        count = (
            db.query(models.EventParticipant)
            .filter(models.EventParticipant.event_id == event_id)
            .count()
        )
        if count >= event.max_participants:
            raise HTTPException(status_code=409, detail="Posti esauriti")

    db.add(models.EventParticipant(event_id=event_id, user_id=current_user.id))
    db.commit()
    db.refresh(event)
    return _build_response(event, db, current_user)

@router.delete("/{event_id}/join", response_model=EventResponse)
def leave_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")

    db.query(models.EventParticipant).filter(
        models.EventParticipant.event_id == event_id,
        models.EventParticipant.user_id == current_user.id,
    ).delete()
    db.commit()
    db.refresh(event)
    return _build_response(event, db, current_user)

# ==========================================================
# UPLOAD LOCANDINA (immagine singola)
# ==========================================================

@router.post("/{event_id}/cover", response_model=EventResponse)
def upload_event_cover(
    event_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Carica/sostituisce la locandina di un evento. Una sola immagine."""
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    auth.ensure_owner_or_moderator(
        event.organizer_id, current_user,
        detail="Non puoi modificare questo evento",
    )

    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Nessun file ricevuto")
    if not (file.content_type or "").startswith("image/"):
        raise HTTPException(status_code=400, detail="La locandina deve essere un'immagine")

    # Riusa la pipeline media: salva 1 file, ottieni l'URL pubblico.
    saved = save_uploaded_media(
        [file],
        upload_root=EVENT_UPLOAD_ROOT,
        url_prefix="/uploads/events",
        project_root=EVENT_PROJECT_ROOT,
    )
    if not saved:
        raise HTTPException(status_code=400, detail="File non salvato")

    new_url = saved[0]["media_url"]
    old_url = event.image_url

    try:
        event.image_url = new_url
        db.add(event)
        db.commit()
        db.refresh(event)
    except Exception:
        db.rollback()
        cleanup_saved_files(saved, EVENT_PROJECT_ROOT)
        raise

    # Cancella la locandina precedente solo dopo commit
    if old_url and old_url.startswith("/uploads/events/"):
        try:
            p = EVENT_PROJECT_ROOT / old_url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

    return _build_response(event, db, current_user)

@router.delete("/{event_id}/cover", response_model=EventResponse)
def delete_event_cover(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Evento non trovato")
    auth.ensure_owner_or_moderator(
        event.organizer_id, current_user,
        detail="Non puoi modificare questo evento",
    )

    old_url = event.image_url
    event.image_url = None
    db.add(event)
    db.commit()
    db.refresh(event)

    if old_url and old_url.startswith("/uploads/events/"):
        try:
            p = EVENT_PROJECT_ROOT / old_url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

    return _build_response(event, db, current_user)
