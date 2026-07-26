"""Klient Instagram Graph API — publikacja Reelsów + insights.

DARMOWE: Meta nie pobiera opłat za Content Publishing API dla własnego konta
Business/Creator. Jedyny koszt to jednorazowa konfiguracja aplikacji i tokenu
(instrukcja krok po kroku w content-pipeline/README.md).

Przepływ publikacji (3 kroki, wymuszony przez API):
1. POST /{ig-user-id}/media   media_type=REELS, video_url=<PUBLICZNY HTTPS>
2. GET  /{container-id}?fields=status_code — polling do FINISHED
3. POST /{ig-user-id}/media_publish  creation_id=<container-id>

WAŻNE: krok 1 wymaga PUBLICZNIE dostępnego URL-a — API pobiera plik samo,
nie da się wysłać bajtów multipartem. Stąd lib/hosting.py.
"""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request

GRAPH_VERSION = "v23.0"
GRAPH_BASE = f"https://graph.instagram.com/{GRAPH_VERSION}"
FACEBOOK_BASE = f"https://graph.facebook.com/{GRAPH_VERSION}"

# metryki mediów aktualne po deprecacjach z v22.0 (impressions/plays/video_views
# zostały zastąpione przez `views`)
MEDIA_METRICS = ["views", "reach", "likes", "comments", "shares", "saved"]


class InstagramError(RuntimeError):
    """Błąd zwrócony przez Graph API albo warstwę transportu."""

    def __init__(self, message: str, payload: dict | None = None):
        super().__init__(message)
        self.payload = payload or {}


def _request(url: str, *, data: dict | None = None, timeout: int = 60) -> dict:
    body = None
    headers = {"Accept": "application/json"}
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, headers=headers,
                                 method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"raw": raw}
        message = payload.get("error", {}).get("message", raw[:400])
        raise InstagramError(f"Graph API {exc.code}: {message}", payload) from exc
    except urllib.error.URLError as exc:
        raise InstagramError(f"Błąd sieci przy wywołaniu Graph API: {exc.reason}") from exc


class InstagramClient:
    def __init__(self, access_token: str, ig_user_id: str,
                 base_url: str = GRAPH_BASE):
        if not access_token or not ig_user_id:
            raise InstagramError(
                "Brak IG_ACCESS_TOKEN lub IG_USER_ID — uzupełnij .env "
                "(instrukcja: content-pipeline/README.md, sekcja o tokenie Instagrama)."
            )
        self.token = access_token
        self.ig_user_id = str(ig_user_id)
        self.base = base_url.rstrip("/")

    # -- diagnostyka -------------------------------------------------------- #
    def me(self) -> dict:
        url = (f"{self.base}/{self.ig_user_id}"
               f"?fields=id,username,account_type&access_token={self.token}")
        return _request(url)

    def publishing_limit(self) -> dict:
        """Ile z 50 postów/24h zostało zużytych (limit Meta, nie nasz)."""
        url = (f"{self.base}/{self.ig_user_id}/content_publishing_limit"
               f"?access_token={self.token}")
        return _request(url)

    # -- publikacja --------------------------------------------------------- #
    def create_reel_container(self, video_url: str, caption: str,
                              *, share_to_feed: bool = True,
                              cover_url: str | None = None,
                              thumb_offset_ms: int | None = None) -> str:
        payload = {
            "media_type": "REELS",
            "video_url": video_url,
            "caption": caption,
            "share_to_feed": "true" if share_to_feed else "false",
            "access_token": self.token,
        }
        if cover_url:
            payload["cover_url"] = cover_url
        elif thumb_offset_ms is not None:
            payload["thumb_offset"] = str(thumb_offset_ms)
        result = _request(f"{self.base}/{self.ig_user_id}/media", data=payload)
        container_id = result.get("id")
        if not container_id:
            raise InstagramError(
                f"Graph API nie zwróciło id kontenera: {result}", result)
        return container_id

    def container_status(self, container_id: str) -> dict:
        url = (f"{self.base}/{container_id}"
               f"?fields=status_code,status&access_token={self.token}")
        return _request(url)

    def wait_for_container(self, container_id: str, *, timeout_s: int = 420,
                           poll_s: int = 10, on_poll=None) -> dict:
        """Czeka na FINISHED. Wywołanie media_publish za wcześnie = błąd 400."""
        deadline = time.time() + timeout_s
        last: dict = {}
        while time.time() < deadline:
            last = self.container_status(container_id)
            code = last.get("status_code")
            if on_poll:
                on_poll(code, last)
            if code == "FINISHED":
                return last
            if code in {"ERROR", "EXPIRED"}:
                raise InstagramError(
                    f"Przetwarzanie wideo zakończone statusem {code}: "
                    f"{last.get('status')}", last)
            time.sleep(poll_s)
        raise InstagramError(
            f"Timeout ({timeout_s}s) — kontener {container_id} nie osiągnął "
            f"FINISHED (ostatni status: {last.get('status_code')})", last)

    def publish_container(self, container_id: str) -> dict:
        return _request(f"{self.base}/{self.ig_user_id}/media_publish",
                        data={"creation_id": container_id,
                              "access_token": self.token})

    def publish_reel(self, video_url: str, caption: str, *,
                     share_to_feed: bool = True, cover_url: str | None = None,
                     timeout_s: int = 420, on_poll=None) -> dict:
        container_id = self.create_reel_container(
            video_url, caption, share_to_feed=share_to_feed, cover_url=cover_url)
        self.wait_for_container(container_id, timeout_s=timeout_s, on_poll=on_poll)
        published = self.publish_container(container_id)
        media_id = published.get("id")
        details = {}
        if media_id:
            try:
                details = self.media_details(media_id)
            except InstagramError:
                details = {}
        return {"container_id": container_id, "media_id": media_id, **details}

    # -- odczyt ------------------------------------------------------------- #
    def media_details(self, media_id: str) -> dict:
        url = (f"{self.base}/{media_id}"
               f"?fields=id,permalink,media_product_type,timestamp,caption"
               f"&access_token={self.token}")
        return _request(url)

    def media_insights(self, media_id: str,
                       metrics: list[str] | None = None) -> dict:
        """Zwraca {metryka: wartość}. Niedostępne metryki są pomijane, nie wywalają."""
        metrics = metrics or MEDIA_METRICS
        url = (f"{self.base}/{media_id}/insights"
               f"?metric={','.join(metrics)}&access_token={self.token}")
        try:
            data = _request(url)
        except InstagramError as exc:
            # najczęściej: metryka niedostępna dla tego typu mediów albo za
            # świeży post — degradujemy do pojedynczych zapytań
            if len(metrics) == 1:
                raise
            merged: dict = {}
            for metric in metrics:
                try:
                    merged.update(self.media_insights(media_id, [metric]))
                except InstagramError:
                    merged[metric] = None
            merged["_partial_error"] = str(exc)
            return merged
        out: dict = {}
        for entry in data.get("data", []):
            values = entry.get("values") or [{}]
            out[entry.get("name")] = values[0].get("value")
        return out
