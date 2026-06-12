"""
Recensioni utente bidirezionali.

Una review e' lasciata da `rater` su `ratee` per una specifica transazione
(`target_type` + `target_id`, dove target_type e' 'job' o 'item'). Vincoli:

- target deve essere completed (job) o taken (item)
- rater e ratee devono essere le DUE parti effettive della transazione
  (owner + accepted_by). Niente review da terzi.
- una sola review per (rater, ratee, target_type, target_id)
- editabile/eliminabile dal rater entro 30 giorni dalla creazione,
  poi cristallizzata. Gli admin possono sempre cancellare (passando
  per /moderation/content/...).

Dopo ogni create/update/delete ricalcoliamo `User.rating` e
`User.rating_count` del ratee.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, auth
from ..database import get_db

router = APIRouter(prefix="/reviews", tags=["reviews"])

REVIEW_EDIT_WINDOW = timedelta(days=30)

# =====================================================================
# Schemas
# =====================================================================

class ReviewCreate(BaseModel):
    ratee_id: int
    target_type: str  # 'job' | 'item'
    target_id: int
    score: int = Field(ge=1, le=5)
    comment: Optional[str] = None

class ReviewUpdate(BaseModel):
    score: Optional[int] = Field(default=None, ge=1, le=5)
    comment: Optional[str] = None

class ReviewOut(BaseModel):
    id: int
    rater_id: int
    ratee_id: int
    target_type: str
    target_id: int
    score: int
    comment: Optional[str]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]
    rater_name: Optional[str] = None

    class Config:
        from_attributes = True

# =====================================================================
# Helpers
# =====================================================================

def _recompute_user_rating(db: Session, user_id: int) -> None:
    """Aggiorna `users.rating` e `users.rating_count` come media/count delle
    review ricevute. Default 5.0 se l'utente non ha mai ricevuto review."""
    q = db.query(
        func.avg(models.Review.score).label("avg"),
        func.count(models.Review.id).label("cnt"),
    ).filter(models.Review.ratee_id == user_id).one()

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        return
    if q.cnt:
        user.rating = round(float(q.avg), 2)
        user.rating_count = int(q.cnt)
    else:
        user.rating = 5.0
        user.rating_count = 0
    db.add(user)

def _get_transaction_parties(db: Session, target_type: str, target_id: int) -> tuple[int, int] | None:
    """Ritorna (owner_id, counterparty_id) se la transazione e' completata,
    None altrimenti."""
    if target_type == "job":
        job = db.query(models.JobPost).filter(models.JobPost.id == target_id).first()
        if not job or job.status != "completed" or not job.accepted_by_user_id:
            return None
        return (job.user_id, job.accepted_by_user_id)
    if target_type == "item":
        item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == target_id).first()
        if not item or item.status != "taken" or not item.accepted_by_user_id:
            return None
        return (item.user_id, item.accepted_by_user_id)
    return None

def _serialize(r: models.Review) -> ReviewOut:
    return ReviewOut(
        id=r.id,
        rater_id=r.rater_id,
        ratee_id=r.ratee_id,
        target_type=r.target_type,
        target_id=r.target_id,
        score=r.score,
        comment=r.comment,
        created_at=r.created_at,
        updated_at=r.updated_at,
        rater_name=r.rater.full_name if r.rater else None,
    )

# =====================================================================
# Endpoints
# =====================================================================

@router.post("", response_model=ReviewOut)
@router.post("/", response_model=ReviewOut, include_in_schema=False)
def create_review(
    payload: ReviewCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if payload.target_type not in {"job", "item"}:
        raise HTTPException(status_code=400, detail="target_type non valido")
    if payload.ratee_id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi recensire te stesso")

    parties = _get_transaction_parties(db, payload.target_type, payload.target_id)
    if not parties:
        raise HTTPException(status_code=400,
                            detail="La transazione non risulta completata")
    owner_id, counter_id = parties
    if {current_user.id, payload.ratee_id} != {owner_id, counter_id}:
        raise HTTPException(status_code=403,
                            detail="Solo le due parti della transazione possono recensirsi")

    existing = db.query(models.Review).filter(
        models.Review.rater_id == current_user.id,
        models.Review.ratee_id == payload.ratee_id,
        models.Review.target_type == payload.target_type,
        models.Review.target_id == payload.target_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Hai gia' recensito questa transazione")

    review = models.Review(
        rater_id=current_user.id,
        ratee_id=payload.ratee_id,
        target_type=payload.target_type,
        target_id=payload.target_id,
        score=payload.score,
        comment=(payload.comment or "").strip()[:2000] or None,
    )
    db.add(review)
    db.flush()  # cosi' review.id e' disponibile, e la query AVG vede la nuova riga
    _recompute_user_rating(db, payload.ratee_id)
    db.commit()
    db.refresh(review)
    return _serialize(review)

@router.patch("/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    payload: ReviewUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    review = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    if review.rater_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Non puoi modificare questa recensione")

    if not current_user.is_admin:
        # Finestra di modifica per gli utenti normali
        created = review.created_at or datetime.utcnow()
        if datetime.utcnow() - created.replace(tzinfo=None) > REVIEW_EDIT_WINDOW:
            raise HTTPException(status_code=403,
                                detail="Recensione bloccata: passati i 30 giorni")

    if payload.score is not None:
        review.score = payload.score
    if payload.comment is not None:
        review.comment = payload.comment.strip()[:2000] or None

    db.add(review)
    db.flush()
    _recompute_user_rating(db, review.ratee_id)
    db.commit()
    db.refresh(review)
    return _serialize(review)

@router.delete("/{review_id}")
def delete_review(
    review_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    review = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not review:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    if review.rater_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Non puoi cancellare questa recensione")

    if not current_user.is_admin:
        created = review.created_at or datetime.utcnow()
        if datetime.utcnow() - created.replace(tzinfo=None) > REVIEW_EDIT_WINDOW:
            raise HTTPException(status_code=403,
                                detail="Recensione bloccata: passati i 30 giorni")

    ratee_id = review.ratee_id
    db.delete(review)
    db.flush()
    _recompute_user_rating(db, ratee_id)
    db.commit()
    return {"detail": "Recensione eliminata"}

@router.get("/user/{user_id}", response_model=List[ReviewOut])
def list_user_reviews(
    user_id: int,
    db: Session = Depends(get_db),
):
    """Recensioni RICEVUTE da un utente (visibili a chiunque)."""
    rows = (db.query(models.Review)
            .filter(models.Review.ratee_id == user_id)
            .order_by(models.Review.created_at.desc())
            .all())
    return [_serialize(r) for r in rows]

@router.get("/mine", response_model=List[ReviewOut])
def list_my_reviews(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Recensioni LASCIATE dall'utente corrente."""
    rows = (db.query(models.Review)
            .filter(models.Review.rater_id == current_user.id)
            .order_by(models.Review.created_at.desc())
            .all())
    return [_serialize(r) for r in rows]

@router.get("/transaction/{target_type}/{target_id}", response_model=List[ReviewOut])
def list_transaction_reviews(
    target_type: str,
    target_id: int,
    db: Session = Depends(get_db),
):
    """Le (max 2) recensioni associate a una specifica transazione."""
    rows = (db.query(models.Review)
            .filter(models.Review.target_type == target_type,
                    models.Review.target_id == target_id)
            .order_by(models.Review.created_at.desc())
            .all())
    return [_serialize(r) for r in rows]
