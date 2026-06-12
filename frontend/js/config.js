// Configurazione API
// Usa sempre l'host da cui e' servito il frontend, cosi' funziona sia in
// LAN che dall'esterno (con Nginx che fa da proxy). Non hard-codare IP qui:
// se window.location.origin manca (caso file://), e' meglio fallire esplicitamente.
const API_BASE_URL = window.location.origin || '';

const API_CONFIG = {
    BASE_URL: API_BASE_URL,
    ENDPOINTS: {
        REGISTER: '/users/register',
        LOGIN: '/users/login',
        ME: '/users/me',
        USERS: '/users/',
        JOBS: '/jobs/',
        ITEMS: '/items/',
        EVENTS: '/events/',
        HEALTH: '/health',
        TEST_DB: '/test-db'
    },
    // Headers di default
    DEFAULT_HEADERS: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    }
};

// Helper per costruire URL completi
function getApiUrl(endpoint) {
    return API_CONFIG.BASE_URL + endpoint;
}

// Stato applicazione
const savedUser = localStorage.getItem('user');
const savedToken = localStorage.getItem('token');

const APP_STATE = {
    currentUser: savedUser ? JSON.parse(savedUser) : null,
    token: savedToken,
    isLoggedIn: !!savedToken,
    apiStatus: 'unknown',
    dbStatus: 'unknown'
};

// Inizializza stato login
if (APP_STATE.token) {
    APP_STATE.isLoggedIn = true;
}

// Escape HTML per prevenire XSS quando si inserisce testo controllato
// (anche solo parzialmente: messaggi di errore dal backend, contenuti
// utente, ecc.) tramite innerHTML.
function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

// Helper per gli header di una richiesta JSON autenticata.
// Parte dai DEFAULT_HEADERS, aggiunge Authorization solo se l'utente e'
// loggato, e applica eventuali header extra passati dal chiamante.
function authHeaders(extra) {
    const headers = { ...API_CONFIG.DEFAULT_HEADERS };
    if (APP_STATE.token) {
        headers['Authorization'] = `Bearer ${APP_STATE.token}`;
    }
    return extra ? { ...headers, ...extra } : headers;
}