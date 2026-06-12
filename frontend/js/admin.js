// =====================================================
// Pannello amministrazione
// =====================================================
// Mostrato solo se APP_STATE.currentUser.is_admin === true.
// Suddiviso in tab: overview, settings, reports, users, content, audit.

const AdminAPI = {
    async _req(method, path, body) {
        const opts = { method, headers: authHeaders() };
        if (body !== undefined) opts.body = JSON.stringify(body);
        let res;
        try {
            res = await fetch(getApiUrl(path), opts);
        } catch (err) {
            throw new Error("Connessione al server fallita: " + err.message);
        }
        const text = await res.text();
        let data = null;
        let parseError = null;
        if (text) {
            try { data = JSON.parse(text); }
            catch (err) { parseError = err; }
        }
        if (!res.ok) {
            const detail = data?.detail;
            const msg = typeof detail === "string"
                ? detail
                : (detail ? JSON.stringify(detail) : `Errore ${res.status} su ${path}`);
            console.error("[admin]", method, path, "->", res.status, text.slice(0, 300));
            throw new Error(msg);
        }
        // Tutti gli endpoint admin GET ritornano JSON. Se il body non e'
        // JSON valido (tipico: nginx gira la richiesta sul fallback statico
        // e ti restituisce index.html), urla forte invece di fingere 0
        // ovunque. Se il body e' davvero vuoto, dillo.
        if (method === "GET" && data === null) {
            const looksLikeHtml = /^\s*<(?:!doctype|html)/i.test(text || "");
            console.error("[admin] body non-JSON da", path,
                "status", res.status,
                "html?", looksLikeHtml,
                "preview:", (text || "").slice(0, 200));
            if (looksLikeHtml) {
                throw new Error(
                    `${path} ha risposto con HTML (status ${res.status}). ` +
                    `Probabile reverse-proxy che non instrada il prefisso al backend FastAPI.`
                );
            }
            if (parseError) {
                throw new Error(`Body non-JSON da ${path}: ${parseError.message}`);
            }
            throw new Error(`Risposta vuota da ${path} (status ${res.status})`);
        }
        return data;
    },
    stats:      ()                  => AdminAPI._req("GET", "/admin/stats"),
    settings:   ()                  => AdminAPI._req("GET", "/admin/settings"),
    setSetting: (key, value, isPub) => AdminAPI._req("PUT", `/admin/settings/${encodeURIComponent(key)}`, { value, is_public: isPub }),
    delSetting: (key)               => AdminAPI._req("DELETE", `/admin/settings/${encodeURIComponent(key)}`),
    users:      (search)            => AdminAPI._req("GET", `/admin/users${search ? "?search=" + encodeURIComponent(search) : ""}`),
    setRole:    (id, payload)       => AdminAPI._req("PATCH", `/admin/users/${id}/role`, payload),
    setBan:     (id, payload)       => AdminAPI._req("PATCH", `/admin/users/${id}/ban`, payload),
    delUser:    (id)                => AdminAPI._req("DELETE", `/admin/users/${id}`),
    audit:      ()                  => AdminAPI._req("GET", "/admin/audit-log"),
    clearAudit: (olderThanDays)     => AdminAPI._req(
        "DELETE",
        olderThanDays
            ? `/admin/audit-log?older_than_days=${olderThanDays}`
            : "/admin/audit-log"
    ),
    reports:    (status)            => AdminAPI._req("GET", `/moderation/reports${status ? "?status=" + encodeURIComponent(status) : ""}`),
    setReport:  (id, payload)       => AdminAPI._req("PATCH", `/moderation/reports/${id}`, payload),
    delContent: (type, id)          => AdminAPI._req("DELETE", `/moderation/content/${type}/${id}`),
};

// =====================================================
// Boot del pannello
// =====================================================

function initAdminPanel() {
    setupAdminTabs();
    setupAdminForms();
    setupAdminListeners();
}

function setupAdminTabs() {
    const buttons = document.querySelectorAll(".admin-tab-btn");
    const panes = document.querySelectorAll(".admin-tab-pane");
    buttons.forEach(btn => {
        btn.addEventListener("click", () => {
            const tab = btn.dataset.adminTab;
            buttons.forEach(b => b.classList.toggle("active", b === btn));
            panes.forEach(p => p.classList.toggle("active", p.id === `admin-tab-${tab}`));
            loadAdminTabData(tab);
        });
    });
}

function loadAdminTabData(tab) {
    if (tab === "overview") loadAdminStats();
    else if (tab === "settings") loadAdminSettings();
    else if (tab === "reports") loadAdminReports();
    else if (tab === "users") loadAdminUsers();
    else if (tab === "content") loadAdminContent();
    else if (tab === "audit") loadAdminAudit();
}

function setupAdminListeners() {
    document.getElementById("admin-reports-refresh")?.addEventListener("click", loadAdminReports);
    document.getElementById("admin-reports-filter")?.addEventListener("change", loadAdminReports);
    document.getElementById("admin-users-refresh")?.addEventListener("click", loadAdminUsers);
    document.getElementById("admin-users-search")?.addEventListener("input", debounce(loadAdminUsers, 300));
    document.getElementById("admin-content-refresh")?.addEventListener("click", loadAdminContent);
    document.querySelectorAll(".admin-subtab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".admin-subtab-btn")
                .forEach(b => b.classList.toggle("active", b === btn));
            loadAdminContent();
        });
    });
    document.getElementById("admin-audit-refresh")?.addEventListener("click", loadAdminAudit);
    document.getElementById("admin-audit-clear-old")?.addEventListener("click", async () => {
        if (!confirm("Eliminare le voci di audit log piu' vecchie di 30 giorni?")) return;
        try {
            const res = await AdminAPI.clearAudit(30);
            alert(res?.detail || "Pulizia eseguita");
            loadAdminAudit();
        } catch (err) { alert(err.message); }
    });
    document.getElementById("admin-audit-clear-all")?.addEventListener("click", async () => {
        if (!confirm("Eliminare TUTTE le voci dell'audit log? L'azione non e' reversibile.")) return;
        try {
            const res = await AdminAPI.clearAudit();
            alert(res?.detail || "Pulizia eseguita");
            loadAdminAudit();
        } catch (err) { alert(err.message); }
    });
}

function debounce(fn, ms) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn(...args), ms);
    };
}

// =====================================================
// Overview
// =====================================================

async function loadAdminStats() {
    const el = document.getElementById("admin-stats");
    if (!el) return;
    el.innerHTML = '<div class="loading">Caricamento...</div>';
    try {
        const s = (await AdminAPI.stats()) || {};
        const cards = [
            { label: "Utenti", value: s.users, icon: "users", sub: `${s.admins} admin · ${s.moderators} mod` },
            { label: "Bannati", value: s.users_banned, icon: "user-slash" },
            { label: "Lavoretti", value: s.jobs, icon: "tools" },
            { label: "Scambio/Regalo", value: s.items, icon: "gift" },
            { label: "Eventi", value: s.events, icon: "calendar-alt" },
            { label: "Chat / messaggi", value: `${s.chat_rooms} / ${s.chat_messages}`, icon: "comments" },
            { label: "Segnalazioni aperte", value: s.reports_open, icon: "flag", sub: `${s.reports_total} totali` },
        ];
        el.innerHTML = cards.map(c => `
            <div class="admin-stat-card">
                <div class="admin-stat-icon"><i class="fas fa-${c.icon}"></i></div>
                <div class="admin-stat-value">${c.value ?? 0}</div>
                <div class="admin-stat-label">${c.label}</div>
                ${c.sub ? `<div class="admin-stat-sub">${c.sub}</div>` : ""}
            </div>
        `).join("");
    } catch (e) {
        el.innerHTML = `<div class="result-message error">${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================
// Settings
// =====================================================

const SIMPLE_KEYS = [
    "site_name", "site_description", "welcome_message",
    "logo_url", "favicon_url", "primary_color",
    "contact_email", "locale",
];
const LIST_KEYS = ["zones", "job_categories", "event_categories"];

async function loadAdminSettings() {
    try {
        const rows = await AdminAPI.settings();
        const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
        for (const k of SIMPLE_KEYS) {
            const el = document.getElementById(`setting-${k}`);
            if (el) el.value = map[k] ?? "";
        }
        for (const k of LIST_KEYS) {
            const el = document.getElementById(`setting-${k}`);
            if (el) {
                const arr = Array.isArray(map[k]) ? map[k] : [];
                el.value = arr.join("\n");
            }
        }
    } catch (e) {
        showAdminMessage("admin-site-result", e.message, "error");
    }
}

function setupAdminForms() {
    document.getElementById("admin-site-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            for (const k of SIMPLE_KEYS) {
                const el = document.getElementById(`setting-${k}`);
                if (!el) continue;
                await AdminAPI.setSetting(k, el.value, true);
            }
            showAdminMessage("admin-site-result", "Impostazioni salvate", "success");
            // Riapplica al volo header/title senza reload
            if (typeof loadSiteSettings === "function") loadSiteSettings();
        } catch (err) {
            showAdminMessage("admin-site-result", err.message, "error");
        }
    });

    document.getElementById("admin-lists-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
            for (const k of LIST_KEYS) {
                const el = document.getElementById(`setting-${k}`);
                if (!el) continue;
                const arr = el.value.split("\n").map(s => s.trim()).filter(Boolean);
                await AdminAPI.setSetting(k, arr, true);
            }
            showAdminMessage("admin-lists-result", "Liste aggiornate", "success");
            if (typeof loadSiteSettings === "function") loadSiteSettings();
        } catch (err) {
            showAdminMessage("admin-lists-result", err.message, "error");
        }
    });
}

// =====================================================
// Reports
// =====================================================

async function loadAdminReports() {
    const el = document.getElementById("admin-reports-list");
    if (!el) return;
    el.innerHTML = '<div class="loading">Caricamento...</div>';
    const status = document.getElementById("admin-reports-filter")?.value || "";
    try {
        const reports = (await AdminAPI.reports(status)) || [];
        if (!reports.length) {
            el.innerHTML = '<div class="empty-state">Nessuna segnalazione.</div>';
            return;
        }
        el.innerHTML = reports.map(r => `
            <div class="admin-row" data-report-id="${r.id}">
                <div class="admin-row-main">
                    <div>
                        <strong>${escapeHtml(r.target_type)}</strong> #${r.target_id}
                        <span class="badge badge-${r.status}">${r.status}</span>
                    </div>
                    <div class="admin-row-meta">
                        Motivo: ${escapeHtml(r.reason)}
                        ${r.description ? ` — ${escapeHtml(r.description)}` : ""}
                    </div>
                    <div class="admin-row-meta hint-text">
                        Reporter #${r.reporter_id} · ${formatDate(r.created_at)}
                    </div>
                </div>
                <div class="admin-row-actions">
                    <button class="btn btn-outline btn-small" data-action="report-status" data-status="reviewing">In revisione</button>
                    <button class="btn btn-primary btn-small" data-action="report-status" data-status="resolved">Risolvi</button>
                    <button class="btn btn-outline btn-small" data-action="report-status" data-status="dismissed">Archivia</button>
                    <button class="btn btn-outline btn-small danger-btn" data-action="report-delete-target">
                        <i class="fas fa-trash"></i> Elimina contenuto
                    </button>
                </div>
            </div>
        `).join("");

        el.querySelectorAll("[data-action='report-status']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const row = btn.closest("[data-report-id]");
                const id = row.dataset.reportId;
                try {
                    await AdminAPI.setReport(id, { status: btn.dataset.status });
                    loadAdminReports();
                } catch (err) {
                    alert(err.message);
                }
            });
        });
        el.querySelectorAll("[data-action='report-delete-target']").forEach(btn => {
            btn.addEventListener("click", async () => {
                const row = btn.closest("[data-report-id]");
                const id = row.dataset.reportId;
                const report = reports.find(x => String(x.id) === String(id));
                if (!report) return;
                if (!confirm(`Eliminare il ${report.target_type} #${report.target_id}?`)) return;
                try {
                    await AdminAPI.delContent(report.target_type, report.target_id);
                    await AdminAPI.setReport(id, { status: "resolved", resolution_note: "Contenuto eliminato" });
                    loadAdminReports();
                } catch (err) {
                    alert(err.message);
                }
            });
        });
    } catch (e) {
        el.innerHTML = `<div class="result-message error">${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================
// Users & ruoli
// =====================================================

async function loadAdminUsers() {
    const el = document.getElementById("admin-users-list");
    if (!el) return;
    el.innerHTML = '<div class="loading">Caricamento...</div>';
    const search = document.getElementById("admin-users-search")?.value || "";
    try {
        const users = (await AdminAPI.users(search)) || [];
        if (!users.length) {
            el.innerHTML = '<div class="empty-state">Nessun utente trovato.</div>';
            return;
        }
        const me = APP_STATE.currentUser;
        el.innerHTML = users.map(u => {
            const isMe = me && u.id === me.id;
            return `
            <div class="admin-row" data-user-id="${u.id}">
                <div class="admin-row-main">
                    <div>
                        <strong>${escapeHtml(u.full_name || u.username || u.email)}</strong>
                        ${u.is_admin ? '<span class="badge badge-admin">Admin</span>' : ""}
                        ${u.is_moderator && !u.is_admin ? '<span class="badge badge-mod">Moderatore</span>' : ""}
                        ${u.is_banned ? '<span class="badge badge-banned">Bannato</span>' : ""}
                        ${isMe ? '<span class="badge">Tu</span>' : ""}
                    </div>
                    <div class="admin-row-meta hint-text">
                        ${escapeHtml(u.email)} · @${escapeHtml(u.username || "")} · #${u.id}
                    </div>
                    ${u.ban_reason ? `<div class="admin-row-meta">Motivo ban: ${escapeHtml(u.ban_reason)}</div>` : ""}
                </div>
                <div class="admin-row-actions">
                    <label class="admin-toggle">
                        <input type="checkbox" data-action="toggle-mod" ${u.is_moderator ? "checked" : ""} ${isMe && u.is_admin ? "disabled" : ""}> Mod
                    </label>
                    <label class="admin-toggle">
                        <input type="checkbox" data-action="toggle-admin" ${u.is_admin ? "checked" : ""} ${isMe ? "disabled" : ""}> Admin
                    </label>
                    ${u.is_banned
                        ? `<button class="btn btn-outline btn-small" data-action="unban">Sblocca</button>`
                        : `<button class="btn btn-outline btn-small danger-btn" data-action="ban" ${isMe || u.is_admin ? "disabled" : ""}>Banna</button>`}
                    <button class="btn btn-outline btn-small danger-btn" data-action="delete" ${isMe || u.is_admin ? "disabled" : ""}>
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>`;
        }).join("");

        el.querySelectorAll("[data-action='toggle-mod']").forEach(input => {
            input.addEventListener("change", async (e) => {
                const id = e.target.closest("[data-user-id]").dataset.userId;
                try { await AdminAPI.setRole(id, { is_moderator: e.target.checked }); }
                catch (err) { alert(err.message); loadAdminUsers(); }
            });
        });
        el.querySelectorAll("[data-action='toggle-admin']").forEach(input => {
            input.addEventListener("change", async (e) => {
                const id = e.target.closest("[data-user-id]").dataset.userId;
                try { await AdminAPI.setRole(id, { is_admin: e.target.checked }); loadAdminUsers(); }
                catch (err) { alert(err.message); loadAdminUsers(); }
            });
        });
        el.querySelectorAll("[data-action='ban']").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                if (btn.disabled) return;
                const reason = prompt("Motivo del ban (facoltativo)") || "";
                const id = e.target.closest("[data-user-id]").dataset.userId;
                try { await AdminAPI.setBan(id, { is_banned: true, reason }); loadAdminUsers(); }
                catch (err) { alert(err.message); }
            });
        });
        el.querySelectorAll("[data-action='unban']").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const id = e.target.closest("[data-user-id]").dataset.userId;
                try { await AdminAPI.setBan(id, { is_banned: false }); loadAdminUsers(); }
                catch (err) { alert(err.message); }
            });
        });
        el.querySelectorAll("[data-action='delete']").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                if (btn.disabled) return;
                const id = e.target.closest("[data-user-id]").dataset.userId;
                if (!confirm("Eliminare definitivamente l'utente e tutti i suoi contenuti?")) return;
                try { await AdminAPI.delUser(id); loadAdminUsers(); }
                catch (err) { alert(err.message); }
            });
        });
    } catch (e) {
        el.innerHTML = `<div class="result-message error">${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================
// Content moderation
// =====================================================

async function loadAdminContent() {
    const el = document.getElementById("admin-content-list");
    if (!el) return;
    const activeBtn = document.querySelector(".admin-subtab-btn.active");
    const type = activeBtn?.dataset.contentType || "job";
    el.innerHTML = '<div class="loading">Caricamento...</div>';

    const endpointMap = { job: "/jobs/", item: "/items/", event: "/events/" };
    try {
        const res = await fetch(getApiUrl(endpointMap[type]));
        const items = await res.json();
        if (!Array.isArray(items) || !items.length) {
            el.innerHTML = '<div class="empty-state">Nessun contenuto.</div>';
            return;
        }
        const now = new Date();
        el.innerHTML = items.map(it => {
            // Tag/badge contestuali per tipo di contenuto
            const badges = [];
            if (type === "event") {
                const start = it.date ? new Date(it.date) : null;
                const end = it.end_date ? new Date(it.end_date) : start;
                if (end && end < now) {
                    badges.push('<span class="badge badge-past">Passato</span>');
                } else if (start && start > now) {
                    badges.push('<span class="badge badge-upcoming">In programma</span>');
                } else {
                    badges.push('<span class="badge badge-live">In corso</span>');
                }
                if (it.status === "cancelled") badges.push('<span class="badge badge-banned">Annullato</span>');
            } else if (type === "item") {
                if (it.status === "taken") badges.push('<span class="badge badge-past">Ceduto</span>');
                else if (it.status === "reserved") badges.push('<span class="badge badge-upcoming">Riservato</span>');
                else if (it.status === "available") badges.push('<span class="badge badge-live">Disponibile</span>');
                if (it.item_type === "scambio") badges.push('<span class="badge">Scambio</span>');
                if (it.item_type === "regalo") badges.push('<span class="badge">Regalo</span>');
            } else if (type === "job") {
                if (it.status === "completed") badges.push('<span class="badge badge-past">Completato</span>');
                else if (it.status === "cancelled") badges.push('<span class="badge badge-banned">Annullato</span>');
                else if (it.status === "in_progress") badges.push('<span class="badge badge-upcoming">In corso</span>');
                if (it.is_offer === false) badges.push('<span class="badge">Richiesta</span>');
                if (it.is_offer === true) badges.push('<span class="badge">Offerta</span>');
            }

            const dateInfo = type === "event" && it.date
                ? `Data evento: ${formatDate(it.date)}`
                : `Pubblicato: ${formatDate(it.created_at)}`;

            return `
            <div class="admin-row" data-content-id="${it.id}">
                <div class="admin-row-main">
                    <div>
                        <strong>${escapeHtml(it.title || "(senza titolo)")}</strong> · #${it.id}
                        ${badges.join("")}
                    </div>
                    <div class="admin-row-meta hint-text">
                        ${escapeHtml((it.description || "").slice(0, 140))}
                    </div>
                    <div class="admin-row-meta hint-text">
                        Autore #${it.user_id ?? it.organizer_id ?? "?"} · ${dateInfo}
                    </div>
                </div>
                <div class="admin-row-actions">
                    <button class="btn btn-outline btn-small danger-btn" data-action="del-content">
                        <i class="fas fa-trash"></i> Elimina
                    </button>
                </div>
            </div>`;
        }).join("");

        el.querySelectorAll("[data-action='del-content']").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const id = e.target.closest("[data-content-id]").dataset.contentId;
                if (!confirm(`Eliminare il ${type} #${id}?`)) return;
                try { await AdminAPI.delContent(type, id); loadAdminContent(); }
                catch (err) { alert(err.message); }
            });
        });
    } catch (e) {
        el.innerHTML = `<div class="result-message error">${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================
// Audit log
// =====================================================

async function loadAdminAudit() {
    const el = document.getElementById("admin-audit-list");
    if (!el) return;
    el.innerHTML = '<div class="loading">Caricamento...</div>';
    try {
        const rows = (await AdminAPI.audit()) || [];
        if (!rows.length) {
            el.innerHTML = '<div class="empty-state">Nessuna azione registrata.</div>';
            return;
        }
        el.innerHTML = rows.map(r => `
            <div class="admin-row">
                <div class="admin-row-main">
                    <div>
                        <strong>${escapeHtml(r.action)}</strong>
                        ${r.target_type ? ` · ${escapeHtml(r.target_type)} #${r.target_id ?? "?"}` : ""}
                    </div>
                    ${r.note ? `<div class="admin-row-meta">${escapeHtml(r.note)}</div>` : ""}
                    <div class="admin-row-meta hint-text">
                        Attore #${r.actor_id} · ${formatDate(r.created_at)}
                    </div>
                </div>
            </div>
        `).join("");
    } catch (e) {
        el.innerHTML = `<div class="result-message error">${escapeHtml(e.message)}</div>`;
    }
}

// =====================================================
// Helpers
// =====================================================

function showAdminMessage(elId, msg, kind) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = msg;
    el.className = `result-message ${kind}`;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 4000);
}

// escapeHtml e' definito globalmente in config.js

function formatDate(s) {
    if (!s) return "";
    try { return new Date(s).toLocaleString("it-IT"); }
    catch { return s; }
}

// =====================================================
// Init
// =====================================================
document.addEventListener("DOMContentLoaded", initAdminPanel);
