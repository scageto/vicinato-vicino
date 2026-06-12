from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import func
from sqlalchemy.orm import Session
from . import models
from .config import settings
from .database import get_db

# Configurazione (i segreti vivono in .env, non nel codice)
SECRET_KEY = settings.SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = settings.ACCESS_TOKEN_EXPIRE_MINUTES

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/users/login")
# Variante che NON solleva 401 se il token manca: utile per endpoint
# pubblici che vogliono "personalizzare" la risposta quando l'utente e'
# loggato (es. is_participating su un evento) ma non richiedono auth.
oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/users/login", auto_error=False)

def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password):
    return pwd_context.hash(password)

def authenticate_user(db: Session, username: str, password: str):
    # Cerca per email o username, case-insensitive (allineato a /users/login)
    ident = (username or "").strip().lower()
    user = db.query(models.User).filter(
        (func.lower(models.User.email) == ident) |
        (func.lower(models.User.username) == ident)
    ).first()

    if not user:
        return False
    if not verify_password(password, user.hashed_password):
        return False
    return user

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(
    token: str = Depends(oauth2_scheme), 
    db: Session = Depends(get_db)
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Credenziali non valide",
        headers={"WWW-Auticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
    
    user = db.query(models.User).filter(
        func.lower(models.User.email) == (email or "").lower()
    ).first()
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(current_user: models.User = Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Utente disattivato")
    if getattr(current_user, "is_banned", False):
        raise HTTPException(status_code=403, detail="Account sospeso")
    return current_user

async def require_moderator(current_user: models.User = Depends(get_current_active_user)):
    if not (current_user.is_moderator or current_user.is_admin):
        raise HTTPException(status_code=403, detail="Permessi di moderazione richiesti")
    return current_user

async def require_admin(current_user: models.User = Depends(get_current_active_user)):
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Permessi di amministrazione richiesti")
    return current_user

def ensure_owner_or_moderator(owner_id: int, current_user: models.User,
                              detail="Non hai i permessi necessari") -> None:
    """Solleva 403 se current_user non e' il proprietario ne' un moderatore.

    `detail` puo' essere una stringa o un dict (es. {"general": "..."}):
    viene passato cosi' com'e' a HTTPException, per non alterare il formato
    di errore atteso dai vari endpoint.
    """
    if owner_id != current_user.id and not current_user.is_moderator:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)

async def get_current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
):
    """Ritorna l'utente se il token e' valido, None altrimenti.
    Non solleva 401: e' pensato per endpoint "leggibili anche da non loggati"
    che vogliono enrichire la risposta quando un utente e' presente."""
    if not token:
        return None
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email = payload.get("sub")
        if not email:
            return None
    except JWTError:
        return None
    user = db.query(models.User).filter(
        func.lower(models.User.email) == (email or "").lower()
    ).first()
    return user
