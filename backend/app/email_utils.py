"""
Utility per l'invio di email.

Configurazione via variabili d'ambiente (opzionali):
  SMTP_HOST         es. smtp.gmail.com
  SMTP_PORT         es. 587
  SMTP_USER         utente SMTP
  SMTP_PASSWORD     password SMTP
  SMTP_FROM         mittente (es. "VicinatoVicino <noreply@example.com>")
  SMTP_STARTTLS     "1" per abilitare STARTTLS (default: 1)
  APP_BASE_URL      base URL del frontend (es. https://example.com)

Se SMTP non è configurato l'email non viene davvero inviata: il contenuto
viene stampato a console (utile in sviluppo) e la funzione ritorna False.
"""

import os
import smtplib
import ssl
from email.message import EmailMessage

def _smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_PORT"))

def send_email(to_address: str, subject: str, body: str) -> bool:
    """Invia una email di testo semplice. Ritorna True se l'invio è riuscito."""
    if not _smtp_configured():
        # Fallback dev: stampa a console
        print("=" * 60)
        print(f"[EMAIL - SMTP non configurato]")
        print(f"To:      {to_address}")
        print(f"Subject: {subject}")
        print("-" * 60)
        print(body)
        print("=" * 60)
        return False

    host = os.getenv("SMTP_HOST")
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("SMTP_FROM") or user or "noreply@vicinato.local"
    use_starttls = os.getenv("SMTP_STARTTLS", "1") == "1"

    msg = EmailMessage()
    msg["From"] = sender
    msg["To"] = to_address
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        if port == 465:
            # SMTPS
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(host, port, context=context, timeout=10) as server:
                if user:
                    server.login(user, password or "")
                server.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.ehlo()
                if use_starttls:
                    context = ssl.create_default_context()
                    server.starttls(context=context)
                    server.ehlo()
                if user:
                    server.login(user, password or "")
                server.send_message(msg)
        return True
    except Exception as e:
        print(f"[EMAIL] Errore invio a {to_address}: {e}")
        return False

def build_reset_url(token: str, base_url: str | None = None) -> str:
    """Costruisce il link per il reset password."""
    base = (base_url or os.getenv("APP_BASE_URL") or "").rstrip("/")
    if not base:
        # fallback: link relativo, il frontend gestirà l'hash
        return f"/#reset-password?token={token}"
    return f"{base}/#reset-password?token={token}"
