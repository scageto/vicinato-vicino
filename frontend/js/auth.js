// Gestione Autenticazione

class AuthService {
    constructor() {
        this.token = APP_STATE.token;
    }
    
    // Registrazione
    async register(userData) {
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.REGISTER), {
                method: 'POST',
                headers: API_CONFIG.DEFAULT_HEADERS,
                body: JSON.stringify(userData)
            });
    
            const data = await response.json().catch(() => null);
    
            if (!response.ok) {
    
                let fieldErrors = {};
                let generalError = "Errore durante la registrazione";
    
                if (data && data.detail) {
    
                    // 🔹 Caso 400 con oggetto { email: "...", username: "..." }
                    if (typeof data.detail === "object" && !Array.isArray(data.detail)) {
                        fieldErrors = data.detail;
                    }
    
                    // 🔹 Caso 422 Pydantic (lista errori)
                    if (Array.isArray(data.detail)) {
                        data.detail.forEach(err => {
                            const field = err.loc?.[1];
                            if (field) {
                                fieldErrors[field] = err.msg;
                            }
                        });
                    }
    
                    // 🔹 Caso stringa semplice
                    if (typeof data.detail === "string") {
                        generalError = data.detail;
                    }
                }
    
                return {
                    success: false,
                    error: generalError,
                    fieldErrors
                };
            }
    
            return { 
                success: true, 
                data: data 
            };
    
        } catch (error) {
            console.error("Register error:", error);
    
            return {
                success: false,
                error: "Errore di connessione al server",
                fieldErrors: {}
            };
        }
    }
    
    // Login
    async login(username, password) {
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.LOGIN), {
                method: 'POST',
                headers: API_CONFIG.DEFAULT_HEADERS,
                body: JSON.stringify({ username, password })
            });
            
            const data = await response.json().catch(() => ({}));
            
            if (!response.ok) {
                let errorMsg = 'Credenziali non valide';
                if (data && data.detail) {
                    if (typeof data.detail === 'string') {
                        errorMsg = data.detail;
                    } else if (typeof data.detail === 'object' && data.detail.general) {
                        errorMsg = data.detail.general;
                    } else if (Array.isArray(data.detail)) {
                        errorMsg = data.detail.map(e => e.msg || JSON.stringify(e)).join(', ');
                    }
                }
                return { success: false, error: errorMsg };
            }
            
            // Salva il token
            this.token = data.access_token;
            
            // Salva nel localStorage - CHIAVI STANDARDIZZATE
            localStorage.setItem('token', data.access_token);
            if (data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
            
            // Aggiorna APP_STATE
            APP_STATE.token = data.access_token;
            APP_STATE.currentUser = data.user;
            APP_STATE.isLoggedIn = true;
            
            // Restituisci token e user esplicitamente
            return { 
                success: true, 
                data: data,
                token: data.access_token,
                user: data.user
            };
            
        } catch (error) {
            console.error('Login error:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Logout
    logout() {
        this.token = null;
        APP_STATE.token = null;
        APP_STATE.currentUser = null;
        APP_STATE.isLoggedIn = false;
        
        // Pulisci localStorage - CHIAVI STANDARDIZZATE
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        
        return { success: true };
    }
    
    // Ottieni utente corrente
    async getCurrentUser() {
        // Recupera token dal localStorage se non presente in memoria
        if (!this.token) {
            const savedToken = localStorage.getItem('token');
            if (savedToken) {
                this.token = savedToken;
                APP_STATE.token = savedToken;
            }
        }
        
        if (!this.token) {
            return { success: false, error: 'Non autenticato' };
        }
        
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.ME), {
                method: 'GET',
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    'Authorization': `Bearer ${this.token}`
                }
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                if (response.status === 401) {
                    this.logout();
                }
                throw new Error(data.detail || 'Errore recupero utente');
            }
            
            // Aggiorna i dati utente
            APP_STATE.currentUser = data;
            
            // Aggiorna anche nel localStorage
            localStorage.setItem('user', JSON.stringify(data));
            
            return { 
                success: true, 
                data: data 
            };
            
        } catch (error) {
            console.error('Get current user error:', error);
            return { 
                success: false, 
                error: error.message 
            };
        }
    }
    
    // Check stato API
    async checkApiStatus() {
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.HEALTH), {
                method: 'GET',
                headers: API_CONFIG.DEFAULT_HEADERS
            });
            
            if (response.ok) {
                APP_STATE.apiStatus = 'healthy';
                return true;
            } else {
                APP_STATE.apiStatus = 'error';
                return false;
            }
            
        } catch (error) {
            console.error('API check error:', error);
            APP_STATE.apiStatus = 'error';
            return false;
        }
    }
    
    // Check stato Database
    async checkDbStatus() {
        try {
            const response = await fetch(getApiUrl(API_CONFIG.ENDPOINTS.TEST_DB), {
                method: 'GET',
                headers: API_CONFIG.DEFAULT_HEADERS
            });
            
            const data = await response.json();
            
            if (response.ok && data.database === 'connected') {
                APP_STATE.dbStatus = 'healthy';
                return true;
            } else {
                APP_STATE.dbStatus = 'error';
                return false;
            }
            
        } catch (error) {
            console.error('DB check error:', error);
            APP_STATE.dbStatus = 'error';
            return false;
        }
    }
    
    // Metodo per inizializzare lo stato dal localStorage
    initFromStorage() {
        const savedToken = localStorage.getItem('token');
        const savedUser = localStorage.getItem('user');
        
        if (savedToken) {
            this.token = savedToken;
            APP_STATE.token = savedToken;
            
            if (savedUser) {
                try {
                    APP_STATE.currentUser = JSON.parse(savedUser);
                    APP_STATE.isLoggedIn = true;
                } catch (e) {
                    console.error('Errore parsing user data:', e);
                }
            }
        }
    }

    // Aggiorna i dati del profilo
    async updateProfile(profileData) {
        if (!this.token) {
            return { success: false, error: 'Non autenticato' };
        }

        try {
            const response = await fetch(getApiUrl('/users/me'), {
                method: 'PUT',
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify(profileData)
            });

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                return {
                    success: false,
                    error: data && data.detail ? JSON.stringify(data.detail) : 'Errore durante l\'aggiornamento del profilo'
                };
            }

            APP_STATE.currentUser = data;
            localStorage.setItem('user', JSON.stringify(data));

            return { success: true, data };

        } catch (error) {
            console.error('Update profile error:', error);
            return { success: false, error: error.message };
        }
    }

    // Cambio password
    async changePassword(currentPassword, newPassword) {
        if (!this.token) {
            return { success: false, error: 'Non autenticato' };
        }

        try {
            const response = await fetch(getApiUrl('/users/change-password'), {
                method: 'POST',
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    'Authorization': `Bearer ${this.token}`
                },
                body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
            });

            const data = await response.json().catch(() => null);

            if (!response.ok) {
                return {
                    success: false,
                    error: data && data.detail ? JSON.stringify(data.detail) : 'Errore durante il cambio password'
                };
            }

            return { success: true, data };

        } catch (error) {
            console.error('Change password error:', error);
            return { success: false, error: error.message };
        }
    }

    // Elimina account
    async deleteAccount() {
        if (!this.token) {
            return { success: false, error: 'Non autenticato' };
        }

        try {
            const response = await fetch(getApiUrl('/users/me'), {
                method: 'DELETE',
                headers: {
                    ...API_CONFIG.DEFAULT_HEADERS,
                    'Authorization': `Bearer ${this.token}`
                }
            });

            let data = null;
            try {
                data = await response.json();
            } catch (e) {
                data = null;
            }

            if (!response.ok) {
                return {
                    success: false,
                    error: data && data.detail ? JSON.stringify(data.detail) : 'Errore durante l\'eliminazione dell\'account'
                };
            }

            this.logout();
            return { success: true, data };

        } catch (error) {
            console.error('Delete account error:', error);
            return { success: false, error: error.message };
        }
    }
}

// Istanza globale
const authService = new AuthService();

// Inizializza dal localStorage all'avvio
authService.initFromStorage();