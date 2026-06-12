// =====================================================
// Site Settings — caricate al boot da GET /site/settings
// =====================================================
// Le settings dinamiche del sito (nome, descrizione, logo, colore,
// liste di zone/categorie) vengono lette dal backend e applicate al
// volo al DOM. Cosi' la stessa app puo' essere deployata in qualsiasi
// quartiere senza toccare l'HTML.

const SITE_SETTINGS = {
    site_name: "VicinatoVicino",
    site_description: "",
    welcome_message: "",
    logo_url: "",
    favicon_url: "",
    primary_color: "#2c7a4d",
    contact_email: "",
    locale: "it",
    zones: [],
    job_categories: [],
    event_categories: [],
};

async function loadSiteSettings() {
    try {
        const res = await fetch(getApiUrl("/site/settings"));
        if (!res.ok) return;
        const data = await res.json();
        Object.assign(SITE_SETTINGS, data);
        applySiteSettingsToDOM();
        // Notifica i moduli che vogliono ripopolare i loro <select>
        window.dispatchEvent(new CustomEvent("site-settings-loaded", { detail: SITE_SETTINGS }));
    } catch (err) {
        console.warn("Impossibile caricare site settings:", err);
    }
}

function applySiteSettingsToDOM() {
    const s = SITE_SETTINGS;

    // Title + meta
    if (s.site_name) {
        const suffix = s.site_description ? ` - ${s.site_description}` : "";
        document.title = `${s.site_name}${suffix}`;
    }

    // Header
    const nameEl = document.getElementById("site-name");
    if (nameEl && s.site_name) nameEl.textContent = s.site_name;

    const descEl = document.getElementById("site-description");
    if (descEl && s.site_description) descEl.textContent = s.site_description;

    const logoImg = document.getElementById("site-logo-img");
    const logoIcon = document.getElementById("site-logo-icon");
    if (logoImg && s.logo_url) {
        logoImg.src = s.logo_url;
        logoImg.alt = s.site_name || "logo";
        logoImg.style.display = "inline-block";
        if (logoIcon) logoIcon.style.display = "none";
    }

    // Favicon
    if (s.favicon_url) {
        let link = document.querySelector("link[rel='icon']");
        if (!link) {
            link = document.createElement("link");
            link.rel = "icon";
            document.head.appendChild(link);
        }
        link.href = s.favicon_url;
    }

    // Colore primario via CSS variable. Calcoliamo anche una variante
    // "dark" (-15% luminosita') per gli hover, e una "soft" trasparente
    // per gli accenti, cosi' tutto il sito segue il tema scelto.
    if (s.primary_color) {
        const dark = shadeHex(s.primary_color, -0.15);
        const soft = hexToRgba(s.primary_color, 0.15);
        document.documentElement.style.setProperty("--primary-color", s.primary_color);
        document.documentElement.style.setProperty("--primary-color-dark", dark || s.primary_color);
        if (soft) document.documentElement.style.setProperty("--primary-color-soft", soft);
    }

    // Hero / welcome
    const hero = document.querySelector(".hero .hero-text");
    if (hero && s.welcome_message) hero.textContent = s.welcome_message;
    const heroH = document.querySelector(".hero h2");
    if (heroH && s.site_name) heroH.textContent = `Benvenuto in ${s.site_name}`;

    // Footer
    const footerP = document.querySelector(".footer .container p:first-child");
    if (footerP && s.site_name) {
        const suffix = s.site_description ? ` - ${s.site_description}` : "";
        footerP.textContent = `${s.site_name}${suffix}`;
    }

    // Ripopola tutti i <select> con data-source
    repopulateConfigurableSelects();
}

// Ripopola dinamicamente i <select> di zone/categorie nei form/filtri.
// Strategia "minimamente invasiva": riempie solo i select che hanno gia'
// il pattern noto (id contiene "zone" / "category"), e solo se la lista
// dal server non e' vuota.
function repopulateConfigurableSelects() {
    const fillSelect = (selectEl, values, keepFirst = true) => {
        if (!selectEl || !values || !values.length) return;
        const firstOpt = keepFirst ? selectEl.querySelector("option") : null;
        const currentValue = selectEl.value;
        selectEl.innerHTML = "";
        if (firstOpt) selectEl.appendChild(firstOpt);
        for (const v of values) {
            const opt = document.createElement("option");
            opt.value = v;
            // Capitalizza primo carattere per i label visibili
            opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
            selectEl.appendChild(opt);
        }
        if (currentValue) selectEl.value = currentValue;
    };

    document.querySelectorAll("select").forEach(sel => {
        const id = sel.id || "";
        if (/zone/i.test(id)) {
            fillSelect(sel, SITE_SETTINGS.zones);
        } else if (/job.*category|category.*job|jobs-filter-category|^job-category$/.test(id)) {
            fillSelect(sel, SITE_SETTINGS.job_categories);
        } else if (/event.*category|^event-category$|events-filter-category/.test(id)) {
            fillSelect(sel, SITE_SETTINGS.event_categories);
        }
    });
}

// Helpers colore: schiarire/scurire una hex e convertirla in rgba.
// `pct` < 0 = scurisce, > 0 = schiarisce (es. -0.15 = -15% luminosita').
function shadeHex(hex, pct) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return null;
    const adjust = (h) => {
        const v = parseInt(h, 16);
        const next = Math.max(0, Math.min(255, Math.round(v + 255 * pct)));
        return next.toString(16).padStart(2, "0");
    };
    return `#${adjust(m[1])}${adjust(m[2])}${adjust(m[3])}`;
}

function hexToRgba(hex, alpha) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return null;
    const [r, g, b] = [m[1], m[2], m[3]].map(h => parseInt(h, 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Avvia il caricamento appena il DOM e' pronto.
document.addEventListener("DOMContentLoaded", loadSiteSettings);
