#!/usr/bin/env python3
"""Wysyłka tygodniowego raportu „Monday" na skrzynkę właściciela.

Używane przez subagenta `monday-mailer` (krok 5 pipeline'u /monday), ale
działa też samodzielnie:

    python3 scripts/monday/send_report.py \
        --html run/<TS>/monday/report.html \
        --subject-file run/<TS>/monday/subject.txt

Konfiguracja WYŁĄCZNIE przez zmienne środowiskowe albo plik `.env` w root
repo (zmienne środowiskowe mają pierwszeństwo):

    MONDAY_REPORT_TO   adres odbiorcy (wymagany)
    MONDAY_SMTP_USER   login SMTP, zwykle ten sam Gmail (wymagany do wysyłki)
    MONDAY_SMTP_PASS   HASŁO APLIKACJI Google (nie hasło do konta!)
    MONDAY_SMTP_HOST   domyślnie smtp.gmail.com
    MONDAY_SMTP_PORT   domyślnie 465 (SSL); 587 przełącza na STARTTLS
    MONDAY_FROM_NAME   domyślnie "Monday"

Kody wyjścia:
    0  wysłane
    1  błąd wysyłki (sieć/uwierzytelnienie) — warto ponowić raz
    2  brak konfiguracji SMTP → wywołujący ma użyć fallbacku (draft Gmail)
"""

from __future__ import annotations

import argparse
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_dotenv(path: Path) -> dict[str, str]:
    """Minimalny parser .env — bez zależności zewnętrznych."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].strip()
        key, sep, value = line.partition("=")
        if not sep:
            continue
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def cfg(name: str, dotenv: dict[str, str], default: str = "") -> str:
    """Zmienna środowiskowa > .env > default."""
    return os.environ.get(name) or dotenv.get(name) or default


def html_to_text(html: str) -> str:
    """Prosty fallback tekstowy — na wypadek braku report.md."""
    text = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|tr|h[1-6]|li)>", "\n", text)
    text = re.sub(r"(?i)<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", r"\2 (\1)", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"'))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


def main() -> int:
    parser = argparse.ArgumentParser(description="Wyślij raport Monday e-mailem (SMTP).")
    parser.add_argument("--html", required=True, help="ścieżka do report.html")
    parser.add_argument("--md", help="ścieżka do report.md (wersja tekstowa)")
    parser.add_argument("--subject", help="temat wiadomości")
    parser.add_argument("--subject-file", help="plik z tematem (subject.txt)")
    parser.add_argument("--to", help="odbiorca (nadpisuje MONDAY_REPORT_TO)")
    parser.add_argument("--dry-run", action="store_true",
                        help="sprawdź konfigurację i wypisz plan, nic nie wysyłaj")
    args = parser.parse_args()

    dotenv = load_dotenv(REPO_ROOT / ".env")

    html_path = Path(args.html)
    if not html_path.is_file():
        print(f"BŁĄD: nie znaleziono pliku raportu: {html_path}", file=sys.stderr)
        return 1
    html = html_path.read_text(encoding="utf-8")

    if args.subject:
        subject = args.subject.strip()
    elif args.subject_file and Path(args.subject_file).is_file():
        subject = Path(args.subject_file).read_text(encoding="utf-8").strip().splitlines()[0]
    else:
        subject = "[Monday] Raport AI"
    if not subject.startswith("[Monday]"):
        # Prefiks jest kontraktem: po nim filtruje Gmail i skrypt otwierający.
        subject = f"[Monday] {subject}"

    if args.md and Path(args.md).is_file():
        text = Path(args.md).read_text(encoding="utf-8")
    else:
        text = html_to_text(html)

    to_addr = (args.to or cfg("MONDAY_REPORT_TO", dotenv)).strip()
    user = cfg("MONDAY_SMTP_USER", dotenv).strip()
    password = cfg("MONDAY_SMTP_PASS", dotenv)
    host = cfg("MONDAY_SMTP_HOST", dotenv, "smtp.gmail.com").strip()
    port = int(cfg("MONDAY_SMTP_PORT", dotenv, "465") or 465)
    from_name = cfg("MONDAY_FROM_NAME", dotenv, "Monday").strip()

    if not to_addr:
        print("BRAK KONFIGURACJI: nie ustawiono MONDAY_REPORT_TO.", file=sys.stderr)
        return 2
    if not user or not password:
        print("BRAK KONFIGURACJI SMTP: ustaw MONDAY_SMTP_USER i MONDAY_SMTP_PASS "
              "(hasło aplikacji Google) w .env. Użyj fallbacku: draft w Gmailu.",
              file=sys.stderr)
        return 2

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, user))
    msg["To"] = to_addr
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain=user.split("@")[-1] or "localhost")
    msg["X-Monday-Report"] = "weekly-ai"
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    if args.dry_run:
        print(f"[dry-run] {host}:{port} jako {user} → {to_addr}")
        print(f"[dry-run] temat: {subject}")
        print(f"[dry-run] HTML: {len(html)} znaków, tekst: {len(text)} znaków")
        return 0

    context = ssl.create_default_context()
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=context, timeout=45) as smtp:
                smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=45) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.login(user, password)
                smtp.send_message(msg)
    except smtplib.SMTPAuthenticationError:
        print("BŁĄD UWIERZYTELNIENIA: Gmail wymaga HASŁA APLIKACJI "
              "(https://myaccount.google.com/apppasswords), nie zwykłego hasła.",
              file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001 — wywołujący ma zrobić fallback
        print(f"BŁĄD WYSYŁKI: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    print(f"OK: wysłano „{subject}” → {to_addr}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
