#!/usr/bin/env python3
"""Read-only local demo mailbox. Never sends mail or contacts another service."""
import html
import json
import os
from pathlib import Path
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime

MAIL_DIRECTORY = Path(os.environ.get("MAIL_DIRECTORY", "/mail"))
CODE = re.compile(r"(?<!\d)\d{6}(?!\d)")


def messages():
    entries = []
    try:
        root = MAIL_DIRECTORY.resolve()
        candidates = list(MAIL_DIRECTORY.glob("*.json"))
    except OSError:
        return entries
    for candidate in candidates:
        try:
            if candidate.resolve().parent != root or candidate.stat().st_size > 1_000_000:
                continue
            message = json.loads(candidate.read_text(encoding="utf-8"))
            if not isinstance(message, dict):
                continue
            text = str(message.get("text", ""))[:50_000]
            match = CODE.search(text)
            entries.append({
                "to": str(message.get("to", ""))[:1_000],
                "subject": str(message.get("subject", ""))[:2_000],
                "text": text,
                "code": match.group(0) if match else None,
                "mtime": candidate.stat().st_mtime,
            })
        except (OSError, ValueError, UnicodeError):
            # The service can be halfway through writing its newest message.
            continue
    return sorted(entries, key=lambda item: item["mtime"], reverse=True)[:100]


def render():
    escape = lambda value: html.escape(str(value), quote=True)
    cards = []
    for item in messages():
        timestamp = datetime.fromtimestamp(item["mtime"]).astimezone().strftime("%d/%m/%Y %H:%M:%S %Z")
        code = f'<div class="code">{escape(item["code"])}</div>' if item["code"] else ""
        cards.append(f'''<article><div class="meta">{escape(timestamp)}</div>
<h2>{escape(item["to"])}</h2><p class="subject">{escape(item["subject"])}</p>{code}
<details><summary>Afficher le message complet</summary><pre>{escape(item["text"])}</pre></details></article>''')
    content = "\n".join(cards) or '<article>Aucun message pour le moment. Demandez un code dans l’application.</article>'
    return f'''<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="3">
<title>Boîte mail — Démo Blok</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#f5f3ef;color:#25231f;font:16px/1.5 system-ui,sans-serif}}
main{{max-width:850px;margin:40px auto;padding:0 20px}}h1{{font-size:28px;margin-bottom:8px}}
.warning{{background:#fff0c7;border:1px solid #dbba59;border-radius:12px;padding:16px}}
.note,.meta{{color:#716d65;font-size:13px}}article{{background:white;border:1px solid #e4dfd5;border-radius:12px;padding:24px;margin:18px 0}}
h2{{font-size:18px;margin:5px 0;overflow-wrap:anywhere}}.subject{{margin:8px 0;color:#625d54}}
.code{{font-size:36px;letter-spacing:.2em;font-weight:700;margin:18px 0;font-variant-numeric:tabular-nums}}
pre{{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace;background:#f6f5f2;padding:16px;border-radius:8px}}
summary{{cursor:pointer}}.meta{{float:right}}@media(max-width:600px){{.meta{{float:none}}article{{padding:18px}}}}
</style></head><body><main><h1>Boîte mail locale Blok</h1>
<div class="warning"><strong>DÉMO LOCALE — codes de connexion visibles</strong><br>
Ces messages restent sur cet ordinateur. Aucun email réel n’est envoyé. Cette boîte doit rester accessible uniquement sur <strong>127.0.0.1</strong>.</div>
<p class="note">Actualisation automatique toutes les 3 secondes. Messages les plus récents en premier ; dernier message conservé par adresse.</p>
{content}</main></body></html>'''.encode("utf-8")


class MailboxHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/healthz":
            payload, content_type = b'{"ok":true}\n', "application/json"
        elif self.path in ("/", "/index.html"):
            payload, content_type = render(), "text/html; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
        self.end_headers()
        self.wfile.write(payload)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8025"))), MailboxHandler)
    server.serve_forever()
