"""Publiczny HTTPS URL dla gotowego .mp4 — wymóg Instagram Graph API.

API pobiera plik samo z podanego `video_url`, więc plik musi być publicznie
dostępny przez HTTPS. Wszystkie backendy poniżej są DARMOWE i bez karty:

1. `public_base_url` — masz własny hosting statyczny (np. Vercel/GitHub Pages);
   podajesz PUBLIC_BASE_URL w .env, my kopiujemy plik do PUBLIC_UPLOAD_DIR.
2. `github_release` — asset w GitHub Release w Twoim repo (publiczny URL
   `https://github.com/<repo>/releases/download/<tag>/<plik>`). Limit 2 GB/plik.
3. `catbox` — catbox.moe, anonimowy hosting plików (limit 200 MB, bez konta).
   Uwaga: usługa zewnętrzna bez SLA — plik staje się publiczny dla każdego,
   kto zna URL. Dokładnie to samo dotyczy zresztą każdego `video_url`.

Jeśli żaden backend nie jest dostępny → zwracamy None, a publisher eskaluje do
publikacji ręcznej (plik i tak leży gotowy w output/).
"""
from __future__ import annotations

import json
import mimetypes
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

CATBOX_ENDPOINT = "https://catbox.moe/user/api.php"


class HostingError(RuntimeError):
    pass


def _multipart(fields: dict[str, str], file_field: str | None = None,
               file_path: Path | None = None) -> tuple[bytes, str]:
    boundary = f"----content-pipeline-{uuid.uuid4().hex}"
    parts: list[bytes] = []
    for name, value in fields.items():
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n"
            f"{value}\r\n".encode())
    if file_field and file_path:
        ctype = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; "
            f"name=\"{file_field}\"; filename=\"{file_path.name}\"\r\n"
            f"Content-Type: {ctype}\r\n\r\n".encode())
        parts.append(file_path.read_bytes())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), f"multipart/form-data; boundary={boundary}"


# --------------------------------------------------------------------------- #
# Backendy
# --------------------------------------------------------------------------- #
def upload_public_base_url(path: Path, base_url: str, upload_dir: str) -> str:
    target_dir = Path(upload_dir).expanduser()
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / path.name
    shutil.copy2(path, target)
    return f"{base_url.rstrip('/')}/{urllib.parse.quote(path.name)}"


def upload_github_release(path: Path, repo: str, tag: str = "content-assets") -> str:
    """Wrzuca plik jako asset Release'u przez `gh` CLI (darmowe, publiczne repo)."""
    if not shutil.which("gh"):
        raise HostingError("Brak `gh` CLI — backend github_release niedostępny.")
    view = subprocess.run(["gh", "release", "view", tag, "--repo", repo],
                          capture_output=True, text=True)
    if view.returncode != 0:
        created = subprocess.run(
            ["gh", "release", "create", tag, "--repo", repo, "--title",
             "Content pipeline assets", "--notes",
             "Pliki wideo hostowane dla Instagram Graph API (video_url)."],
            capture_output=True, text=True)
        if created.returncode != 0:
            raise HostingError(
                f"Nie udało się utworzyć release {tag}: {created.stderr.strip()}")
    upload = subprocess.run(
        ["gh", "release", "upload", tag, str(path), "--repo", repo, "--clobber"],
        capture_output=True, text=True)
    if upload.returncode != 0:
        raise HostingError(f"Upload assetu nie powiódł się: {upload.stderr.strip()}")
    return (f"https://github.com/{repo}/releases/download/{tag}/"
            f"{urllib.parse.quote(path.name)}")


def upload_catbox(path: Path, timeout: int = 600) -> str:
    size_mb = path.stat().st_size / (1024 * 1024)
    if size_mb > 200:
        raise HostingError(f"Plik {size_mb:.0f} MB przekracza limit 200 MB catbox.moe.")
    body, ctype = _multipart({"reqtype": "fileupload"}, "fileToUpload", path)
    req = urllib.request.Request(CATBOX_ENDPOINT, data=body,
                                 headers={"Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            url = resp.read().decode("utf-8").strip()
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        raise HostingError(f"catbox.moe nie odpowiedział poprawnie: {exc}") from exc
    if not url.startswith("https://"):
        raise HostingError(f"catbox.moe zwrócił nieoczekiwaną odpowiedź: {url[:200]}")
    return url


# --------------------------------------------------------------------------- #
# Wybór backendu
# --------------------------------------------------------------------------- #
def upload(path: Path, *, mode: str = "auto", env_get=None) -> dict:
    """Zwraca {'url': str|None, 'backend': str, 'errors': [...]}.

    `env_get` to funkcja (key, default=None) — wstrzykiwana, żeby moduł nie
    zależał od runio i dał się testować.
    """
    path = Path(path)
    if not path.exists():
        raise HostingError(f"Plik do wysłania nie istnieje: {path}")
    if env_get is None:
        import os
        env_get = lambda key, default=None: os.environ.get(key, default)  # noqa: E731

    base_url = env_get("PUBLIC_BASE_URL")
    upload_dir = env_get("PUBLIC_UPLOAD_DIR")
    gh_repo = env_get("CONTENT_ASSETS_REPO")
    gh_tag = env_get("CONTENT_ASSETS_TAG", "content-assets") or "content-assets"

    order: list[str]
    if mode == "auto":
        order = ["public_base_url", "github_release", "catbox"]
    else:
        order = [mode]

    errors: list[str] = []
    for backend in order:
        try:
            if backend == "public_base_url":
                if not (base_url and upload_dir):
                    errors.append("public_base_url: brak PUBLIC_BASE_URL/PUBLIC_UPLOAD_DIR")
                    continue
                return {"url": upload_public_base_url(path, base_url, upload_dir),
                        "backend": backend, "errors": errors}
            if backend == "github_release":
                if not gh_repo:
                    errors.append("github_release: brak CONTENT_ASSETS_REPO")
                    continue
                return {"url": upload_github_release(path, gh_repo, gh_tag),
                        "backend": backend, "errors": errors}
            if backend == "catbox":
                if (env_get("CONTENT_ALLOW_CATBOX", "true") or "true").lower() != "true":
                    errors.append("catbox: wyłączony przez CONTENT_ALLOW_CATBOX=false")
                    continue
                return {"url": upload_catbox(path), "backend": backend, "errors": errors}
            errors.append(f"nieznany backend: {backend}")
        except HostingError as exc:
            errors.append(f"{backend}: {exc}")
        except Exception as exc:  # noqa: BLE001 - raportujemy i idziemy dalej
            errors.append(f"{backend}: nieoczekiwany błąd {exc!r}")

    return {"url": None, "backend": None, "errors": errors}


if __name__ == "__main__":  # ręczny test: python3 lib/hosting.py plik.mp4
    import sys
    print(json.dumps(upload(Path(sys.argv[1])), ensure_ascii=False, indent=2))
