# VicinatoVicino

> Una piattaforma open source per connettere i vicini di casa: regali e
> scambi di oggetti, lavoretti e aiuti, eventi di quartiere, chat privata,
> recensioni reciproche. Pensata per girare leggera su un Raspberry Pi e
> servire un singolo quartiere o palazzo.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.135-009688.svg)](https://fastapi.tiangolo.com/)

---

## Indice

- [Cos'è VicinatoVicino](#cosè-vicinatovicino)
- [Funzionalità principali](#funzionalità-principali)
- [Stack tecnico](#stack-tecnico)
- [Requisiti hardware/software](#requisiti-hardware-e-software)
- [Installazione passo-passo](#installazione-passo-passo)
- [Configurazione](#configurazione)
- [Primo avvio e admin](#primo-avvio-e-admin)
- [Reverse proxy nginx](#reverse-proxy-nginx)
- [Avvio come servizio (systemd)](#avvio-come-servizio-systemd)
- [HTTPS in produzione](#https-in-produzione)
- [Manutenzione](#manutenzione)
- [Sicurezza](#sicurezza)
- [Contribuire](#contribuire)
- [Licenza](#licenza)

---

## Cos'è VicinatoVicino

VicinatoVicino è una **piattaforma web di vicinato** che permette agli
abitanti di un quartiere, palazzo o gruppo di condomini di:

- pubblicare e ricevere richieste di aiuti pratici ("Lavoretti e Aiuti");
- regalare o scambiare oggetti ("Regalo e Scambio");
- organizzare e partecipare a eventi locali ("Eventi di Quartiere");
- conversare in privato tramite chat 1-a-1;
- lasciare recensioni reciproche dopo una transazione completata;
- segnalare contenuti inappropriati a un team di moderazione interna.

Non è un social network generico né un marketplace commerciale: è una
**bacheca verticale di prossimità**, leggera, autohosted, senza tracker
né pubblicità.

## Funzionalità principali

- **Tre ruoli**: utente, moderatore, amministratore. Pannello admin con
  panoramica statistiche, gestione utenti (ruoli, ban), modifica
  impostazioni sito, audit log.
- **Pubblicazione contenuti** con upload foto/video (tetto 3 allegati per
  annuncio, immagini ≤ 8 MB, video ≤ 12 MB).
- **Calendario eventi** con vista mensile, partecipazione/disiscrizione,
  cover image opzionale.
- **Chat 1-a-1** legata a un contesto (item, job, oppure libera) con
  notifiche di messaggi non letti.
- **Sistema recensioni** con stelle e commento entro 30 giorni dalla
  transazione (job o item completato).
- **Moderazione**: ogni utente può segnalare contenuti, i moderatori
  vedono la coda dei report, possono risolvere/archiviare e rimuovere
  contenuti.
- **Customizzazione di quartiere** via `config.yaml`: nome, descrizione,
  colore principale, logo, zone selezionabili, categorie di lavoretti e
  eventi. Tutto modificabile anche a runtime dal pannello admin.

## Stack tecnico

| Componente | Tecnologia |
|---|---|
| Backend | Python 3.11, FastAPI 0.135, SQLAlchemy 2 |
| Autenticazione | JWT firmati HS256, bcrypt per password |
| Database | SQLite (default) o Postgres |
| Frontend | HTML5 + CSS3 + JavaScript vanilla, nessun framework |
| Web server | nginx (reverse proxy + file statici + uploads) |
| ASGI | uvicorn |

Nessun database NoSQL, nessun Redis, nessun broker code. Tutto sta in un
processo Python + un DB file + nginx davanti.

## Requisiti hardware e software

**Hardware minimo testato:**

- Raspberry Pi 3 con 1 GB RAM (sufficiente per ~20 utenti attivi)
- Raspberry Pi 4 con 2 GB RAM (sufficiente per ~50 utenti attivi)
- Raspberry Pi 5 / VPS 1 GB RAM per ~200 utenti

**Sistema operativo testato:**

- **Raspberry Pi OS / Raspbian basato su Debian 13 "trixie"** (kernel ARM)
- Anche Debian 12 (Bookworm) e Ubuntu 22.04+ dovrebbero funzionare con
  minime variazioni sui nomi pacchetti.

**Versioni di riferimento del setup live:**

- Python 3.11.9
- nginx 1.26.3
- SQLite 3.46.1
- FastAPI 0.135.3 (vedi `backend/requirements.txt` per il pin completo)

**Pacchetti di sistema:**

```bash
sudo apt update
sudo apt install -y \
    python3.11 python3.11-venv python3.11-dev python3-pip \
    nginx \
    sqlite3 \
    build-essential pkg-config \
    libffi-dev libssl-dev \
    libjpeg-dev zlib1g-dev libpng-dev libwebp-dev libtiff-dev \
    libfreetype6-dev liblcms2-dev libopenjp2-7-dev \
    git curl ca-certificates
```

Note sui pacchetti:

- `python3.11-dev` + `build-essential` + `libffi-dev` + `libssl-dev`:
  servono per compilare estensioni native di `bcrypt`, `cryptography`,
  `cffi`. Su ARM i wheel precompilati non sempre sono disponibili e
  pip ricade sulla compilazione locale.
- `libjpeg-dev`, `libpng-dev`, `libwebp-dev`, `libtiff-dev`,
  `libfreetype6-dev`, `liblcms2-dev`, `libopenjp2-7-dev`, `zlib1g-dev`:
  richiesti da Pillow per supportare i vari formati immagine usati per
  gli upload di annunci, eventi e profili.
- `sqlite3`: solo come CLI per ispezione del DB in casi di debug.
  Python ha il proprio modulo `sqlite3` incluso nella standard library,
  non richiede pacchetto apt separato.

> 💡 Se vuoi usare Postgres invece di SQLite, aggiungi anche
> `libpq-dev` e poi `pip install psycopg2-binary` nel venv. Vedi le
> note in `backend/.env.example` per il `DATABASE_URL`.

## Installazione passo-passo

### 1. Clona il repository

```bash
cd /home/<user>
git clone https://github.com/<your-username>/vicinato-vicino.git
cd vicinato-vicino
```

### 2. Crea il virtualenv e installa le dipendenze Python

```bash
python3.11 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r backend/requirements.txt
```

### 3. Configura i segreti (`.env`)

```bash
cd backend
cp .env.example .env
# Genera una SECRET_KEY robusta
python -c "import secrets; print(secrets.token_hex(32))"
# Copia l'output nella riga SECRET_KEY del .env
nano .env
```

Editare anche `CORS_ORIGINS` se il frontend è servito da un dominio
diverso dal backend.

### 4. Personalizza il quartiere (`config.yaml`)

```bash
cp config.yaml.example config.yaml
nano config.yaml
```

Modifica `site.name`, `site.description`, `zones`, `job_categories`,
`event_categories` per riflettere il tuo quartiere.

> ⚠️ Le voci in `config.yaml` vengono lette **solo al primo avvio**.
> Dopo, le modifiche si fanno dal pannello admin (sezione "Impostazioni
> sito").

### 5. Primo avvio

```bash
cd /home/<user>/vicinato-vicino/backend
source ../venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
```

Al primo avvio uvicorn:

- crea il file `vicinato.db` (SQLite) nella root del repo;
- applica le migrations e crea tutte le tabelle;
- popola `site_settings` con i valori di `config.yaml`;
- crea l'utente admin di default (vedi sezione dopo).

## Primo avvio e admin

Al primo avvio, se nel database non esiste **nessun** utente admin, viene
creato automaticamente l'utente:

- **username**: `admin`
- **password**: `ChangeMe123!`

Le credenziali vengono stampate nei log di uvicorn come warning. **Vai
SUBITO** su `http://<your-host>/` e:

1. fai login con `admin` / `ChangeMe123!`;
2. vai sul tuo profilo → cambia password con una robusta (la policy
   richiede ≥ 8 caratteri, una maiuscola, una minuscola e un numero).

Il bootstrap dell'admin è **idempotente**: dal momento in cui esiste
almeno un admin nel DB, ai successivi avvii non viene ricreato.

## Reverse proxy nginx

Il file `deploy/nginx.conf.example` contiene una configurazione completa,
con CORS, header di sicurezza (CSP, X-Content-Type-Options, ecc.) e
gestione separata per `/uploads/`.

```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/vicinato-vicino
sudo nano /etc/nginx/sites-available/vicinato-vicino
# modifica la riga `root /home/<user>/vicinato-vicino/frontend;` col path reale
# modifica `server_name` se hai un dominio
sudo ln -s /etc/nginx/sites-available/vicinato-vicino /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Il file ha già una sezione "PRODUCTION HARDENING" in fondo con le note
per HTTPS e CORS in ambienti pubblici.

## Avvio come servizio (systemd)

Per non dover ri-lanciare `uvicorn` ad ogni reboot, crea un'unit file:

```ini
# /etc/systemd/system/vicinato-vicino.service
[Unit]
Description=VicinatoVicino backend (FastAPI + uvicorn)
After=network.target

[Service]
Type=simple
User=<user>
WorkingDirectory=/home/<user>/vicinato-vicino/backend
Environment="PATH=/home/<user>/vicinato-vicino/venv/bin"
ExecStart=/home/<user>/vicinato-vicino/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Sostituisci `<user>` col tuo username e abilita:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now vicinato-vicino
sudo systemctl status vicinato-vicino
```

Nginx farà reverse proxy verso `127.0.0.1:8000` (vedi
`deploy/nginx.conf.example`).

## HTTPS in produzione

Se hai un dominio, il modo più semplice è Let's Encrypt via certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d miosito.example.com
```

Certbot aggiunge automaticamente i blocchi SSL al file nginx e configura
il rinnovo automatico. Vedi anche le note in
`deploy/nginx.conf.example` (sezione PRODUCTION HARDENING).

## Manutenzione

### Backup del database

```bash
# SQLite: il backup è semplicemente la copia del file
cp /home/<user>/vicinato-vicino/vicinato.db /backup/vicinato-$(date +%F).db
```

### Backup degli upload

```bash
tar czf /backup/uploads-$(date +%F).tar.gz \
    -C /home/<user>/vicinato-vicino/backend uploads
```

### Aggiornamento codice da git

```bash
cd /home/<user>/vicinato-vicino
git pull
source venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart vicinato-vicino
```

### Log

Se avvii via systemd: `sudo journalctl -u vicinato-vicino -f`.

Se avvii a mano: i log finiscono su stdout.

## Sicurezza

VicinatoVicino integra le principali pratiche difensive (autenticazione JWT,
ruoli applicati lato server, validazione e sanitizzazione degli input,
header di sicurezza via nginx). Per uso casalingo su LAN o per un piccolo
quartiere è adatto out-of-the-box.

Se esponi un'istanza su Internet, segui le raccomandazioni di hardening
(HTTPS, CORS ristretto, rate limiting, backup) descritte in
[SECURITY.md](SECURITY.md).

Per **segnalare una vulnerabilità**, usa la private vulnerability reporting
di GitHub (tab *Security* del repository): la procedura è in
[SECURITY.md](SECURITY.md). Non aprire issue pubbliche per problemi di
sicurezza.

## Contribuire

Pull request e issue sono benvenute. Per modifiche non banali, apri
prima una discussion per allinearci sul design.

Lo sviluppo include uno smoke test che colpisce un'istanza live e
verifica i flussi principali via HTTP:

```bash
python tools/smoke_test.py
```

Modifica la costante `BASE_URL` in cima al file per puntare alla tua
istanza. Lo script crea risorse di test contrassegnate `[SMOKE-TEST]` e
le ripulisce alla fine.

## Licenza

[MIT](LICENSE) © VicinatoVicino contributors
