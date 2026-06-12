from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from pydantic import BaseModel, EmailStr, field_validator
import re
from datetime import timedelta

from .. import models, auth
from ..database import get_db

router = APIRouter(prefix="/users", tags=["users"])

# ==========================================================
# PYDANTIC MODELS
# ==========================================================

def _strip_html_basic(v: str) -> str:
    """Sanitizzazione minima: rimuove tag HTML e caratteri di controllo per
    prevenire stored XSS sui campi free-text che vengono renderizzati lato
    frontend tramite innerHTML.

    Defense in depth: il frontend deve comunque usare escapeHtml() su tutto
    il contenuto di provenienza utente. Questo validator e' la barriera lato
    server, in modo da pulire i dati persistiti.
    """
    if v is None:
        return ""
    # Rimuovi tag HTML/JS
    v = re.sub(r"<[^>]*>", "", v)
    # Rimuovi entity HTML pericolose (evita la concatenazione bypass)
    v = re.sub(r"&(?:#\w+|\w+);", " ", v)
    # Rimuovi caratteri di controllo non stampabili
    v = "".join(ch for ch in v if ch == "\n" or ch == "\t" or ord(ch) >= 32)
    return v.strip()

class UserCreate(BaseModel):
    email: EmailStr
    username: str
    full_name: str
    password: str
    phone: str
    age: int
    bio: str = ""
    skills: str = ""
    zone: str

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("La password deve essere di almeno 8 caratteri")
        if not re.search(r"[A-Z]", v):
            raise ValueError("La password deve contenere almeno una lettera maiuscola")
        if not re.search(r"[a-z]", v):
            raise ValueError("La password deve contenere almeno una lettera minuscola")
        if not re.search(r"\d", v):
            raise ValueError("La password deve contenere almeno un numero")
        return v

    @field_validator("phone")
    @classmethod
    def phone_format(cls, v):
        if not re.match(r'^\+?[0-9\s\-\(\)]{6,20}$', v):
            raise ValueError("Numero di telefono non valido")
        return v

    @field_validator("age")
    @classmethod
    def age_valid(cls, v):
        if v < 18:
            raise ValueError("Devi avere almeno 18 anni per registrarti")
        if v > 120:
            raise ValueError("Età non valida")
        return v

    @field_validator("full_name", "bio", "skills", "username", "zone")
    @classmethod
    def strip_html(cls, v):
        return _strip_html_basic(v) if v else v

class UserResponse(BaseModel):
    """Schema completo: include email e phone. Usato per l'utente loggato
    su /me, per la creazione e per gli endpoint admin. Non esporre via /users
    perche' contiene PII."""
    id: int
    email: str
    username: str
    full_name: str
    phone: str
    age: int
    bio: str
    skills: str
    zone: str
    rating: float
    rating_count: int = 0
    is_moderator: bool = False
    is_admin: bool = False

    class Config:
        from_attributes = True

class UserPublic(BaseModel):
    """Schema sicuro per la lista utenti pubblica: senza email ne' phone."""
    id: int
    username: str
    full_name: str
    age: int
    bio: str
    skills: str
    zone: str
    rating: float
    rating_count: int = 0
    is_moderator: bool = False
    is_admin: bool = False

    class Config:
        from_attributes = True

class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    age: Optional[int] = None
    bio: Optional[str] = None
    skills: Optional[str] = None
    zone: Optional[str] = None

    @field_validator("full_name", "bio", "skills", "zone")
    @classmethod
    def strip_html(cls, v):
        return _strip_html_basic(v) if v else v

    @field_validator("phone")
    @classmethod
    def phone_format(cls, v):
        if v is None:
            return v
        if not re.match(r'^\+?[0-9\s\-\(\)]{6,20}$', v):
            raise ValueError("Numero di telefono non valido")
        return v

    @field_validator("age")
    @classmethod
    def age_valid(cls, v):
        if v is None:
            return v
        if v < 18:
            raise ValueError("Devi avere almeno 18 anni")
        if v > 120:
            raise ValueError("Età non valida")
        return v

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if len(v) < 8:
            raise ValueError("La password deve essere di almeno 8 caratteri")
        if not re.search(r"[A-Z]", v):
            raise ValueError("La password deve contenere almeno una lettera maiuscola")
        if not re.search(r"[a-z]", v):
            raise ValueError("La password deve contenere almeno una lettera minuscola")
        if not re.search(r"\d", v):
            raise ValueError("La password deve contenere almeno un numero")
        return v

# ==========================================================
# ENDPOINTS (ORDINE CORRETTO!)
# ==========================================================

# ---------- REGISTER ----------
@router.post("/register", response_model=UserResponse)
def register(user: UserCreate, db: Session = Depends(get_db)):
    errors = {}

    # Normalizziamo email e username in lowercase: la registrazione e' la
    # fonte di verita', cosi' poi i confronti restano deterministici e
    # mariorossi == MarioRossi == mariorossi.
    norm_email = (user.email or "").strip().lower()
    norm_username = (user.username or "").strip().lower()

    # Email gia' registrata (confronto case-insensitive)
    if db.query(models.User).filter(func.lower(models.User.email) == norm_email).first():
        errors["email"] = "Email già registrata"

    # Username gia' registrato (confronto case-insensitive)
    if db.query(models.User).filter(func.lower(models.User.username) == norm_username).first():
        errors["username"] = "Username già in uso"

    if errors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=errors
        )

    hashed_password = auth.get_password_hash(user.password)

    db_user = models.User(
        email=norm_email,
        username=norm_username,
        full_name=user.full_name,
        hashed_password=hashed_password,
        phone=user.phone,
        age=user.age,
        bio=user.bio,
        skills=user.skills,
        zone=user.zone
    )

    try:
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
        print(f"✅ Nuovo utente registrato: {user.email}")
        return db_user

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail={"general": f"Errore interno: {str(e)}"}
        )

# ---------- LOGIN ----------
@router.post("/login", response_model=Token)
def login(login_data: UserLogin, db: Session = Depends(get_db)):

    # Confronto case-insensitive: chi si e' registrato come "Mario" puo'
    # loggarsi anche scrivendo "mario" o "MARIO".
    ident = (login_data.username or "").strip().lower()
    user = db.query(models.User).filter(
        (func.lower(models.User.email) == ident) |
        (func.lower(models.User.username) == ident)
    ).first()

    if not user or not auth.verify_password(login_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"general": "Credenziali non valide"},
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=auth.ACCESS_TOKEN_EXPIRE_MINUTES)

    access_token = auth.create_access_token(
        data={"sub": user.email},
        expires_delta=access_token_expires
    )

    user_data = UserResponse.model_validate(user)

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user_data
    }

# ---------- UTENTE CORRENTE ----------
@router.get("/me", response_model=UserResponse)
def read_users_me(current_user: models.User = Depends(auth.get_current_active_user)):
    return current_user

# ---------- AGGIORNA UTENTE CORRENTE ----------
@router.put("/me", response_model=UserResponse)
def update_user_me(
    update: UserUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    data = update.model_dump(exclude_unset=True)

    if "age" in data:
        if data["age"] is not None and (data["age"] < 18 or data["age"] > 120):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"age": "Età non valida"},
            )

    for field, value in data.items():
        setattr(current_user, field, value)

    db.add(current_user)
    db.commit()
    db.refresh(current_user)
    return current_user

# ---------- CAMBIO PASSWORD ----------
@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    if not auth.verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"current_password": "La password attuale non è corretta"},
        )

    if len(payload.new_password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"new_password": "La nuova password deve essere di almeno 8 caratteri"},
        )

    current_user.hashed_password = auth.get_password_hash(payload.new_password)
    db.add(current_user)
    db.commit()

    return {"detail": "Password aggiornata con successo"}

# ---------- ELIMINA ACCOUNT CORRENTE ----------
@router.delete("/me")
def delete_user_me(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    # elimina tutti i lavoretti dell'utente per evitare problemi di vincoli
    db.query(models.JobPost).filter(models.JobPost.user_id == current_user.id).delete()

    # elimina chat e messaggi associati all'utente (come mittente o partecipante)
    db.query(models.ChatMessage).filter(models.ChatMessage.sender_id == current_user.id).delete()
    db.query(models.ChatRoom).filter(
        (models.ChatRoom.participant1_id == current_user.id) |
        (models.ChatRoom.participant2_id == current_user.id)
    ).delete()

    # elimina annunci scambio/regalo dell'utente
    db.query(models.ExchangeItemMedia).filter(
        models.ExchangeItemMedia.item_id.in_(
            db.query(models.ExchangeItem.id).filter(models.ExchangeItem.user_id == current_user.id)
        )
    ).delete(synchronize_session=False)
    db.query(models.ExchangeItem).filter(models.ExchangeItem.user_id == current_user.id).delete()

    db.delete(current_user)
    db.commit()

    return {"detail": "Account eliminato con successo"}

# ---------- LISTA UTENTI ----------
from fastapi import Query

@router.get("/", response_model=List[UserPublic])
def get_users(
    skip: int = 0,
    limit: int = 100,
    search: str = Query(None, description="Testo ricerca"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Lista utenti: richiede autenticazione. Espone solo dati pubblici
    (no email, no telefono). Gli admin che vogliono il dettaglio possono
    usare /admin/users."""
    base_query = db.query(models.User)
    if search:
        search = f"%{search.lower()}%"
        base_query = base_query.filter(
            models.User.full_name.ilike(search) |
            models.User.username.ilike(search) |
            models.User.skills.ilike(search)
        )
    return base_query.offset(skip).limit(limit).all()

# ---------- UTENTE PER ID (SEMPRE ULTIMA!) ----------
@router.get("/{user_id}", response_model=UserPublic)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_active_user),
):
    """Profilo pubblico utente: richiede autenticazione, non espone PII.
    Gli admin che vogliono email/telefono usano /admin/users."""
    user = db.query(models.User).filter(models.User.id == user_id).first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail={"general": "Utente non trovato"}
        )

    return user