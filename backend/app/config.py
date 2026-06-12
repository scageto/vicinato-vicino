"""
Loader della configurazione di VicinatoVicino.

Due livelli, deliberatamente distinti:

1. **Settings (env / `.env`)** - segreti e parametri di deploy.
   Cambiarli richiede un riavvio del backend. Mai esporli al frontend.

2. **bootstrap_config (config.yaml)** - valori di default "di quartiere"
   (nome sito, logo, zone, categorie). Letti SOLO al primo avvio per
   popolare la tabella `site_settings`. Dopo il bootstrap, le modifiche
   si fanno dal pannello admin (DB), non da questo file.

Pensato per essere fork-friendly: chi vuole deployare l'app in un altro
quartiere modifica `.env` (segreti) e `config.yaml` (defaults) e basta.
"""

from __future__ import annotations

from pathlib import Path
from typing import List

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent  # backend/
CONFIG_YAML_PATH = BASE_DIR / "config.yaml"
ENV_PATH = BASE_DIR / ".env"

class Settings(BaseSettings):
    """Variabili d'ambiente. Caricate da `.env` se presente."""

    SECRET_KEY: str = "change-me-in-production"
    DATABASE_URL: str = f"sqlite:///{BASE_DIR.parent / 'vicinato.db'}"
    CORS_ORIGINS: str = "*"
    UPLOADS_DIR: str = str(BASE_DIR / "uploads")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7

    model_config = SettingsConfigDict(
        env_file=str(ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> List[str]:
        raw = (self.CORS_ORIGINS or "").strip()
        if not raw or raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

def load_bootstrap_config() -> dict:
    """Legge `config.yaml`. Ritorna {} se mancante (uso solo al boot)."""
    if not CONFIG_YAML_PATH.exists():
        return {}
    with open(CONFIG_YAML_PATH, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}

settings = Settings()
bootstrap_config = load_bootstrap_config()
