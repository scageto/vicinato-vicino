# Security Policy

## Segnalare una vulnerabilità

Se pensi di aver trovato una vulnerabilità di sicurezza in VicinatoVicino,
**non aprire una issue pubblica** e non descriverla in una pull request.

Usa invece il canale privato di GitHub:

1. vai sulla tab **Security** del repository;
2. clicca **Report a vulnerability** (Private vulnerability reporting);
3. descrivi il problema, i passi per riprodurlo e l'impatto stimato.

Riceverai un riscontro appena possibile. Una volta confermata e corretta la
vulnerabilità, la patch verrà rilasciata e segnalata nelle note di versione.

> Se la private vulnerability reporting non è abilitata sul fork che stai
> usando, l'amministratore di quell'istanza può attivarla da
> *Settings → Code security and analysis → Private vulnerability reporting*.

## Versioni supportate

Riceve patch di sicurezza solo l'ultima versione pubblicata sul branch
principale. Se gestisci un'istanza, tieni il codice aggiornato con `git pull`
(vedi la sezione *Manutenzione* del [README](README.md)).

## Misure di sicurezza integrate

VicinatoVicino adotta diverse pratiche difensive standard:

- autenticazione JWT con password hashed (bcrypt) e policy di robustezza;
- separazione dei ruoli (utente / moderatore / amministratore) applicata
  lato server;
- validazione e sanitizzazione degli input lato backend;
- escaping degli output lato frontend;
- header di sicurezza HTTP applicati dal reverse proxy (vedi
  `deploy/nginx.conf.example`);
- query parametrizzate tramite ORM;
- validazione di tipo e dimensione sui file caricati.

I dettagli implementativi sono nel codice e nei commenti dei rispettivi
moduli.

## Raccomandazioni per chi installa un'istanza pubblica

Il template è pensato per girare leggero (es. su Raspberry Pi). Se lo esponi
su Internet, applica questi accorgimenti di hardening:

1. **HTTPS**: attiva un certificato TLS (es. Let's Encrypt via certbot). Vedi
   la sezione *HTTPS in produzione* del [README](README.md) e le note in
   `deploy/nginx.conf.example`.
2. **CORS**: in `backend/.env` imposta `CORS_ORIGINS` sul dominio reale del
   tuo frontend, non lasciare `*` in produzione.
3. **Rate limiting**: configura `limit_req_zone` su nginx per gli endpoint di
   autenticazione e di pubblicazione, ed eventualmente `fail2ban`.
4. **Backup**: pianifica backup regolari del database e della cartella
   `uploads/` (vedi *Manutenzione* nel README).
5. **Segreti**: genera una `SECRET_KEY` univoca e robusta e non riutilizzarla
   tra istanze. Non committare mai il file `.env`.

## Licenza e responsabilità

VicinatoVicino è distribuito "as is" secondo i termini della licenza
[MIT](LICENSE), senza garanzie. La sicurezza dell'istanza che metti online
dipende anche dalla tua configurazione di deploy.
