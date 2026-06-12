"""
Mini migrazioni "ALTER TABLE" idempotenti.

SQLAlchemy `Base.metadata.create_all()` crea solo le tabelle mancanti, NON
aggiunge colonne nuove a tabelle esistenti. Quando estendiamo un modello in
produzione (es. `Event` ha guadagnato `end_date`, `location_zone`,
`image_url`, `status`) il DB esistente continua ad avere lo schema vecchio
e ogni query col campo nuovo va in 500.

Questo modulo aggiunge le colonne mancanti senza rompere nulla:
 - inspect() per leggere lo schema reale
 - se manca una colonna del modello, `ALTER TABLE ... ADD COLUMN ...`
 - sicuro su SQLite (sintassi limitata ma supportata) e su MySQL
 - idempotente: rieseguibile mille volte senza effetti collaterali

Importato e chiamato da main.py prima di Base.metadata.create_all().
"""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

log = logging.getLogger(__name__)

# Colonne che vogliamo siano presenti su ciascuna tabella, con il loro tipo
# SQL. Aggiungere qui in caso di evoluzioni future del modello.
EXPECTED_COLUMNS: dict[str, dict[str, str]] = {
    "events": {
        "end_date":       "DATETIME",
        "location_zone":  "VARCHAR",
        "image_url":      "VARCHAR",
        "status":         "VARCHAR DEFAULT 'open'",
    },
    "users": {
        "is_admin":     "BOOLEAN DEFAULT 0",
        "is_banned":    "BOOLEAN DEFAULT 0",
        "ban_reason":   "VARCHAR",
        "rating_count": "INTEGER DEFAULT 0",
    },
    "job_posts": {
        "accepted_by_user_id": "INTEGER",
        "completed_at":        "DATETIME",
    },
    "exchange_items": {
        "accepted_by_user_id": "INTEGER",
        "completed_at":        "DATETIME",
    },
    "chat_rooms": {
        "item_id": "INTEGER",
    },
    # Anche se job_post_media / exchange_item_media / event_participants sono
    # tabelle nuove (gestite da create_all), elenchiamo qui eventuali
    # colonne aggiunte in futuro.
}

def _add_column_if_missing(conn, table: str, column: str, ddl_type: str) -> bool:
    inspector = inspect(conn)
    if table not in inspector.get_table_names():
        # tabella non ancora esistente: ci pensera' create_all() dopo
        return False
    cols = {c["name"] for c in inspector.get_columns(table)}
    if column in cols:
        return False
    sql = f'ALTER TABLE "{table}" ADD COLUMN "{column}" {ddl_type}'
    log.info("MIGRATION: %s", sql)
    conn.execute(text(sql))
    return True

def apply_migrations(engine: Engine) -> None:
    """Applica tutte le migrazioni in modo idempotente."""
    added = 0
    with engine.begin() as conn:
        for table, columns in EXPECTED_COLUMNS.items():
            for col, ddl in columns.items():
                if _add_column_if_missing(conn, table, col, ddl):
                    added += 1
    if added:
        log.info("MIGRATION: aggiunte %d colonne", added)
    else:
        log.info("MIGRATION: schema gia' aggiornato, nulla da fare")
