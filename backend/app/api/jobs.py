from pathlib import Path

from fastapi import (
    APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status,
)
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

from .. import models, auth
from ..database import get_db
from ..media_utils import save_uploaded_media, cleanup_saved_files, MAX_ATTACHMENTS

router = APIRouter(prefix="/jobs", tags=["jobs"])

# Foto/video allegati ai lavoretti vivono in backend/uploads/jobs/.
# main.py mounta /uploads su backend/uploads/, quindi l'URL pubblico
# di un file qui dentro e' /uploads/jobs/<filename>.
JOB_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "jobs"
JOB_UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
JOB_PROJECT_ROOT = Path(__file__).resolve().parents[2]

# ==========================================================
# MODELLI PYDANTIC
# ==========================================================

class JobPostBase(BaseModel):
    title: str
    description: str
    category: str

    # Offerta / richiesta
    is_offer: bool = True

    # Compenso
    price_type: str = "gratis"  # gratis, fisso, orario, scambio
    price_amount: Optional[float] = None
    price_currency: str = "EUR"
    price_note: Optional[str] = None

    # Luogo
    location_zone: Optional[str] = None
    location_details: Optional[str] = None
    is_remote: bool = False
    at_client_home: bool = False

    # Tempistiche
    time_type: str = "una_tantum"
    estimated_hours: Optional[float] = None
    preferred_days: Optional[str] = None
    preferred_time_slots: Optional[str] = None

    # Contatto
    allow_contact_phone: bool = True
    allow_contact_chat: bool = True
    extra_contact_info: Optional[str] = None

    # Altro
    required_skills: Optional[str] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None

class JobPostCreate(JobPostBase):
    """Tutti i campi aggiuntivi sono facoltativi (default gestiti dal modello)."""
    pass

class JobPostMediaResponse(BaseModel):
    id: int
    media_url: str
    media_type: str

    class Config:
        from_attributes = True

class JobPostResponse(JobPostBase):
    id: int
    status: str
    user_id: int
    created_at: datetime
    accepted_by_user_id: Optional[int] = None
    accepted_by_name: Optional[str] = None
    completed_at: Optional[datetime] = None

    # Informazioni utente proprietario
    owner_name: Optional[str] = None
    owner_zone: Optional[str] = None
    owner_rating: Optional[float] = None
    owner_rating_count: Optional[int] = None

    # Allegati foto/video
    media: List[JobPostMediaResponse] = []

    class Config:
        from_attributes = True

class JobPostUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    is_offer: Optional[bool] = None

    price_type: Optional[str] = None
    price_amount: Optional[float] = None
    price_currency: Optional[str] = None
    price_note: Optional[str] = None

    location_zone: Optional[str] = None
    location_details: Optional[str] = None
    is_remote: Optional[bool] = None
    at_client_home: Optional[bool] = None

    time_type: Optional[str] = None
    estimated_hours: Optional[float] = None
    preferred_days: Optional[str] = None
    preferred_time_slots: Optional[str] = None

    allow_contact_phone: Optional[bool] = None
    allow_contact_chat: Optional[bool] = None
    extra_contact_info: Optional[str] = None

    required_skills: Optional[str] = None
    notes: Optional[str] = None
    photo_url: Optional[str] = None

# ==========================================================
# ENDPOINTS LAVORETTI
# ==========================================================

@router.get("/", response_model=List[JobPostResponse])
def get_jobs(
    skip: int = 0,
    limit: int = 50,
    category: Optional[str] = Query(None, description="Filtra per categoria"),
    is_offer: Optional[bool] = Query(None, description="True=offerte, False=richieste"),
    status: Optional[str] = Query(None, description="open,in_progress,completed,cancelled"),
    zone: Optional[str] = Query(None, description="Zona del quartiere"),
    search: Optional[str] = Query(None, description="Filtra per titolo/descrizione/categoria"),
    db: Session = Depends(get_db),
):
    # Query con join per ottenere informazioni utente
    query = db.query(models.JobPost).join(models.User, models.JobPost.user_id == models.User.id)

    if category:
        query = query.filter(models.JobPost.category == category)
    if is_offer is not None:
        query = query.filter(models.JobPost.is_offer == is_offer)
    if status:
        query = query.filter(models.JobPost.status == status)
    if zone:
        query = query.filter(models.JobPost.location_zone == zone)
    if search:
        like = f"%{search.lower()}%"
        query = query.filter(
            models.JobPost.title.ilike(like) |
            models.JobPost.description.ilike(like) |
            models.JobPost.category.ilike(like) |
            models.JobPost.required_skills.ilike(like)
        )

    jobs = query.order_by(models.JobPost.created_at.desc()).offset(skip).limit(limit).all()
    
    # Costruisci la risposta aggiungendo le informazioni utente
    jobs_response = []
    for job in jobs:
        # Crea un dizionario con tutti i campi del job
        job_dict = {
            'id': job.id,
            'title': job.title,
            'description': job.description,
            'category': job.category,
            'is_offer': job.is_offer,
            'price_type': job.price_type,
            'price_amount': job.price_amount,
            'price_currency': job.price_currency,
            'price_note': job.price_note,
            'location_zone': job.location_zone,
            'location_details': job.location_details,
            'is_remote': job.is_remote,
            'at_client_home': job.at_client_home,
            'time_type': job.time_type,
            'estimated_hours': job.estimated_hours,
            'preferred_days': job.preferred_days,
            'preferred_time_slots': job.preferred_time_slots,
            'available_from': job.available_from,
            'available_until': job.available_until,
            'urgency': job.urgency,
            'allow_contact_phone': job.allow_contact_phone,
            'allow_contact_chat': job.allow_contact_chat,
            'extra_contact_info': job.extra_contact_info,
            'required_skills': job.required_skills,
            'notes': job.notes,
            'photo_url': job.photo_url,
            'status': job.status,
            'user_id': job.user_id,
            'accepted_by_user_id': job.accepted_by_user_id,
            'accepted_by_name': (job.accepted_by.full_name if job.accepted_by else None),
            'completed_at': job.completed_at,
            'created_at': job.created_at,
            'owner_name': job.owner.full_name,
            'owner_zone': job.owner.zone,
            'owner_rating': job.owner.rating,
            'owner_rating_count': job.owner.rating_count or 0,
            'media': [
                JobPostMediaResponse(id=m.id, media_url=m.media_url, media_type=m.media_type)
                for m in (job.media or [])
            ],
        }
        jobs_response.append(JobPostResponse(**job_dict))
    
    return jobs_response

@router.get("/me", response_model=List[JobPostResponse])
def get_my_jobs(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    jobs = (
        db.query(models.JobPost)
        .filter(models.JobPost.user_id == current_user.id)
        .order_by(models.JobPost.created_at.desc())
        .all()
    )
    return jobs

@router.get("/{job_id}", response_model=JobPostResponse)
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"general": "Lavoretto non trovato"},
        )
    return job

@router.post("/", response_model=JobPostResponse)
def create_job(
    job: JobPostCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    db_job = models.JobPost(
        **job.model_dump(),
        user_id=current_user.id,
        status="open",
    )
    db.add(db_job)
    db.commit()
    db.refresh(db_job)
    return db_job

@router.patch("/{job_id}/status", response_model=JobPostResponse)
def update_job_status(
    job_id: int,
    new_status: str,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if new_status not in {"open", "in_progress", "completed", "cancelled"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"status": "Stato non valido"},
        )

    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"general": "Lavoretto non trovato"},
        )

    auth.ensure_owner_or_moderator(
        job.user_id, current_user,
        detail={"general": "Non puoi modificare questo lavoretto"},
    )

    job.status = new_status
    if new_status == "completed" and job.completed_at is None:
        job.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job

class AcceptPayload(BaseModel):
    user_id: int

@router.post("/{job_id}/accept", response_model=JobPostResponse)
def accept_job(
    job_id: int,
    payload: AcceptPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """L'owner del job accetta un altro utente come controparte.
    Imposta accepted_by_user_id e porta lo status a 'in_progress'.
    Necessario perche' senza una controparte ufficiale non sappiamo
    chi puo' lasciare review a chi quando il job sara' completato."""
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    if job.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Solo chi ha pubblicato puo' accettare")
    if payload.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi accettare te stesso")
    other = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not other:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    job.accepted_by_user_id = other.id
    if job.status == "open":
        job.status = "in_progress"
    db.commit()
    db.refresh(job)
    return job

class CandidateOut(BaseModel):
    id: int
    full_name: str
    username: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None

@router.get("/{job_id}/candidates", response_model=List[CandidateOut])
def list_job_candidates(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Lista degli utenti che hanno aperto una chat con l'owner su questo job:
    dal pannello 'Segna completato' l'owner sceglie tra questi."""
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    auth.ensure_owner_or_moderator(job.user_id, current_user, detail="Non autorizzato")

    rooms = (db.query(models.ChatRoom)
             .filter(models.ChatRoom.job_post_id == job_id).all())
    other_ids = {r.participant1_id if r.participant2_id == job.user_id else r.participant2_id
                 for r in rooms}
    other_ids.discard(job.user_id)
    if not other_ids:
        return []
    users = db.query(models.User).filter(models.User.id.in_(other_ids)).all()
    return [CandidateOut(
        id=u.id, full_name=u.full_name, username=u.username,
        rating=u.rating, rating_count=u.rating_count or 0,
    ) for u in users]

@router.post("/{job_id}/complete", response_model=JobPostResponse)
def complete_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Marca il lavoretto come completato. Lo possono fare entrambe le parti
    (owner o accepted_by). Da qui in poi entrambi possono lasciare review."""
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    if not job.accepted_by_user_id:
        raise HTTPException(status_code=400,
                            detail="Devi prima accettare un utente per questo lavoretto")
    if current_user.id not in {job.user_id, job.accepted_by_user_id}:
        raise HTTPException(status_code=403, detail="Non sei parte di questa transazione")

    job.status = "completed"
    if job.completed_at is None:
        job.completed_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return job

@router.put("/{job_id}", response_model=JobPostResponse)
def update_job(
    job_id: int,
    job_update: JobPostUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"general": "Lavoretto non trovato"},
        )

    auth.ensure_owner_or_moderator(
        job.user_id, current_user,
        detail={"general": "Non puoi modificare questo lavoretto"},
    )

    data = job_update.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(job, field, value)

    db.add(job)
    db.commit()
    db.refresh(job)
    return job

@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"general": "Lavoretto non trovato"},
        )

    auth.ensure_owner_or_moderator(
        job.user_id, current_user,
        detail={"general": "Non puoi cancellare questo lavoretto"},
    )

    db.delete(job)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

# ==========================================================
# UPLOAD ALLEGATI (foto/video) di un lavoretto
# ==========================================================

@router.post("/{job_id}/media", response_model=JobPostResponse)
def upload_job_media(
    job_id: int,
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """
    Sostituisce gli allegati di un lavoretto con quelli passati. Accetta fino
    a 3 file (immagini compresse via Pillow, video con cap di dimensione).
    Atomico: se la validazione di un file fallisce, tutti i file gia' scritti
    vengono ripuliti e i media esistenti restano invariati.
    """
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    auth.ensure_owner_or_moderator(
        job.user_id, current_user,
        detail="Non puoi modificare questo lavoretto",
    )

    real_files = [f for f in files if f and f.filename]
    if len(real_files) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400, detail=f"Puoi caricare massimo {MAX_ATTACHMENTS} allegati"
        )

    # 1) salva i nuovi file PRIMA di toccare il DB. In caso di errore l'helper
    #    pulisce gli eventuali file gia' scritti e rilancia.
    saved_files = save_uploaded_media(
        real_files,
        upload_root=JOB_UPLOAD_ROOT,
        url_prefix="/uploads/jobs",
        project_root=JOB_PROJECT_ROOT,
    )

    # 2) ricorda i vecchi file per cancellarli SOLO dopo commit DB ok
    old_urls = [m.media_url for m in (job.media or [])]

    try:
        db.query(models.JobPostMedia).filter(
            models.JobPostMedia.job_post_id == job.id
        ).delete()
        for media in saved_files:
            db.add(models.JobPostMedia(
                job_post_id=job.id,
                media_url=media["media_url"],
                media_type=media["media_type"],
            ))
        db.commit()
        db.refresh(job)
    except Exception:
        db.rollback()
        cleanup_saved_files(saved_files, JOB_PROJECT_ROOT)
        raise

    # 3) ora che il DB e' coerente, ripulisci i vecchi file dal disco
    for url in old_urls:
        try:
            p = JOB_PROJECT_ROOT / url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

    return job

@router.delete("/{job_id}/media", status_code=status.HTTP_204_NO_CONTENT)
def clear_job_media(
    job_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    job = db.query(models.JobPost).filter(models.JobPost.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    auth.ensure_owner_or_moderator(
        job.user_id, current_user,
        detail="Non puoi modificare questo lavoretto",
    )

    old_urls = [m.media_url for m in (job.media or [])]
    db.query(models.JobPostMedia).filter(
        models.JobPostMedia.job_post_id == job.id
    ).delete()
    db.commit()
    for url in old_urls:
        try:
            p = JOB_PROJECT_ROOT / url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass
    return Response(status_code=status.HTTP_204_NO_CONTENT)
