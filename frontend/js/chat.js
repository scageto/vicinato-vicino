// =====================================================
// CHAT SERVICE
// =====================================================

/** Legge il body: se è HTML (es. index.html da Nginx) evita JSON.parse e messaggio criptico */
async function parseChatResponse(response) {
    const text = await response.text();
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("<")) {
        throw new Error(
            "Il server ha risposto con una pagina HTML invece che con JSON. " +
                "Aggiungi «chat» al proxy Nginx verso FastAPI (es. location ~ ^/(users|jobs|chat|...))."
        );
    }
    try {
        return JSON.parse(trimmed);
    } catch (e) {
        throw new Error("Risposta non valida dal server: " + e.message);
    }
}

function chatApiErrorMessage(data, fallback) {
    if (!data || data.detail === undefined) return fallback;
    const d = data.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
        return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    }
    if (typeof d === "object") {
        return Object.entries(d)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ");
    }
    return fallback;
}

class ChatService {
    constructor() {
        this.currentChatRoom = null;
        this.chatRooms = [];
        this.unreadCount = 0;
        this.pollingInterval = null;
        this.typingTimeout = null;
    }

    // Crea una nuova chat room.
    // - jobPostId: id del lavoretto contesto (null se chat generica)
    // - participant2Id: utente con cui parlare
    // - itemId (opzionale): id dell'oggetto scambio/regalo contesto.
    //   Serve perche' la lista candidati di /items/{id}/candidates
    //   filtra le chat per item_id; senza, l'owner non vede chi
    //   l'ha contattato per quell'oggetto.
    async createChatRoom(jobPostId, participant2Id, itemId = null) {
        try {
            const response = await fetch(getApiUrl('/chat/rooms'), {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    job_post_id: jobPostId,
                    item_id: itemId,
                    participant2_id: participant2Id
                })
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore creazione chat"));
            }

            return { success: true, data };
        } catch (error) {
            console.error('Create chat room error:', error);
            return { success: false, error: error.message };
        }
    }

    // Ottieni tutte le chat dell'utente
    async getUserChatRooms() {
        try {
            const response = await fetch(getApiUrl('/chat/rooms'), {
                method: 'GET',
                headers: authHeaders()
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore caricamento chat"));
            }

            this.chatRooms = data.chat_rooms;
            this.updateUnreadCount();
            
            return { success: true, data };
        } catch (error) {
            console.error('Get chat rooms error:', error);
            return { success: false, error: error.message };
        }
    }

    // Ottieni i messaggi di una chat room
    async getChatMessages(roomId, limit = 50, offset = 0) {
        try {
            const response = await fetch(getApiUrl(`/chat/rooms/${roomId}/messages?limit=${limit}&offset=${offset}`), {
                method: 'GET',
                headers: authHeaders()
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore caricamento messaggi"));
            }

            return { success: true, data };
        } catch (error) {
            console.error('Get chat messages error:', error);
            return { success: false, error: error.message };
        }
    }

    // Invia un messaggio
    async sendMessage(roomId, content, messageType = 'text') {
        try {
            const response = await fetch(getApiUrl(`/chat/rooms/${roomId}/messages`), {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    content: content,
                    message_type: messageType
                })
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore invio messaggio"));
            }

            return { success: true, data };
        } catch (error) {
            console.error('Send message error:', error);
            return { success: false, error: error.message };
        }
    }

    // Marca messaggi come letti
    async markMessagesAsRead(roomId) {
        try {
            const response = await fetch(getApiUrl(`/chat/rooms/${roomId}/read`), {
                method: 'PUT',
                headers: authHeaders()
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore marcatura letti"));
            }

            return { success: true, data };
        } catch (error) {
            console.error('Mark as read error:', error);
            return { success: false, error: error.message };
        }
    }

    // Lascia una chat room
    async leaveChatRoom(roomId) {
        try {
            const response = await fetch(getApiUrl(`/chat/rooms/${roomId}`), {
                method: 'DELETE',
                headers: authHeaders()
            });

            const data = await parseChatResponse(response);

            if (!response.ok) {
                throw new Error(chatApiErrorMessage(data, "Errore abbandono chat"));
            }

            return { success: true, data };
        } catch (error) {
            console.error('Leave chat room error:', error);
            return { success: false, error: error.message };
        }
    }

    // Calcola e aggiorna il conteggio dei messaggi non letti
    updateUnreadCount() {
        this.unreadCount = this.chatRooms.reduce((total, room) => total + (room.unread_count || 0), 0);
        this.updateUnreadBadge();
    }

    // Aggiorna il badge dei messaggi non letti
    updateUnreadBadge() {
        const badge = document.getElementById('chat-unread-badge');
        if (badge) {
            if (this.unreadCount > 0) {
                badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    // Inizia il polling per nuovi messaggi
    startPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }

        this.pollingInterval = setInterval(async () => {
            if (this.currentChatRoom) {
                // Polling per nuovi messaggi nella chat corrente
                await this.checkNewMessages(this.currentChatRoom.id);
            }
            
            // Polling per aggiornare la lista delle chat e non letti
            await this.getUserChatRooms();
        }, 5000); // Ogni 5 secondi
    }

    // Ferma il polling
    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    // Controlla nuovi messaggi
    async checkNewMessages(roomId) {
        const result = await this.getChatMessages(roomId, 10, 0);
        if (result.success && result.data.length > 0) {
            // Aggiorna solo se ci sono nuovi messaggi
            const chatMessages = document.getElementById('chat-messages');
            if (chatMessages && chatMessages.children.length > 0) {
                const messageNodes = Array.from(chatMessages.querySelectorAll('[data-message-id]'));
                const lastKnownId = messageNodes.length
                    ? Math.max(...messageNodes.map((el) => parseInt(el.getAttribute('data-message-id'), 10) || 0))
                    : 0;
                const newMessages = result.data.filter(msg => msg.id > lastKnownId);
                
                if (newMessages.length > 0) {
                    newMessages.forEach(msg => {
                        this.addMessageToChat(msg);
                    });
                    this.scrollToBottom();
                }
            } else if (chatMessages) {
                // Nessun messaggio renderizzato: mostra tutti quelli ricevuti
                result.data.forEach(msg => this.addMessageToChat(msg));
                this.scrollToBottom();
            }
        }
    }

    // Aggiunge un messaggio alla chat
    addMessageToChat(message) {
        const chatMessages = document.getElementById('chat-messages');
        if (!chatMessages) return;

        // Evita duplicati (es. invio ottimistico + polling)
        if (message && message.id) {
            const existing = chatMessages.querySelector(`[data-message-id="${message.id}"]`);
            if (existing) return;
        }

        // Se presente il placeholder "chat vuota", rimuovilo prima di aggiungere il messaggio
        const emptyState = chatMessages.querySelector('.chat-empty');
        if (emptyState) emptyState.remove();

        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${message.is_own_message ? 'own' : 'other'} ${message.message_type}`;
        messageElement.setAttribute('data-message-id', message.id);

        const messageContent = `
            <div class="message-content">
                ${!message.is_own_message ? `<div class="message-sender">${message.sender_name}</div>` : ''}
                <div class="message-text">${this.escapeHtml(message.content)}</div>
                <div class="message-time">${this.formatTime(message.created_at)}</div>
            </div>
        `;

        messageElement.innerHTML = messageContent;
        chatMessages.appendChild(messageElement);
    }

    // Scroll automatico in fondo
    scrollToBottom() {
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }

    // Il backend usa datetime.utcnow() (naive ISO senza timezone): forziamo
    // l'interpretazione come UTC se il suffisso manca, cosi' la conversione in
    // ora locale del browser e' corretta.
    parseBackendDate(dateString) {
        if (!dateString) return null;
        const hasTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(dateString);
        const iso = hasTz ? dateString : dateString + 'Z';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? null : d;
    }

    // Etichetta compatta: data + ora locale.
    //   oggi   -> "14:30"
    //   ieri   -> "ieri 14:30"
    //   altri  -> "15/04 14:30"  (o "15/04/2024 14:30" se anno diverso)
    formatTime(dateString) {
        const date = this.parseBackendDate(dateString);
        if (!date) return '';

        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();
        const sameYear = date.getFullYear() === now.getFullYear();

        const hhmm = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        if (sameDay) return hhmm;
        if (isYesterday) return `ieri ${hhmm}`;

        const dateOpts = sameYear
            ? { day: '2-digit', month: '2-digit' }
            : { day: '2-digit', month: '2-digit', year: 'numeric' };
        const ddmm = date.toLocaleDateString('it-IT', dateOpts);
        return `${ddmm} ${hhmm}`;
    }

    // Escape HTML per sicurezza
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Resetta il servizio
    reset() {
        this.stopPolling();
        this.currentChatRoom = null;
        this.chatRooms = [];
        this.unreadCount = 0;
        this.updateUnreadBadge();
    }
}

// Istanza globale
const chatService = new ChatService();
