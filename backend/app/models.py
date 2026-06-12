from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    username = Column(String, unique=True, index=True)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)
    phone = Column(String)
    age = Column(Integer)
    bio = Column(Text, default="")
    skills = Column(Text, default="")  # CSV: "giardinaggio,elettricista"
    zone = Column(String)  # Zona del quartiere
    rating = Column(Float, default=5.0)        # media delle review ricevute
    rating_count = Column(Integer, default=0)  # numero review ricevute
    is_moderator = Column(Boolean, default=False)
    is_admin = Column(Boolean, default=False)
    is_banned = Column(Boolean, default=False)
    ban_reason = Column(String)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relazioni — sui modelli con piu' FK verso users (es. JobPost ha sia
    # user_id sia accepted_by_user_id) bisogna esplicitare quale colonna
    # rappresenta l'owner, altrimenti SQLAlchemy non sa quale join usare.
    job_posts = relationship(
        "JobPost",
        back_populates="owner",
        foreign_keys="JobPost.user_id",
    )
    events = relationship("Event", back_populates="organizer")

class JobPost(Base):
    __tablename__ = "job_posts"

    id = Column(Integer, primary_key=True, index=True)

    # Info base
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    category = Column(String, nullable=False)  # giardinaggio, elettricista, babysitting, etc.

    # Offerta o richiesta
    is_offer = Column(Boolean, default=True)  # True = offro lavoro, False = cerco aiuto

    # Compenso
    price_type = Column(String, default="gratis")  # gratis, fisso, orario, scambio
    price_amount = Column(Float)  # importo numerico
    price_currency = Column(String, default="EUR")
    price_note = Column(String)  # es: "trattabile", "rimborso spese"

    # Luogo
    location_zone = Column(String)  # macro-zona (Nord, Sud, Centro, Parco)
    location_details = Column(String)  # indirizzo o riferimento più preciso
    is_remote = Column(Boolean, default=False)  # se può essere fatto da remoto
    at_client_home = Column(Boolean, default=False)  # se si svolge a casa del richiedente

    # Tempistiche e disponibilità
    time_type = Column(String, default="una_tantum")  # una_tantum, ricorrente
    estimated_hours = Column(Float)  # durata stimata
    preferred_days = Column(String)  # CSV: "lun,mar,mer"
    preferred_time_slots = Column(String)  # CSV: "mattina,pomeriggio,sera"
    available_from = Column(DateTime(timezone=True))
    available_until = Column(DateTime(timezone=True))
    urgency = Column(String, default="normale")  # urgente, normale, quando_si_puo

    # Contatto
    allow_contact_phone = Column(Boolean, default=True)
    allow_contact_chat = Column(Boolean, default=True)
    extra_contact_info = Column(String)  # info aggiuntive (es. solo WhatsApp)

    # Altro
    required_skills = Column(String)  # competenze richieste, CSV
    notes = Column(Text)  # note aggiuntive
    photo_url = Column(String)  # URL o path foto luogo/oggetto

    # Stato
    status = Column(String, default="open")  # open, in_progress, completed, cancelled

    # Relazioni
    user_id = Column(Integer, ForeignKey("users.id"))
    # L'utente "controparte": chi ha preso/eseguito il lavoretto.
    # Settato quando l'owner accetta esplicitamente una richiesta. Necessario
    # per sapere chi ha diritto di lasciare review a chi.
    accepted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    owner = relationship("User", back_populates="job_posts", foreign_keys=[user_id])
    accepted_by = relationship("User", foreign_keys=[accepted_by_user_id])
    media = relationship("JobPostMedia", back_populates="job_post", cascade="all, delete-orphan")

class JobPostMedia(Base):
    __tablename__ = "job_post_media"

    id = Column(Integer, primary_key=True, index=True)
    job_post_id = Column(Integer, ForeignKey("job_posts.id"), nullable=False)
    media_url = Column(String, nullable=False)
    media_type = Column(String, nullable=False)  # image | video
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    job_post = relationship("JobPost", back_populates="media")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    date = Column(DateTime(timezone=True), nullable=False)             # inizio
    end_date = Column(DateTime(timezone=True))                          # fine (facoltativa)
    location = Column(String, nullable=False)
    location_zone = Column(String)                                      # zona del quartiere
    category = Column(String)  # festa, mercatino, corso, pulizia, altro
    image_url = Column(String)                                          # foto evento (facoltativa, copertina)
    organizer_id = Column(Integer, ForeignKey("users.id"))
    max_participants = Column(Integer)
    status = Column(String, default="open")  # open, cancelled, full
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    organizer = relationship("User", back_populates="events")
    participants = relationship(
        "EventParticipant",
        back_populates="event",
        cascade="all, delete-orphan",
    )

class EventParticipant(Base):
    __tablename__ = "event_participants"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    event = relationship("Event", back_populates="participants")
    user = relationship("User")

class FreeItem(Base):
    __tablename__ = "free_items"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    condition = Column(String)  # nuovo, usato, da riparare
    category = Column(String)  # mobili, elettrodomestici, libri, etc.
    status = Column(String, default="available")  # available, reserved, taken
    user_id = Column(Integer, ForeignKey("users.id"))
    location = Column(String)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class ExchangeItem(Base):
    __tablename__ = "exchange_items"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    item_type = Column(String, nullable=False, default="regalo")  # regalo | scambio
    category = Column(String, nullable=False)
    condition = Column(String, default="usato")
    zone = Column(String)
    status = Column(String, default="available")  # available, reserved, taken
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # Chi ha effettivamente ricevuto/scambiato l'oggetto (settato quando
    # l'owner conferma la cessione). Serve per il sistema review.
    accepted_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    media = relationship("ExchangeItemMedia", back_populates="item", cascade="all, delete-orphan")
    accepted_by = relationship("User", foreign_keys=[accepted_by_user_id])

class ExchangeItemMedia(Base):
    __tablename__ = "exchange_item_media"

    id = Column(Integer, primary_key=True, index=True)
    item_id = Column(Integer, ForeignKey("exchange_items.id"), nullable=False)
    media_url = Column(String, nullable=False)
    media_type = Column(String, nullable=False)  # image | video
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    item = relationship("ExchangeItem", back_populates="media")

# ======================================================
# CHAT MODELS
# ======================================================

class ChatRoom(Base):
    __tablename__ = "chat_rooms"
    
    id = Column(Integer, primary_key=True, index=True)
    job_post_id = Column(Integer, ForeignKey("job_posts.id"), nullable=True)  # Associato a un lavoretto
    item_id = Column(Integer, ForeignKey("exchange_items.id"), nullable=True)  # Associato a un oggetto
    participant1_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Utente 1
    participant2_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Utente 2
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_message_at = Column(DateTime(timezone=True), server_default=func.now())
    is_active = Column(Boolean, default=True)
    
    # Relazioni
    job_post = relationship("JobPost")
    participant1 = relationship("User", foreign_keys=[participant1_id])
    participant2 = relationship("User", foreign_keys=[participant2_id])
    messages = relationship("ChatMessage", back_populates="chat_room", cascade="all, delete-orphan")

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    chat_room_id = Column(Integer, ForeignKey("chat_rooms.id"), nullable=False)
    sender_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    message_type = Column(String, default="text")  # text, system, job_request, job_accept
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relazioni
    chat_room = relationship("ChatRoom", back_populates="messages")
    sender = relationship("User")

# ======================================================
# SITE SETTINGS / MODERATION MODELS
# ======================================================

class SiteSetting(Base):
    """Config dinamica del sito (key/value).

    Editabile dal pannello admin. Popolata al primo boot da config.yaml.
    Le chiavi pubbliche (name, description, logo_url, ...) sono leggibili
    da chiunque tramite GET /site/settings; tutte le altre solo da admin.
    """
    __tablename__ = "site_settings"

    key = Column(String, primary_key=True, index=True)
    value = Column(Text)
    is_public = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

class Report(Base):
    """Segnalazione di un contenuto o di un utente da parte di un utente."""
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String, nullable=False)  # user | job | item | event | chat_message
    target_id = Column(Integer, nullable=False)
    reason = Column(String, nullable=False)       # spam, abuso, contenuto_inappropriato, altro
    description = Column(Text)
    status = Column(String, default="open")       # open, reviewing, resolved, dismissed
    resolution_note = Column(Text)
    resolved_by_id = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True))

    reporter = relationship("User", foreign_keys=[reporter_id])
    resolved_by = relationship("User", foreign_keys=[resolved_by_id])

class AuditLog(Base):
    """Traccia delle azioni di moderazione (chi ha fatto cosa)."""
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, index=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    action = Column(String, nullable=False)     # delete_job, ban_user, update_settings, ...
    target_type = Column(String)
    target_id = Column(Integer)
    note = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    actor = relationship("User")

class Review(Base):
    """Recensione bidirezionale tra utenti dopo una transazione completata.

    Vincoli applicativi (vedi api/reviews.py):
    - rater_id != ratee_id (non si recensisce se stesso)
    - target deve essere completed (job) o taken (item)
    - rater e ratee devono essere le due parti della transazione
    - una sola review per coppia (rater, ratee, target_type, target_id)
    - editabile/eliminabile dal rater entro 30 giorni; sempre dagli admin
    """
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, index=True)
    rater_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    ratee_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_type = Column(String, nullable=False)   # job | item
    target_id = Column(Integer, nullable=False)
    score = Column(Integer, nullable=False)        # 1..5
    comment = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("rater_id", "ratee_id", "target_type", "target_id",
                         name="uq_review_per_target"),
    )

    rater = relationship("User", foreign_keys=[rater_id])
    ratee = relationship("User", foreign_keys=[ratee_id])
