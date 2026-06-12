class UsersService {
    constructor() {
        this.users = [];
        this.filteredUsers = [];
    }
    
    async loadUsers() {
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.USERS || '/users'), {
                method: 'GET',
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    ...(APP_STATE.token ? {'Authorization': `Bearer ${APP_STATE.token}`} : {})
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.users = await response.json();
            this.filteredUsers = [...this.users];
            
            return { success: true, users: this.users };
            
        } catch (error) {
            console.error('Load users error:', error);
            return { success: false, error: error.message };
        }
    }
    
    filterUsers(searchTerm) {
        if (!searchTerm) {
            this.filteredUsers = [...this.users];
            return this.filteredUsers;
        }
        
        const term = searchTerm.toLowerCase();
        this.filteredUsers = this.users.filter(user => 
            user.full_name.toLowerCase().includes(term) ||
            user.email.toLowerCase().includes(term) ||
            user.username.toLowerCase().includes(term) ||
            (user.skills && user.skills.toLowerCase().includes(term)) ||
            (user.zone && user.zone.toLowerCase().includes(term)) ||
            (user.bio && user.bio.toLowerCase().includes(term))
        );
        
        return this.filteredUsers;
    }
    
    getStats() {
        const stats = {
            total: this.users.length,
            averageAge: 0,
            zones: {},
            skills: new Set(),
            withPhone: 0,
            withBio: 0
        };
        
        if (this.users.length === 0) return stats;
        
        let ageSum = 0;
        this.users.forEach(user => {
            ageSum += user.age || 0;
            
            // Conteggio per zona
            if (user.zone) {
                stats.zones[user.zone] = (stats.zones[user.zone] || 0) + 1;
            }
            
            // Competenze uniche
            if (user.skills) {
                user.skills.split(',').forEach(skill => {
                    if (skill.trim()) {
                        stats.skills.add(skill.trim());
                    }
                });
            }
            
            // Con telefono
            if (user.phone) stats.withPhone++;
            
            // Con bio
            if (user.bio && user.bio.trim()) stats.withBio++;
        });
        
        stats.averageAge = Math.round(ageSum / this.users.length);
        stats.uniqueSkills = stats.skills.size;
        
        return stats;
    }
}

// Istanza globale
const usersService = new UsersService();

// Funzioni per la UI
async function loadAndDisplayUsers() {
    const usersList = document.getElementById('users-list');
    const statsContainer = document.getElementById('users-stats');
    
    usersList.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Caricamento utenti...</div>';
    statsContainer.innerHTML = '';
    
    const result = await usersService.loadUsers();
    
    if (result.success) {
        displayUsers(usersService.filteredUsers);
        displayUsersStats();
    } else {
        usersList.innerHTML = `
            <div class="result-message error">
                <i class="fas fa-exclamation-triangle"></i>
                Errore nel caricamento utenti: ${result.error}
            </div>
        `;
    }
}

function displayUsers(users) {
    const usersList = document.getElementById('users-list');
    
    if (users.length === 0) {
        usersList.innerHTML = `
            <div class="no-users">
                <i class="fas fa-user-slash"></i>
                <h3>Nessun utente trovato</h3>
                <p>Prova a modificare la ricerca o attendi che si registrino nuovi utenti</p>
            </div>
        `;
        return;
    }
    
    usersList.innerHTML = users.map(user => `
        <div class="user-card user-clickable" data-user-id="${user.id}" title="Vedi profilo e recensioni">
            <div class="user-avatar">
                ${escapeHtml((user.full_name || "?").charAt(0).toUpperCase())}
            </div>
            <div class="user-info">
                <div class="user-name">
                    ${escapeHtml(user.full_name)}
                    ${user.is_moderator ? '<span class="badge"><i class="fas fa-shield-alt"></i> Moderatore</span>' : ''}
                </div>

                <div class="user-meta">
                    <div class="meta-item">
                        <i class="fas fa-at"></i>
                        @${escapeHtml(user.username)}
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-map-marker-alt"></i>
                        ${escapeHtml(user.zone || 'Zona non specificata')}
                    </div>
                    <div class="meta-item">
                        <i class="fas fa-birthday-cake"></i>
                        ${Number(user.age) || 0} anni
                    </div>
                    <div class="meta-item">
                        ${typeof renderStars === "function"
                            ? renderStars(user.rating, user.rating_count || 0)
                            : `<i class="fas fa-star"></i> ${(Number(user.rating)||0).toFixed(1)}/5.0`}
                    </div>
                </div>

                ${user.bio ? `
                <div class="user-bio">
                    <strong>Bio:</strong> ${escapeHtml(user.bio)}
                </div>
                ` : ''}

                ${user.skills ? `
                <div class="user-skills">
                    <strong>Competenze:</strong>
                    ${String(user.skills).split(',').map(skill => `
                        <span class="skill-tag">${escapeHtml(skill.trim())}</span>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        </div>
    `).join('');

    // Click sull'intera card -> profilo pubblico con stelle e recensioni
    usersList.querySelectorAll(".user-clickable").forEach(el => {
        el.addEventListener("click", () => {
            const id = parseInt(el.dataset.userId, 10);
            if (id && typeof openUserProfileModal === "function") openUserProfileModal(id);
        });
    });
}

function displayUsersStats() {
    const stats = usersService.getStats();
    const statsContainer = document.getElementById('users-stats');
    
    statsContainer.innerHTML = `
        <h3><i class="fas fa-chart-bar"></i> Statistiche Utenti</h3>
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${stats.total}</div>
                <div class="stat-label">Utenti Totali</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.averageAge}</div>
                <div class="stat-label">Età Media</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.uniqueSkills}</div>
                <div class="stat-label">Competenze Uniche</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.withBio}</div>
                <div class="stat-label">Con Bio</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${stats.withPhone}</div>
                <div class="stat-label">Con Telefono</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-value">${Object.keys(stats.zones).length}</div>
                <div class="stat-label">Zone Diverse</div>
            </div>
        </div>
        
        ${Object.keys(stats.zones).length > 0 ? `
        <div class="zones-distribution" style="margin-top: 1.5rem;">
            <h4>Distribuzione per Zona:</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem;">
                ${Object.entries(stats.zones).map(([zone, count]) => `
                    <span style="background: #e3f2fd; padding: 0.25rem 0.75rem; border-radius: 15px; font-size: 0.9rem;">
                        ${zone}: ${count}
                    </span>
                `).join('')}
            </div>
        </div>
        ` : ''}
    `;
}

// Carica il file users.js in index.html
// Aggiungi questa linea prima della chiusura di </body> in index.html:
// <script src="js/users.js"></script>
