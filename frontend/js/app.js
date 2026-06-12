// =====================================================
// INIZIALIZZAZIONE
// =====================================================

document.addEventListener("DOMContentLoaded", () => {
    initApp();
});

function initApp() {
    setupNavigation();
    setupForms();
    setupEventListeners();
    setupChatEventListeners();

    checkInitialStatus();

    if (APP_STATE.token) {
        checkLoggedInUser();
    } else {
        updateUIForLoginState();
    }

    // La home e' la pagina attiva di default: setActivePage non viene
    // chiamato all'avvio, quindi gli "eventi di oggi" li carichiamo qui.
    if (typeof loadHomeTodayEvents === "function") loadHomeTodayEvents();
}

// =====================================================
// NAVIGAZIONE
// =====================================================

// Stato visibile della pagina (sezione attiva). Mantenuto sincrono con
// history.state per gestire il tasto "indietro" del telefono.
function getActivePageName() {
    const sec = document.querySelector(".page.active");
    return sec ? sec.id.replace(/-page$/, "") : "home";
}

// Cambia pagina UI. Se push=true scrive uno step in history (default: si').
function setActivePage(targetPage, opts = {}) {
    const push = opts.push !== false;
    const pages = document.querySelectorAll(".page");
    const navLinks = document.querySelectorAll(".nav-link");

    pages.forEach(p => p.classList.remove("active"));
    document.getElementById(`${targetPage}-page`)?.classList.add("active");
    navLinks.forEach(l => l.classList.remove("active"));
    document.querySelector(`.nav-link[data-page="${targetPage}"]`)?.classList.add("active");

    if (targetPage === "profile" && APP_STATE.isLoggedIn) {
        loadUserProfile();
    }
    if (targetPage === "users" && APP_STATE.isLoggedIn) {
        if (typeof loadAndDisplayUsers === "function") loadAndDisplayUsers();
        else loadUsers();
    }
    if (targetPage === "jobs") {
        loadJobs();
        updateJobsFormVisibility();
    }
    if (targetPage === "items") {
        if (typeof loadItems === "function") loadItems();
        if (typeof updateItemsFormVisibility === "function") updateItemsFormVisibility();
    }
    if (targetPage === "events") {
        if (typeof loadEvents === "function") loadEvents();
        if (typeof updateEventsFormVisibility === "function") updateEventsFormVisibility();
    }
    if (targetPage === "home") {
        // popola gli "eventi di oggi" sotto le feature card
        if (typeof loadHomeTodayEvents === "function") loadHomeTodayEvents();
    }
    if (targetPage === "admin") {
        if (!APP_STATE.currentUser?.is_admin) {
            // Non admin: non mostriamo nulla, torniamo alla home
            setActivePage("home", { push: false });
            return;
        }
        if (typeof loadAdminTabData === "function") loadAdminTabData("overview");
    }

    if (push) {
        const newState = { page: targetPage };
        history.pushState(newState, "", "#" + targetPage);
    }
}

// Pusha uno step "overlay" (chat/lightbox) sopra la pagina corrente, cosi'
// il primo back del telefono chiude l'overlay invece di uscire.
function pushOverlayState(name) {
    const page = (history.state && history.state.page) || getActivePageName();
    history.pushState({ page, overlay: name }, "", `#${page}/${name}`);
}
// items.js (e in generale gli altri script) usano pushOverlayState dal window
window.pushOverlayState = pushOverlayState;

function chiudiOverlayCorrenti() {
    let chiusoQualcosa = false;
    const lightbox = document.getElementById("items-lightbox");
    if (lightbox && !lightbox.hasAttribute("hidden")) {
        if (typeof closeItemsLightbox === "function") closeItemsLightbox();
        chiusoQualcosa = true;
    }
    const chatOverlay = document.getElementById("chat-overlay");
    if (chatOverlay && chatOverlay.style.display && chatOverlay.style.display !== "none") {
        closeChatOverlay();
        chiusoQualcosa = true;
    }
    const sidebar = document.getElementById("chat-list-sidebar");
    if (sidebar && sidebar.style.display && sidebar.style.display !== "none") {
        closeChatList();
        chiusoQualcosa = true;
    }
    return chiusoQualcosa;
}

function setupNavigation() {

    const navLinks = document.querySelectorAll(".nav-link");

    navLinks.forEach(link => {
        link.addEventListener("click", function (e) {
            e.preventDefault();
            const targetPage = this.getAttribute("data-page");
            setActivePage(targetPage, { push: true });
        });
    });

    document.getElementById("logout-btn")?.addEventListener("click", () => {
        authService.logout();
        updateUIForLoginState();
        showMessage("Logout effettuato con successo!", "success");
        setActivePage("home", { push: true });
    });

    // Feature card della home: cliccabili come bottoni di navigazione
    document.querySelectorAll(".feature-link").forEach((el) => {
        el.addEventListener("click", () => {
            const target = el.getAttribute("data-feature-page");
            if (target) setActivePage(target, { push: true });
        });
    });

    // Stato iniziale + listener back/forward del browser/telefono
    if (!history.state) {
        history.replaceState({ page: getActivePageName() }, "", location.hash || "");
    }

    window.addEventListener("popstate", (e) => {
        const incoming = e.state || { page: "home" };
        const incomingHasOverlay = !!incoming.overlay;

        // Se l'utente sta tornando indietro da uno step "overlay", chiudi gli
        // overlay visibili senza ulteriori push.
        if (!incomingHasOverlay) chiudiOverlayCorrenti();

        // Allinea la pagina visibile a quella indicata dallo state, senza
        // fare un nuovo push (lo state e' gia' nello stack).
        if (incoming.page && incoming.page !== getActivePageName()) {
            setActivePage(incoming.page, { push: false });
        }
    });
}

// =====================================================
// STATO LOGIN UI
// =====================================================

function updateUIForLoginState() {

    const loginBtn = document.querySelector('.nav-link[data-page="login"]');
    const registerBtn = document.querySelector('.nav-link[data-page="register"]');
    const profileBtn = document.querySelector('.nav-link[data-page="profile"]');
    const usersBtn = document.querySelector('.nav-link[data-page="users"]');
    const adminBtn = document.getElementById("nav-admin");
    const logoutBtn = document.getElementById("logout-btn");
    // userStatus era nel box "Stato Sistema" della home, ora rimosso.
    // Manteniamo l'optional chaining cosi' funziona anche se il nodo manca.
    const userStatus = document.getElementById("user-status");

    if (APP_STATE.isLoggedIn) {
        if (loginBtn) loginBtn.style.display = "none";
        if (registerBtn) registerBtn.style.display = "none";
        if (profileBtn) profileBtn.style.display = "block";
        if (logoutBtn) logoutBtn.style.display = "block";
        if (usersBtn) usersBtn.style.display = "block";
        if (adminBtn) adminBtn.style.display = APP_STATE.currentUser?.is_admin ? "block" : "none";

        if (APP_STATE.currentUser && userStatus) {
            userStatus.textContent = `Loggato come ${APP_STATE.currentUser.username}`;
            userStatus.className = "status logged";
        }
    } else {
        if (loginBtn) loginBtn.style.display = "block";
        if (registerBtn) registerBtn.style.display = "block";
        if (profileBtn) profileBtn.style.display = "none";
        if (logoutBtn) logoutBtn.style.display = "none";
        if (usersBtn) usersBtn.style.display = "none";
        if (adminBtn) adminBtn.style.display = "none";

        if (userStatus) {
            userStatus.textContent = "Non loggato";
            userStatus.className = "status not-logged";
        }
    }

    updateJobsFormVisibility();
    if (typeof updateItemsFormVisibility === "function") updateItemsFormVisibility();
    if (typeof updateEventsFormVisibility === "function") updateEventsFormVisibility();
    updateChatUIForLoginState();
}

// =====================================================
// FORMS
// =====================================================

function setupForms() {
    setupRegisterForm();
    setupLoginForm();
    setupJobsForm();
    if (typeof setupItemsForm === "function") setupItemsForm();
    if (typeof setupEventsForm === "function") setupEventsForm();
}

// ---------------- REGISTER (CORRETTO) ----------------
function setupRegisterForm() {
    const registerForm = document.getElementById("register-form");
    if (!registerForm) return;

    registerForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        clearRegisterErrors();

        const password = document.getElementById("reg-password").value;
        const confirmPassword = document.getElementById("reg-confirm-password").value;

        if (password !== confirmPassword) {
            showFieldError("confirm-password", "Le password non corrispondono");
            return;
        }

        const userData = {
            email: document.getElementById("reg-email").value,
            username: document.getElementById("reg-username").value,
            full_name: document.getElementById("reg-fullname").value,
            password: password,
            phone: document.getElementById("reg-phone").value,
            age: parseInt(document.getElementById("reg-age").value),
            bio: document.getElementById("reg-bio").value,
            skills: document.getElementById("reg-skills").value,
            zone: document.getElementById("reg-zone").value
        };

        const result = await authService.register(userData);

        if (result.success) {
            showMessage("Registrazione completata! Login automatico...", "success", "register-result");

            const loginResult = await authService.login(userData.username, userData.password);

            if (loginResult.success) {
                // Aggiorna APP_STATE con i dati del login
                APP_STATE.token = loginResult.token;
                APP_STATE.isLoggedIn = true;
                APP_STATE.currentUser = loginResult.user;
                
                updateUIForLoginState();
                
                // Reset form
                registerForm.reset();
                
                // Naviga al profilo via setActivePage (cosi' history step
                // si aggiorna e il tasto indietro del telefono funziona).
                setActivePage("profile", { push: true });

                showMessage("Login automatico effettuato!", "success", "register-result");
            } else {
                showMessage("Registrazione OK ma login automatico fallito", "error", "register-result");
            }
        } else {
            if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) {
                for (const [field, message] of Object.entries(result.fieldErrors)) {
                    showFieldError(field, message);
                }
            } else {
                showMessage(result.error || "Errore registrazione", "error", "register-result");
            }
        }
    });
}

function clearRegisterErrors() {
    document.querySelectorAll(".form-group").forEach(group => {
        group.classList.remove("error-field");
        const error = group.querySelector(".field-error");
        if (error) error.remove();
    });
}

function showFieldError(field, message) {
    const input = document.getElementById(`reg-${field}`);
    if (!input) return;

    const formGroup = input.closest(".form-group");
    formGroup.classList.add("error-field");

    const existingError = formGroup.querySelector(".field-error");
    if (existingError) existingError.remove();

    const errorDiv = document.createElement("div");
    errorDiv.className = "field-error";
    errorDiv.textContent = message;
    formGroup.appendChild(errorDiv);
}

// ---------------- LOGIN ----------------
function setupLoginForm() {
    const loginForm = document.getElementById("login-form");
    if (!loginForm) return;

    // Mostra/nascondi password
    const showPasswordCheck = document.getElementById("show-password");
    const passwordInput = document.getElementById("login-password");
    if (showPasswordCheck && passwordInput) {
        showPasswordCheck.addEventListener("change", function () {
            passwordInput.type = this.checked ? "text" : "password";
        });
    }

    loginForm.addEventListener("submit", async function (e) {
        e.preventDefault();

        const username = document.getElementById("login-username").value;
        const password = document.getElementById("login-password").value;

        const result = await authService.login(username, password);

        if (result.success) {
            // Aggiorna APP_STATE con i dati del login
            APP_STATE.token = result.token;
            APP_STATE.isLoggedIn = true;
            APP_STATE.currentUser = result.user;
            
            showMessage("Login effettuato!", "success", "login-result");
            loginForm.reset();
            updateUIForLoginState();

            // Naviga al profilo via setActivePage (history step + tasto indietro)
            setActivePage("profile", { push: true });
        } else {
            showMessage(result.error || "Errore login", "error", "login-result");
        }
    });
}

// =====================================================
// FUNZIONI HELPER PROFILO
// =====================================================

function toggleProfileSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (!section) return;
    
    // Nascondi tutte le altre sezioni del profilo
    const allSections = ['profile-edit-section', 'profile-password-section', 'profile-delete-section'];
    allSections.forEach(id => {
        if (id !== sectionId) {
            hideProfileSection(id);
        }
    });
    
    // Toggle della sezione richiesta
    if (section.style.display === 'none' || section.style.display === '') {
        section.style.display = 'block';
    } else {
        section.style.display = 'none';
    }
}

function hideProfileSection(sectionId) {
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'none';
    }
}

function showProfileError(message, resultElementId) {
    const resultElement = document.getElementById(resultElementId);
    if (resultElement) {
        // Messaggi di errore più parlenti
        let friendlyMessage = message;
        
        if (message.includes('422') || message.includes('validation')) {
            friendlyMessage = '⚠️ Dati non validi. Controlla tutti i campi e riprova.';
        } else if (message.includes('401') || message.includes('unauthorized')) {
            friendlyMessage = '🔒 Sessione scaduta. Effettua nuovamente il login.';
        } else if (message.includes('403') || message.includes('forbidden')) {
            friendlyMessage = '🚫 Non hai i permessi per eseguire questa operazione.';
        } else if (message.includes('404') || message.includes('not found')) {
            friendlyMessage = '🔍 Risorsa non trovata. Riprova più tardi.';
        } else if (message.includes('500') || message.includes('server error')) {
            friendlyMessage = '🛠️ Errore del server. Riprova tra qualche minuto.';
        } else if (message.includes('network') || message.includes('connessione')) {
            friendlyMessage = '🌐 Problema di connessione. Controlla la tua rete.';
        } else if (message.includes('password')) {
            friendlyMessage = '🔑 ' + message;
        } else if (message.includes('email') || message.includes('username')) {
            friendlyMessage = '📧 ' + message;
        }
        
        resultElement.innerHTML = `<div class="error">${friendlyMessage}</div>`;
        resultElement.style.display = 'block';
        
        // Auto-hide dopo 5 secondi per errori non critici
        if (!message.includes('sessione') && !message.includes('permessi')) {
            setTimeout(() => {
                resultElement.style.display = 'none';
            }, 5000);
        }
    }
}

// =====================================================
// PROFILO
// =====================================================

async function loadUserProfile() {
    const profileInfo = document.getElementById("profile-info");
    profileInfo.innerHTML = "Caricamento...";

    const result = await authService.getCurrentUser();

    if (!result.success) {
        profileInfo.innerHTML = `<div class="result-message error">${escapeHtml(result.error)}</div>`;
        return;
    }

    const user = result.data;

    profileInfo.innerHTML = `
        <div class="profile-card">
            <p><strong>Nome:</strong> ${escapeHtml(user.full_name)}</p>
            <p><strong>Email:</strong> ${escapeHtml(user.email)}</p>
            <p><strong>Username:</strong> ${escapeHtml(user.username)}</p>
            <p><strong>Telefono:</strong> ${escapeHtml(user.phone || "-")}</p>
            <p><strong>Età:</strong> ${Number(user.age) || 0}</p>
            <p><strong>Zona:</strong> ${escapeHtml(user.zone)}</p>
            <p><strong>Competenze:</strong> ${escapeHtml(user.skills || "-")}</p>
            <p><strong>Bio:</strong> ${escapeHtml(user.bio || "-")}</p>
            <p><strong>Rating:</strong> ${typeof renderStars === "function"
                ? renderStars(user.rating, user.rating_count || 0)
                : escapeHtml(String(user.rating))}</p>
        </div>
        <div class="profile-reviews-section">
            <h3><i class="fas fa-star"></i> Recensioni ricevute</h3>
            <div id="profile-reviews-list"></div>
        </div>
    `;

    if (typeof loadProfileReviews === "function") {
        loadProfileReviews(user.id, document.getElementById("profile-reviews-list"));
    }

    // Compila i form di modifica profilo con i dati correnti
    const fullnameInput = document.getElementById("profile-fullname");
    const phoneInput = document.getElementById("profile-phone");
    const ageInput = document.getElementById("profile-age");
    const zoneSelect = document.getElementById("profile-zone");
    const skillsInput = document.getElementById("profile-skills");
    const bioInput = document.getElementById("profile-bio");

    if (fullnameInput) fullnameInput.value = user.full_name || "";
    if (phoneInput) phoneInput.value = user.phone || "";
    if (ageInput) ageInput.value = user.age || "";
    if (zoneSelect) zoneSelect.value = user.zone || "";
    if (skillsInput) skillsInput.value = user.skills || "";
    if (bioInput) bioInput.value = user.bio || "";
}

// =====================================================
// LISTA UTENTI
// =====================================================

async function loadUsers(searchText = "") {
    const usersList = document.getElementById("users-list");
    if (!usersList) return;

    usersList.innerHTML = "Caricamento utenti...";

    // Preparo URL con parametro ricerca
    let url = getApiUrl(API_CONFIG.ENDPOINTS.USERS);
    if (searchText && searchText.trim().length > 0) {
        url += `?search=${encodeURIComponent(searchText.trim())}`;
    }
    try {
        const response = await fetch(url, {
            headers: {
                ...API_CONFIG.DEFAULT_HEADERS,
                Authorization: `Bearer ${APP_STATE.token}`
            }
        });
        const data = await response.json();
        if (!response.ok) {
            usersList.innerHTML = "Errore caricamento utenti";
            return;
        }
        if (!data.length) {
            usersList.innerHTML = "Nessun utente trovato";
            return;
        }
        usersList.innerHTML = data.map(user => `
            <div class="user-card">
                <h3>${user.full_name}</h3>
                <p><strong>Username:</strong> ${user.username}</p>
                <p><strong>Zona:</strong> ${user.zone}</p>
                <p><strong>Competenze:</strong> ${user.skills || "-"}</p>
                <p><strong>Rating:</strong> ${typeof renderStars === "function"
                    ? renderStars(user.rating, user.rating_count || 0)
                    : user.rating}</p>
            </div>
        `).join("");
    } catch (err) {
        usersList.innerHTML = "Errore di connessione";
    }
}
// Listener su barra ricerca
const searchBtn = document.getElementById("search-btn");
if (searchBtn) {
    searchBtn.addEventListener("click", function () {
        const searchValue = document.getElementById("user-search").value;
        loadUsers(searchValue);
    });
}
// Listener su input (hit enter)
const userSearch = document.getElementById("user-search");
if (userSearch) {
    userSearch.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            loadUsers(this.value);
        }
    });
}

// =====================================================
// STATUS
// =====================================================

// La home non mostra piu' il box "Stato Sistema": l'API e DB status non
// sono piu' utili nell'UI utente. Manteniamo la funzione vuota per
// retrocompatibilita' con i punti che la chiamano.
async function checkInitialStatus() { /* no-op */ }

async function checkLoggedInUser() {
    const result = await authService.getCurrentUser();

    if (!result.success) {
        console.warn("Token non valido, logout automatico");
        authService.logout();
        updateUIForLoginState();
        return;
    }

    APP_STATE.currentUser = result.data;
    APP_STATE.isLoggedIn = true;
    updateUIForLoginState();
}

// =====================================================
// HELPERS
// =====================================================

function showMessage(text, type, containerId = null) {
    const messageDiv = document.createElement("div");
    messageDiv.className = `result-message ${type}`;
    messageDiv.textContent = text;

    if (containerId) {
        const container = document.getElementById(containerId);
        if (container) {
            container.innerHTML = "";
            container.appendChild(messageDiv);
        }
    } else {
        document.body.appendChild(messageDiv);
        setTimeout(() => messageDiv.remove(), 4000);
    }
}

function setupEventListeners() {
    document.getElementById("refresh-profile")?.addEventListener("click", loadUserProfile);
    document.getElementById("test-api")?.addEventListener("click", checkInitialStatus);

    // Toggle form modifica profilo
    document.getElementById("toggle-edit-profile")?.addEventListener("click", () => {
        toggleProfileSection('profile-edit-section');
    });

    // Toggle form cambio password
    document.getElementById("toggle-change-password")?.addEventListener("click", () => {
        toggleProfileSection('profile-password-section');
    });

    // Toggle form eliminazione account
    document.getElementById("toggle-delete-account")?.addEventListener("click", () => {
        toggleProfileSection('profile-delete-section');
    });

    // Annulla eliminazione account
    document.getElementById("cancel-delete-account")?.addEventListener("click", () => {
        hideProfileSection('profile-delete-section');
    });

    // Form modifica profilo
    const profileEditForm = document.getElementById("profile-edit-form");
    if (profileEditForm) {
        profileEditForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const payload = {
                full_name: document.getElementById("profile-fullname").value,
                phone: document.getElementById("profile-phone").value,
                age: parseInt(document.getElementById("profile-age").value, 10),
                zone: document.getElementById("profile-zone").value,
                skills: document.getElementById("profile-skills").value,
                bio: document.getElementById("profile-bio").value,
            };
            const result = await authService.updateProfile(payload);
            if (result.success) {
                showMessage("Profilo aggiornato con successo!", "success", "profile-edit-result");
                hideProfileSection('profile-edit-section');
                loadUserProfile();
            } else {
                showProfileError(result.error || "Errore durante l'aggiornamento del profilo", "profile-edit-result");
            }
        });
    }

    // Form cambio password
    const passwordForm = document.getElementById("profile-password-form");
    if (passwordForm) {
        passwordForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const currentPassword = document.getElementById("current-password").value;
            const newPassword = document.getElementById("new-password").value;
            const confirmNewPassword = document.getElementById("confirm-new-password").value;

            if (newPassword !== confirmNewPassword) {
                showProfileError("Le nuove password non coincidono. Riprova.", "profile-password-result");
                return;
            }

            if (newPassword.length < 8) {
                showProfileError("La nuova password deve essere di almeno 8 caratteri.", "profile-password-result");
                return;
            }

            const result = await authService.changePassword(currentPassword, newPassword);
            if (result.success) {
                showMessage("Password aggiornata con successo!", "success", "profile-password-result");
                passwordForm.reset();
                hideProfileSection('profile-password-section');
            } else {
                showProfileError(result.error || "Errore durante il cambio password", "profile-password-result");
            }
        });
    }

    // Eliminazione account
    const deleteAccountBtn = document.getElementById("delete-account-btn");
    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener("click", async () => {
            const conferma = window.confirm(
                "⚠️ Sei sicuro di voler eliminare definitivamente il tuo account?\n\nQuesta operazione è irreversibile e cancellerà:\n• Tutti i tuoi dati personali\n• Tutti i tuoi annunci di lavoretti\n• Il tuo storico attività\n\nVuoi procedere con l'eliminazione?"
            );
            if (!conferma) return;

            const result = await authService.deleteAccount();
            if (result.success) {
                showMessage("Account eliminato con successo. Verrai reindirizzato alla home.", "success", "profile-delete-result");
                setTimeout(() => {
                    authService.logout();
                    updateUIForLoginState();
                    document.querySelector('.nav-link[data-page="home"]')?.click();
                }, 2000);
            } else {
                showProfileError(result.error || "Errore durante l'eliminazione dell'account", "profile-delete-result");
            }
        });
    }

    // Navigazione dai bottoni nei form (login/register)
    document.getElementById("go-to-register")?.addEventListener("click", () => {
        document.querySelector('.nav-link[data-page="register"]')?.click();
    });
    document.getElementById("go-to-login")?.addEventListener("click", () => {
        document.querySelector('.nav-link[data-page="login"]')?.click();
    });

    document.getElementById("jobs-refresh")?.addEventListener("click", () => loadJobs());
    document.getElementById("jobs-search-btn")?.addEventListener("click", applyJobsFilters);
    document.getElementById("jobs-search")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyJobsFilters();
        }
    });
    document.getElementById("jobs-filter-category")?.addEventListener("change", applyJobsFilters);
    document.getElementById("jobs-filter-type")?.addEventListener("change", applyJobsFilters);
    document.getElementById("jobs-filter-zone")?.addEventListener("change", applyJobsFilters);
    document.getElementById("jobs-reset-filters")?.addEventListener("click", resetJobsFilters);
    document.getElementById("jobs-toggle-form-btn")?.addEventListener("click", () => toggleJobsForm(true));
    document.getElementById("jobs-close-form-btn")?.addEventListener("click", () => toggleJobsForm(false));

    // Click su una thumb di un lavoretto -> apre la lightbox (riusa quella di items)
    document.getElementById("jobs-list")?.addEventListener("click", (e) => {
        const thumb = e.target.closest(".item-media-clickable");
        if (!thumb) return;
        const card = thumb.closest(".job-card[data-job-id]");
        if (!card) return;
        const jobId = parseInt(card.getAttribute("data-job-id"), 10);
        const startIdx = parseInt(thumb.getAttribute("data-thumb-idx"), 10) || 0;
        const job = JOBS_CACHE.find((j) => j.id === jobId);
        if (!job || !Array.isArray(job.media) || !job.media.length) return;
        const imgs = job.media.filter((m) => m.media_type === "image");
        if (!imgs.length) return;
        const startInImgs = imgs.findIndex((m) => m.media_url === job.media[startIdx]?.media_url);
        if (typeof openItemsLightbox === "function") {
            openItemsLightbox(imgs, Math.max(0, startInImgs));
        }
    });

    // ----- Scambio / Regalo (stesso schema di Lavoretti) -----
    document.getElementById("items-refresh")?.addEventListener("click", () => loadItems());
    document.getElementById("items-search-btn")?.addEventListener("click", applyItemsFilters);
    document.getElementById("items-search")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applyItemsFilters();
        }
    });
    document.getElementById("items-filter-type")?.addEventListener("change", applyItemsFilters);
    document.getElementById("items-filter-zone")?.addEventListener("change", applyItemsFilters);
    document.getElementById("items-filter-status")?.addEventListener("change", applyItemsFilters);
    document.getElementById("items-reset-filters")?.addEventListener("click", resetItemsFilters);
    document.getElementById("items-toggle-form-btn")?.addEventListener("click", () => toggleItemsForm(true));
    document.getElementById("items-close-form-btn")?.addEventListener("click", () => toggleItemsForm(false));
}

// =====================================================
// LAVORETTI
// =====================================================

let JOBS_CACHE = [];
let CURRENT_JOB_EDIT_ID = null;

function updateJobsFormVisibility() {
    const toggleWrapper = document.getElementById("jobs-form-toggle-wrapper");
    const formWrapper = document.getElementById("jobs-form-wrapper");
    if (!toggleWrapper || !formWrapper) return;

    if (APP_STATE.isLoggedIn) {
        toggleWrapper.style.display = "block";
        formWrapper.style.display = "none";
    } else {
        toggleWrapper.style.display = "none";
        formWrapper.style.display = "none";
    }
}

function toggleJobsForm(show) {
    const formWrapper = document.getElementById("jobs-form-wrapper");
    const toggleWrapper = document.getElementById("jobs-form-toggle-wrapper");
    if (!formWrapper || !toggleWrapper) return;

    if (show) {
        formWrapper.style.display = "block";
        toggleWrapper.style.display = "none";
    } else {
        formWrapper.style.display = "none";
        toggleWrapper.style.display = "block";
    }
}

function applyJobsFilters() {
    const searchText = (document.getElementById("jobs-search")?.value || "").trim().toLowerCase();
    const category = document.getElementById("jobs-filter-category")?.value || "";
    const type = document.getElementById("jobs-filter-type")?.value || "";
    const zone = document.getElementById("jobs-filter-zone")?.value || "";

    let filtered = [...JOBS_CACHE];

    if (searchText) {
        filtered = filtered.filter(
            (job) =>
                (job.title && job.title.toLowerCase().includes(searchText)) ||
                (job.description && job.description.toLowerCase().includes(searchText)) ||
                (job.category && job.category.toLowerCase().includes(searchText)) ||
                (job.required_skills && job.required_skills.toLowerCase().includes(searchText))
        );
    }
    if (category) filtered = filtered.filter((j) => j.category === category);
    if (type === "offer") filtered = filtered.filter((j) => j.is_offer === true);
    if (type === "request") filtered = filtered.filter((j) => j.is_offer === false);
    if (zone) filtered = filtered.filter((j) => j.location_zone === zone);

    renderJobsList(filtered);
}

function resetJobsFilters() {
    document.getElementById("jobs-search").value = "";
    document.getElementById("jobs-filter-category").value = "";
    document.getElementById("jobs-filter-type").value = "";
    document.getElementById("jobs-filter-zone").value = "";
    applyJobsFilters();
}

function setupJobsForm() {
    const jobsForm = document.getElementById("jobs-form");
    if (!jobsForm) return;

    jobsForm.addEventListener("submit", async function (e) {
        e.preventDefault();

        if (!APP_STATE.isLoggedIn || !APP_STATE.token) {
            showMessage("Devi essere loggato per pubblicare un annuncio", "error", "jobs-result");
            return;
        }

        const jobTypeValue = document.querySelector('input[name="job-type"]:checked')?.value || "offer";
        const preferredDays = Array.from(document.querySelectorAll('input[name="job-days"]:checked')).map(
            (c) => c.value
        );
        const preferredTimes = Array.from(document.querySelectorAll('input[name="job-times"]:checked')).map(
            (c) => c.value
        );

        const priceAmountValue = document.getElementById("job-price-amount").value;
        const estimatedHoursValue = document.getElementById("job-estimated-hours").value;

        const jobData = {
            title: document.getElementById("job-title").value,
            description: document.getElementById("job-description").value,
            category: document.getElementById("job-category").value,

            is_offer: jobTypeValue === "offer",

            price_type: document.getElementById("job-price-type").value,
            price_amount: priceAmountValue ? parseFloat(priceAmountValue) : null,
            price_currency: "EUR",
            price_note: document.getElementById("job-price-note").value || null,

            location_zone: document.getElementById("job-zone").value || null,
            location_details: document.getElementById("job-location-details").value || null,
            is_remote: document.getElementById("job-is-remote").checked,
            at_client_home: document.getElementById("job-at-client-home").checked,

            time_type: document.getElementById("job-time-type").value,
            estimated_hours: estimatedHoursValue ? parseFloat(estimatedHoursValue) : null,
            preferred_days: preferredDays.length ? preferredDays.join(",") : null,
            preferred_time_slots: preferredTimes.length ? preferredTimes.join(",") : null,
            urgency: document.getElementById("job-urgency").value,

            // I campi "Preferenze di contatto" sono stati rimossi dal form:
            // mandiamo dei default fissi cosi' il backend (che li ha ancora
            // sul model JobPostBase) non lamenta validazione.
            allow_contact_phone: true,
            allow_contact_chat: true,
            extra_contact_info: null,

            required_skills: document.getElementById("job-required-skills").value || null,
            notes: document.getElementById("job-notes").value || null,
            // photo_url legacy: lasciato vuoto, ora si usano gli allegati multipli
            photo_url: null,
        };

        // File allegati accumulati (riusa l'helper di items.js)
        const filesToUpload = [...(typeof JOBS_PENDING_FILES !== "undefined" ? JOBS_PENDING_FILES : [])];
        const validationError = typeof validateItemsFiles === "function"
            ? validateItemsFiles(filesToUpload)
            : null;
        if (validationError) {
            showMessage(validationError, "error", "jobs-result");
            return;
        }

        try {
            let url = getApiUrl(API_CONFIG.ENDPOINTS.JOBS);
            let method = "POST";

            if (CURRENT_JOB_EDIT_ID !== null) {
                url = getApiUrl(`${API_CONFIG.ENDPOINTS.JOBS}${CURRENT_JOB_EDIT_ID}`);
                method = "PUT";
            }

            const response = await fetch(url, {
                method,
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    Authorization: `Bearer ${APP_STATE.token}`,
                },
                body: JSON.stringify(jobData),
            });

            let data = null;
            try {
                data = await response.json();
            } catch (e) {
                data = null;
            }

            if (!response.ok) {
                let baseMsg = `Errore durante la creazione del lavoretto (HTTP ${response.status} ${response.statusText})`;

                let detailMsg = "";
                if (data && data.detail) {
                    if (typeof data.detail === "string") {
                        detailMsg = data.detail;
                    } else {
                        detailMsg = JSON.stringify(data.detail);
                    }
                }

                if (response.status === 405) {
                    detailMsg = detailMsg || "Metodo non consentito. Probabile problema di configurazione del server o del proxy (la rotta /jobs/ non accetta POST sulla porta attuale).";
                } else if (response.status === 401) {
                    detailMsg = detailMsg || "Non sei autorizzato. Prova a rifare il login.";
                }

                const errorText = detailMsg ? `${baseMsg}: ${detailMsg}` : baseMsg;
                showMessage(errorText, "error", "jobs-result");
                console.error("Create job error detail:", { status: response.status, body: data });
                return;
            }

            // Annuncio creato/aggiornato. Se l'utente ha messo allegati,
            // mandiamo l'upload (sostituisce i media esistenti se in edit).
            const createdJobId = (data && data.id) || CURRENT_JOB_EDIT_ID;
            if (createdJobId && filesToUpload.length > 0) {
                try {
                    const fd = new FormData();
                    filesToUpload.forEach((f) => fd.append("files", f));
                    const upRes = await fetch(
                        getApiUrl(`${API_CONFIG.ENDPOINTS.JOBS}${createdJobId}/media`),
                        {
                            method: "POST",
                            headers: { Authorization: `Bearer ${APP_STATE.token}` },
                            body: fd,
                        }
                    );
                    if (!upRes.ok) {
                        const upData = await upRes.json().catch(() => null);
                        const det = upData?.detail
                            ? (typeof upData.detail === "string" ? upData.detail : JSON.stringify(upData.detail))
                            : `HTTP ${upRes.status}`;
                        showMessage(`Annuncio salvato ma errore allegati: ${det}`, "error", "jobs-result");
                    }
                } catch (upErr) {
                    showMessage(`Annuncio salvato ma errore upload: ${upErr.message}`, "error", "jobs-result");
                }
            }

            jobsForm.reset();
            clearJobsMediaPreview();
            showMessage("Annuncio creato con successo!", "success", "jobs-result");
            CURRENT_JOB_EDIT_ID = null;
            toggleJobsForm(false);
            loadJobs();
        } catch (err) {
            console.error("Create job error:", err);
            showMessage("Errore di connessione al server", "error", "jobs-result");
        }
    });

    // listener input file + bottone "rimuovi" + accumulo (mirror di items)
    document.getElementById("job-media")?.addEventListener("change", handleJobsMediaChange);
    document.getElementById("jobs-media-preview")?.addEventListener("click", (e) => {
        const btn = e.target.closest(".item-media-remove");
        if (!btn) return;
        const idx = parseInt(btn.getAttribute("data-idx"), 10);
        if (!isFinite(idx) || idx < 0 || idx >= JOBS_PENDING_FILES.length) return;
        JOBS_PENDING_FILES.splice(idx, 1);
        syncJobsFileInput();
        renderJobsMediaPreview(JOBS_PENDING_FILES);
        const note = document.getElementById("jobs-media-error");
        if (note) note.style.display = "none";
    });
}

// ===== Helpers media per i lavoretti (riusano la logica e gli stili di items) =====

let JOBS_PENDING_FILES = [];

function clearJobsMediaPreview() {
    const box = document.getElementById("jobs-media-preview");
    if (box) box.innerHTML = "";
    JOBS_PENDING_FILES = [];
}

function syncJobsFileInput() {
    const input = document.getElementById("job-media");
    if (!input) return;
    const dt = new DataTransfer();
    JOBS_PENDING_FILES.forEach((f) => dt.items.add(f));
    input.files = dt.files;
}

function renderJobsMediaPreview(files) {
    const box = document.getElementById("jobs-media-preview");
    if (!box) return;
    box.innerHTML = "";
    files.forEach((file, idx) => {
        const isImage = (file.type || "").startsWith("image/");
        const url = URL.createObjectURL(file);
        const wrapper = document.createElement("div");
        wrapper.className = "item-media-thumb";
        const sizeKB = file.size < 1024 * 1024
            ? `${(file.size / 1024).toFixed(0)} KB`
            : `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
        wrapper.innerHTML = `
            ${isImage
                ? `<img class="item-media" src="${url}" alt="anteprima">`
                : `<video class="item-media" controls preload="metadata" src="${url}"></video>`}
            <div class="item-media-info">
                <span class="item-media-name" title="${file.name}">${file.name}</span>
                <span class="item-media-size">${sizeKB}</span>
                <button type="button" class="item-media-remove" data-idx="${idx}" title="Rimuovi">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        box.appendChild(wrapper);
    });
}

function handleJobsMediaChange() {
    const input = document.getElementById("job-media");
    if (!input) return;
    const justPicked = Array.from(input.files || []);
    const MAX = (typeof ITEMS_MAX_ATTACHMENTS !== "undefined") ? ITEMS_MAX_ATTACHMENTS : 3;
    const slotsLeft = MAX - JOBS_PENDING_FILES.length;
    let truncated = false;
    let toAdd = justPicked;
    if (justPicked.length > slotsLeft) {
        toAdd = justPicked.slice(0, Math.max(0, slotsLeft));
        truncated = true;
    }
    const combined = [...JOBS_PENDING_FILES, ...toAdd];
    const error = (typeof validateItemsFiles === "function") ? validateItemsFiles(combined) : null;
    const note = document.getElementById("jobs-media-error");
    if (note) {
        note.textContent = error
            ? error
            : (truncated ? `Limite di ${MAX} allegati raggiunto: alcuni file non sono stati aggiunti.` : "");
        note.style.display = (error || truncated) ? "block" : "none";
        note.classList.toggle("error", !!error);
    }
    if (error) {
        syncJobsFileInput();
        return;
    }
    JOBS_PENDING_FILES = combined;
    syncJobsFileInput();
    renderJobsMediaPreview(JOBS_PENDING_FILES);
}

async function loadJobs() {
    const jobsList = document.getElementById("jobs-list");
    if (!jobsList) return;

    jobsList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Caricamento lavoretti...</div>';

    try {
        const url = getApiUrl(API_CONFIG.ENDPOINTS.JOBS);
        const response = await fetch(url, {
            method: "GET",
            headers: API_CONFIG.DEFAULT_HEADERS,
        });

        let data = null;
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }

        if (!response.ok) {
            let baseMsg = `Errore nel caricamento dei lavoretti (HTTP ${response.status} ${response.statusText})`;
            let detailMsg = "";

            if (data && data.detail) {
                if (typeof data.detail === "string") {
                    detailMsg = data.detail;
                } else {
                    detailMsg = JSON.stringify(data.detail);
                }
            }

            if (response.status === 405) {
                detailMsg = detailMsg || "Metodo non consentito sulla rotta /jobs/. Controllare la configurazione del server/proxy.";
            }

            const finalMsg = detailMsg ? `${baseMsg}: ${detailMsg}` : baseMsg;
            jobsList.innerHTML = `<div class="result-message error">${finalMsg}</div>`;
            console.error("Load jobs error detail:", { status: response.status, body: data });
            return;
        }

        JOBS_CACHE = Array.isArray(data) ? data : [];
        applyJobsFilters();
    } catch (err) {
        console.error("Load jobs error:", err);
        if (jobsList) {
            jobsList.innerHTML = `<div class="result-message error">Errore di connessione al server: ${escapeHtml(err.message)}</div>`;
        }
    }
}

function renderJobsList(jobs) {
    const jobsList = document.getElementById("jobs-list");
    if (!jobsList) return;

    if (!jobs || jobs.length === 0) {
        jobsList.innerHTML = '<div class="no-users"><i class="fas fa-briefcase"></i><h3>Nessun lavoretto trovato</h3><p>Prova a modificare i filtri di ricerca o attendi che vengano pubblicati nuovi annunci</p></div>';
        return;
    }

    jobsList.innerHTML = jobs
        .map((job) => {
            const tipo = job.is_offer ? "Offro aiuto" : "Cerco aiuto";
            const tipoClass = job.is_offer ? "offer" : "request";
            const zona = job.location_zone || "Zona non specificata";
            const categoria = job.category || "-";
            const iconClass = job.is_offer ? "fa-hand-holding-heart" : "fa-search";

            let compensoLabel = "Gratis / volontariato";
            if (job.price_type === "fisso" && job.price_amount) {
                compensoLabel = `${job.price_amount} € totali`;
            } else if (job.price_type === "orario" && job.price_amount) {
                compensoLabel = `${job.price_amount} € / ora`;
            } else if (job.price_type === "scambio") {
                compensoLabel = "Scambio / baratto";
            }
            if (job.price_note) compensoLabel += ` (${job.price_note})`;

            const timeParts = [];
            if (job.time_type === "ricorrente") timeParts.push("Ricorrente");
            else timeParts.push("Una tantum");
            if (job.estimated_hours) timeParts.push(`${job.estimated_hours}h`);
            if (job.preferred_days) timeParts.push(job.preferred_days);
            if (job.preferred_time_slots) timeParts.push(job.preferred_time_slots);
            const quandoLabel = timeParts.length ? timeParts.join(" • ") : "-";

            const skills = job.required_skills
                ? job.required_skills.split(",").map((s) => s.trim()).filter(Boolean)
                : [];

            const isOwner = APP_STATE.currentUser && APP_STATE.currentUser.id === job.user_id;

            // Render allegati: thumb cliccabili che riusano la lightbox di items
            const mediaList = Array.isArray(job.media) ? job.media : [];
            const mediaHtml = mediaList.length === 0 ? "" : `
                <div class="item-media-grid">
                    ${mediaList.map((m, i) => m.media_type === "video"
                        ? `<div class="item-media-thumb" data-thumb-idx="${i}">
                              <video class="item-media" controls preload="metadata" src="${m.media_url}"></video>
                           </div>`
                        : `<div class="item-media-thumb item-media-clickable" data-thumb-idx="${i}">
                              <img class="item-media" loading="lazy" src="${m.media_url}" alt="Allegato annuncio"
                                   onerror="this.classList.add('item-media-broken'); this.alt='Immagine non disponibile';">
                           </div>`
                    ).join("")}
                </div>`;

            return `
            <div class="job-card ${tipoClass}" data-job-id="${job.id}">
                <div class="job-avatar">
                    <i class="fas ${iconClass}"></i>
                </div>
                <div class="job-info">
                    <div class="job-title-row">
                        <h4 class="job-title">${job.title}</h4>
                        <span class="job-type-badge ${tipoClass}">${tipo}</span>
                    </div>
                    <div class="job-meta">
                        <div class="job-meta-item">
                            <i class="fas fa-tag"></i> ${categoria}
                        </div>
                        <div class="job-meta-item">
                            <i class="fas fa-map-marker-alt"></i> ${zona}
                        </div>
                        <div class="job-meta-item">
                            <i class="fas fa-euro-sign"></i> ${compensoLabel}
                        </div>
                        <div class="job-meta-item">
                            <i class="fas fa-clock"></i> ${quandoLabel}
                        </div>
                    </div>
                    <p class="job-description">${job.description}</p>
                    ${mediaHtml}
                    ${
                        skills.length > 0
                            ? `<div class="job-skills">${skills.map((s) => `<span class="job-skill-tag">${s}</span>`).join("")}</div>`
                            : ""
                    }
                    <div class="job-user-info user-clickable" data-user-id="${job.user_id}" title="Vedi profilo e recensioni">
                        <div class="job-user-details">
                            <span class="job-user-name">${job.owner_name || 'Anonimo'}</span>
                            <span class="job-user-zone">${job.owner_zone || ''}</span>
                        </div>
                        <div class="job-user-rating">
                            ${typeof renderStars === "function"
                                ? renderStars(job.owner_rating, job.owner_rating_count || 0)
                                : `<i class="fas fa-star"></i> ${job.owner_rating || '5.0'}`}
                        </div>
                    </div>
                    <div class="job-actions">
                        ${
                            isOwner
                                ? `<button type="button" class="btn btn-secondary btn-small job-edit-btn" data-job-id="${job.id}">
                                        <i class="fas fa-edit"></i> Modifica
                                    </button>
                                    ${job.status === "in_progress"
                                        ? `<button type="button" class="btn btn-primary btn-small job-complete-btn" data-job-id="${job.id}">
                                                <i class="fas fa-check"></i> Segna completato
                                           </button>` : ""}
                                    ${(job.status === "open" || job.status === "in_progress") && !job.accepted_by_user_id
                                        ? `<button type="button" class="btn btn-outline btn-small job-accept-btn" data-job-id="${job.id}">
                                                <i class="fas fa-user-check"></i> Accetta utente
                                           </button>` : ""}
                                    ${job.status === "completed" && job.accepted_by_user_id && job.accepted_by_user_id !== APP_STATE.currentUser?.id
                                        ? `<button type="button" class="btn btn-primary btn-small job-review-btn" data-job-id="${job.id}" data-ratee-id="${job.accepted_by_user_id}" data-ratee-name="${(job.accepted_by_name || 'utente accettato').replace(/"/g, '&quot;')}">
                                                <i class="fas fa-star"></i> Recensisci
                                           </button>` : ""}
                                    <button type="button" class="btn btn-outline btn-small job-delete-btn" data-job-id="${job.id}">
                                        <i class="fas fa-trash-alt"></i> Elimina
                                   </button>`
                                : `<button type="button" class="btn btn-primary btn-small job-chat-btn" data-job-id="${job.id}" data-owner-id="${job.user_id}" data-owner-name="${job.owner_name || 'Anonimo'}">
                                        <i class="fas fa-comments"></i> Contatta
                                   </button>
                                   ${job.status === "completed" && job.accepted_by_user_id === APP_STATE.currentUser?.id
                                        ? `<button type="button" class="btn btn-primary btn-small job-review-btn" data-job-id="${job.id}" data-ratee-id="${job.user_id}" data-ratee-name="${job.owner_name || 'proprietario'}">
                                                <i class="fas fa-star"></i> Recensisci
                                           </button>` : ""}
                                   ${job.status === "in_progress" && job.accepted_by_user_id === APP_STATE.currentUser?.id
                                        ? `<button type="button" class="btn btn-primary btn-small job-complete-btn" data-job-id="${job.id}">
                                                <i class="fas fa-check"></i> Segna completato
                                           </button>` : ""}`
                        }
                    </div>
                </div>
            </div>
        `;
        })
        .join("");

    setupJobCardActions();
}

function setupJobCardActions() {
    const editButtons = document.querySelectorAll(".job-edit-btn");
    const deleteButtons = document.querySelectorAll(".job-delete-btn");

    // Click sul nome/stelle dell'owner -> apre profilo pubblico
    document.querySelectorAll(".user-clickable").forEach(el => {
        el.addEventListener("click", () => {
            const id = parseInt(el.dataset.userId, 10);
            if (id && typeof openUserProfileModal === "function") openUserProfileModal(id);
        });
    });

    // Accept / Complete / Review (delega click sul container per non
    // duplicare i bind a ogni render)
    document.querySelectorAll(".job-accept-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.jobId, 10);
            openAcceptModal({
                targetType: "job", targetId: id,
                onSuccess: () => loadJobs(),
            });
        });
    });
    document.querySelectorAll(".job-complete-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.jobId, 10);
            openCompleteModal({
                targetType: "job", targetId: id,
                onSuccess: () => loadJobs(),
            });
        });
    });
    document.querySelectorAll(".job-review-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = parseInt(btn.dataset.jobId, 10);
            const rateeId = parseInt(btn.dataset.rateeId, 10);
            const rateeName = btn.dataset.rateeName || "utente";
            openReviewModal({
                targetType: "job", targetId: id,
                rateeId, rateeName,
                onSuccess: () => loadJobs(),
            });
        });
    });

    editButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const jobId = parseInt(btn.getAttribute("data-job-id"), 10);
            const job = JOBS_CACHE.find((j) => j.id === jobId);
            if (!job) return;

            CURRENT_JOB_EDIT_ID = jobId;

            document.getElementById("job-title").value = job.title || "";
            document.getElementById("job-description").value = job.description || "";
            document.getElementById("job-category").value = job.category || "";

            const offerRadio = document.querySelector('input[name="job-type"][value="offer"]');
            const requestRadio = document.querySelector('input[name="job-type"][value="request"]');
            if (offerRadio && requestRadio) {
                if (job.is_offer) {
                    offerRadio.checked = true;
                } else {
                    requestRadio.checked = true;
                }
            }

            document.getElementById("job-price-type").value = job.price_type || "gratis";
            document.getElementById("job-price-amount").value = job.price_amount || "";
            document.getElementById("job-price-note").value = job.price_note || "";

            document.getElementById("job-zone").value = job.location_zone || "";
            document.getElementById("job-location-details").value = job.location_details || "";
            document.getElementById("job-is-remote").checked = !!job.is_remote;
            document.getElementById("job-at-client-home").checked = !!job.at_client_home;

            document.getElementById("job-time-type").value = job.time_type || "una_tantum";
            document.getElementById("job-estimated-hours").value = job.estimated_hours || "";

            // Reset giorni/fasce, poi ri-setta se presenti
            document.querySelectorAll('input[name="job-days"]').forEach((c) => (c.checked = false));
            if (job.preferred_days) {
                const days = job.preferred_days.split(",").map((d) => d.trim());
                document
                    .querySelectorAll('input[name="job-days"]')
                    .forEach((c) => (c.checked = days.includes(c.value)));
            }

            document.querySelectorAll('input[name="job-times"]').forEach((c) => (c.checked = false));
            if (job.preferred_time_slots) {
                const slots = job.preferred_time_slots.split(",").map((d) => d.trim());
                document
                    .querySelectorAll('input[name="job-times"]')
                    .forEach((c) => (c.checked = slots.includes(c.value)));
            }

            document.getElementById("job-urgency").value = job.urgency || "normale";

            document.getElementById("job-required-skills").value = job.required_skills || "";
            document.getElementById("job-notes").value = job.notes || "";

            // Reset allegati: in edit l'utente parte senza file selezionati;
            // se ne carica di nuovi sostituiscono quelli esistenti via
            // POST /jobs/{id}/media (vedi setupJobsForm > submit).
            clearJobsMediaPreview();
            const mediaNote = document.getElementById("jobs-edit-media-note");
            if (mediaNote) {
                mediaNote.style.display = "block";
                const n = (job.media || []).length;
                mediaNote.innerHTML = n
                    ? `<i class="fas fa-info-circle"></i> Allegati attuali: ${n}. Se carichi nuovi file, quelli precedenti verranno sostituiti.`
                    : `<i class="fas fa-info-circle"></i> Nessun allegato attuale.`;
            }

            toggleJobsForm(true);
        });
    });

    deleteButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
            const jobId = parseInt(btn.getAttribute("data-job-id"), 10);
            const conferma = window.confirm("Sei sicuro di voler eliminare questo annuncio?");
            if (!conferma) return;

            try {
                const response = await fetch(getApiUrl(`${API_CONFIG.ENDPOINTS.JOBS}${jobId}`), {
                    method: "DELETE",
                    headers: {
                        ...API_CONFIG.DEFAULT_HEADERS,
                        Authorization: `Bearer ${APP_STATE.token}`,
                    },
                });

                if (!response.ok) {
                    let data = null;
                    try {
                        data = await response.json();
                    } catch (e) {
                        data = null;
                    }
                    const msg =
                        data && data.detail
                            ? `Errore nell'eliminazione del lavoretto: ${JSON.stringify(data.detail)}`
                            : "Errore nell'eliminazione del lavoretto";
                    showMessage(msg, "error", "jobs-result");
                    return;
                }

                showMessage("Annuncio eliminato con successo", "success", "jobs-result");
                CURRENT_JOB_EDIT_ID = null;
                loadJobs();
            } catch (err) {
                console.error("Delete job error:", err);
                showMessage(`Errore di connessione durante l'eliminazione: ${err.message}`, "error", "jobs-result");
            }
        });
    });
}

// =====================================================
// CHAT MANAGEMENT
// =====================================================

function setupChatEventListeners() {
    // Pulsante chat toggle
    document.getElementById("chat-toggle-btn")?.addEventListener("click", () => {
        toggleChatList();
    });

    // Pulsanti chat overlay: usano history.back() quando siamo in uno step
    // overlay, cosi' la cronologia resta coerente col tasto indietro.
    document.getElementById("chat-close-btn")?.addEventListener("click", () => {
        if (history.state && history.state.overlay === "chat") history.back();
        else closeChatOverlay();
    });

    document.getElementById("chat-minimize-btn")?.addEventListener("click", () => {
        if (history.state && history.state.overlay === "chat") history.back();
        else minimizeChat();
    });

    document.getElementById("chat-list-close-btn")?.addEventListener("click", () => {
        if (history.state && history.state.overlay === "chat-list") history.back();
        else closeChatList();
    });

    // Form chat
    const chatForm = document.getElementById("chat-form");
    if (chatForm) {
        chatForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            await sendChatMessage();
        });
    }

    // Input chat con auto-resize
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
        chatInput.addEventListener("input", () => {
            // Auto-resize
            chatInput.style.height = "auto";
            chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + "px";
            
            // Abilita/disabilita pulsante invio
            const sendBtn = document.getElementById("chat-send-btn");
            sendBtn.disabled = !chatInput.value.trim();
        });

        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }

    // Event listeners per pulsanti chat nelle job card
    document.addEventListener("click", (e) => {
        if (e.target.closest(".job-chat-btn")) {
            const btn = e.target.closest(".job-chat-btn");
            const jobId = btn.getAttribute("data-job-id");
            const ownerId = btn.getAttribute("data-owner-id");
            const ownerName = btn.getAttribute("data-owner-name");
            openJobChat(jobId, ownerId, ownerName);
        }
    });
}

async function openJobChat(jobId, ownerId, ownerName) {
    if (!APP_STATE.isLoggedIn) {
        showMessage("Devi essere loggato per usare la chat", "error");
        return;
    }

    showChatOverlay();
    
    // Mostra loading
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.innerHTML = '<div class="chat-loading">Apertura chat...</div>';

    // Crea o ottieni la chat room
    const result = await chatService.createChatRoom(parseInt(jobId), parseInt(ownerId));
    
    if (result.success) {
        chatService.currentChatRoom = result.data;
        updateChatHeader(result.data);
        await loadChatMessages(result.data.id);
        chatService.startPolling();
    } else {
        chatMessages.innerHTML = `<div class="chat-error">Errore: ${escapeHtml(result.error)}</div>`;
    }
}

async function loadChatMessages(roomId) {
    const chatMessages = document.getElementById("chat-messages");
    chatMessages.innerHTML = '<div class="chat-loading">Caricamento messaggi...</div>';

    const result = await chatService.getChatMessages(roomId);
    
    if (result.success) {
        chatMessages.innerHTML = '';
        
        if (result.data.length === 0) {
            chatMessages.innerHTML = '<div class="chat-empty">Nessun messaggio. Inizia la conversazione!</div>';
        } else {
            result.data.forEach(message => {
                chatService.addMessageToChat(message);
            });
            chatService.scrollToBottom();
        }
        
        // Marca come letti
        await chatService.markMessagesAsRead(roomId);
    } else {
        chatMessages.innerHTML = `<div class="chat-error">Errore caricamento messaggi: ${escapeHtml(result.error)}</div>`;
    }
}

async function sendChatMessage() {
    const chatInput = document.getElementById("chat-input");
    const content = chatInput.value.trim();

    if (!content || !chatService.currentChatRoom) return;

    const sendBtn = document.getElementById("chat-send-btn");
    const originalText = sendBtn.innerHTML;
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

    const result = await chatService.sendMessage(chatService.currentChatRoom.id, content);

    if (result.success) {
        chatInput.value = "";
        chatInput.style.height = "auto";
        sendBtn.disabled = true;
        chatService.addMessageToChat(result.data);
        chatService.scrollToBottom();
    } else {
        showMessage(`Errore invio messaggio: ${result.error}`, "error");
    }

    sendBtn.disabled = false;
    sendBtn.innerHTML = originalText;
}

function toggleChatList() {
    const sidebar = document.getElementById("chat-list-sidebar");
    const isVisible = sidebar.style.display !== "none";
    if (isVisible) closeChatList();
    else showChatList();
}

async function showChatList() {
    const sidebar = document.getElementById("chat-list-sidebar");
    sidebar.style.display = "block";
    lockBodyScroll(true);
    if (!(history.state && history.state.overlay === "chat-list")) {
        pushOverlayState("chat-list");
    }

    const chatList = document.getElementById("chat-list");
    chatList.innerHTML = '<div class="chat-loading">Caricamento chat...</div>';

    const result = await chatService.getUserChatRooms();

    if (result.success) {
        const rooms = [...(result.data.chat_rooms || [])].sort(
            (a, b) => new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0)
        );
        chatService.chatRooms = rooms;

        if (rooms.length === 0) {
            chatList.innerHTML = '<div class="chat-empty">Nessuna chat attiva</div>';
        } else {
            chatList.innerHTML = rooms.map(room => `
                <div class="chat-list-item" data-room-id="${room.id}">
                    <div class="chat-item-avatar"><i class="fas fa-comments"></i></div>
                    <div class="chat-item-content">
                        <div class="chat-item-header">
                            <span class="chat-item-name">${room.participant1_name === APP_STATE.currentUser?.full_name ? room.participant2_name : room.participant1_name}</span>
                            <span class="chat-item-time">${chatService.formatTime(room.last_message_at)}</span>
                        </div>
                        <div class="chat-item-preview">
                            ${room.job_title ? `<span class="chat-item-job">${room.job_title}</span>` : ''}
                            <span class="chat-item-status">Chat attiva</span>
                        </div>
                    </div>
                    ${room.unread_count > 0 ? `<div class="chat-item-badge">${room.unread_count}</div>` : ''}
                </div>
            `).join('');

            document.querySelectorAll(".chat-list-item").forEach(item => {
                item.addEventListener("click", () => {
                    const roomId = parseInt(item.getAttribute("data-room-id"));
                    openChatFromList(roomId);
                });
            });
        }
    } else {
        chatList.innerHTML = `<div class="chat-error">Errore: ${escapeHtml(result.error)}</div>`;
    }
}

function closeChatList() {
    const sidebar = document.getElementById("chat-list-sidebar");
    sidebar.style.display = "none";
    // sblocca solo se anche la chat overlay e' chiusa
    const overlay = document.getElementById("chat-overlay");
    if (!overlay || overlay.style.display === "none") {
        lockBodyScroll(false);
    }
}

async function openChatFromList(roomId) {
    closeChatList();
    showChatOverlay();
    const room = chatService.chatRooms.find(r => r.id === roomId);
    if (room) {
        chatService.currentChatRoom = room;
        updateChatHeader(room);
        await loadChatMessages(roomId);
        chatService.startPolling();
    }
}

function showChatOverlay() {
    const overlay = document.getElementById("chat-overlay");
    overlay.style.display = "flex";
    lockBodyScroll(true);
    // step in history: il primo back del telefono chiude la chat
    if (!(history.state && history.state.overlay === "chat")) {
        pushOverlayState("chat");
    }
}

function closeChatOverlay() {
    const overlay = document.getElementById("chat-overlay");
    overlay.style.display = "none";
    chatService.stopPolling();
    chatService.currentChatRoom = null;
    // sblocca solo se anche la sidebar chat e' chiusa
    const sidebar = document.getElementById("chat-list-sidebar");
    if (!sidebar || sidebar.style.display === "none") {
        lockBodyScroll(false);
    }
}

// Scroll lock condiviso tra chat e lightbox. Su iOS overflow:hidden non
// basta a fermare lo scroll del body: usiamo position:fixed con la
// posizione di scroll salvata e la ripristiniamo all'unlock. Conta-chiavi:
// si "sblocca" davvero solo quando l'ultimo holder rilascia.
const _SCROLL_LOCK_HOLDERS = new Set();
let _savedScrollY = 0;

function lockBodyScroll(lock, holder = "chat") {
    const body = document.body;
    const wasLocked = _SCROLL_LOCK_HOLDERS.size > 0;

    if (lock) _SCROLL_LOCK_HOLDERS.add(holder);
    else _SCROLL_LOCK_HOLDERS.delete(holder);

    const isLocked = _SCROLL_LOCK_HOLDERS.size > 0;
    if (!wasLocked && isLocked) {
        _savedScrollY = window.scrollY || window.pageYOffset || 0;
        body.style.top = `-${_savedScrollY}px`;
        body.classList.add("is-scroll-locked");
    } else if (wasLocked && !isLocked) {
        body.classList.remove("is-scroll-locked");
        body.style.top = "";
        window.scrollTo(0, _savedScrollY);
    }

    if (holder === "chat") body.classList.toggle("chat-open", _SCROLL_LOCK_HOLDERS.has("chat"));
    if (holder === "lightbox") body.classList.toggle("items-lightbox-open", _SCROLL_LOCK_HOLDERS.has("lightbox"));
}

window.lockBodyScroll = lockBodyScroll;

// =====================================================
// CHAT helpers (reinseriti: erano andati persi nei rebuild precedenti)
// =====================================================

function minimizeChat() {
    closeChatOverlay();
}

function updateChatHeader(chatRoom) {
    const title = document.getElementById("chat-title");
    const subtitle = document.getElementById("chat-subtitle");
    if (!chatRoom) return;
    const otherParticipant = chatRoom.participant1_name === APP_STATE.currentUser?.full_name
        ? chatRoom.participant2_name
        : chatRoom.participant1_name;
    if (title) title.textContent = otherParticipant || "Chat";
    if (subtitle) {
        if (chatRoom.job_title) {
            subtitle.textContent = `Riguardo a: ${chatRoom.job_title}`;
            subtitle.style.display = "block";
        } else {
            subtitle.style.display = "none";
        }
    }
}

function updateChatUIForLoginState() {
    const chatToggleBtn = document.getElementById("chat-toggle-btn");
    if (!chatToggleBtn) return;
    if (APP_STATE.isLoggedIn) {
        chatToggleBtn.style.display = "block";
        if (typeof chatService !== "undefined") chatService.startPolling();
    } else {
        chatToggleBtn.style.display = "none";
        if (typeof chatService !== "undefined") chatService.reset();
        closeChatOverlay();
        closeChatList();
    }
}
