// =====================================================
// Reviews — sistema rating bidirezionale
// =====================================================
// Espone:
//   ReviewsAPI: client per /reviews/* /jobs/{id}/(accept|complete|candidates)
//   renderStars(rating, count): HTML per stellette riutilizzabile su card e profili
//   openReviewModal(target): modal "Lascia/modifica recensione"
//   openCompleteModal(target): modal "Segna come completato/ceduto" con select utente
//   loadProfileReviews(userId, container): rende lista recensioni ricevute
// =====================================================

const ReviewsAPI = {
    async _req(method, path, body) {
        const opts = { method, headers: authHeaders() };
        if (body !== undefined) opts.body = JSON.stringify(body);
        const res = await fetch(getApiUrl(path), opts);
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* */ }
        if (!res.ok) {
            const detail = data?.detail;
            throw new Error(typeof detail === "string" ? detail
                : detail ? JSON.stringify(detail) : `Errore ${res.status}`);
        }
        return data;
    },
    create:        (payload)             => ReviewsAPI._req("POST", "/reviews", payload),
    update:        (id, payload)         => ReviewsAPI._req("PATCH", `/reviews/${id}`, payload),
    remove:        (id)                  => ReviewsAPI._req("DELETE", `/reviews/${id}`),
    forUser:       (userId)              => ReviewsAPI._req("GET", `/reviews/user/${userId}`),
    forTransaction:(type, id)            => ReviewsAPI._req("GET", `/reviews/transaction/${type}/${id}`),
    mine:          ()                    => ReviewsAPI._req("GET", "/reviews/mine"),

    jobCandidates:  (jobId)              => ReviewsAPI._req("GET", `/jobs/${jobId}/candidates`),
    jobAccept:      (jobId, userId)      => ReviewsAPI._req("POST", `/jobs/${jobId}/accept`, { user_id: userId }),
    jobComplete:    (jobId)              => ReviewsAPI._req("POST", `/jobs/${jobId}/complete`),

    itemCandidates: (itemId)             => ReviewsAPI._req("GET", `/items/${itemId}/candidates`),
    itemAccept:     (itemId, userId)     => ReviewsAPI._req("POST", `/items/${itemId}/accept`, { user_id: userId }),
    itemComplete:   (itemId)             => ReviewsAPI._req("POST", `/items/${itemId}/complete`),
};

// ---------------------------------------------------------------
// Render stelle (HTML inline). Mezza stella supportata.
// ---------------------------------------------------------------
function renderStars(rating, count) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    const full = Math.floor(r);
    const half = (r - full) >= 0.25 && (r - full) < 0.75 ? 1 : 0;
    const remainder = (r - full) >= 0.75 ? 1 : 0;
    const filled = full + remainder;
    const empty = 5 - filled - half;
    const stars =
        '<i class="fas fa-star"></i>'.repeat(filled) +
        (half ? '<i class="fas fa-star-half-alt"></i>' : '') +
        '<i class="far fa-star"></i>'.repeat(empty);
    const numText = (count > 0)
        ? `${r.toFixed(1)} <span class="rating-count">(${count})</span>`
        : `<span class="rating-count">nessuna recensione</span>`;
    return `<span class="rating-stars" title="${r.toFixed(1)} su 5">${stars}</span>
            <span class="rating-num">${numText}</span>`;
}

// ---------------------------------------------------------------
// Modale generico (semplice, costruito al volo)
// ---------------------------------------------------------------
function _modal({ title, bodyHtml, onConfirm, confirmLabel = "Conferma" }) {
    const overlay = document.createElement("div");
    overlay.className = "review-modal-overlay";
    overlay.innerHTML = `
        <div class="review-modal">
            <div class="review-modal-header">
                <h3>${title}</h3>
                <button class="review-modal-close" type="button"><i class="fas fa-times"></i></button>
            </div>
            <div class="review-modal-body">${bodyHtml}</div>
            <div class="review-modal-footer">
                <button class="btn btn-outline" data-modal-cancel>Annulla</button>
                <button class="btn btn-primary" data-modal-confirm>${confirmLabel}</button>
            </div>
            <div class="review-modal-result result-message"></div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector(".review-modal-close").addEventListener("click", close);
    overlay.querySelector("[data-modal-cancel]").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    const confirmBtn = overlay.querySelector("[data-modal-confirm]");
    confirmBtn.addEventListener("click", async () => {
        try {
            confirmBtn.disabled = true;
            await onConfirm(overlay);
            close();
        } catch (err) {
            const msg = overlay.querySelector(".review-modal-result");
            msg.textContent = err.message || "Errore";
            msg.className = "review-modal-result result-message error";
            msg.style.display = "block";
        } finally {
            confirmBtn.disabled = false;
        }
    });
    return overlay;
}

// ---------------------------------------------------------------
// Modal: lascia/modifica recensione
// ---------------------------------------------------------------
async function openReviewModal({ targetType, targetId, rateeId, rateeName, existing, onSuccess }) {
    const isEdit = !!existing;
    const initialScore = existing?.score || 5;
    const initialComment = existing?.comment || "";

    const bodyHtml = `
        <p>Stai recensendo <strong>${escapeHtmlSafe(rateeName)}</strong></p>
        <div class="form-group">
            <label>Voto</label>
            <div class="review-stars-input" data-score="${initialScore}">
                ${[1,2,3,4,5].map(n => `<i class="fas fa-star" data-value="${n}"></i>`).join("")}
            </div>
        </div>
        <div class="form-group">
            <label for="review-comment">Commento (facoltativo)</label>
            <textarea id="review-comment" rows="3" maxlength="2000"
                      placeholder="Com'e' andata?">${escapeHtmlSafe(initialComment)}</textarea>
        </div>
        ${isEdit ? `<p class="hint-text">Le recensioni possono essere modificate entro 30 giorni dalla pubblicazione.</p>` : ""}
    `;

    _modal({
        title: isEdit ? "Modifica recensione" : "Lascia una recensione",
        bodyHtml,
        confirmLabel: isEdit ? "Salva" : "Pubblica",
        onConfirm: async (overlay) => {
            const starsEl = overlay.querySelector(".review-stars-input");
            const score = parseInt(starsEl.dataset.score, 10);
            const comment = overlay.querySelector("#review-comment").value.trim();
            if (!score || score < 1 || score > 5) throw new Error("Scegli un voto da 1 a 5");

            if (isEdit) {
                await ReviewsAPI.update(existing.id, { score, comment });
            } else {
                await ReviewsAPI.create({
                    ratee_id: rateeId,
                    target_type: targetType,
                    target_id: targetId,
                    score, comment,
                });
            }
            showReviewToast(isEdit ? "Recensione aggiornata" : "Recensione pubblicata");
            if (typeof onSuccess === "function") onSuccess();
        },
    });

    // Logica clic-stelle (con hover effetto)
    const overlay = document.body.lastElementChild;
    const starsEl = overlay.querySelector(".review-stars-input");
    const stars = starsEl.querySelectorAll("i");
    const paint = (val) => stars.forEach(s => {
        const v = parseInt(s.dataset.value, 10);
        s.classList.toggle("active", v <= val);
    });
    paint(initialScore);
    stars.forEach(s => {
        s.addEventListener("mouseenter", () => paint(parseInt(s.dataset.value, 10)));
        s.addEventListener("click", () => {
            const v = parseInt(s.dataset.value, 10);
            starsEl.dataset.score = v;
            paint(v);
        });
    });
    starsEl.addEventListener("mouseleave", () => paint(parseInt(starsEl.dataset.score, 10)));
}

// ---------------------------------------------------------------
// Modal: "Accetta richiesta" (owner sceglie controparte)
// ---------------------------------------------------------------
async function openAcceptModal({ targetType, targetId, onSuccess }) {
    const isJob = targetType === "job";
    const candidatesPromise = isJob
        ? ReviewsAPI.jobCandidates(targetId)
        : ReviewsAPI.itemCandidates(targetId);

    let candidates = [];
    try { candidates = (await candidatesPromise) || []; } catch (e) { candidates = []; }

    const optionsHtml = candidates.length
        ? candidates.map(c => `<option value="${c.id}">${escapeHtmlSafe(c.full_name)} (@${escapeHtmlSafe(c.username || "")})</option>`).join("")
        : `<option value="">Nessun utente ti ha contattato in chat</option>`;

    _modal({
        title: isJob ? "Accetta richiesta sul lavoretto" : "Accetta destinatario per l'oggetto",
        bodyHtml: `
            <p>Scegli l'utente che ${isJob ? "eseguira'/ricevera' il lavoretto" : "ricevera' l'oggetto"}.
               Solo gli utenti che ti hanno contattato in chat compaiono qui.</p>
            <div class="form-group">
                <label for="accept-user-select">Utente</label>
                <select id="accept-user-select">${optionsHtml}</select>
            </div>
        `,
        confirmLabel: "Accetta",
        onConfirm: async (overlay) => {
            const sel = overlay.querySelector("#accept-user-select");
            const userId = parseInt(sel.value, 10);
            if (!userId) throw new Error("Seleziona un utente");
            if (isJob) await ReviewsAPI.jobAccept(targetId, userId);
            else await ReviewsAPI.itemAccept(targetId, userId);
            if (onSuccess) onSuccess();
        },
    });
}

// ---------------------------------------------------------------
// Modal: "Segna come completato/ceduto"
// ---------------------------------------------------------------
async function openCompleteModal({ targetType, targetId, onSuccess }) {
    const isJob = targetType === "job";
    _modal({
        title: isJob ? "Segna lavoretto come completato" : "Segna oggetto come ceduto",
        bodyHtml: `<p>Confermi che la transazione e' avvenuta? Da qui in poi entrambe le parti potranno lasciare una recensione.</p>`,
        confirmLabel: "Conferma",
        onConfirm: async () => {
            if (isJob) await ReviewsAPI.jobComplete(targetId);
            else await ReviewsAPI.itemComplete(targetId);
            if (onSuccess) onSuccess();
        },
    });
}

// ---------------------------------------------------------------
// Lista recensioni ricevute (es. nel profilo)
// ---------------------------------------------------------------
async function loadProfileReviews(userId, container) {
    if (!container) return;
    container.innerHTML = '<div class="loading">Caricamento recensioni...</div>';
    try {
        const reviews = (await ReviewsAPI.forUser(userId)) || [];
        if (!reviews.length) {
            container.innerHTML = '<div class="empty-state">Nessuna recensione ricevuta.</div>';
            return;
        }
        const myId = APP_STATE.currentUser?.id;
        container.innerHTML = reviews.map(r => {
            const own = myId && r.rater_id === myId;
            const editable = own && _withinEditWindow(r.created_at);
            return `
            <div class="review-card" data-review-id="${r.id}">
                <div class="review-card-head">
                    <strong>${escapeHtmlSafe(r.rater_name || `Utente #${r.rater_id}`)}</strong>
                    <span class="review-card-stars">${_smallStars(r.score)}</span>
                </div>
                ${r.comment ? `<p class="review-card-body">${escapeHtmlSafe(r.comment)}</p>` : ""}
                <div class="review-card-meta">
                    ${formatDateSafe(r.created_at)}
                    · su ${r.target_type === "job" ? "lavoretto" : "scambio/regalo"} #${r.target_id}
                    ${editable ? `<button class="btn btn-outline btn-small" data-action="edit-review">Modifica</button>
                                  <button class="btn btn-outline btn-small danger-btn" data-action="del-review">Elimina</button>` : ""}
                </div>
            </div>`;
        }).join("");

        container.querySelectorAll("[data-action='edit-review']").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = parseInt(btn.closest("[data-review-id]").dataset.reviewId, 10);
                const r = reviews.find(x => x.id === id);
                if (!r) return;
                openReviewModal({
                    targetType: r.target_type, targetId: r.target_id,
                    rateeId: r.ratee_id, rateeName: "(stesso utente)",
                    existing: r,
                });
            });
        });
        container.querySelectorAll("[data-action='del-review']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const id = parseInt(btn.closest("[data-review-id]").dataset.reviewId, 10);
                if (!confirm("Eliminare la recensione?")) return;
                try {
                    await ReviewsAPI.remove(id);
                    loadProfileReviews(userId, container);
                } catch (err) {
                    alert(err.message);
                }
            });
        });
    } catch (e) {
        container.innerHTML = `<div class="result-message error">${escapeHtmlSafe(e.message)}</div>`;
    }
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
// ---------------------------------------------------------------
// Modal: profilo pubblico utente (info essenziali + recensioni)
// ---------------------------------------------------------------
async function openUserProfileModal(userId) {
    if (!userId) return;
    // Apriamo il modal subito con un loader, poi fetch in parallelo.
    const overlay = document.createElement("div");
    overlay.className = "review-modal-overlay";
    overlay.innerHTML = `
        <div class="review-modal user-profile-modal">
            <div class="review-modal-header">
                <h3 id="upm-name">Profilo utente</h3>
                <button class="review-modal-close" type="button"><i class="fas fa-times"></i></button>
            </div>
            <div class="review-modal-body">
                <div id="upm-summary" class="user-profile-summary">
                    <div class="loading">Caricamento...</div>
                </div>
                <h4 style="margin-top:1rem;"><i class="fas fa-star"></i> Recensioni ricevute</h4>
                <div id="upm-reviews"></div>
            </div>
        </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector(".review-modal-close").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    // Fetch profilo + recensioni in parallelo
    try {
        const [user] = await Promise.all([
            fetch(getApiUrl(`/users/${userId}`)).then(r => r.ok ? r.json() : null),
            loadProfileReviews(userId, overlay.querySelector("#upm-reviews")),
        ]);
        if (user) {
            overlay.querySelector("#upm-name").textContent = user.full_name || user.username || `Utente #${userId}`;
            overlay.querySelector("#upm-summary").innerHTML = `
                <p><strong>@${escapeHtmlSafe(user.username || "")}</strong></p>
                ${user.zone ? `<p><i class="fas fa-map-marker-alt"></i> ${escapeHtmlSafe(user.zone)}</p>` : ""}
                ${user.bio ? `<p>${escapeHtmlSafe(user.bio)}</p>` : ""}
                <p>${renderStars(user.rating, user.rating_count || 0)}</p>
            `;
        } else {
            overlay.querySelector("#upm-summary").innerHTML = `<p class="hint-text">Profilo non disponibile.</p>`;
        }
    } catch (err) {
        overlay.querySelector("#upm-summary").innerHTML = `<div class="result-message error">${escapeHtmlSafe(err.message)}</div>`;
    }
}
window.openUserProfileModal = openUserProfileModal;

// Toast minimale (in alto a dx) per conferme review.
function showReviewToast(text, kind = "success") {
    const t = document.createElement("div");
    t.className = `review-toast ${kind}`;
    t.innerHTML = `<i class="fas fa-${kind === "success" ? "check-circle" : "exclamation-triangle"}"></i> ${escapeHtmlSafe(text)}`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => {
        t.classList.remove("show");
        setTimeout(() => t.remove(), 300);
    }, 2500);
}

function _smallStars(score) {
    const n = Math.max(0, Math.min(5, score|0));
    return '<i class="fas fa-star"></i>'.repeat(n) + '<i class="far fa-star"></i>'.repeat(5 - n);
}
function _withinEditWindow(iso) {
    if (!iso) return false;
    const d = new Date(iso);
    return (Date.now() - d.getTime()) < 30 * 24 * 3600 * 1000;
}
// Alias verso il globale escapeHtml di config.js per retrocompatibilita'.
const escapeHtmlSafe = escapeHtml;
function formatDateSafe(iso) {
    if (!iso) return "";
    try { return new Date(iso).toLocaleDateString("it-IT"); }
    catch { return iso; }
}
