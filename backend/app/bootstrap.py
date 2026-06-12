"""
Bootstrap dei dati al primo avvio.

- Popola la tabella `site_settings` con i valori di `config.yaml`
  (solo per le chiavi mancanti: edit dell'admin > yaml).
- Se nel DB non esiste alcun utente admin, ne crea uno di default
  (`admin` / `administrator`). Idempotente: ai successivi boot non
  fa nulla.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.orm import Session

from . import models, auth
from .config import bootstrap_config

log = logging.getLogger(__name__)

# Credenziali del primo admin creato automaticamente. Sono volutamente
# triviali per sbloccare il primo accesso: l'admin DEVE cambiare la
# password dal pannello profilo subito dopo il login.
DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "ChangeMe123!"
DEFAULT_ADMIN_EMAIL = "admin@local"
DEFAULT_ADMIN_FULLNAME = "Administrator"

# Definizione delle chiavi gestite + tipo + se sono pubbliche.
# La forma "value" sul DB e' SEMPRE una stringa: per liste/dict
# serializziamo in JSON.
PUBLIC_KEYS = {
    "site_name",
    "site_description",
    "welcome_message",
    "logo_url",
    "favicon_url",
    "primary_color",
    "contact_email",
    "locale",
    "zones",
    "job_categories",
    "event_categories",
}

def _to_str(value: Any) -> str:
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False)
    if value is None:
        return ""
    return str(value)

def _set_if_missing(db: Session, key: str, value: Any, is_public: bool = True) -> None:
    existing = db.query(models.SiteSetting).filter(models.SiteSetting.key == key).first()
    if existing is not None:
        return
    db.add(models.SiteSetting(key=key, value=_to_str(value), is_public=is_public))

def seed_site_settings(db: Session) -> None:
    """Inserisce nel DB i default da config.yaml (solo per le chiavi mancanti)."""
    site = bootstrap_config.get("site", {}) or {}

    _set_if_missing(db, "site_name", site.get("name", "VicinatoVicino"))
    _set_if_missing(db, "site_description", site.get("description", ""))
    _set_if_missing(db, "welcome_message", site.get("welcome_message", ""))
    _set_if_missing(db, "logo_url", site.get("logo_url", ""))
    _set_if_missing(db, "favicon_url", site.get("favicon_url", ""))
    _set_if_missing(db, "primary_color", site.get("primary_color", "#3498db"))
    _set_if_missing(db, "contact_email", site.get("contact_email", ""))
    _set_if_missing(db, "locale", site.get("locale", "it"))

    _set_if_missing(db, "zones", bootstrap_config.get("zones", []))
    _set_if_missing(db, "job_categories", bootstrap_config.get("job_categories", []))
    _set_if_missing(db, "event_categories", bootstrap_config.get("event_categories", []))

    db.commit()

def bootstrap_default_admin(db: Session) -> None:
    """Se nel DB non esiste alcun admin, crea l'utente `admin` / `administrator`.

    Idempotente: dal momento in cui esiste almeno un admin, questa funzione
    non fa nulla, quindi anche se il primo admin viene rinominato/eliminato
    (purche' rimanga ALMENO un altro admin) non torna a comparire al boot.
    """
    has_admin = (db.query(models.User)
                 .filter(models.User.is_admin == True)  # noqa: E712
                 .first() is not None)
    if has_admin:
        return

    # Prima di creare, controlliamo se esiste gia' un utente con lo stesso
    # username o email: in tal caso lo promuoviamo, niente duplicati.
    from sqlalchemy import func as _f
    existing = (db.query(models.User)
                .filter(
                    (_f.lower(models.User.username) == DEFAULT_ADMIN_USERNAME) |
                    (_f.lower(models.User.email) == DEFAULT_ADMIN_EMAIL)
                ).first())
    if existing:
        existing.is_admin = True
        existing.is_moderator = True
        db.add(existing)
        db.commit()
        log.info("BOOTSTRAP: utente '%s' esistente promosso ad admin", existing.username)
        return

    admin = models.User(
        email=DEFAULT_ADMIN_EMAIL,
        username=DEFAULT_ADMIN_USERNAME,
        full_name=DEFAULT_ADMIN_FULLNAME,
        hashed_password=auth.get_password_hash(DEFAULT_ADMIN_PASSWORD),
        phone="",
        age=18,
        bio="Account amministratore creato automaticamente. Cambia la password!",
        skills="",
        zone="",
        rating=5.0,
        rating_count=0,
        is_active=True,
        is_admin=True,
        is_moderator=True,
    )
    db.add(admin)
    db.commit()
    log.warning(
        "BOOTSTRAP: creato admin di default username='%s' password='%s'. "
        "Cambia la password DOPO il primo login!",
        DEFAULT_ADMIN_USERNAME, DEFAULT_ADMIN_PASSWORD,
    )

def run_bootstrap(db: Session) -> None:
    seed_site_settings(db)
    bootstrap_default_admin(db)
