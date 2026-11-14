#!/usr/bin/env python3
"""Seed local demo identities through real API/OTP flows; never print tokens/codes."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import urlsplit

API_URL = os.environ.get("API_URL", "http://web").rstrip("/")
MAIL_DIRECTORY = Path(os.environ.get("MAIL_DIRECTORY", "/mail"))
ADMIN_EMAIL = os.environ.get("BOOTSTRAP_ADMIN_EMAIL", "admin@example.test").strip().lower()
MEMBER_EMAIL = os.environ.get("DEMO_MEMBER_EMAIL", "membre@example.test").strip().lower()
REQUESTER_EMAIL = os.environ.get("DEMO_REQUESTER_EMAIL", "demandeur@example.test").strip().lower()
WORKSPACE = os.environ.get("DEMO_WORKSPACE", "equipe")
CODE = re.compile(r"(?<!\d)\d{6}(?!\d)")


class APIError(Exception):
    def __init__(self, status, message):
        self.status = status
        super().__init__(f"API {status}: {message}")


def api(method, path, payload=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    request = Request(API_URL + path, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=25) as response:
            raw = response.read(1_000_000)
            return json.loads(raw) if raw else {}
    except HTTPError as error:
        try:
            message = json.loads(error.read(10_000)).get("error", "request refused")
        except (ValueError, AttributeError):
            message = "request refused"
        raise APIError(error.code, str(message)) from None


def mailbox(email):
    filename = hashlib.sha256(email.encode("utf-8")).hexdigest() + ".json"
    source = MAIL_DIRECTORY / filename
    try:
        message = json.loads(source.read_text(encoding="utf-8"))
        if message.get("to", "").strip().lower() != email:
            return None, 0
        match = CODE.search(str(message.get("text", "")))
        return (match.group(0) if match else None), source.stat().st_mtime
    except (OSError, ValueError, AttributeError):
        return None, 0


def verify(email, code):
    try:
        result = api("POST", "/api/auth/verify-code", {"email": email, "code": code, "client": "desktop"})
    except APIError as error:
        if error.status == 401:
            return None
        raise
    token = result.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("The demo API did not issue a desktop session")
    return token


def login(email):
    # Reuse an unconsumed recent sink code when possible. A consumed one simply
    # returns 401; wait for the known 45-second resend cooldown before retrying.
    code, sent_at = mailbox(email)
    if code and time.time() - sent_at < 590:
        token = verify(email, code)
        if token:
            return token
    if code and sent_at and time.time() - sent_at < 46:
        time.sleep(max(0, 46 - (time.time() - sent_at)))
    try:
        api("POST", "/api/auth/request-code", {"email": email})
    except APIError as error:
        if error.status == 429:
            raise RuntimeError("Demo login rate limit reached; wait before rerunning the seed command") from None
        raise
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        code, timestamp = mailbox(email)
        if code and time.time() - timestamp < 30:
            token = verify(email, code)
            if token:
                return token
        time.sleep(0.25)
    raise RuntimeError("No usable login code appeared in MAIL_DIRECTORY; check the development mail sink")


def wait_ready():
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        try:
            if api("GET", "/healthz").get("ok"):
                return
        except (APIError, URLError, TimeoutError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError("The local API did not become ready")


def main():
    if len({ADMIN_EMAIL, MEMBER_EMAIL, REQUESTER_EMAIL}) != 3:
        raise RuntimeError("Demo admin, member and requester must use distinct addresses")
    # Seed only explicit demo identities; avoid accidentally targeting live mail.
    if not all(email.endswith("@example.test") for email in (ADMIN_EMAIL, MEMBER_EMAIL, REQUESTER_EMAIL)):
        raise RuntimeError("The demo seed only accepts @example.test identities")
    target = urlsplit(API_URL)
    if target.scheme != "http" or target.hostname not in {"localhost", "127.0.0.1", "::1", "web", "app", "service"}:
        raise RuntimeError("The demo seed only connects to a local HTTP demo service")
    if not MAIL_DIRECTORY.is_dir():
        raise RuntimeError("MAIL_DIRECTORY must be the mounted local development mail sink")
    wait_ready()
    base = "/api/workspaces/" + WORKSPACE
    admin = login(ADMIN_EMAIL)
    workspace = api("GET", base, token=admin)
    if workspace.get("role") != "admin":
        raise RuntimeError("Bootstrap demo account is not an administrator; no role changes made")
    members = api("GET", base + "/members", token=admin)["members"]
    existing = next((person for person in members if person["email"] == MEMBER_EMAIL), None)
    if not existing:
        api("POST", base + "/invites", {"email": MEMBER_EMAIL, "role": "member"}, admin)
    elif existing["role"] == "viewer":
        api("PATCH", base + "/members/" + existing["id"], {"role": "member"}, admin)
    # Existing admins keep their role. Never demote an admin during demo setup.
    member = login(MEMBER_EMAIL)
    if api("GET", base, token=member).get("role") not in ("member", "admin"):
        raise RuntimeError("The member invitation was not accepted")
    # Keep the requester eligible to request admission. Revoke only this demo
    # address's pending invitations; preserve all unrelated users and requests.
    for invitation in api("GET", base + "/invites", token=admin)["invites"]:
        if invitation["email"] == REQUESTER_EMAIL and invitation["status"] == "pending":
            api("DELETE", base + "/invites/" + invitation["id"], token=admin)
    members = api("GET", base + "/members", token=admin)["members"]
    existing = next((person for person in members if person["email"] == REQUESTER_EMAIL), None)
    if existing:
        if existing["role"] == "admin":
            raise RuntimeError("The requester is already an admin; refusing to demote an administrator")
        api("DELETE", base + "/members/" + existing["id"], token=admin)
    requester = login(REQUESTER_EMAIL)
    if api("GET", base, token=requester).get("role") is not None:
        raise RuntimeError("Requester unexpectedly has workspace membership")
    # Tokens stay in memory and are explicitly revoked after seeding. Users sign
    # in themselves from the browser and read their fresh code in the mailbox.
    for token in (member, requester, admin):
        api("POST", "/api/auth/logout", {}, token)
    # Make the next interactive login immediately usable: seed codes have been
    # consumed, so wait out the resend cooldown rather than exposing dead codes.
    ready_at = max(mailbox(email)[1] + 46 for email in (ADMIN_EMAIL, MEMBER_EMAIL, REQUESTER_EMAIL))
    if ready_at > time.time():
        print("Comptes créés ; attente du délai anti-abus avant la connexion interactive…", flush=True)
        time.sleep(ready_at - time.time())
    print("Démo locale prête — aucun email réel envoyé.")
    print(f"{ADMIN_EMAIL} : administrateur")
    print(f"{MEMBER_EMAIL} : membre déjà ajouté")
    print(f"{REQUESTER_EMAIL} : compte vérifié, sans accès, prêt à demander à rejoindre")


if __name__ == "__main__":
    try:
        main()
    except (APIError, URLError, TimeoutError, OSError, RuntimeError, ValueError, KeyError) as error:
        print(f"Initialisation de la démo impossible : {error}", file=sys.stderr)
        sys.exit(1)
