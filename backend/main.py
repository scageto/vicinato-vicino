from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
import os

from app.config import settings
from app.database import engine, Base, SessionLocal
from app.api import users, jobs, chat, items, events, site, moderation, reviews
from app.migrations import apply_migrations
from app.bootstrap import run_bootstrap
from app import auth, models

# Migrazioni mini (ALTER TABLE su colonne mancanti) PRIMA di create_all,
# cosi' eventuali tabelle esistenti vengono allineate al modello attuale.
apply_migrations(engine)

# Crea tutte le tabelle (le nuove come event_participants, job_post_media,
# exchange_item_media, site_settings, reports, audit_log).
Base.metadata.create_all(bind=engine)

# Bootstrap iniziale (idempotente): popola site_settings dai default in
# config.yaml e promuove l'eventuale ADMIN_BOOTSTRAP_EMAIL.
with SessionLocal() as _db:
    run_bootstrap(_db)

app = FastAPI(
    title="VicinatoVicino API",
    description="Piattaforma di quartiere",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers principali
app.include_router(users.router)
app.include_router(jobs.router)
app.include_router(chat.router)
app.include_router(items.router)
app.include_router(events.router)
app.include_router(site.router)
app.include_router(reviews.router)

# Routers di moderazione/amministrazione
app.include_router(moderation.reports_router)
app.include_router(moderation.moderation_router)
app.include_router(moderation.admin_router)

uploads_dir = settings.UPLOADS_DIR
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

@app.get("/")
def read_root():
    return {"message": "Benvenuto su VicinatoVicino!", "status": "operativo"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.get("/test-db")
def test_db(current_user: models.User = Depends(auth.require_admin)):
    """Diagnostica del database. Solo admin: la lista delle tabelle e' un
    information-disclosure utile a un attaccante per pianificare SQL injection."""
    try:
        with engine.connect() as conn:
            result = conn.execute(text("SELECT 1"))
            result.fetchone()
        return {
            "database": "connected",
            "status": "healthy",
            "tables": get_table_count()
        }
    except Exception as e:
        return {"database": "error", "status": "unhealthy", "error": str(e)}

def get_table_count():
    try:
        from sqlalchemy import inspect
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        return {"count": len(tables), "names": tables}
    except Exception:
        return {"count": 0, "names": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
