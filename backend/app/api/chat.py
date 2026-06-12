from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel, field_validator
from datetime import datetime, timezone
import re

from .. import models, auth
from ..database import get_db

router = APIRouter(prefix="/chat", tags=["chat"])

# ==========================================================
# SECURITY AND CONTENT FILTERING
# ==========================================================

# Lista di parole inappropriate da filtrare (semplice esempio)
INAPPROPRIATE_WORDS = [
    'parolaccia1', 'parolaccia2', 'insulto1', 'insulto2'
    # In produzione aggiungere una lista più completa
]

# Pattern per rilevare contenuti potenzialmente pericolosi
DANGEROUS_PATTERNS = [
    r'<script[^>]*>.*?</script>',  # Script tags
    r'javascript:',                # JavaScript URLs
    r'on\w+\s*=',                 # Event handlers
]

def sanitize_content(content: str) -> str:
    """Pulisce il contenuto del messaggio per sicurezza"""
    # Converte HTML entities
    content = content.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    
    # Rimuove pattern pericolosi
    for pattern in DANGEROUS_PATTERNS:
        content = re.sub(pattern, '', content, flags=re.IGNORECASE | re.DOTALL)
    
    # Filtra parole inappropriate
    words = content.lower().split()
    filtered_words = []
    for word in words:
        if word not in INAPPROPRIATE_WORDS:
            filtered_words.append(word)
        else:
            filtered_words.append('***')  # Sostituisci con asterischi
    
    # Ricostruisci il contenuto preservando la formattazione originale
    result_words = []
    for i, original_word in enumerate(content.split()):
        if i < len(filtered_words):
            result_words.append(filtered_words[i])
        else:
            result_words.append(original_word)
    
    return ' '.join(result_words)

def check_message_frequency(user_id: int, db: Session) -> bool:
    """Verifica che l'utente non stia inviando troppi messaggi in poco tempo"""
    from datetime import datetime, timedelta
    
    # Conta messaggi inviati nell'ultimo minuto
    one_minute_ago = datetime.utcnow() - timedelta(minutes=1)
    recent_messages = db.query(models.ChatMessage).filter(
        models.ChatMessage.sender_id == user_id,
        models.ChatMessage.created_at >= one_minute_ago
    ).count()
    
    # Limita a 10 messaggi al minuto per utente
    return recent_messages < 10

# ==========================================================
# PYDANTIC MODELS
# ==========================================================

class ChatRoomCreate(BaseModel):
    job_post_id: Optional[int] = None
    item_id: Optional[int] = None
    participant2_id: int

class ChatRoomResponse(BaseModel):
    id: int
    job_post_id: Optional[int] = None
    item_id: Optional[int] = None
    participant1_id: int
    participant2_id: int
    created_at: datetime
    last_message_at: datetime
    is_active: bool
    
    # Informazioni aggiuntive
    participant1_name: Optional[str] = None
    participant2_name: Optional[str] = None
    job_title: Optional[str] = None
    unread_count: Optional[int] = 0

class MessageCreate(BaseModel):
    content: str
    message_type: str = "text"

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if len(v.strip()) == 0:
            raise ValueError("Il messaggio non può essere vuoto")
        if len(v) > 1000:
            raise ValueError("Il messaggio è troppo lungo (max 1000 caratteri)")
        return v.strip()

    @field_validator("message_type")
    @classmethod
    def validate_message_type(cls, v):
        allowed_types = ["text", "system", "job_request", "job_accept"]
        if v not in allowed_types:
            raise ValueError(f"Tipo messaggio non valido. Tipi permessi: {allowed_types}")
        return v

class MessageResponse(BaseModel):
    id: int
    chat_room_id: int
    sender_id: int
    content: str
    message_type: str
    is_read: bool
    created_at: datetime
    
    # Informazioni aggiuntive
    sender_name: Optional[str] = None
    is_own_message: Optional[bool] = False

class ChatListResponse(BaseModel):
    chat_rooms: List[ChatRoomResponse]
    total_count: int

# ==========================================================
# HELPER FUNCTIONS
# ==========================================================

def get_user_chat_rooms_for_user(db: Session, user_id: int):
    """Ottieni tutte le chat rooms di un utente"""
    return db.query(models.ChatRoom).filter(
        (models.ChatRoom.participant1_id == user_id) | 
        (models.ChatRoom.participant2_id == user_id)
    ).filter(models.ChatRoom.is_active == True).all()

def check_chat_permission(db: Session, chat_room_id: int, user_id: int):
    """Verifica che l'utente abbia accesso alla chat room"""
    chat_room = db.query(models.ChatRoom).filter(
        models.ChatRoom.id == chat_room_id,
        models.ChatRoom.is_active == True
    ).first()
    
    if not chat_room:
        raise HTTPException(status_code=404, detail="Chat room non trovata")
    
    if chat_room.participant1_id != user_id and chat_room.participant2_id != user_id:
        raise HTTPException(status_code=403, detail="Non hai accesso a questa chat")
    
    return chat_room

# ==========================================================
# API ENDPOINTS
# ==========================================================

@router.post("/rooms", response_model=ChatRoomResponse)
async def create_chat_room(
    room_data: ChatRoomCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Crea una nuova chat room"""
    
    # Verifica che il partecipante 2 esista
    participant2 = db.query(models.User).filter(models.User.id == room_data.participant2_id).first()
    if not participant2:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    
    # Cerca una chat esistente STRETTAMENTE legata allo stesso contesto:
    # stessi due utenti + stesso job_post_id + stesso item_id (entrambi
    # anche None). Cosi' ogni "interlocutore + lavoretto" e ogni
    # "interlocutore + oggetto" ha la propria chat distinta. Niente
    # fallback su chat con contesto diverso (era il comportamento vecchio,
    # provocava il riuso indebito quando uno stesso utente contattava
    # piu' annunci dello stesso owner).
    existing_chat = (
        db.query(models.ChatRoom)
        .filter(
            models.ChatRoom.participant1_id.in_([current_user.id, room_data.participant2_id]),
            models.ChatRoom.participant2_id.in_([current_user.id, room_data.participant2_id]),
            models.ChatRoom.is_active == True,
            models.ChatRoom.job_post_id == room_data.job_post_id,
            models.ChatRoom.item_id == room_data.item_id,
        )
        .first()
    )

    if existing_chat:
        # Conta messaggi non letti per questo utente
        unread_count = db.query(models.ChatMessage).filter(
            models.ChatMessage.chat_room_id == existing_chat.id,
            models.ChatMessage.sender_id != current_user.id,
            models.ChatMessage.is_read == False
        ).count()

        job_title = None
        if existing_chat.job_post_id:
            jp = db.query(models.JobPost).filter(models.JobPost.id == existing_chat.job_post_id).first()
            if jp:
                job_title = jp.title

        return ChatRoomResponse(
            id=existing_chat.id,
            job_post_id=existing_chat.job_post_id,
            participant1_id=existing_chat.participant1_id,
            participant2_id=existing_chat.participant2_id,
            created_at=existing_chat.created_at or datetime.now(timezone.utc),
            last_message_at=existing_chat.last_message_at or existing_chat.created_at or datetime.now(timezone.utc),
            is_active=existing_chat.is_active,
            participant1_name=existing_chat.participant1.full_name if existing_chat.participant1 else "Utente",
            participant2_name=existing_chat.participant2.full_name if existing_chat.participant2 else "Utente",
            job_title=job_title,
            unread_count=unread_count,
        )
    
    # Se specificato, verifica che il job post esista
    if room_data.job_post_id:
        job_post = db.query(models.JobPost).filter(models.JobPost.id == room_data.job_post_id).first()
        if not job_post:
            raise HTTPException(status_code=404, detail="Lavoretto non trovato")
    
    # Crea la chat room
    chat_room = models.ChatRoom(
        job_post_id=room_data.job_post_id,
        item_id=room_data.item_id,
        participant1_id=current_user.id,
        participant2_id=room_data.participant2_id
    )
    
    db.add(chat_room)
    db.commit()
    db.refresh(chat_room)
    
    # Aggiungi messaggio di sistema
    system_message = models.ChatMessage(
        chat_room_id=chat_room.id,
        sender_id=current_user.id,
        content=f"Chat creata da {current_user.full_name}",
        message_type="system"
    )
    db.add(system_message)
    db.commit()
    
    # Prepara risposta con informazioni aggiuntive
    response_data = {
        "id": chat_room.id,
        "job_post_id": chat_room.job_post_id,
        "participant1_id": chat_room.participant1_id,
        "participant2_id": chat_room.participant2_id,
        "created_at": chat_room.created_at,
        "last_message_at": chat_room.last_message_at,
        "is_active": chat_room.is_active,
        "participant1_name": current_user.full_name,
        "participant2_name": participant2.full_name,
        "job_title": None,
        "unread_count": 0
    }
    
    if chat_room.job_post_id:
        job_post = db.query(models.JobPost).filter(models.JobPost.id == chat_room.job_post_id).first()
        if job_post:
            response_data["job_title"] = job_post.title
    
    return ChatRoomResponse(**response_data)

@router.get("/rooms", response_model=ChatListResponse)
async def get_user_chat_rooms(
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Ottieni tutte le chat rooms dell'utente"""
    
    chat_rooms = get_user_chat_rooms_for_user(db, current_user.id)
    
    response_rooms = []
    for room in chat_rooms:
        # Conta messaggi non letti
        unread_count = db.query(models.ChatMessage).filter(
            models.ChatMessage.chat_room_id == room.id,
            models.ChatMessage.sender_id != current_user.id,
            models.ChatMessage.is_read == False
        ).count()
        
        job_title = None
        if room.job_post_id:
            job_post = db.query(models.JobPost).filter(models.JobPost.id == room.job_post_id).first()
            if job_post:
                job_title = job_post.title
        
        participant1_name = room.participant1.full_name if room.participant1 else "Utente eliminato"
        participant2_name = room.participant2.full_name if room.participant2 else "Utente eliminato"

        response_data = {
            "id": room.id,
            "job_post_id": room.job_post_id,
            "participant1_id": room.participant1_id,
            "participant2_id": room.participant2_id,
            "created_at": room.created_at or datetime.now(timezone.utc),
            "last_message_at": room.last_message_at or room.created_at or datetime.now(timezone.utc),
            "is_active": room.is_active,
            "participant1_name": participant1_name,
            "participant2_name": participant2_name,
            "job_title": job_title,
            "unread_count": unread_count
        }
        
        response_rooms.append(ChatRoomResponse(**response_data))

    # Chat più recenti in cima
    response_rooms.sort(
        key=lambda r: r.last_message_at or r.created_at or datetime.now(timezone.utc),
        reverse=True,
    )
    
    return ChatListResponse(
        chat_rooms=response_rooms,
        total_count=len(response_rooms)
    )

@router.get("/rooms/{room_id}/messages", response_model=List[MessageResponse])
async def get_chat_messages(
    room_id: int,
    limit: int = 50,
    offset: int = 0,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Ottieni i messaggi di una chat room"""

    # Verifica permessi (solleva 403 se non autorizzato)
    check_chat_permission(db, room_id, current_user.id)

    # Ottieni messaggi
    messages = db.query(models.ChatMessage).filter(
        models.ChatMessage.chat_room_id == room_id
    ).order_by(models.ChatMessage.created_at.desc()).offset(offset).limit(limit).all()
    
    # Marca come letti i messaggi degli altri
    db.query(models.ChatMessage).filter(
        models.ChatMessage.chat_room_id == room_id,
        models.ChatMessage.sender_id != current_user.id,
        models.ChatMessage.is_read == False
    ).update({"is_read": True})
    db.commit()
    
    # Prepara risposta
    response_messages = []
    for message in reversed(messages):  # Inverti per ordine cronologico
        response_data = {
            "id": message.id,
            "chat_room_id": message.chat_room_id,
            "sender_id": message.sender_id,
            "content": message.content,
            "message_type": message.message_type,
            "is_read": message.is_read,
            "created_at": message.created_at,
            "sender_name": message.sender.full_name if message.sender else "Utente eliminato",
            "is_own_message": message.sender_id == current_user.id
        }
        response_messages.append(MessageResponse(**response_data))
    
    return response_messages

@router.post("/rooms/{room_id}/messages", response_model=MessageResponse)
async def send_message(
    room_id: int,
    message_data: MessageCreate,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Invia un messaggio in una chat room"""
    
    # Verifica permessi
    chat_room = check_chat_permission(db, room_id, current_user.id)
    
    # Verifica frequenza messaggi (anti-spam)
    if not check_message_frequency(current_user.id, db):
        raise HTTPException(
            status_code=429, 
            detail="Stai inviando troppi messaggi. Aspetta un momento prima di scrivere di nuovo."
        )
    
    # Pulisci e valida il contenuto
    sanitized_content = sanitize_content(message_data.content)
    
    # Verifica che dopo la pulizia ci sia ancora contenuto
    if len(sanitized_content.strip()) == 0:
        raise HTTPException(
            status_code=400, 
            detail="Il messaggio contiene solo contenuti non validi."
        )
    
    # Verifica lunghezza dopo pulizia
    if len(sanitized_content) > 1000:
        raise HTTPException(
            status_code=400, 
            detail="Il messaggio è troppo lungo dopo la pulizia (max 1000 caratteri)."
        )
    
    # Crea il messaggio con contenuto pulito
    message = models.ChatMessage(
        chat_room_id=room_id,
        sender_id=current_user.id,
        content=sanitized_content,
        message_type=message_data.message_type
    )
    
    db.add(message)
    
    # Aggiorna timestamp della chat room
    chat_room.last_message_at = datetime.utcnow()
    
    db.commit()
    db.refresh(message)
    
    # Prepara risposta
    response_data = {
        "id": message.id,
        "chat_room_id": message.chat_room_id,
        "sender_id": message.sender_id,
        "content": message.content,
        "message_type": message.message_type,
        "is_read": message.is_read,
        "created_at": message.created_at,
        "sender_name": message.sender.full_name if message.sender else (current_user.full_name or "Utente"),
        "is_own_message": True
    }
    
    return MessageResponse(**response_data)

@router.put("/rooms/{room_id}/read")
async def mark_messages_as_read(
    room_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Marca tutti i messaggi come letti"""

    # Verifica permessi (solleva 403 se non autorizzato)
    check_chat_permission(db, room_id, current_user.id)

    # Marca come letti i messaggi degli altri
    updated_count = db.query(models.ChatMessage).filter(
        models.ChatMessage.chat_room_id == room_id,
        models.ChatMessage.sender_id != current_user.id,
        models.ChatMessage.is_read == False
    ).update({"is_read": True})
    
    db.commit()
    
    return {"message": f"{updated_count} messaggi marcati come letti"}

@router.delete("/rooms/{room_id}")
async def leave_chat_room(
    room_id: int,
    current_user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db)
):
    """Lascia una chat room (la disattiva)"""
    
    # Verifica permessi
    chat_room = check_chat_permission(db, room_id, current_user.id)
    
    # Aggiungi messaggio di sistema
    system_message = models.ChatMessage(
        chat_room_id=room_id,
        sender_id=current_user.id,
        content=f"{current_user.full_name} ha lasciato la chat",
        message_type="system"
    )
    db.add(system_message)
    
    # Disattiva la chat room
    chat_room.is_active = False
    chat_room.last_message_at = datetime.utcnow()
    
    db.commit()
    
    return {"message": "Chat room lasciata con successo"}
