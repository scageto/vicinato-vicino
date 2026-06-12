"""
Smoke test per VicinatoVicino.

Esegue una sequenza di chiamate HTTP contro il sito live e verifica i
comportamenti attesi con i 3 utenti gia' presenti (admin, mod, sena).

Uso:
    python tools/smoke_test.py            # esecuzione completa
    python tools/smoke_test.py --cleanup-only  # ripulisce solo le risorse [SMOKE-TEST]

Target hard-coded: BASE_URL.
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import requests

BASE_URL = "http://localhost"

USERS = {
    "admin": {"username": "test_admin", "password": "Test1234!", "role": "admin"},
    "mod":   {"username": "test_mod",   "password": "Test1234!", "role": "moderator"},
    "sena":  {"username": "test_user",  "password": "Test1234!", "role": "user"},
}

SMOKE_TAG = "[SMOKE-TEST]"
TIMEOUT = 20

# ANSI colors
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
RESET = "\033[0m"

@dataclass
class Report:
    results: List["StepResult"] = field(default_factory=list)

    def add(self, name: str, ok: bool, detail: str = "") -> None:
        self.results.append(StepResult(name, ok, detail))
        marker = f"{GREEN}[PASS]{RESET}" if ok else f"{RED}[FAIL]{RESET}"
        suffix = f" - {detail}" if detail else ""
        print(f"{marker} {name}{suffix}")

    @property
    def all_ok(self) -> bool:
        return all(r.ok for r in self.results)

    def summary(self) -> None:
        total = len(self.results)
        failed = sum(1 for r in self.results if not r.ok)
        passed = total - failed
        print()
        print(f"=== {passed}/{total} passed ===")
        if failed:
            print(f"{RED}FAILED:{RESET}")
            for r in self.results:
                if not r.ok:
                    print(f"  - {r.name}: {r.detail}")

@dataclass
class StepResult:
    name: str
    ok: bool
    detail: str = ""

class SmokeClient:
    """Client HTTP minimal con login multi-utente."""

    def __init__(self, base_url: str = BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.tokens: Dict[str, str] = {}
        self.user_ids: Dict[str, int] = {}

    def url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def headers(self, user: Optional[str] = None) -> Dict[str, str]:
        h = {"Accept": "application/json"}
        if user and user in self.tokens:
            h["Authorization"] = f"Bearer {self.tokens[user]}"
        return h

    def login(self, user_key: str) -> bool:
        u = USERS[user_key]
        r = requests.post(
            self.url("/users/login"),
            json={"username": u["username"], "password": u["password"]},
            timeout=TIMEOUT,
        )
        if r.status_code != 200:
            return False
        data = r.json()
        token = data.get("access_token")
        user = data.get("user") or {}
        if not token:
            return False
        self.tokens[user_key] = token
        if "id" in user:
            self.user_ids[user_key] = user["id"]
        return True

    def get(self, path: str, user: Optional[str] = None, **kw) -> requests.Response:
        return requests.get(self.url(path), headers=self.headers(user),
                            timeout=TIMEOUT, **kw)

    def post(self, path: str, user: Optional[str] = None, **kw) -> requests.Response:
        return requests.post(self.url(path), headers=self.headers(user),
                             timeout=TIMEOUT, **kw)

    def post_form(self, path: str, user: Optional[str] = None,
                  data: Optional[Dict[str, Any]] = None,
                  files: Optional[Any] = None) -> requests.Response:
        return requests.post(self.url(path), headers=self.headers(user),
                             data=data, files=files, timeout=TIMEOUT)

    def put(self, path: str, user: Optional[str] = None, **kw) -> requests.Response:
        return requests.put(self.url(path), headers=self.headers(user),
                            timeout=TIMEOUT, **kw)

    def patch(self, path: str, user: Optional[str] = None, **kw) -> requests.Response:
        return requests.patch(self.url(path), headers=self.headers(user),
                              timeout=TIMEOUT, **kw)

    def delete(self, path: str, user: Optional[str] = None, **kw) -> requests.Response:
        return requests.delete(self.url(path), headers=self.headers(user),
                               timeout=TIMEOUT, **kw)

# =====================================================================
# STEP POSITIVI
# =====================================================================

def step_health(c: SmokeClient, r: Report) -> None:
    res = c.get("/health")
    r.add("GET /health",
          res.status_code == 200 and res.json().get("status") == "healthy",
          f"status={res.status_code}")
    # /test-db richiede admin (information disclosure se aperto)
    res = c.get("/test-db")
    r.add("GET /test-db senza auth -> 401", res.status_code == 401,
          f"status={res.status_code}")
    # /users/ richiede auth (PII leak se aperto). Test piu' approfondito in
    # step_auth dopo il login.

def step_auth(c: SmokeClient, r: Report) -> None:
    for key, u in USERS.items():
        ok = c.login(key)
        r.add(f"login {key}", ok, "" if ok else "login fallito")
        if not ok:
            continue
        res = c.get("/users/me", user=key)
        ok_me = res.status_code == 200 and res.json().get("username") == u["username"]
        r.add(f"GET /users/me ({key})", ok_me, f"status={res.status_code}")
        if ok_me:
            data = res.json()
            actual_role = ("admin" if data.get("is_admin") else
                           "moderator" if data.get("is_moderator") else "user")
            r.add(f"role {key}={u['role']}", actual_role == u["role"],
                  f"actual={actual_role}")

def step_site(c: SmokeClient, r: Report) -> None:
    res = c.get("/site/settings")
    r.add("GET /site/settings (pubblico)", res.status_code == 200,
          f"status={res.status_code}")

def step_items(c: SmokeClient, r: Report) -> None:
    """sena crea item (multipart) -> admin lo vede in lista -> sena elimina."""
    payload = {
        "title": f"{SMOKE_TAG} item",
        "description": "smoke test description",
        "item_type": "regalo",
        "category": "altro",
        "condition": "usato",
    }
    res = c.post_form("/items/", user="sena", data=payload)
    ok_create = res.status_code in (200, 201)
    item_id = res.json().get("id") if ok_create else None
    r.add("POST /items/ (sena)", ok_create,
          f"status={res.status_code} body={res.text[:200] if not ok_create else ''}")

    if not item_id:
        return

    res = c.get("/items/", user="admin")
    if res.status_code == 200:
        ids = [i.get("id") for i in res.json()]
        r.add("GET /items/ contiene item creato", item_id in ids,
              f"trovati={len(ids)}")
    else:
        r.add("GET /items/", False, f"status={res.status_code}")

    res = c.delete(f"/items/{item_id}", user="sena")
    r.add("DELETE /items/{id} (sena)", res.status_code in (200, 204),
          f"status={res.status_code}")

def step_jobs(c: SmokeClient, r: Report) -> None:
    payload = {
        "title": f"{SMOKE_TAG} job",
        "description": "smoke test job",
        "category": "altro",
    }
    res = c.post("/jobs/", user="sena", json=payload)
    ok = res.status_code in (200, 201)
    job_id = res.json().get("id") if ok else None
    r.add("POST /jobs/ (sena)", ok,
          f"status={res.status_code} body={res.text[:200] if not ok else ''}")

    if not job_id:
        return

    res = c.get("/jobs/", user="sena")
    ids = [i.get("id") for i in res.json()] if res.status_code == 200 else []
    r.add("GET /jobs/ contiene job creato", job_id in ids,
          f"trovati={len(ids)}")

    res = c.delete(f"/jobs/{job_id}", user="sena")
    r.add("DELETE /jobs/{id} (sena)", res.status_code in (200, 204),
          f"status={res.status_code}")

def step_events(c: SmokeClient, r: Report) -> None:
    when = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
    payload = {
        "title": f"{SMOKE_TAG} event",
        "description": "smoke test event",
        "date": when,
        "location": "Centro test",
        "category": "altro",
    }
    res = c.post("/events/", user="sena", json=payload)
    ok = res.status_code in (200, 201)
    event_id = res.json().get("id") if ok else None
    r.add("POST /events/ (sena)", ok,
          f"status={res.status_code} body={res.text[:200] if not ok else ''}")

    if not event_id:
        return

    res = c.post(f"/events/{event_id}/join", user="admin")
    r.add("POST /events/{id}/join (admin)",
          res.status_code in (200, 201), f"status={res.status_code}")

    res = c.delete(f"/events/{event_id}", user="sena")
    r.add("DELETE /events/{id} (sena)",
          res.status_code in (200, 204), f"status={res.status_code}")

def step_chat(c: SmokeClient, r: Report) -> None:
    admin_id = c.user_ids.get("admin")
    if admin_id is None:
        r.add("chat: lookup admin id", False, "id non trovato")
        return

    res = c.post("/chat/rooms", user="sena",
                 json={"participant2_id": admin_id})
    ok = res.status_code in (200, 201)
    room_id = res.json().get("id") if ok else None
    r.add("POST /chat/rooms (sena -> admin)", ok,
          f"status={res.status_code} body={res.text[:200] if not ok else ''}")
    if not room_id:
        return

    # Conta messaggi pre-invio
    res_pre = c.get(f"/chat/rooms/{room_id}/messages", user="admin")
    pre_count = len(res_pre.json()) if res_pre.status_code == 200 else 0

    res = c.post(f"/chat/rooms/{room_id}/messages", user="sena",
                 json={"content": f"{SMOKE_TAG} ciao"})
    r.add("POST messaggio (sena)", res.status_code in (200, 201),
          f"status={res.status_code}")

    res = c.get(f"/chat/rooms/{room_id}/messages", user="admin")
    msgs = res.json() if res.status_code == 200 else []
    r.add("GET messaggi (admin): count aumenta di 1",
          len(msgs) == pre_count + 1,
          f"pre={pre_count} post={len(msgs)}")

    c.delete(f"/chat/rooms/{room_id}", user="sena")

def step_reviews(c: SmokeClient, r: Report) -> None:
    """Flusso completo: sena crea item -> sena accept(admin) -> sena complete
    -> admin lascia review su sena."""
    sena_id = c.user_ids.get("sena")
    admin_id = c.user_ids.get("admin")
    if not sena_id or not admin_id:
        r.add("reviews: lookup ids", False, "id mancanti")
        return

    # Sena crea item
    res = c.post_form("/items/", user="sena", data={
        "title": f"{SMOKE_TAG} review-target",
        "description": "review test",
        "item_type": "regalo",
        "category": "altro",
        "condition": "usato",
    })
    if res.status_code not in (200, 201):
        r.add("reviews prep: create item", False, f"status={res.status_code}")
        return
    item_id = res.json().get("id")

    # Apri una chat tra sena e admin (necessario perche' candidates filtra
    # tramite le room di chat collegate all'item)
    chat_res = c.post("/chat/rooms", user="sena",
                      json={"participant2_id": admin_id, "item_id": item_id})

    # Sena accept admin
    res = c.post(f"/items/{item_id}/accept", user="sena",
                 json={"user_id": admin_id})
    if res.status_code != 200:
        r.add("reviews prep: accept admin", False,
              f"status={res.status_code} body={res.text[:200]}")
        c.delete(f"/items/{item_id}", user="sena")
        return

    # Sena complete
    res = c.post(f"/items/{item_id}/complete", user="sena")
    if res.status_code != 200:
        r.add("reviews prep: complete", False,
              f"status={res.status_code} body={res.text[:200]}")
        c.delete(f"/items/{item_id}", user="sena")
        return

    # Admin lascia review su sena
    res = c.post("/reviews", user="admin", json={
        "ratee_id": sena_id,
        "target_type": "item",
        "target_id": item_id,
        "score": 5,
        "comment": f"{SMOKE_TAG} ottimo",
    })
    ok = res.status_code in (200, 201)
    review_id = res.json().get("id") if ok else None
    r.add("POST /reviews (admin -> sena)", ok,
          f"status={res.status_code} body={res.text[:200] if not ok else ''}")

    if review_id:
        res = c.get(f"/reviews/user/{sena_id}")
        ids = [x.get("id") for x in res.json()] if res.status_code == 200 else []
        r.add("GET /reviews/user/{id}", review_id in ids, f"count={len(ids)}")
        c.delete(f"/reviews/{review_id}", user="admin")

    # Cleanup: l'item ormai e' "taken" e non puo' essere riutilizzato.
    # Lo lasciamo li (verra' raccolto da cleanup_residui se ancora visibile).
    c.delete(f"/items/{item_id}", user="sena")

def step_moderation(c: SmokeClient, r: Report) -> None:
    """sena segnala item -> mod vede coda -> mod chiude report."""
    res = c.post_form("/items/", user="sena", data={
        "title": f"{SMOKE_TAG} target-report",
        "description": "to-report",
        "item_type": "regalo",
        "category": "altro",
        "condition": "usato",
    })
    if res.status_code not in (200, 201):
        r.add("moderation prep: create item", False, f"status={res.status_code}")
        return
    item_id = res.json().get("id")

    res = c.post("/reports", user="sena", json={
        "target_type": "item",
        "target_id": item_id,
        "reason": "spam",
        "description": f"{SMOKE_TAG} test",
    })
    ok = res.status_code in (200, 201)
    report_id = res.json().get("id") if ok else None
    r.add("POST /reports (sena)", ok,
          f"status={res.status_code} body={res.text[:200] if not ok else ''}")

    if report_id:
        res = c.get("/moderation/reports", user="mod")
        ids = [x.get("id") for x in res.json()] if res.status_code == 200 else []
        r.add("GET /moderation/reports (mod) vede report",
              report_id in ids, f"count={len(ids)}")

        res = c.patch(f"/moderation/reports/{report_id}", user="mod",
                      json={"status": "resolved"})
        r.add("PATCH /moderation/reports/{id} (mod)",
              res.status_code in (200, 204), f"status={res.status_code}")

    c.delete(f"/items/{item_id}", user="sena")

def step_admin(c: SmokeClient, r: Report) -> None:
    res = c.get("/admin/users", user="admin")
    r.add("GET /admin/users (admin)", res.status_code == 200,
          f"status={res.status_code}")

    res = c.get("/admin/audit-log", user="admin")
    r.add("GET /admin/audit-log (admin)", res.status_code == 200,
          f"status={res.status_code}")

    res = c.get("/admin/stats", user="admin")
    r.add("GET /admin/stats (admin)", res.status_code == 200,
          f"status={res.status_code}")

# =====================================================================
# STEP NEGATIVI
# =====================================================================

def step_security(c: SmokeClient, r: Report) -> None:
    """Step dedicato ai fix di sicurezza Fase 2 post-pentest."""
    # /users/ senza auth -> 401
    res = requests.get(f"{c.base_url}/users/", timeout=TIMEOUT)
    r.add("/users/ senza auth -> 401", res.status_code == 401,
          f"status={res.status_code}")

    # /users/ con auth -> 200 ma senza email/phone (UserPublic)
    res = c.get("/users/", user="sena")
    ok = res.status_code == 200
    if ok and isinstance(res.json(), list) and res.json():
        sample = res.json()[0]
        no_pii = "email" not in sample and "phone" not in sample
        r.add("/users/ esclude email/phone (UserPublic)", no_pii,
              f"keys={list(sample.keys())[:6]}")
    else:
        r.add("/users/ esclude email/phone (UserPublic)", False,
              f"status={res.status_code}")

    # /users/{id} senza auth -> 401
    res = requests.get(f"{c.base_url}/users/1", timeout=TIMEOUT)
    r.add("/users/{id} senza auth -> 401", res.status_code == 401,
          f"status={res.status_code}")

    # /test-db senza auth -> 401
    res = requests.get(f"{c.base_url}/test-db", timeout=TIMEOUT)
    r.add("/test-db senza auth -> 401", res.status_code == 401,
          f"status={res.status_code}")

    # /test-db con admin -> 200
    res = c.get("/test-db", user="admin")
    r.add("/test-db con admin -> 200",
          res.status_code == 200 and res.json().get("database") == "connected",
          f"status={res.status_code}")

    # XSS: bio con <script> deve essere stripped server-side
    payload_xss = "<script>alert('xss')</script>hello"
    res = c.put("/users/me", user="sena", json={"bio": payload_xss})
    bio_clean = (res.json().get("bio") or "") if res.status_code == 200 else ""
    no_script = "<script" not in bio_clean
    r.add("bio XSS payload sanificato server-side", no_script,
          f"bio={bio_clean[:60]}")

    # Jobs search funzionante (parametro precedentemente ignorato)
    res = c.get("/jobs/?search=ZZZZNOMATCH123", user="sena")
    r.add("/jobs/?search=NOMATCH ritorna lista vuota",
          res.status_code == 200 and len(res.json()) == 0,
          f"status={res.status_code} count={len(res.json()) if res.status_code==200 else '?'}")

    # Mass assignment: tento is_admin=true via /users/me, deve essere ignorato
    res = c.put("/users/me", user="sena",
                json={"is_admin": True, "is_moderator": True, "bio": "test mass"})
    body = res.json() if res.status_code == 200 else {}
    r.add("mass assignment is_admin via /users/me ignorato",
          res.status_code == 200 and body.get("is_admin") is False and body.get("is_moderator") is False,
          f"status={res.status_code} is_admin={body.get('is_admin')}")

    # Password policy: weak password (no maiuscola) deve essere rifiutata in registrazione
    weak_payload = {
        "email": "fase2.weakpwd@example.com",
        "username": "fase2_weakpwd",
        "full_name": "Weak Pwd",
        "password": "weakpassword123",  # no uppercase
        "phone": "+390000000123",
        "age": 30,
        "zone": "Centro",
    }
    res = requests.post(f"{c.base_url}/users/register", json=weak_payload, timeout=TIMEOUT)
    r.add("password senza maiuscola in register -> 422",
          res.status_code == 422,
          f"status={res.status_code}")

def step_negativi(c: SmokeClient, r: Report) -> None:
    # Login con password sbagliata
    res = requests.post(f"{c.base_url}/users/login",
                        json={"username": "admin", "password": "WRONG"},
                        timeout=TIMEOUT)
    r.add("login wrong password -> 401", res.status_code == 401,
          f"status={res.status_code}")

    # sena su /admin/users -> 403
    res = c.get("/admin/users", user="sena")
    r.add("sena -> /admin/users -> 403", res.status_code == 403,
          f"status={res.status_code}")

    # mod su /admin/users -> 403 (mod non e' admin)
    res = c.get("/admin/users", user="mod")
    r.add("mod -> /admin/users -> 403", res.status_code == 403,
          f"status={res.status_code}")

    # POST item senza campi obbligatori -> 422 (multipart, body vuoto)
    res = c.post_form("/items/", user="sena", data={})
    r.add("POST /items/ senza campi -> 422", res.status_code == 422,
          f"status={res.status_code}")

    # sena cancella item di altro utente -> 403/404
    res = c.post_form("/items/", user="admin", data={
        "title": f"{SMOKE_TAG} admin-owned",
        "description": "x",
        "item_type": "regalo",
        "category": "altro",
        "condition": "usato",
    })
    if res.status_code in (200, 201):
        admin_item = res.json().get("id")
        res2 = c.delete(f"/items/{admin_item}", user="sena")
        r.add("sena cancella item altrui -> 403/404",
              res2.status_code in (403, 404), f"status={res2.status_code}")
        c.delete(f"/items/{admin_item}", user="admin")
    else:
        r.add("prep negativo item altrui", False, f"status={res.status_code}")

    # Token invalido -> 401
    res = requests.get(f"{c.base_url}/users/me",
                       headers={"Authorization": "Bearer INVALID"},
                       timeout=TIMEOUT)
    r.add("token invalido -> 401", res.status_code == 401,
          f"status={res.status_code}")

    # Token assente su endpoint protetto -> 401
    res = requests.get(f"{c.base_url}/users/me", timeout=TIMEOUT)
    r.add("nessun token -> 401", res.status_code == 401,
          f"status={res.status_code}")

# =====================================================================
# CLEANUP RESIDUI
# =====================================================================

def cleanup_residui(c: SmokeClient, r: Report) -> None:
    """Best-effort: elimina risorse [SMOKE-TEST] eventualmente residue."""
    if "sena" not in c.tokens:
        c.login("sena")
    if "admin" not in c.tokens:
        c.login("admin")

    cleaned = 0
    for path, owner, kind in [("/items/me", "sena", "items"),
                               ("/jobs/me", "sena", "jobs"),
                               ("/events/me", "sena", "events"),
                               ("/items/me", "admin", "items")]:
        res = c.get(path, user=owner)
        if res.status_code != 200:
            continue
        for entry in res.json():
            title = entry.get("title", "") or ""
            if SMOKE_TAG in title:
                c.delete(f"/{kind}/{entry['id']}", user=owner)
                cleaned += 1

    r.add("cleanup risorse [SMOKE-TEST]", True, f"rimosse={cleaned}")

# =====================================================================
# MAIN
# =====================================================================

def run_all(client: SmokeClient, report: Report,
            cleanup_only: bool = False) -> None:
    if cleanup_only:
        cleanup_residui(client, report)
        return

    step_health(client, report)
    step_auth(client, report)
    step_site(client, report)
    step_items(client, report)
    step_jobs(client, report)
    step_events(client, report)
    step_chat(client, report)
    step_reviews(client, report)
    step_moderation(client, report)
    step_admin(client, report)
    step_security(client, report)
    step_negativi(client, report)
    cleanup_residui(client, report)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cleanup-only", action="store_true")
    args = parser.parse_args()

    report = Report()
    client = SmokeClient()
    run_all(client, report, cleanup_only=args.cleanup_only)
    report.summary()
    return 0 if report.all_ok else 1

if __name__ == "__main__":
    sys.exit(main())
