// =====================================================
// SCAMBIO / REGALO
// =====================================================
//
// Stessa struttura della sezione Lavoretti (vedi app.js):
//   - le variabili di stato e tutte le funzioni stanno qui
//   - i listener vengono collegati da app.js (setupForms /
//     setupEventListeners) cosi' la pagina segue lo stesso
//     ciclo di vita del resto dell'app
// =====================================================

let ITEMS_CACHE = [];
let CURRENT_ITEM_EDIT_ID = null;

// Lista degli allegati che l'utente sta selezionando per un nuovo annuncio.
// La manteniamo in memoria perche' <input type="file"> sostituisce sempre
// la selezione precedente; vogliamo invece accumulare fino a MAX_ATTACHMENTS.
let ITEMS_PENDING_FILES = [];

// Tetti coerenti con il backend (vedi backend/app/api/items.py).
const ITEMS_MAX_ATTACHMENTS = 3;
const ITEMS_MAX_IMAGE_BYTES = 8 * 1024 * 1024;   // 8 MB
const ITEMS_MAX_VIDEO_BYTES = 12 * 1024 * 1024;  // 12 MB

// =====================================================
// VISIBILITA' FORM (mirror di updateJobsFormVisibility)
// =====================================================

function updateItemsFormVisibility() {
    const toggleWrapper = document.getElementById("items-form-toggle-wrapper");
    const formWrapper = document.getElementById("items-form-wrapper");
    if (!toggleWrapper || !formWrapper) return;

    if (APP_STATE.isLoggedIn) {
        toggleWrapper.style.display = "block";
        formWrapper.style.display = "none";
    } else {
        toggleWrapper.style.display = "none";
        formWrapper.style.display = "none";
    }
}

function toggleItemsForm(show) {
    const formWrapper = document.getElementById("items-form-wrapper");
    const toggleWrapper = document.getElementById("items-form-toggle-wrapper");
    if (!formWrapper || !toggleWrapper) return;

    if (show) {
        formWrapper.style.display = "block";
        toggleWrapper.style.display = "none";
    } else {
        formWrapper.style.display = "none";
        toggleWrapper.style.display = "block";
        // ripulisci preview e stato di modifica
        clearItemsMediaPreview();
        const formEl = document.getElementById("items-form");
        if (formEl) formEl.reset();
        CURRENT_ITEM_EDIT_ID = null;
        const submitBtn = document.querySelector('#items-form button[type="submit"]');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Pubblica annuncio';
        const note = document.getElementById("items-edit-media-note");
        if (note) note.style.display = "none";
    }
}

// =====================================================
// FILTRI
// =====================================================

function applyItemsFilters() {
    const search = (document.getElementById("items-search")?.value || "").trim().toLowerCase();
    const type = document.getElementById("items-filter-type")?.value || "";
    const zone = document.getElementById("items-filter-zone")?.value || "";
    const itemStatus = document.getElementById("items-filter-status")?.value || "";

    let filtered = [...ITEMS_CACHE];
    if (search) {
        filtered = filtered.filter((item) =>
            (item.title || "").toLowerCase().includes(search) ||
            (item.description || "").toLowerCase().includes(search) ||
            (item.category || "").toLowerCase().includes(search)
        );
    }
    if (type) filtered = filtered.filter((item) => item.item_type === type);
    if (zone) filtered = filtered.filter((item) => item.zone === zone);
    if (itemStatus) filtered = filtered.filter((item) => item.status === itemStatus);

    renderItemsList(filtered);
}

function resetItemsFilters() {
    const search = document.getElementById("items-search");
    if (search) search.value = "";
    const t = document.getElementById("items-filter-type");
    if (t) t.value = "";
    const z = document.getElementById("items-filter-zone");
    if (z) z.value = "";
    const s = document.getElementById("items-filter-status");
    if (s) s.value = "";
    applyItemsFilters();
}

// =====================================================
// CARICAMENTO LISTA
// =====================================================

async function loadItems() {
    const list = document.getElementById("items-list");
    if (!list) return;
    list.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Caricamento annunci...</div>';

    try {
        const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.ITEMS), {
            method: "GET",
            headers: API_CONFIG.DEFAULT_HEADERS,
        });
        const data = await response.json().catch(() => []);
        if (!response.ok) {
            list.innerHTML = `<div class="result-message error">Errore caricamento annunci (HTTP ${response.status})</div>`;
            return;
        }
        ITEMS_CACHE = Array.isArray(data) ? data : [];
        applyItemsFilters();
    } catch (err) {
        list.innerHTML = `<div class="result-message error">Errore di connessione: ${escapeHtml(err.message)}</div>`;
    }
}

// =====================================================
// RENDER LISTA
// =====================================================

function statusBadge(status) {
    if (status === "reserved") {
        return '<span class="item-status-badge reserved"><i class="fas fa-bookmark"></i> Riservato</span>';
    }
    if (status === "taken") {
        return '<span class="item-status-badge taken"><i class="fas fa-check-circle"></i> Ceduto</span>';
    }
    return '<span class="item-status-badge available"><i class="fas fa-circle"></i> Disponibile</span>';
}

function itemTypeBadge(type) {
    if (type === "scambio") {
        return '<span class="job-type-badge request"><i class="fas fa-exchange-alt"></i> Scambio</span>';
    }
    return '<span class="job-type-badge offer"><i class="fas fa-gift"></i> Regalo</span>';
}

function conditionLabel(condition) {
    switch (condition) {
        case "nuovo": return "Nuovo";
        case "da_riparare": return "Da riparare";
        default: return "Usato";
    }
}

function renderMediaThumbs(media) {
    if (!media || media.length === 0) return "";
    const thumbs = media.map((m, i) => {
        if (m.media_type === "video") {
            return `
                <div class="item-media-thumb" data-thumb-idx="${i}">
                    <video class="item-media" controls preload="metadata" src="${m.media_url}"></video>
                </div>`;
        }
        // <img> diretta (niente <a> wrapper) + onerror fallback grafico.
        // Il click sulla card e' gestito a livello superiore per aprire il
        // lightbox con prev/next.
        return `
            <div class="item-media-thumb item-media-clickable" data-thumb-idx="${i}">
                <img class="item-media" loading="lazy"
                     src="${m.media_url}"
                     alt="Allegato annuncio"
                     onerror="this.classList.add('item-media-broken'); this.alt='Immagine non disponibile';">
            </div>`;
    }).join("");
    return `<div class="item-media-grid">${thumbs}</div>`;
}

function renderItemsList(items) {
    const list = document.getElementById("items-list");
    if (!list) return;

    if (!items || items.length === 0) {
        list.innerHTML = '<div class="no-users"><i class="fas fa-gift"></i><h3>Nessun oggetto trovato</h3><p>Pubblica il primo annuncio di regalo/scambio</p></div>';
        return;
    }

    list.innerHTML = items.map((item) => {
        const isOwner = APP_STATE.currentUser && APP_STATE.currentUser.id === item.user_id;
        const tipoClass = item.item_type === "scambio" ? "request" : "offer";
        const iconClass = item.item_type === "scambio" ? "fa-exchange-alt" : "fa-gift";
        const isUnavailable = item.status === "taken";

        const myId = APP_STATE.currentUser?.id;
        const isAcceptedByMe = item.accepted_by_user_id && item.accepted_by_user_id === myId;

        const ownerActions = isOwner ? `
            <div class="job-actions">
                ${item.status !== "available" ? `
                    <button type="button" class="btn btn-outline btn-small item-status-btn" data-item-id="${item.id}" data-new-status="available">
                        <i class="fas fa-undo"></i> Rendi disponibile
                    </button>` : ""}
                ${(item.status === "available" || item.status === "reserved") && !item.accepted_by_user_id ? `
                    <button type="button" class="btn btn-outline btn-small item-accept-btn" data-item-id="${item.id}">
                        <i class="fas fa-user-check"></i> Accetta destinatario
                    </button>` : ""}
                ${item.accepted_by_user_id && item.status !== "taken" ? `
                    <button type="button" class="btn btn-primary btn-small item-complete-btn" data-item-id="${item.id}">
                        <i class="fas fa-check-circle"></i> Segna come ceduto
                    </button>` : ""}
                ${item.status === "taken" && item.accepted_by_user_id ? `
                    <button type="button" class="btn btn-primary btn-small item-review-btn"
                            data-item-id="${item.id}"
                            data-ratee-id="${item.accepted_by_user_id}"
                            data-ratee-name="${(item.accepted_by_name || 'destinatario').replace(/"/g, '&quot;')}">
                        <i class="fas fa-star"></i> Recensisci
                    </button>` : ""}
                <button type="button" class="btn btn-secondary btn-small item-edit-btn" data-item-id="${item.id}">
                    <i class="fas fa-edit"></i> Modifica
                </button>
                <button type="button" class="btn btn-outline btn-small item-delete-btn" data-item-id="${item.id}">
                    <i class="fas fa-trash-alt"></i> Elimina
                </button>
            </div>` : `
            <div class="job-actions">
                <button type="button" class="btn btn-primary btn-small item-chat-btn"
                        data-item-id="${item.id}"
                        data-owner-id="${item.user_id}"
                        data-owner-name="${(item.owner_name || 'Anonimo').replace(/"/g, '&quot;')}"
                        data-item-title="${(item.title || '').replace(/"/g, '&quot;')}"
                        ${isUnavailable && !isAcceptedByMe ? "disabled" : ""}>
                    <i class="fas fa-comments"></i> ${isUnavailable && !isAcceptedByMe ? "Non disponibile" : "Contatta"}
                </button>
                ${item.status === "taken" && isAcceptedByMe ? `
                    <button type="button" class="btn btn-primary btn-small item-review-btn"
                            data-item-id="${item.id}"
                            data-ratee-id="${item.user_id}"
                            data-ratee-name="${(item.owner_name || 'proprietario').replace(/"/g, '&quot;')}">
                        <i class="fas fa-star"></i> Recensisci
                    </button>` : ""}
            </div>`;

        return `
            <div class="job-card ${tipoClass} ${isUnavailable ? "is-taken" : ""}" data-item-id="${item.id}">
                <div class="job-avatar"><i class="fas ${iconClass}"></i></div>
                <div class="job-info">
                    <div class="job-title-row">
                        <h4 class="job-title">${item.title}</h4>
                        ${itemTypeBadge(item.item_type)}
                        ${statusBadge(item.status)}
                    </div>
                    <div class="job-meta">
                        <div class="job-meta-item"><i class="fas fa-tag"></i> ${item.category || "-"}</div>
                        <div class="job-meta-item"><i class="fas fa-info-circle"></i> ${conditionLabel(item.condition)}</div>
                        <div class="job-meta-item"><i class="fas fa-map-marker-alt"></i> ${item.zone || "Zona non specificata"}</div>
                        <div class="job-meta-item user-clickable" data-user-id="${item.user_id}" title="Vedi profilo e recensioni">
                            <i class="fas fa-user"></i> ${item.owner_name || "Anonimo"}
                            ${typeof renderStars === "function"
                                ? `<span style="margin-left:0.4rem;">${renderStars(item.owner_rating, item.owner_rating_count || 0)}</span>`
                                : ""}
                        </div>
                    </div>
                    <p class="job-description">${item.description || ""}</p>
                    ${renderMediaThumbs(item.media)}
                    ${ownerActions}
                </div>
            </div>
        `;
    }).join("");

    setupItemCardActions();
}

// =====================================================
// AZIONI SULLE CARD
// =====================================================

function setupItemCardActions() {
    // Click sul nome owner -> profilo pubblico con recensioni
    document.querySelectorAll("#items-list .user-clickable").forEach(el => {
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            const id = parseInt(el.dataset.userId, 10);
            if (id && typeof openUserProfileModal === "function") openUserProfileModal(id);
        });
    });

    // Accept / Complete / Review (sistema rating)
    document.querySelectorAll(".item-accept-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.itemId, 10);
            openAcceptModal({
                targetType: "item", targetId: id,
                onSuccess: () => loadItems(),
            });
        });
    });
    document.querySelectorAll(".item-complete-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.itemId, 10);
            openCompleteModal({
                targetType: "item", targetId: id,
                onSuccess: () => loadItems(),
            });
        });
    });
    document.querySelectorAll(".item-review-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.itemId, 10);
            const rateeId = parseInt(btn.dataset.rateeId, 10);
            const rateeName = btn.dataset.rateeName || "utente";
            openReviewModal({
                targetType: "item", targetId: id,
                rateeId, rateeName,
                onSuccess: () => loadItems(),
            });
        });
    });

    document.querySelectorAll(".item-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const itemId = parseInt(btn.getAttribute("data-item-id"), 10);
            const item = ITEMS_CACHE.find((i) => i.id === itemId);
            if (!item) return;

            CURRENT_ITEM_EDIT_ID = itemId;
            document.getElementById("item-type").value = item.item_type || "regalo";
            document.getElementById("item-category").value = item.category || "";
            document.getElementById("item-title").value = item.title || "";
            document.getElementById("item-description").value = item.description || "";
            document.getElementById("item-condition").value = item.condition || "usato";
            document.getElementById("item-zone").value = item.zone || "";
            document.getElementById("item-media").value = "";
            clearItemsMediaPreview();

            const note = document.getElementById("items-edit-media-note");
            if (note) {
                note.style.display = "block";
                note.innerHTML = item.media && item.media.length
                    ? `<i class="fas fa-info-circle"></i> Allegati attuali: ${item.media.length}. Se carichi nuovi file, quelli precedenti verranno sostituiti.`
                    : `<i class="fas fa-info-circle"></i> Nessun allegato attuale.`;
            }
            const submitBtn = document.querySelector('#items-form button[type="submit"]');
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Salva modifiche';
            toggleItemsForm(true);
        });
    });

    document.querySelectorAll(".item-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const itemId = parseInt(btn.getAttribute("data-item-id"), 10);
            if (!window.confirm("Sei sicuro di voler eliminare questo annuncio?")) return;
            try {
                const response = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.ITEMS}${itemId}`), {
                    method: "DELETE",
                    headers: {
                        ...API_CONFIG.DEFAULT_HEADERS,
                        Authorization: `Bearer ${APP_STATE.token}`,
                    },
                });
                if (!response.ok) {
                    showMessage("Errore eliminazione annuncio", "error", "items-result");
                    return;
                }
                showMessage("Annuncio eliminato con successo", "success", "items-result");
                CURRENT_ITEM_EDIT_ID = null;
                loadItems();
            } catch (err) {
                showMessage(`Errore di connessione: ${err.message}`, "error", "items-result");
            }
        });
    });

    document.querySelectorAll(".item-status-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const itemId = parseInt(btn.getAttribute("data-item-id"), 10);
            const newStatus = btn.getAttribute("data-new-status");
            try {
                const url = getApiUrl(`${API_CONFIG.ENDPOINTS.ITEMS}${itemId}/status?new_status=${encodeURIComponent(newStatus)}`);
                const response = await fetch(url, {
                    method: "PATCH",
                    headers: {
                        ...API_CONFIG.DEFAULT_HEADERS,
                        Authorization: `Bearer ${APP_STATE.token}`,
                    },
                });
                if (!response.ok) {
                    showMessage("Errore aggiornamento stato", "error", "items-result");
                    return;
                }
                showMessage("Stato annuncio aggiornato", "success", "items-result");
                loadItems();
            } catch (err) {
                showMessage(`Errore di connessione: ${err.message}`, "error", "items-result");
            }
        });
    });

    document.querySelectorAll(".item-chat-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (btn.disabled) return;
            const ownerId = parseInt(btn.getAttribute("data-owner-id"), 10);
            const ownerName = btn.getAttribute("data-owner-name") || "Utente";
            const itemTitle = btn.getAttribute("data-item-title") || "";
            const itemId = parseInt(btn.getAttribute("data-item-id"), 10);
            openItemChat(ownerId, ownerName, itemTitle, itemId);
        });
    });
}

// Apre la chat con il proprietario di un oggetto. Riusa l'infrastruttura
// chat esistente passando job_post_id=null. Se viene passato itemId,
// lo propaghiamo al backend cosi' la chat resta legata all'oggetto: e'
// quello che permette al pannello "Accetta destinatario" di vederla.
async function openItemChat(ownerId, ownerName, itemTitle, itemId = null) {
    if (!APP_STATE.isLoggedIn) {
        showMessage("Devi essere loggato per usare la chat", "error", "items-result");
        return;
    }
    if (typeof showChatOverlay !== "function" || typeof chatService === "undefined") {
        showMessage("Chat non disponibile in questo contesto", "error", "items-result");
        return;
    }

    showChatOverlay();
    const chatMessages = document.getElementById("chat-messages");
    if (chatMessages) chatMessages.innerHTML = '<div class="chat-loading">Apertura chat...</div>';

    // Una chat per (utenti, oggetto): il backend cerca/crea la room
    // strettamente associata a questo item_id. Nessuna fallback su chat
    // pre-esistenti con contesto diverso, cosi' ogni annuncio ha la sua
    // conversazione separata.
    const result = await chatService.createChatRoom(null, ownerId, itemId);

    if (result.success && result.data) {
        chatService.currentChatRoom = result.data;
        const title = document.getElementById("chat-title");
        const subtitle = document.getElementById("chat-subtitle");
        if (title) title.textContent = ownerName;
        if (subtitle) {
            subtitle.textContent = itemTitle ? `Riguardo a: ${itemTitle}` : "Scambio / Regalo";
            subtitle.style.display = "block";
        }
        await loadChatMessages(result.data.id);
        chatService.startPolling();
    } else if (chatMessages) {
        chatMessages.innerHTML = `<div class="chat-error">Errore: ${escapeHtml(result.error || "impossibile aprire la chat")}</div>`;
    }
}

// =====================================================
// PREVIEW + VALIDAZIONE FILE LATO CLIENT
// =====================================================

function clearItemsMediaPreview() {
    const previewBox = document.getElementById("items-media-preview");
    if (previewBox) previewBox.innerHTML = "";
    ITEMS_PENDING_FILES = [];
}

// Sincronizza ITEMS_PENDING_FILES dentro l'<input type="file"> (FileList immutabile)
// usando DataTransfer. Cosi' il submit form puo' usare direttamente input.files
// e la lista visibile coincide sempre con la nostra collezione.
function syncItemsFileInput() {
    const input = document.getElementById("item-media");
    if (!input) return;
    const dt = new DataTransfer();
    ITEMS_PENDING_FILES.forEach((f) => dt.items.add(f));
    input.files = dt.files;
}

function humanFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function validateItemsFiles(files) {
    if (files.length > ITEMS_MAX_ATTACHMENTS) {
        return `Puoi caricare massimo ${ITEMS_MAX_ATTACHMENTS} allegati`;
    }
    for (const f of files) {
        const isImage = (f.type || "").startsWith("image/");
        const isVideo = (f.type || "").startsWith("video/");
        if (!isImage && !isVideo) {
            return `Formato non supportato: ${f.name}. Ammessi solo immagini o video.`;
        }
        if (isImage && f.size > ITEMS_MAX_IMAGE_BYTES) {
            return `L'immagine "${f.name}" supera il limite di ${ITEMS_MAX_IMAGE_BYTES / (1024 * 1024)} MB`;
        }
        if (isVideo && f.size > ITEMS_MAX_VIDEO_BYTES) {
            return `Il video "${f.name}" supera il limite di ${ITEMS_MAX_VIDEO_BYTES / (1024 * 1024)} MB. Riduci durata o risoluzione.`;
        }
    }
    return null;
}

function renderItemsMediaPreview(files) {
    const previewBox = document.getElementById("items-media-preview");
    if (!previewBox) return;
    previewBox.innerHTML = "";
    files.forEach((file, idx) => {
        const isImage = (file.type || "").startsWith("image/");
        const url = URL.createObjectURL(file);
        const wrapper = document.createElement("div");
        wrapper.className = "item-media-thumb";
        wrapper.innerHTML = `
            ${isImage
                ? `<img class="item-media" src="${url}" alt="anteprima">`
                : `<video class="item-media" controls preload="metadata" src="${url}"></video>`}
            <div class="item-media-info">
                <span class="item-media-name" title="${file.name}">${file.name}</span>
                <span class="item-media-size">${humanFileSize(file.size)}</span>
                <button type="button" class="item-media-remove" data-idx="${idx}" title="Rimuovi">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        previewBox.appendChild(wrapper);
    });
}

function handleItemsMediaChange() {
    const input = document.getElementById("item-media");
    if (!input) return;

    // File scelti in questa interazione (l'<input> contiene SOLO l'ultima
    // selezione; non viene unito automaticamente a quella precedente).
    const justPicked = Array.from(input.files || []);

    // Spazio rimanente sotto il limite
    const slotsLeft = ITEMS_MAX_ATTACHMENTS - ITEMS_PENDING_FILES.length;
    let truncated = false;
    let toAdd = justPicked;
    if (justPicked.length > slotsLeft) {
        toAdd = justPicked.slice(0, Math.max(0, slotsLeft));
        truncated = true;
    }

    // Combina con quelli gia' selezionati e valida l'intera lista
    const combined = [...ITEMS_PENDING_FILES, ...toAdd];
    const error = validateItemsFiles(combined);
    const note = document.getElementById("items-media-error");
    if (note) {
        note.textContent = error
            ? error
            : (truncated ? `Limite di ${ITEMS_MAX_ATTACHMENTS} allegati raggiunto: alcuni file non sono stati aggiunti.` : "");
        note.style.display = (error || truncated) ? "block" : "none";
        note.classList.toggle("error", !!error);
    }

    if (error) {
        // Niente cambia: ripristiniamo solo lo stato precedente
        syncItemsFileInput();
        return;
    }

    ITEMS_PENDING_FILES = combined;
    syncItemsFileInput();
    renderItemsMediaPreview(ITEMS_PENDING_FILES);
}

// =====================================================
// SUBMIT FORM (mirror di setupJobsForm > submit)
// =====================================================

function setupItemsForm() {
    const itemsForm = document.getElementById("items-form");
    if (!itemsForm) return;

    itemsForm.addEventListener("submit", async function (e) {
        e.preventDefault();

        if (!APP_STATE.isLoggedIn || !APP_STATE.token) {
            showMessage("Devi essere loggato per pubblicare un annuncio", "error", "items-result");
            return;
        }

        // Usa la lista accumulata (gli <input type="file"> non aggregano)
        const files = [...ITEMS_PENDING_FILES];
        const validationError = validateItemsFiles(files);
        if (validationError) {
            showMessage(validationError, "error", "items-result");
            return;
        }

        const formData = new FormData();
        formData.append("item_type", document.getElementById("item-type").value);
        formData.append("category", document.getElementById("item-category").value);
        formData.append("title", document.getElementById("item-title").value);
        formData.append("description", document.getElementById("item-description").value);
        formData.append("condition", document.getElementById("item-condition").value);
        formData.append("zone", document.getElementById("item-zone").value || "");
        files.forEach((f) => formData.append("files", f));

        let url = getApiUrl(API_CONFIG.ENDPOINTS.ITEMS);
        let method = "POST";
        if (CURRENT_ITEM_EDIT_ID !== null) {
            url = getApiUrl(`${API_CONFIG.ENDPOINTS.ITEMS}${CURRENT_ITEM_EDIT_ID}`);
            method = "PUT";
        }

        const submitBtn = itemsForm.querySelector('button[type="submit"]');
        const originalLabel = submitBtn ? submitBtn.innerHTML : null;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invio in corso...';
        }

        try {
            const response = await fetch(url, {
                method,
                headers: { Authorization: `Bearer ${APP_STATE.token}` },
                body: formData,
            });
            const data = await response.json().catch(() => null);
            if (!response.ok) {
                const detail = data && data.detail
                    ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))
                    : `HTTP ${response.status}`;
                showMessage(`Errore salvataggio annuncio: ${detail}`, "error", "items-result");
                return;
            }
            showMessage("Annuncio pubblicato con successo", "success", "items-result");
            itemsForm.reset();
            clearItemsMediaPreview();
            CURRENT_ITEM_EDIT_ID = null;
            toggleItemsForm(false);
            loadItems();
        } catch (err) {
            showMessage(`Errore di connessione: ${err.message}`, "error", "items-result");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalLabel || '<i class="fas fa-plus-circle"></i> Pubblica annuncio';
            }
        }
    });

    // input file: live preview e validazione (con accumulo)
    document.getElementById("item-media")?.addEventListener("change", handleItemsMediaChange);

    // Bottone "rimuovi" su una preview: aggiorna la lista accumulata
    document.getElementById("items-media-preview")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".item-media-remove");
        if (!btn) return;
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        if (!isFinite(idx) || idx < 0 || idx >= ITEMS_PENDING_FILES.length) return;
        ITEMS_PENDING_FILES.splice(idx, 1);
        syncItemsFileInput();
        renderItemsMediaPreview(ITEMS_PENDING_FILES);
        const note = document.getElementById("items-media-error");
        if (note) note.style.display = "none";
    });

    // Click su una thumb -> apre il lightbox con tutte le foto dell'annuncio
    document.getElementById("items-list")?.addEventListener("click", (e) => {
        const thumb = e.target.closest(".item-media-clickable");
        if (!thumb) return;
        const card = thumb.closest(".job-card[data-item-id]");
        if (!card) return;
        const itemId = parseInt(card.getAttribute("data-item-id"), 10);
        const startIdx = parseInt(thumb.getAttribute("data-thumb-idx"), 10) || 0;
        const item = ITEMS_CACHE.find((i) => i.id === itemId);
        if (!item || !item.media || !item.media.length) return;
        // mostra solo le immagini (i video sono gia' a tutto schermo grazie ai controls nativi)
        const imgs = item.media.filter((m) => m.media_type === "image");
        if (!imgs.length) return;
        const startInImgs = imgs.findIndex((m) => m.media_url === item.media[startIdx]?.media_url);
        openItemsLightbox(imgs, Math.max(0, startInImgs));
    });
}

// =====================================================
// LIGHTBOX IMMAGINI
// =====================================================

let LIGHTBOX_STATE = { items: [], idx: 0 };

function ensureLightboxDom() {
    let overlay = document.getElementById("items-lightbox");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "items-lightbox";
    overlay.className = "items-lightbox";
    overlay.setAttribute("hidden", "");
    overlay.innerHTML = `
        <button type="button" class="items-lightbox-close" aria-label="Chiudi">
            <i class="fas fa-times"></i>
        </button>
        <button type="button" class="items-lightbox-nav prev" aria-label="Precedente">
            <i class="fas fa-chevron-left"></i>
        </button>
        <img class="items-lightbox-img" alt="">
        <button type="button" class="items-lightbox-nav next" aria-label="Successiva">
            <i class="fas fa-chevron-right"></i>
        </button>
        <div class="items-lightbox-counter"></div>
    `;
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
        if (e.target === overlay || e.target.closest(".items-lightbox-close")) {
            dismissItemsLightbox();
        } else if (e.target.closest(".items-lightbox-nav.prev")) {
            stepItemsLightbox(-1);
        } else if (e.target.closest(".items-lightbox-nav.next")) {
            stepItemsLightbox(1);
        }
    });
    document.addEventListener("keydown", (e) => {
        if (overlay.hasAttribute("hidden")) return;
        if (e.key === "Escape") dismissItemsLightbox();
        else if (e.key === "ArrowLeft") stepItemsLightbox(-1);
        else if (e.key === "ArrowRight") stepItemsLightbox(1);
    });
    return overlay;
}

function openItemsLightbox(items, idx) {
    LIGHTBOX_STATE = { items: items || [], idx: idx || 0 };
    const overlay = ensureLightboxDom();
    overlay.removeAttribute("hidden");
    if (typeof window.lockBodyScroll === "function") window.lockBodyScroll(true, "lightbox");
    // step in history: il tasto back chiude la lightbox
    if (typeof window.pushOverlayState === "function" &&
        !(history.state && history.state.overlay === "lightbox")) {
        window.pushOverlayState("lightbox");
    }
    renderLightbox();
}

// Helper "chiusura attivata da utente": passa per history.back se siamo
// nello state lightbox, cosi' UI e cronologia restano allineate.
function dismissItemsLightbox() {
    if (history.state && history.state.overlay === "lightbox") history.back();
    else closeItemsLightbox();
}

function closeItemsLightbox() {
    const overlay = document.getElementById("items-lightbox");
    if (!overlay) return;
    overlay.setAttribute("hidden", "");
    if (typeof window.lockBodyScroll === "function") window.lockBodyScroll(false, "lightbox");
}

function stepItemsLightbox(delta) {
    const n = LIGHTBOX_STATE.items.length;
    if (!n) return;
    LIGHTBOX_STATE.idx = ((LIGHTBOX_STATE.idx + delta) % n + n) % n;
    renderLightbox();
}

function renderLightbox() {
    const overlay = document.getElementById("items-lightbox");
    if (!overlay) return;
    const { items, idx } = LIGHTBOX_STATE;
    const cur = items[idx];
    if (!cur) return;
    const img = overlay.querySelector(".items-lightbox-img");
    img.src = cur.media_url;
    img.alt = `Foto ${idx + 1} di ${items.length}`;
    overlay.querySelector(".items-lightbox-counter").textContent = `${idx + 1} / ${items.length}`;
    const isSingle = items.length <= 1;
    overlay.querySelector(".items-lightbox-nav.prev").style.display = isSingle ? "none" : "";
    overlay.querySelector(".items-lightbox-nav.next").style.display = isSingle ? "none" : "";
}
