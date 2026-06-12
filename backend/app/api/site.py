"""
Endpoint pubblici relativi alla configurazione del sito.

Espone le sole settings marcate `is_public=True`. Chiamato dal frontend
in fase di boot per leggere nome del sito, descrizione, logo, colore,
zone e categorie da mostrare nei form.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/site", tags=["site"])

# Chiavi che vanno deserializzate da JSON (le altre sono stringhe).
_JSON_KEYS = {"zones", "job_categories", "event_categories"}

def _decode(key: str, raw: str | None):
    if raw is None:
        return None
    if key in _JSON_KEYS:
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return []
    return raw

@router.get("/settings")
def get_public_settings(db: Session = Depends(get_db)):
    rows = db.query(models.SiteSetting).filter(models.SiteSetting.is_public == True).all()  # noqa: E712
    return {row.key: _decode(row.key, row.value) for row in rows}
