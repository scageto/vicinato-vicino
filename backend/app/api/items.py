"""
API per la sezione Scambio / Regalo.

Sostanzialmente lo stesso pattern di jobs.py, ma con la possibilità di
allegare fino a 3 file (immagini o video) per ogni annuncio.

Visto che il server gira su un Raspberry con disco molto limitato (~32GB),
le immagini caricate vengono compresse server-side con Pillow:
    - convertite in JPEG (eccezion fatta per i PNG con trasparenza che restano PNG)
    - ridimensionate al massimo a 1280px sul lato lungo
    - salvate con qualita' 80, ottimizzate

I video non vengono transcodificati (su Pi sarebbe troppo pesante senza ffmpeg)
ma sono soggetti a un limite di dimensione massima (MAX_VIDEO_BYTES).
"""

from io import BytesIO
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth, models
from ..database import get_db

router = APIRouter(prefix="/items", tags=["items"])

# ==========================================================
# CONFIG STORAGE
# ==========================================================

UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads" / "items"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

MAX_ATTACHMENTS = 3
MAX_IMAGE_BYTES = 8 * 1024 * 1024     # 8 MB grezzi in ingresso (post compressione molto meno)
MAX_VIDEO_BYTES = 12 * 1024 * 1024    # 12 MB hard cap per i video
MAX_IMAGE_DIMENSION = 1280            # px sul lato lungo dopo resize
JPEG_QUALITY = 80                     # qualita' di compressione JPEG

ALLOWED_ITEM_TYPES = {"regalo", "scambio"}
ALLOWED_STATUSES = {"available", "reserved", "taken"}
ALLOWED_CONDITIONS = {"nuovo", "usato", "da_riparare"}

# ==========================================================
# PYDANTIC MODELS
# ==========================================================

class ExchangeItemMediaResponse(BaseModel):
    id: int
    media_url: str
    media_type: str

    class Config:
        from_attributes = True

class ExchangeItemResponse(BaseModel):
    id: int
    title: str
    description: str
    item_type: str
    category: str
    condition: str
    zone: Optional[str] = None
    status: str
    user_id: int
    accepted_by_user_id: Optional[int] = None
    accepted_by_name: Optional[str] = None
    completed_at: Optional[str] = None
    owner_name: Optional[str] = None
    owner_zone: Optional[str] = None
    owner_rating: Optional[float] = None
    owner_rating_count: Optional[int] = None
    created_at: Optional[str] = None
    media: List[ExchangeItemMediaResponse] = []

    class Config:
        from_attributes = True

# ==========================================================
# HELPERS
# ==========================================================

def build_item_response(item: models.ExchangeItem, db: Session) -> ExchangeItemResponse:
    owner = db.query(models.User).filter(models.User.id == item.user_id).first()
    media = [
        ExchangeItemMediaResponse(id=m.id, media_url=m.media_url, media_type=m.media_type)
        for m in item.media
    ]
    accepted_user = None
    if item.accepted_by_user_id:
        accepted_user = (db.query(models.User)
                         .filter(models.User.id == item.accepted_by_user_id)
                         .first())

    return ExchangeItemResponse(
        id=item.id,
        title=item.title,
        description=item.description,
        item_type=item.item_type,
        category=item.category,
        condition=item.condition,
        zone=item.zone,
        status=item.status,
        user_id=item.user_id,
        accepted_by_user_id=item.accepted_by_user_id,
        accepted_by_name=accepted_user.full_name if accepted_user else None,
        completed_at=item.completed_at.isoformat() if item.completed_at else None,
        owner_name=owner.full_name if owner else None,
        owner_zone=owner.zone if owner else None,
        owner_rating=owner.rating if owner else None,
        owner_rating_count=(owner.rating_count or 0) if owner else None,
        created_at=item.created_at.isoformat() if item.created_at else None,
        media=media,
    )

def _compress_image(raw_bytes: bytes, original_name: str) -> tuple[bytes, str, str]:
    """
    Comprime un'immagine usando Pillow.

    Ritorna (bytes_compressi, estensione_file, content_type).
    """
    try:
        img = Image.open(BytesIO(raw_bytes))
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Impossibile leggere l'immagine: {original_name}",
        )

    # Rispetta orientazione EXIF (foto dal telefono)
    img = ImageOps.exif_transpose(img)

    # Ridimensiona se troppo grande
    img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

    output = BytesIO()
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

    if has_alpha:
        # Mantieni la trasparenza in PNG ottimizzato
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        img.save(output, format="PNG", optimize=True)
        return output.getvalue(), ".png", "image/png"

    # Tutto il resto -> JPEG (peso minore, perfetto per foto di oggetti)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return output.getvalue(), ".jpg", "image/jpeg"

def _cleanup_saved_files(saved: List[dict]) -> None:
    """Cancella dal disco i file appena scritti (best-effort)."""
    for s in saved:
        try:
            p = Path(__file__).resolve().parents[2] / s["media_url"].lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

def save_media_files(files: List[UploadFile]) -> List[dict]:
    """
    Salva su disco gli allegati di un annuncio applicando compressione e
    controlli di dimensione. Restituisce la lista di dict {media_url, media_type}.

    Atomico: se anche un solo file e' invalido tutti i file gia' salvati nel
    corso della stessa chiamata vengono rimossi dal disco prima di rilanciare
    l'eccezione, in modo da non lasciare allegati orfani.
    """
    saved: List[dict] = []

    real_files = [f for f in files if f and f.filename]
    if len(real_files) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Puoi caricare massimo {MAX_ATTACHMENTS} allegati",
        )

    try:
        for file in real_files:
            content_type = (file.content_type or "").lower()

            if content_type.startswith("image/"):
                raw = file.file.read()
                if len(raw) > MAX_IMAGE_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"Immagine '{file.filename}' troppo grande "
                            f"(max {MAX_IMAGE_BYTES // (1024 * 1024)}MB prima della compressione)."
                        ),
                    )
                compressed, ext, _ctype = _compress_image(raw, file.filename)
                file_name = f"{uuid4().hex}{ext}"
                (UPLOAD_ROOT / file_name).write_bytes(compressed)
                saved.append({"media_url": f"/uploads/items/{file_name}", "media_type": "image"})

            elif content_type.startswith("video/"):
                raw = file.file.read()
                if len(raw) > MAX_VIDEO_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"Video '{file.filename}' troppo grande "
                            f"(max {MAX_VIDEO_BYTES // (1024 * 1024)}MB). "
                            "Riduci durata o risoluzione prima di caricarlo."
                        ),
                    )
                ext = Path(file.filename).suffix.lower() or ".mp4"
                if ext not in {".mp4", ".webm", ".mov", ".m4v"}:
                    ext = ".mp4"
                file_name = f"{uuid4().hex}{ext}"
                (UPLOAD_ROOT / file_name).write_bytes(raw)
                saved.append({"media_url": f"/uploads/items/{file_name}", "media_type": "video"})

            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Formato non supportato per '{file.filename}'. "
                        "Sono ammessi solo immagini o video."
                    ),
                )
    except Exception:
        # qualunque errore: ripulisci i file gia' scritti e rilancia
        _cleanup_saved_files(saved)
        raise

    return saved

def _delete_media_files(item: models.ExchangeItem) -> None:
    """Cancella dal disco gli allegati associati a un item (best-effort)."""
    for media in item.media:
        try:
            p = Path(__file__).resolve().parents[2] / media.media_url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            # non bloccare l'API se non riusciamo a cancellare un file
            pass

def _check_owner_or_moderator(item: models.ExchangeItem, current_user: models.User) -> None:
    auth.ensure_owner_or_moderator(
        item.user_id, current_user,
        detail="Non hai i permessi per modificare questo annuncio",
    )

# ==========================================================
# ENDPOINTS
# ==========================================================

@router.get("/", response_model=List[ExchangeItemResponse])
def get_items(
    search: Optional[str] = Query(None, description="Ricerca testo libero"),
    item_type: Optional[str] = Query(None, description="regalo|scambio"),
    category: Optional[str] = Query(None),
    zone: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(
        None, alias="status", description="available|reserved|taken"
    ),
    db: Session = Depends(get_db),
):
    query = db.query(models.ExchangeItem)

    if search:
        like = f"%{search.lower()}%"
        query = query.filter(
            models.ExchangeItem.title.ilike(like)
            | models.ExchangeItem.description.ilike(like)
            | models.ExchangeItem.category.ilike(like)
        )
    if item_type:
        if item_type not in ALLOWED_ITEM_TYPES:
            raise HTTPException(
                status_code=400, detail="item_type non valido (regalo|scambio)"
            )
        query = query.filter(models.ExchangeItem.item_type == item_type)
    if category:
        query = query.filter(models.ExchangeItem.category == category)
    if zone:
        query = query.filter(models.ExchangeItem.zone == zone)
    if status_filter:
        if status_filter not in ALLOWED_STATUSES:
            raise HTTPException(status_code=400, detail="status non valido")
        query = query.filter(models.ExchangeItem.status == status_filter)

    items = query.order_by(models.ExchangeItem.created_at.desc()).all()
    return [build_item_response(i, db) for i in items]

@router.get("/me", response_model=List[ExchangeItemResponse])
def get_my_items(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    items = (
        db.query(models.ExchangeItem)
        .filter(models.ExchangeItem.user_id == current_user.id)
        .order_by(models.ExchangeItem.created_at.desc())
        .all()
    )
    return [build_item_response(i, db) for i in items]

@router.get("/{item_id}", response_model=ExchangeItemResponse)
def get_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    return build_item_response(item, db)

@router.post("/", response_model=ExchangeItemResponse)
def create_item(
    title: str = Form(...),
    description: str = Form(...),
    item_type: str = Form(...),
    category: str = Form(...),
    condition: str = Form("usato"),
    zone: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    # 1) Validazione metadata: niente effetti collaterali se i campi sono invalidi
    if item_type not in ALLOWED_ITEM_TYPES:
        raise HTTPException(status_code=400, detail="item_type deve essere regalo o scambio")
    if condition not in ALLOWED_CONDITIONS:
        raise HTTPException(status_code=400, detail="condition non valida")

    real_files = [f for f in files if f and f.filename]
    if len(real_files) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400, detail=f"Puoi caricare massimo {MAX_ATTACHMENTS} allegati"
        )

    # 2) Salva e valida i file PRIMA di scrivere su DB. Se anche un solo file
    #    e' invalido save_media_files ripulisce gli eventuali gia' salvati e
    #    rilancia l'eccezione: nessun annuncio orfano nel DB.
    saved_files = save_media_files(real_files)

    # 3) Crea item + media in un'unica transazione. In caso di errore DB
    #    ripuliamo i file dal disco per non lasciare allegati orfani.
    try:
        item = models.ExchangeItem(
            title=title.strip(),
            description=description.strip(),
            item_type=item_type,
            category=category.strip(),
            condition=condition,
            zone=zone,
            user_id=current_user.id,
            status="available",
        )
        db.add(item)
        db.flush()  # ottiene item.id senza chiudere la transazione

        for media in saved_files:
            db.add(
                models.ExchangeItemMedia(
                    item_id=item.id,
                    media_url=media["media_url"],
                    media_type=media["media_type"],
                )
            )
        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        _cleanup_saved_files(saved_files)
        raise

    return build_item_response(item, db)

@router.put("/{item_id}", response_model=ExchangeItemResponse)
def update_item(
    item_id: int,
    title: str = Form(...),
    description: str = Form(...),
    item_type: str = Form(...),
    category: str = Form(...),
    condition: str = Form("usato"),
    zone: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    _check_owner_or_moderator(item, current_user)

    if item_type not in ALLOWED_ITEM_TYPES:
        raise HTTPException(status_code=400, detail="item_type deve essere regalo o scambio")
    if condition not in ALLOWED_CONDITIONS:
        raise HTTPException(status_code=400, detail="condition non valida")

    real_files = [f for f in files if f and f.filename]
    if len(real_files) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=400, detail=f"Puoi caricare massimo {MAX_ATTACHMENTS} allegati"
        )

    # 1) Se l'utente ha caricato nuovi file, validali/salvali PRIMA di toccare
    #    il DB. Se uno e' invalido save_media_files solleva e ripulisce.
    saved_files: List[dict] = []
    if real_files:
        saved_files = save_media_files(real_files)

    # 2) Tieni traccia dei vecchi media URLs per ripulire il disco SOLO dopo
    #    che la transazione DB e' andata a buon fine.
    old_media_urls = [m.media_url for m in item.media] if real_files else []

    # 3) Applica le modifiche al DB in un'unica transazione. Se qualcosa va
    #    storto, rollback e cleanup dei nuovi file salvati.
    try:
        item.title = title.strip()
        item.description = description.strip()
        item.item_type = item_type
        item.category = category.strip()
        item.condition = condition
        item.zone = zone
        db.add(item)

        if real_files:
            db.query(models.ExchangeItemMedia).filter(
                models.ExchangeItemMedia.item_id == item.id
            ).delete()
            for media in saved_files:
                db.add(
                    models.ExchangeItemMedia(
                        item_id=item.id,
                        media_url=media["media_url"],
                        media_type=media["media_type"],
                    )
                )

        db.commit()
        db.refresh(item)
    except Exception:
        db.rollback()
        _cleanup_saved_files(saved_files)
        raise

    # 4) Successo: ora ripulisci i vecchi file dal disco
    for url in old_media_urls:
        try:
            p = Path(__file__).resolve().parents[2] / url.lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

    return build_item_response(item, db)

@router.patch("/{item_id}/status", response_model=ExchangeItemResponse)
def update_item_status(
    item_id: int,
    new_status: str = Query(..., description="available|reserved|taken"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if new_status not in ALLOWED_STATUSES:
        raise HTTPException(status_code=400, detail="Stato non valido")

    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    _check_owner_or_moderator(item, current_user)

    item.status = new_status
    if new_status == "taken" and item.completed_at is None:
        from datetime import datetime as _dt
        item.completed_at = _dt.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return build_item_response(item, db)

class ItemAcceptPayload(BaseModel):
    user_id: int

@router.post("/{item_id}/accept", response_model=ExchangeItemResponse)
def accept_item(
    item_id: int,
    payload: ItemAcceptPayload,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """L'owner sceglie il destinatario. Status -> 'reserved'."""
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    if item.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Solo chi ha pubblicato puo' accettare")
    if payload.user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Non puoi accettare te stesso")
    other = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not other:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    item.accepted_by_user_id = other.id
    if item.status == "available":
        item.status = "reserved"
    db.add(item)
    db.commit()
    db.refresh(item)
    return build_item_response(item, db)

class ItemCandidateOut(BaseModel):
    id: int
    full_name: str
    username: Optional[str] = None
    rating: Optional[float] = None
    rating_count: Optional[int] = None

@router.get("/{item_id}/candidates", response_model=List[ItemCandidateOut])
def list_item_candidates(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    auth.ensure_owner_or_moderator(item.user_id, current_user, detail="Non autorizzato")

    rooms = (db.query(models.ChatRoom)
             .filter(models.ChatRoom.item_id == item_id).all())
    other_ids = {r.participant1_id if r.participant2_id == item.user_id else r.participant2_id
                 for r in rooms}
    other_ids.discard(item.user_id)
    if not other_ids:
        return []
    users = db.query(models.User).filter(models.User.id.in_(other_ids)).all()
    return [ItemCandidateOut(
        id=u.id, full_name=u.full_name, username=u.username,
        rating=u.rating, rating_count=u.rating_count or 0,
    ) for u in users]

@router.post("/{item_id}/complete", response_model=ExchangeItemResponse)
def complete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Marca come 'taken'. Apre la possibilita' di lasciare review."""
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    if not item.accepted_by_user_id:
        raise HTTPException(status_code=400,
                            detail="Devi prima accettare un destinatario")
    if current_user.id not in {item.user_id, item.accepted_by_user_id}:
        raise HTTPException(status_code=403, detail="Non sei parte di questa transazione")

    item.status = "taken"
    if item.completed_at is None:
        from datetime import datetime as _dt
        item.completed_at = _dt.utcnow()
    db.add(item)
    db.commit()
    db.refresh(item)
    return build_item_response(item, db)

@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_item(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    item = db.query(models.ExchangeItem).filter(models.ExchangeItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Oggetto non trovato")
    _check_owner_or_moderator(item, current_user)

    _delete_media_files(item)
    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
