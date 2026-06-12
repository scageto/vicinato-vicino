// =====================================================
// SEZIONE EVENTI
// =====================================================
//
// Calendario mensile (lun-dom) sul modello di puntello.org:
//  - barra di navigazione mese precedente / successivo / Oggi
//  - griglia 7 colonne con badge sui giorni che hanno eventi
//  - click su un giorno -> filtra la lista degli eventi su quel giorno
//  - click su un evento -> dettaglio + iscrizione/disiscrizione
//
// Mirror dello schema di items: stato in modulo, listener
// agganciati da app.js (setupForms / setupEventListeners).
// =====================================================

let EVENTS_CACHE = [];                                  // eventi del mese visualizzato
let EVENTS_CURRENT_MONTH = new Date();                  // primo giorno del mese in vista
EVENTS_CURRENT_MONTH.setDate(1);
EVENTS_CURRENT_MONTH.setHours(0, 0, 0, 0);
let EVENTS_SELECTED_DAY = null;                         // null = mostra tutto il mese
let CURRENT_EVENT_EDIT_ID = null;

const EVENT_MONTH_NAMES = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"
];
const EVENT_WEEKDAYS = ["L", "M", "M", "G", "V", "S", "D"];

const EVENT_CATEGORY_ICONS = {
    festa: "fa-music",
    mercatino: "fa-store",
    corso: "fa-chalkboard-teacher",
    pulizia: "fa-broom",
    sport: "fa-running",
    cultura: "fa-book-open",
    altro: "fa-calendar-day",
};

// =====================================================
// VISIBILITA' FORM
// =====================================================

function updateEventsFormVisibility() {
    const wrap = document.getElementById("events-form-toggle-wrapper");
    const formWrap = document.getElementById("events-form-wrapper");
    if (!wrap || !formWrap) return;
    if (APP_STATE.isLoggedIn) {
        wrap.style.display = "block";
        formWrap.style.display = "none";
    } else {
        wrap.style.display = "none";
        formWrap.style.display = "none";
    }
}

function toggleEventsForm(show) {
    const wrap = document.getElementById("events-form-toggle-wrapper");
    const formWrap = document.getElementById("events-form-wrapper");
    if (!wrap || !formWrap) return;
    if (show) {
        formWrap.style.display = "block";
        wrap.style.display = "none";
        formWrap.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
        formWrap.style.display = "none";
        wrap.style.display = "block";
        const f = document.getElementById("events-form");
        if (f) f.reset();
        CURRENT_EVENT_EDIT_ID = null;
        const title = document.getElementById("events-form-title");
        if (title) title.textContent = "Nuovo evento";
        const submitBtn = document.querySelector('#events-form button[type="submit"]');
        if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Pubblica evento';
        // ripulisci preview + errore della locandina
        const coverPrev = document.getElementById("event-cover-preview");
        if (coverPrev) coverPrev.innerHTML = "";
        const coverErr = document.getElementById("event-cover-error");
        if (coverErr) coverErr.style.display = "none";
    }
}

// Anteprima live della locandina mentre l'utente la sceglie
function handleEventCoverChange() {
    const input = document.getElementById("event-cover");
    const preview = document.getElementById("event-cover-preview");
    const errBox = document.getElementById("event-cover-error");
    if (!input || !preview) return;

    const file = input.files?.[0];
    if (errBox) { errBox.style.display = "none"; errBox.textContent = ""; }
    if (!file) {
        preview.innerHTML = "";
        return;
    }

    const max = (typeof ITEMS_MAX_IMAGE_BYTES !== "undefined") ? ITEMS_MAX_IMAGE_BYTES : 8 * 1024 * 1024;
    if (!(file.type || "").startsWith("image/")) {
        if (errBox) {
            errBox.textContent = "La locandina deve essere un'immagine.";
            errBox.style.display = "block";
        }
        input.value = "";
        preview.innerHTML = "";
        return;
    }
    if (file.size > max) {
        if (errBox) {
            errBox.textContent = `Immagine troppo grande (max ${max / (1024 * 1024)} MB).`;
            errBox.style.display = "block";
        }
        input.value = "";
        preview.innerHTML = "";
        return;
    }

    const url = URL.createObjectURL(file);
    const sizeKB = file.size < 1024 * 1024
        ? `${(file.size / 1024).toFixed(0)} KB`
        : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    preview.innerHTML = `
        <div class="item-media-thumb">
            <img class="item-media" src="${url}" alt="Anteprima locandina">
            <div class="item-media-info">
                <span class="item-media-name" title="${file.name}">${file.name}</span>
                <span class="item-media-size">${sizeKB}</span>
            </div>
        </div>`;
}

// =====================================================
// CARICAMENTO + RENDER CALENDARIO
// =====================================================

function eventsMonthLabel(d) {
    return `${EVENT_MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

async function loadEventsForCurrentMonth() {
    const list = document.getElementById("events-list");
    if (list) list.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Caricamento eventi...</div>';

    const year = EVENTS_CURRENT_MONTH.getFullYear();
    const month = EVENTS_CURRENT_MONTH.getMonth() + 1;  // 1-12
    const cat = document.getElementById("events-filter-category")?.value || "";
    const zone = document.getElementById("events-filter-zone")?.value || "";

    let url = `${getApiUrl(API_CONFIG.ENDPOINTS.EVENTS)}?year=${year}&month=${month}`;
    if (cat) url += `&category=${encodeURIComponent(cat)}`;
    if (zone) url += `&zone=${encodeURIComponent(zone)}`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: APP_STATE.token
                ? { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` }
                : API_CONFIG.DEFAULT_HEADERS,
        });
        const data = await res.json().catch(() => []);
        if (!res.ok) {
            if (list) list.innerHTML = `<div class="result-message error">Errore caricamento eventi (HTTP ${res.status})</div>`;
            return;
        }
        EVENTS_CACHE = Array.isArray(data) ? data : [];
        renderEventsCalendar();
        renderEventsList();
    } catch (err) {
        if (list) list.innerHTML = `<div class="result-message error">Errore di connessione: ${escapeHtml(err.message)}</div>`;
    }
}

function renderEventsCalendar() {
    const grid = document.getElementById("events-calendar-grid");
    const monthLbl = document.getElementById("events-current-month");
    if (!grid) return;
    if (monthLbl) monthLbl.textContent = eventsMonthLabel(EVENTS_CURRENT_MONTH);

    // Mappa data ISO (yyyy-mm-dd) -> elenco eventi del giorno (in cache)
    const byDay = new Map();
    EVENTS_CACHE.forEach((ev) => {
        const d = new Date(ev.date);
        if (isNaN(d.getTime())) return;
        const key = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2,"0")}-${d.getDate().toString().padStart(2,"0")}`;
        if (!byDay.has(key)) byDay.set(key, []);
        byDay.get(key).push(ev);
    });

    const year = EVENTS_CURRENT_MONTH.getFullYear();
    const month = EVENTS_CURRENT_MONTH.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    // calendario lun-dom: getDay -> 0=dom..6=sab; vogliamo offset lun=0 dom=6
    const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let html = '<div class="events-cal-row events-cal-head">' +
        EVENT_WEEKDAYS.map(w => `<div class="events-cal-cell events-cal-weekday">${w}</div>`).join("") +
        '</div>';
    html += '<div class="events-cal-body">';

    // celle vuote prima del primo del mese
    for (let i = 0; i < firstWeekday; i++) {
        html += '<div class="events-cal-cell events-cal-empty"></div>';
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const cellDate = new Date(year, month, day);
        const key = `${year}-${(month+1).toString().padStart(2,"0")}-${day.toString().padStart(2,"0")}`;
        const dayEvents = byDay.get(key) || [];
        const isToday = cellDate.getTime() === today.getTime();
        const isSelected = EVENTS_SELECTED_DAY && EVENTS_SELECTED_DAY.getTime() === cellDate.getTime();

        html += `
            <div class="events-cal-cell events-cal-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""} ${dayEvents.length ? "has-events" : ""}"
                 data-day="${day}"
                 role="button" tabindex="0">
                <span class="events-cal-num">${day}</span>
                ${dayEvents.length
                    ? `<span class="events-cal-dot" title="${dayEvents.length} eventi">${dayEvents.length}</span>`
                    : ""}
            </div>
        `;
    }
    html += '</div>';
    grid.innerHTML = html;
}

function setSelectedDay(day) {
    if (!day) {
        EVENTS_SELECTED_DAY = null;
    } else {
        EVENTS_SELECTED_DAY = new Date(
            EVENTS_CURRENT_MONTH.getFullYear(),
            EVENTS_CURRENT_MONTH.getMonth(),
            day
        );
        EVENTS_SELECTED_DAY.setHours(0, 0, 0, 0);
    }
    renderEventsCalendar();
    renderEventsList();
}

// =====================================================
// LISTA EVENTI (sotto al calendario)
// =====================================================

function formatEventDateTime(d) {
    return d.toLocaleString("it-IT", {
        weekday: "short", day: "2-digit", month: "long",
        hour: "2-digit", minute: "2-digit",
    });
}

function renderEventsList() {
    const list = document.getElementById("events-list");
    const titleEl = document.getElementById("events-list-title");
    if (!list) return;

    let filtered = [...EVENTS_CACHE];
    if (EVENTS_SELECTED_DAY) {
        const sel = EVENTS_SELECTED_DAY;
        filtered = filtered.filter((ev) => {
            const d = new Date(ev.date);
            return d.getFullYear() === sel.getFullYear()
                && d.getMonth() === sel.getMonth()
                && d.getDate() === sel.getDate();
        });
        if (titleEl) titleEl.textContent =
            `Eventi del ${sel.toLocaleDateString("it-IT", { weekday: "long", day: "2-digit", month: "long" })}`;
    } else {
        if (titleEl) titleEl.textContent = `Eventi di ${eventsMonthLabel(EVENTS_CURRENT_MONTH)}`;
    }

    if (filtered.length === 0) {
        list.innerHTML = `
            <div class="no-users">
                <i class="fas fa-calendar-day"></i>
                <h3>Nessun evento</h3>
                <p>${EVENTS_SELECTED_DAY ? "In questa giornata non ci sono eventi pianificati." : "Nessun evento programmato per questo mese."}</p>
            </div>`;
        return;
    }

    list.innerHTML = filtered.map((ev) => {
        const start = new Date(ev.date);
        const end = ev.end_date ? new Date(ev.end_date) : null;
        const cat = (ev.category || "altro").toLowerCase();
        const icon = EVENT_CATEGORY_ICONS[cat] || "fa-calendar-day";
        const full = ev.max_participants && ev.participants_count >= ev.max_participants;
        const isCancelled = ev.status === "cancelled";

        const ownerActions = ev.is_organizer ? `
            <div class="job-actions">
                <button type="button" class="btn btn-secondary btn-small event-edit-btn" data-event-id="${ev.id}">
                    <i class="fas fa-edit"></i> Modifica
                </button>
                <button type="button" class="btn btn-outline btn-small event-delete-btn" data-event-id="${ev.id}">
                    <i class="fas fa-trash-alt"></i> Elimina
                </button>
            </div>` : (APP_STATE.isLoggedIn ? `
            <div class="job-actions">
                ${ev.is_participating
                    ? `<button type="button" class="btn btn-outline btn-small event-leave-btn" data-event-id="${ev.id}">
                            <i class="fas fa-user-minus"></i> Annulla iscrizione
                       </button>`
                    : `<button type="button" class="btn btn-primary btn-small event-join-btn" data-event-id="${ev.id}" ${full || isCancelled ? "disabled" : ""}>
                            <i class="fas fa-user-plus"></i> ${isCancelled ? "Annullato" : (full ? "Posti esauriti" : "Partecipa")}
                       </button>`}
            </div>` : "");

        const partsLabel = ev.max_participants
            ? `${ev.participants_count}/${ev.max_participants}`
            : `${ev.participants_count}`;

        return `
            <div class="job-card event-card ${isCancelled ? "is-taken" : ""}" data-event-id="${ev.id}">
                <div class="job-avatar event-avatar"><i class="fas ${icon}"></i></div>
                <div class="job-info">
                    <div class="job-title-row">
                        <h4 class="job-title">${ev.title}</h4>
                        <span class="job-type-badge offer">${cat}</span>
                        ${isCancelled ? '<span class="item-status-badge taken"><i class="fas fa-ban"></i> Annullato</span>' : ""}
                    </div>
                    <div class="job-meta">
                        <div class="job-meta-item"><i class="fas fa-clock"></i> ${formatEventDateTime(start)}${end ? ` &mdash; ${end.toLocaleTimeString("it-IT", {hour:"2-digit", minute:"2-digit"})}` : ""}</div>
                        <div class="job-meta-item"><i class="fas fa-map-marker-alt"></i> ${ev.location}${ev.location_zone ? ` (${ev.location_zone})` : ""}</div>
                        <div class="job-meta-item"><i class="fas fa-users"></i> ${partsLabel} iscritti</div>
                        <div class="job-meta-item"><i class="fas fa-user"></i> ${ev.organizer_name || "Organizzatore"}</div>
                    </div>
                    ${ev.image_url ? `
                        <div class="event-cover">
                            <img class="event-cover-img" loading="lazy" src="${ev.image_url}" alt="Locandina ${ev.title}"
                                 onerror="this.classList.add('item-media-broken'); this.alt='Locandina non disponibile';">
                        </div>` : ""}
                    <p class="job-description">${ev.description || ""}</p>
                    ${ownerActions}
                </div>
            </div>`;
    }).join("");

    setupEventCardActions();
}

function setupEventCardActions() {
    document.querySelectorAll(".event-edit-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.getAttribute("data-event-id"), 10);
            const ev = EVENTS_CACHE.find((e) => e.id === id);
            if (!ev) return;
            CURRENT_EVENT_EDIT_ID = id;
            document.getElementById("event-title").value = ev.title || "";
            document.getElementById("event-category").value = ev.category || "altro";
            document.getElementById("event-description").value = ev.description || "";
            document.getElementById("event-date").value = isoForDatetimeInput(ev.date);
            document.getElementById("event-end-date").value = ev.end_date ? isoForDatetimeInput(ev.end_date) : "";
            document.getElementById("event-location").value = ev.location || "";
            document.getElementById("event-max").value = ev.max_participants || "";
            // reset locandina input + preview
            const coverInput = document.getElementById("event-cover");
            if (coverInput) coverInput.value = "";
            const coverPrev = document.getElementById("event-cover-preview");
            if (coverPrev) {
                coverPrev.innerHTML = ev.image_url
                    ? `<div class="item-media-thumb">
                           <img class="item-media" src="${ev.image_url}" alt="Locandina attuale">
                           <div class="item-media-info"><span class="item-media-name">Locandina attuale</span></div>
                       </div>`
                    : "";
            }
            const coverErr = document.getElementById("event-cover-error");
            if (coverErr) coverErr.style.display = "none";
            const title = document.getElementById("events-form-title");
            if (title) title.textContent = "Modifica evento";
            const submitBtn = document.querySelector('#events-form button[type="submit"]');
            if (submitBtn) submitBtn.innerHTML = '<i class="fas fa-save"></i> Salva modifiche';
            toggleEventsForm(true);
        });
    });

    document.querySelectorAll(".event-delete-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = parseInt(btn.getAttribute("data-event-id"), 10);
            if (!window.confirm("Sei sicuro di voler eliminare questo evento?")) return;
            try {
                const res = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.EVENTS}${id}`), {
                    method: "DELETE",
                    headers: { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` },
                });
                if (!res.ok) {
                    showMessage("Errore eliminazione evento", "error", "events-result");
                    return;
                }
                showMessage("Evento eliminato", "success", "events-result");
                loadEventsForCurrentMonth();
            } catch (err) {
                showMessage(`Errore di connessione: ${err.message}`, "error", "events-result");
            }
        });
    });

    document.querySelectorAll(".event-join-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            if (btn.disabled) return;
            const id = parseInt(btn.getAttribute("data-event-id"), 10);
            try {
                const res = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.EVENTS}${id}/join`), {
                    method: "POST",
                    headers: { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` },
                });
                const data = await res.json().catch(() => null);
                if (!res.ok) {
                    const detail = data?.detail || `HTTP ${res.status}`;
                    showMessage(`Iscrizione fallita: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`, "error", "events-result");
                    return;
                }
                showMessage("Sei iscritto all'evento", "success", "events-result");
                loadEventsForCurrentMonth();
            } catch (err) {
                showMessage(`Errore di connessione: ${err.message}`, "error", "events-result");
            }
        });
    });

    document.querySelectorAll(".event-leave-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = parseInt(btn.getAttribute("data-event-id"), 10);
            try {
                const res = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.EVENTS}${id}/join`), {
                    method: "DELETE",
                    headers: { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` },
                });
                if (!res.ok) {
                    showMessage("Errore disiscrizione", "error", "events-result");
                    return;
                }
                showMessage("Iscrizione annullata", "success", "events-result");
                loadEventsForCurrentMonth();
            } catch (err) {
                showMessage(`Errore di connessione: ${err.message}`, "error", "events-result");
            }
        });
    });
}

// Helpers datetime-local <-> ISO backend
function isoForDatetimeInput(iso) {
    // ISO -> "YYYY-MM-DDTHH:mm" in ora locale
    const d = new Date(iso);
    const pad = (n) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function datetimeInputToIso(value) {
    // datetime-local non ha timezone: il browser lo interpreta come ora locale.
    // new Date(value) lo converte in oggetto Date locale corretto, lo serializziamo
    // in ISO UTC che il backend accetta.
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d.toISOString();
}

// =====================================================
// SUBMIT FORM (mirror items)
// =====================================================

function setupEventsForm() {
    const form = document.getElementById("events-form");
    if (!form) return;

    form.addEventListener("submit", async function (e) {
        e.preventDefault();
        if (!APP_STATE.isLoggedIn || !APP_STATE.token) {
            showMessage("Devi essere loggato per pubblicare un evento", "error", "events-result");
            return;
        }

        const startIso = datetimeInputToIso(document.getElementById("event-date").value);
        const endIso = datetimeInputToIso(document.getElementById("event-end-date").value);
        if (!startIso) {
            showMessage("Indica una data di inizio valida", "error", "events-result");
            return;
        }
        const maxRaw = document.getElementById("event-max").value;
        const payload = {
            title: document.getElementById("event-title").value,
            description: document.getElementById("event-description").value,
            date: startIso,
            end_date: endIso,
            location: document.getElementById("event-location").value,
            location_zone: null, // campo rimosso dal form
            category: document.getElementById("event-category").value || "altro",
            // image_url: gestito separatamente via POST /events/{id}/cover dopo
            // la creazione/aggiornamento, cosi' l'utente puo' caricare una locandina
            max_participants: maxRaw ? parseInt(maxRaw, 10) : null,
        };

        // File locandina (singolo, facoltativo)
        const coverInput = document.getElementById("event-cover");
        const coverFile = coverInput?.files?.[0] || null;
        if (coverFile) {
            // valida tipo + dimensione (riusa i limiti immagini di items)
            const isImg = (coverFile.type || "").startsWith("image/");
            const max = (typeof ITEMS_MAX_IMAGE_BYTES !== "undefined") ? ITEMS_MAX_IMAGE_BYTES : 8 * 1024 * 1024;
            if (!isImg) {
                showMessage("La locandina deve essere un'immagine", "error", "events-result");
                return;
            }
            if (coverFile.size > max) {
                showMessage(`Locandina troppo grande (max ${max / (1024 * 1024)} MB)`, "error", "events-result");
                return;
            }
        }

        let url = getApiUrl(API_CONFIG.ENDPOINTS.EVENTS);
        let method = "POST";
        if (CURRENT_EVENT_EDIT_ID !== null) {
            url = getApiUrl(`${API_CONFIG.ENDPOINTS.EVENTS}${CURRENT_EVENT_EDIT_ID}`);
            method = "PUT";
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        const originalLabel = submitBtn ? submitBtn.innerHTML : null;
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Invio in corso...';
        }

        try {
            const res = await fetch(url, {
                method,
                headers: { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` },
                body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok) {
                const detail = data?.detail
                    ? (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))
                    : `HTTP ${res.status}`;
                showMessage(`Errore salvataggio evento: ${detail}`, "error", "events-result");
                return;
            }

            // Se c'e' una locandina, caricala come step separato
            const createdId = (data && data.id) || CURRENT_EVENT_EDIT_ID;
            if (createdId && coverFile) {
                try {
                    const fd = new FormData();
                    fd.append("file", coverFile);
                    const upRes = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.EVENTS}${createdId}/cover`), {
                        method: "POST",
                        headers: { Authorization: `Bearer ${APP_STATE.token}` },
                        body: fd,
                    });
                    if (!upRes.ok) {
                        const upData = await upRes.json().catch(() => null);
                        const det = upData?.detail
                            ? (typeof upData.detail === "string" ? upData.detail : JSON.stringify(upData.detail))
                            : `HTTP ${upRes.status}`;
                        showMessage(`Evento salvato ma locandina non caricata: ${det}`, "error", "events-result");
                    }
                } catch (upErr) {
                    showMessage(`Errore upload locandina: ${upErr.message}`, "error", "events-result");
                }
            }

            showMessage(CURRENT_EVENT_EDIT_ID ? "Evento aggiornato" : "Evento pubblicato", "success", "events-result");
            CURRENT_EVENT_EDIT_ID = null;
            toggleEventsForm(false);
            loadEventsForCurrentMonth();
        } catch (err) {
            showMessage(`Errore di connessione: ${err.message}`, "error", "events-result");
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalLabel || '<i class="fas fa-plus-circle"></i> Pubblica evento';
            }
        }
    });

    // Click sui giorni del calendario
    document.getElementById("events-calendar-grid")?.addEventListener("click", (e) => {
        const cell = e.target.closest(".events-cal-day");
        if (!cell) return;
        const day = parseInt(cell.getAttribute("data-day"), 10);
        if (!isFinite(day)) return;
        if (EVENTS_SELECTED_DAY && EVENTS_SELECTED_DAY.getDate() === day) {
            setSelectedDay(null);
        } else {
            setSelectedDay(day);
        }
    });

    // Navigazione mese
    document.getElementById("events-prev-month")?.addEventListener("click", () => {
        EVENTS_CURRENT_MONTH = new Date(
            EVENTS_CURRENT_MONTH.getFullYear(),
            EVENTS_CURRENT_MONTH.getMonth() - 1,
            1
        );
        EVENTS_SELECTED_DAY = null;
        loadEventsForCurrentMonth();
    });
    document.getElementById("events-next-month")?.addEventListener("click", () => {
        EVENTS_CURRENT_MONTH = new Date(
            EVENTS_CURRENT_MONTH.getFullYear(),
            EVENTS_CURRENT_MONTH.getMonth() + 1,
            1
        );
        EVENTS_SELECTED_DAY = null;
        loadEventsForCurrentMonth();
    });
    document.getElementById("events-today")?.addEventListener("click", () => {
        const now = new Date();
        EVENTS_CURRENT_MONTH = new Date(now.getFullYear(), now.getMonth(), 1);
        EVENTS_SELECTED_DAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        loadEventsForCurrentMonth();
    });

    // Filtri
    document.getElementById("events-filter-category")?.addEventListener("change", loadEventsForCurrentMonth);
    document.getElementById("events-filter-zone")?.addEventListener("change", loadEventsForCurrentMonth);

    // Toggle / refresh
    document.getElementById("events-toggle-form-btn")?.addEventListener("click", () => toggleEventsForm(true));
    document.getElementById("events-close-form-btn")?.addEventListener("click", () => toggleEventsForm(false));
    document.getElementById("events-refresh")?.addEventListener("click", loadEventsForCurrentMonth);

    // Anteprima locandina
    document.getElementById("event-cover")?.addEventListener("change", handleEventCoverChange);
}

// Wrapper invocato da app.js setActivePage("events")
function loadEvents() {
    loadEventsForCurrentMonth();
}

// =====================================================
// HOME: eventi di oggi
// =====================================================
//
// Carica gli eventi della giornata corrente e li mostra in un blocco
// compatto sotto le feature card della home. Chiamato da app.js quando
// l'utente entra su "home".

async function loadHomeTodayEvents() {
    const box = document.getElementById("home-today-events");
    const list = document.getElementById("home-today-events-list");
    if (!box || !list) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const url = `${getApiUrl(API_CONFIG.ENDPOINTS.EVENTS)}?year=${year}&month=${month}`;

    list.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Caricamento...</div>';
    try {
        const res = await fetch(url, {
            headers: APP_STATE.token
                ? { ...API_CONFIG.DEFAULT_HEADERS, Authorization: `Bearer ${APP_STATE.token}` }
                : API_CONFIG.DEFAULT_HEADERS,
        });
        const data = await res.json().catch(() => []);
        if (!res.ok || !Array.isArray(data)) {
            box.style.display = "none";
            return;
        }

        const todayKey = `${year}-${month.toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
        const todays = data.filter((ev) => {
            const d = new Date(ev.date);
            const k = `${d.getFullYear()}-${(d.getMonth()+1).toString().padStart(2, "0")}-${d.getDate().toString().padStart(2, "0")}`;
            return k === todayKey;
        });

        if (todays.length === 0) {
            box.style.display = "none";
            return;
        }

        box.style.display = "block";
        list.innerHTML = todays.map((ev) => {
            const start = new Date(ev.date);
            const cat = (ev.category || "altro").toLowerCase();
            const icon = (typeof EVENT_CATEGORY_ICONS !== "undefined" && EVENT_CATEGORY_ICONS[cat])
                ? EVENT_CATEGORY_ICONS[cat]
                : "fa-calendar-day";
            return `
                <div class="home-today-event" data-event-id="${ev.id}" role="button" tabindex="0">
                    <div class="home-today-event-icon"><i class="fas ${icon}"></i></div>
                    <div class="home-today-event-info">
                        <h4 class="home-today-event-title">${ev.title}</h4>
                        <div class="home-today-event-meta">
                            <span><i class="fas fa-clock"></i> ${start.toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}</span>
                            <span><i class="fas fa-map-marker-alt"></i> ${ev.location}</span>
                        </div>
                    </div>
                </div>`;
        }).join("");

        // click su un evento -> vai alla pagina eventi (e seleziona oggi)
        list.querySelectorAll(".home-today-event").forEach((el) => {
            el.addEventListener("click", () => {
                if (typeof setActivePage === "function") setActivePage("events", { push: true });
                // setActivePage triggera loadEvents() che ricarica il mese corrente;
                // selezioniamo "oggi" appena la cache e' arrivata
                setTimeout(() => {
                    const now = new Date();
                    EVENTS_CURRENT_MONTH = new Date(now.getFullYear(), now.getMonth(), 1);
                    EVENTS_SELECTED_DAY = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    if (typeof loadEventsForCurrentMonth === "function") loadEventsForCurrentMonth();
                }, 50);
            });
        });
    } catch (_) {
        box.style.display = "none";
    }
}
