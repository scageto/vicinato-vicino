"""
Helper condivisi per il salvataggio di immagini/video allegati agli annunci
(items / jobs). Compressione Pillow per le immagini e tetti di dimensione per
i video, in modo da preservare lo spazio sul Raspberry.

Importato da:
    - app/api/items.py
    - app/api/jobs.py
"""

from io import BytesIO
from pathlib import Path
from typing import List
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status
from PIL import Image, ImageOps, UnidentifiedImageError

# Limiti / parametri di compressione
MAX_ATTACHMENTS = 3
MAX_IMAGE_BYTES = 8 * 1024 * 1024     # 8 MB grezzi
MAX_VIDEO_BYTES = 12 * 1024 * 1024    # 12 MB grezzi
MAX_IMAGE_DIMENSION = 1280            # px sul lato lungo dopo resize
JPEG_QUALITY = 80
ALLOWED_VIDEO_EXTS = {".mp4", ".webm", ".mov", ".m4v"}

def compress_image(raw_bytes: bytes, original_name: str) -> tuple[bytes, str]:
    """
    Comprime un'immagine. Ritorna (bytes_compressi, estensione_file).
    """
    try:
        img = Image.open(BytesIO(raw_bytes))
    except (UnidentifiedImageError, OSError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Impossibile leggere l'immagine: {original_name}",
        )

    img = ImageOps.exif_transpose(img)
    img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)

    output = BytesIO()
    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)

    if has_alpha:
        if img.mode != "RGBA":
            img = img.convert("RGBA")
        img.save(output, format="PNG", optimize=True)
        return output.getvalue(), ".png"

    if img.mode != "RGB":
        img = img.convert("RGB")
    img.save(output, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
    return output.getvalue(), ".jpg"

def cleanup_saved_files(saved: List[dict], project_root: Path) -> None:
    """Cancella dal disco i file scritti nello stesso ciclo (best-effort)."""
    for s in saved:
        try:
            p = project_root / s["media_url"].lstrip("/")
            if p.exists():
                p.unlink()
        except Exception:
            pass

def save_uploaded_media(
    files: List[UploadFile],
    upload_root: Path,
    url_prefix: str,
    project_root: Path,
) -> List[dict]:
    """
    Salva su disco un set di allegati (immagini compresse / video con cap).

    Atomico: se anche un solo file e' invalido i file gia' scritti vengono
    rimossi prima di rilanciare l'eccezione.

    Argomenti:
      files        - lista di UploadFile da FastAPI
      upload_root  - directory di destinazione (es. backend/uploads/items)
      url_prefix   - prefisso URL pubblico (es. "/uploads/items")
      project_root - directory base usata per ricostruire i path al cleanup
    """
    saved: List[dict] = []

    real_files = [f for f in files if f and f.filename]
    if len(real_files) > MAX_ATTACHMENTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Puoi caricare massimo {MAX_ATTACHMENTS} allegati",
        )

    upload_root.mkdir(parents=True, exist_ok=True)
    url_prefix = url_prefix.rstrip("/")

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
                            f"(max {MAX_IMAGE_BYTES // (1024 * 1024)}MB)."
                        ),
                    )
                compressed, ext = compress_image(raw, file.filename)
                file_name = f"{uuid4().hex}{ext}"
                (upload_root / file_name).write_bytes(compressed)
                saved.append({
                    "media_url": f"{url_prefix}/{file_name}",
                    "media_type": "image",
                })

            elif content_type.startswith("video/"):
                raw = file.file.read()
                if len(raw) > MAX_VIDEO_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=(
                            f"Video '{file.filename}' troppo grande "
                            f"(max {MAX_VIDEO_BYTES // (1024 * 1024)}MB)."
                        ),
                    )
                ext = Path(file.filename).suffix.lower() or ".mp4"
                if ext not in ALLOWED_VIDEO_EXTS:
                    ext = ".mp4"
                file_name = f"{uuid4().hex}{ext}"
                (upload_root / file_name).write_bytes(raw)
                saved.append({
                    "media_url": f"{url_prefix}/{file_name}",
                    "media_type": "video",
                })

            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Formato non supportato per '{file.filename}'. "
                        "Sono ammessi solo immagini o video."
                    ),
                )
    except Exception:
        cleanup_saved_files(saved, project_root)
        raise

    return saved
