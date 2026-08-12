"""Pobieranie ofert przez Playwright (headless Chromium).

Otodom renderuje wyniki JavaScriptem, więc requests+BeautifulSoup nie wystarczy.
Strategia wyciągania danych jest dwutorowa:

  1. `__NEXT_DATA__` — komplet danych w JSON-ie osadzonym w stronie (Next.js).
     Ścieżka podstawowa: pełniejsza i odporniejsza niż skrobanie DOM-u.
  2. selektory CSS z config.yaml — fallback, gdy JSON zniknie albo zmieni kształt.

Blokad anty-botowych (captcha, Cloudflare) NIE obchodzimy — po wykryciu
przebieg kończy się `BlockedError`.
"""

from __future__ import annotations

import json
import logging
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from playwright.sync_api import (
    Error as PlaywrightError,
    Page,
    Response,
    TimeoutError as PlaywrightTimeout,
    sync_playwright,
)

import parsers
from config import Config
from models import BlockedError, Offer, ScraperError

log = logging.getLogger(__name__)


# JS wyciągające pozycje listingu selektorami z configu (ścieżka fallback).
JS_COLLECT_LIST = """
(sel) => {
  const items = Array.from(document.querySelectorAll(sel.list_item));
  const txt = (root, s) => {
    if (!s) return null;
    const node = root.querySelector(s);
    return node ? (node.innerText || node.textContent || '').trim() : null;
  };
  return items.map((el) => {
    const link = (sel.list_link ? el.querySelector(sel.list_link) : null)
              || el.querySelector('a[href]');
    const images = Array.from(el.querySelectorAll(sel.list_image || 'img'))
      .map((i) => i.currentSrc || i.src || i.getAttribute('data-src'))
      .filter(Boolean);
    return {
      url: link ? link.href : null,
      title: txt(el, sel.list_title),
      price: txt(el, sel.list_price),
      location: txt(el, sel.list_location),
      specs: txt(el, sel.list_area),
      images,
    };
  }).filter((o) => o.url);
}
"""

JS_COLLECT_DETAIL = """
(sel) => {
  const txt = (s) => {
    if (!s) return null;
    const node = document.querySelector(s);
    return node ? (node.innerText || node.textContent || '').trim() : null;
  };
  const images = Array.from(document.querySelectorAll(sel.detail_gallery_image || 'img'))
    .map((i) => i.currentSrc || i.src || i.getAttribute('data-src'))
    .filter(Boolean);
  return {
    url: location.href,
    title: txt(sel.detail_title),
    price: txt(sel.detail_price),
    location: txt(sel.detail_location),
    description: txt(sel.detail_description),
    images,
  };
}
"""


@dataclass
class ScrapeResult:
    offers: list[Offer] = field(default_factory=list)
    pages_visited: int = 0
    complete: bool = False  # czy objęliśmy CAŁY zbiór wyników wyszukiwania
    details_fetched: int = 0
    detail_failures: int = 0

    def __len__(self) -> int:
        return len(self.offers)


class RateLimiter:
    """Losowa przerwa między requestami — max 1 request na `min_delay` sekund."""

    def __init__(self, min_delay: float, max_delay: float) -> None:
        self.min_delay = min_delay
        self.max_delay = max(max_delay, min_delay)
        self._last: float | None = None

    def wait(self) -> None:
        target = random.uniform(self.min_delay, self.max_delay)
        if self._last is not None:
            elapsed = time.monotonic() - self._last
            remaining = target - elapsed
            if remaining > 0:
                log.debug("Rate limit: czekam %.1f s", remaining)
                time.sleep(remaining)
        else:
            # Pierwszy request nie musi czekać pełnego okna.
            time.sleep(min(1.0, self.min_delay))
        self._last = time.monotonic()


class Scraper:
    """Kontekst przeglądarki + logika przechodzenia po wynikach."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.profile = cfg.portal
        self.limiter = RateLimiter(cfg.min_delay, cfg.max_delay)
        self._pw = None
        self._browser = None
        self._context = None

    # -- cykl życia ---------------------------------------------------------

    def __enter__(self) -> "Scraper":
        self._pw = sync_playwright().start()
        try:
            launch_args: dict[str, Any] = {"headless": self.cfg.headless}
            if self.cfg.executable_path:
                launch_args["executable_path"] = self.cfg.executable_path
            self._browser = self._pw.chromium.launch(**launch_args)
        except PlaywrightError as exc:
            self._pw.stop()
            raise ScraperError(
                f"Nie udało się uruchomić Chromium ({exc}). "
                "Czy wykonałeś `playwright install chromium`?"
            ) from exc
        self._context = self._browser.new_context(
            user_agent=self.cfg.user_agent or None,
            locale=self.cfg.locale,
            timezone_id=self.cfg.timezone,
            viewport=self.cfg.viewport or None,
        )
        self._context.set_default_timeout(self.cfg.page_timeout_ms)
        return self

    def __exit__(self, *exc_info: Any) -> None:
        for closer in (self._context, self._browser):
            try:
                if closer:
                    closer.close()
            except Exception:  # sprzątanie nie może zamaskować prawdziwego błędu
                pass
        if self._pw:
            self._pw.stop()

    @property
    def request_context(self):
        """Kontekst HTTP dzielący ciasteczka z przeglądarką (do pobierania zdjęć)."""
        if not self._context:
            raise ScraperError("Scraper nie został uruchomiony (użyj `with Scraper(cfg) as s:`)")
        return self._context.request

    # -- nawigacja ----------------------------------------------------------

    def _new_page(self) -> Page:
        assert self._context is not None
        return self._context.new_page()

    def _goto(self, page: Page, url: str, wait_selector: str = "") -> Response | None:
        """Wejście na stronę z rate limitem, retry i detekcją blokady."""
        last_error: Exception | None = None

        for attempt in range(1, self.cfg.navigation_retries + 2):
            self.limiter.wait()
            try:
                response = page.goto(url, wait_until="domcontentloaded",
                                     timeout=self.cfg.page_timeout_ms)
            except PlaywrightTimeout as exc:
                last_error = exc
                log.warning("Timeout (%d/%d): %s", attempt, self.cfg.navigation_retries + 1, url)
                continue
            except PlaywrightError as exc:
                last_error = exc
                log.warning("Błąd nawigacji (%d/%d): %s — %s",
                            attempt, self.cfg.navigation_retries + 1, url, exc)
                continue

            if response is not None and response.status in self.cfg.blocking_statuses:
                raise BlockedError(
                    f"Portal odpowiedział HTTP {response.status} na {url}. "
                    "To wygląda na blokadę / rate limiting po stronie serwisu."
                )

            self._accept_cookies(page)
            self._assert_not_blocked(page)

            if wait_selector:
                try:
                    page.wait_for_selector(wait_selector, timeout=self.cfg.page_timeout_ms // 2)
                except PlaywrightTimeout:
                    log.debug("Selektor '%s' się nie pojawił — jadę dalej z tym, co jest",
                              wait_selector)
            return response

        raise ScraperError(f"Nie udało się otworzyć {url}: {last_error}")

    def _accept_cookies(self, page: Page) -> None:
        """Klik w zgodę na cookies. To baner RODO, nie zabezpieczenie anty-botowe."""
        if not self.cfg.accept_cookies:
            return
        selector = self.profile.selector("cookie_accept")
        if not selector:
            return
        try:
            button = page.locator(selector).first
            if button.count() and button.is_visible(timeout=2000):
                button.click(timeout=3000)
                page.wait_for_timeout(500)
                log.debug("Zaakceptowano baner cookies")
        except (PlaywrightTimeout, PlaywrightError):
            pass  # brak banera to normalny przypadek

    def _assert_not_blocked(self, page: Page) -> None:
        """Wykrywa captcha / Cloudflare i przerywa przebieg.

        Sprawdzamy tytuł i WIDOCZNY tekst strony, a nie surowy HTML — w bundlu JS
        słowo "captcha" potrafi wystąpić na całkowicie normalnej stronie.
        """
        markers = self.cfg.blocking_markers
        if not markers:
            return
        try:
            title = (page.title() or "").lower()
            body = page.locator("body").inner_text(timeout=5000)[:5000].lower()
        except (PlaywrightTimeout, PlaywrightError):
            return

        haystack = f"{title}\n{body}"
        for marker in markers:
            if marker in haystack:
                raise BlockedError(
                    f"Wykryto zabezpieczenie anty-botowe (marker: '{marker}') na {page.url}.\n"
                    "Przerywam przebieg — to narzędzie CELOWO nie omija captcha ani Cloudflare.\n"
                    "Co możesz zrobić: odczekać kilka godzin, zwiększyć min_delay_seconds "
                    "w config.yaml, albo uruchomić z headless: false i przejść weryfikację ręcznie."
                )

    def _autoscroll(self, page: Page, steps: int = 6, pause_ms: int = 350) -> None:
        """Przewinięcie strony, żeby doładowały się leniwe zdjęcia."""
        try:
            for _ in range(steps):
                page.mouse.wheel(0, 1600)
                page.wait_for_timeout(pause_ms)
        except PlaywrightError:
            pass

    # -- __NEXT_DATA__ ------------------------------------------------------

    def _next_data(self, page: Page) -> dict[str, Any] | None:
        if not self.profile.next_data_enabled:
            return None
        try:
            raw = page.locator(f"script#{self.profile.next_data_script_id}").first.text_content(
                timeout=5000
            )
        except (PlaywrightTimeout, PlaywrightError):
            log.debug("Brak <script id=%s> na stronie", self.profile.next_data_script_id)
            return None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            log.warning("__NEXT_DATA__ nie jest poprawnym JSON-em: %s", exc)
            return None

    # -- listing ------------------------------------------------------------

    def _page_url(self, base_url: str, page_number: int) -> str:
        if page_number <= 1:
            return base_url
        parsed = urlparse(base_url)
        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query[self.profile.pagination_param] = str(page_number)
        return urlunparse(parsed._replace(query=urlencode(query)))

    def _offers_from_listing(self, page: Page) -> tuple[list[Offer], str]:
        """Zwraca (oferty, użyta_metoda) dla aktualnie otwartej strony wyników."""
        data = self._next_data(page)
        if data:
            items = None
            for path in self.profile.list_paths:
                candidate = parsers.json_dig(data, path)
                if isinstance(candidate, list) and candidate:
                    items = candidate
                    log.debug("Lista ofert z __NEXT_DATA__ (%s): %d pozycji", path, len(items))
                    break
            if items is None:
                items = parsers.find_list_of_offers(data)
                if items:
                    log.warning(
                        "Skonfigurowane next_data.list_paths nie pasują — użyłem wyszukiwania "
                        "po kształcie (%d pozycji). Zweryfikuj config przez --debug-dump.",
                        len(items),
                    )
            if items:
                offers = [
                    o for o in (
                        parsers.offer_from_json(item, self.profile,
                                                image_limit=self.cfg.max_images_per_offer)
                        for item in items
                    ) if o is not None
                ]
                if offers:
                    return offers, "next_data"

        # Fallback: selektory CSS.
        selector = self.profile.selector("list_item")
        if not selector:
            return [], "brak"
        self._autoscroll(page, steps=4)
        try:
            raw_items = page.evaluate(JS_COLLECT_LIST, self.profile.selectors)
        except PlaywrightError as exc:
            log.error("Nie udało się odczytać listingu selektorami: %s", exc)
            return [], "dom"
        offers = [
            o for o in (
                parsers.offer_from_dom(item, self.profile,
                                       image_limit=self.cfg.max_images_per_offer)
                for item in raw_items
            ) if o is not None
        ]
        return offers, "dom"

    def scrape_listing(self, progress: Callable[[str], None] | None = None) -> ScrapeResult:
        """Przechodzi po stronach wyników i zbiera oferty (bez szczegółów)."""
        result = ScrapeResult()
        seen: set[str] = set()
        limit = self.cfg.max_offers_per_run
        page = self._new_page()
        more_pages_available = False

        try:
            for page_number in range(1, self.cfg.max_pages + 1):
                url = self._page_url(self.cfg.search_url, page_number)
                log.info("Strona wyników %d/%d: %s", page_number, self.cfg.max_pages, url)
                self._goto(page, url, wait_selector=self.profile.selector("list_item"))

                offers, method = self._offers_from_listing(page)
                result.pages_visited += 1
                if not offers:
                    log.info("Strona %d nie zwróciła ofert (metoda: %s) — kończę stronicowanie",
                             page_number, method)
                    break

                fresh = [o for o in offers if o.offer_id not in seen]
                if not fresh:
                    log.info("Strona %d powtarza wyniki poprzedniej — kończę stronicowanie",
                             page_number)
                    break

                for offer in fresh:
                    if limit and len(result.offers) >= limit:
                        more_pages_available = True
                        break
                    seen.add(offer.offer_id)
                    result.offers.append(offer)

                if progress:
                    progress(f"listing: {len(result.offers)} ofert (metoda: {method})")

                if limit and len(result.offers) >= limit:
                    log.info("Osiągnięto limit %d ofert na przebieg", limit)
                    break
                if page_number == self.cfg.max_pages:
                    more_pages_available = True
        finally:
            page.close()

        result.complete = not more_pages_available
        return result

    # -- strona oferty ------------------------------------------------------

    def scrape_detail(self, offer: Offer) -> Offer:
        """Wchodzi na stronę oferty po pełny opis i całą galerię."""
        page = self._new_page()
        try:
            self._goto(page, offer.url, wait_selector=self.profile.selector("detail_title"))
            data = self._next_data(page)
            detail: Offer | None = None

            if data:
                node = None
                for path in self.profile.detail_paths:
                    candidate = parsers.json_dig(data, path)
                    if isinstance(candidate, dict) and candidate:
                        node = candidate
                        break
                if node is None:
                    node = parsers.find_offer_object(data)
                if node:
                    detail = parsers.offer_from_json(
                        node, self.profile, image_limit=self.cfg.max_images_per_offer
                    )
                    if detail is not None:
                        detail.raw = {"source": "next_data"}

            if detail is None or not detail.description or not detail.image_urls:
                dom_detail = self._detail_from_dom(page)
                if dom_detail:
                    detail = parsers.merge_detail(detail, dom_detail) if detail else dom_detail

            if detail is None:
                log.warning("Nie udało się odczytać szczegółów oferty %s", offer.url)
                return offer

            # ID i URL z listingu są wiarygodniejsze — nie pozwalamy ich nadpisać.
            detail.offer_id = offer.offer_id
            detail.url = offer.url
            return parsers.merge_detail(offer, detail)
        finally:
            page.close()

    def _detail_from_dom(self, page: Page) -> Offer | None:
        """Fallback dla strony oferty: rozwinięcie galerii + odczyt selektorami."""
        gallery_button = self.profile.selector("gallery_open")
        if gallery_button:
            try:
                button = page.locator(gallery_button).first
                if button.count() and button.is_visible(timeout=2000):
                    button.click(timeout=3000)
                    page.wait_for_timeout(1200)
            except (PlaywrightTimeout, PlaywrightError):
                log.debug("Nie udało się otworzyć galerii — biorę zdjęcia widoczne na stronie")
        self._autoscroll(page, steps=8)
        try:
            raw = page.evaluate(JS_COLLECT_DETAIL, self.profile.selectors)
        except PlaywrightError as exc:
            log.warning("Odczyt szczegółów selektorami nie powiódł się: %s", exc)
            return None
        return parsers.offer_from_dom(raw, self.profile,
                                      image_limit=self.cfg.max_images_per_offer)

    # -- pełny przebieg -----------------------------------------------------

    def run(self, progress: Callable[[str], None] | None = None) -> ScrapeResult:
        result = self.scrape_listing(progress=progress)
        if not self.cfg.fetch_details:
            return result

        total = len(result.offers)
        for index, offer in enumerate(result.offers, start=1):
            if progress:
                progress(f"szczegóły {index}/{total}: {offer.url}")
            try:
                self.scrape_detail(offer)
                result.details_fetched += 1
            except BlockedError:
                raise  # blokada = koniec przebiegu, nie idziemy dalej
            except (ScraperError, PlaywrightError) as exc:
                result.detail_failures += 1
                log.warning("Szczegóły oferty %s nieudane: %s", offer.offer_id, exc)
        return result

    # -- diagnostyka --------------------------------------------------------

    def debug_dump(self, url: str, out_dir: Path) -> dict[str, Path]:
        """Zrzuca HTML, __NEXT_DATA__ i screenshot — do poprawiania selektorów.

        Gdy portal przebuduje stronę, to jest pierwszy krok: zobacz, gdzie
        naprawdę siedzą dane, i popraw ścieżki/selektory w config.yaml.
        """
        out_dir.mkdir(parents=True, exist_ok=True)
        page = self._new_page()
        written: dict[str, Path] = {}
        try:
            self._goto(page, url)
            self._autoscroll(page, steps=4)

            html_path = out_dir / "page.html"
            html_path.write_text(page.content(), encoding="utf-8")
            written["html"] = html_path

            data = self._next_data(page)
            if data:
                json_path = out_dir / "next_data.json"
                json_path.write_text(
                    json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                written["next_data"] = json_path

                paths_path = out_dir / "next_data_paths.txt"
                paths_path.write_text("\n".join(_walk_paths(data)), encoding="utf-8")
                written["paths"] = paths_path

            shot_path = out_dir / "screenshot.png"
            page.screenshot(path=str(shot_path), full_page=False)
            written["screenshot"] = shot_path
        finally:
            page.close()
        return written


def _walk_paths(data: Any, prefix: str = "", max_depth: int = 6) -> list[str]:
    """Spis ścieżek w JSON-ie — ułatwia znalezienie właściwej `list_paths`."""
    out: list[str] = []
    if max_depth <= 0:
        return out
    if isinstance(data, dict):
        for key, value in data.items():
            path = f"{prefix}.{key}" if prefix else key
            if isinstance(value, list):
                out.append(f"{path}  [lista: {len(value)}]")
            elif isinstance(value, dict):
                out.append(f"{path}  {{obiekt: {len(value)} kluczy}}")
            out.extend(_walk_paths(value, path, max_depth - 1))
    elif isinstance(data, list) and data:
        out.extend(_walk_paths(data[0], f"{prefix}.0", max_depth - 1))
    return out


def safe_dir_name(value: str) -> str:
    """Nazwa katalogu bezpieczna dla systemu plików (ID ofert bywa dziwne)."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", value).strip("._")
    return cleaned or "offer"
