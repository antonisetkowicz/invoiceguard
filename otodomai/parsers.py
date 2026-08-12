"""Normalizacja surowych danych ze strony do obiektów `Offer`.

Moduł jest CELOWO odcięty od Playwrighta — dostaje albo słownik z JSON-a
osadzonego w stronie, albo słownik tekstów wyciągniętych z DOM-u. Dzięki temu
da się go testować bez przeglądarki (`selftest.py`) i łatwiej przenieść na
inny portal.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
from typing import Any, Iterable

from config import PortalProfile
from models import Offer

log = logging.getLogger(__name__)

# Otodom zwraca liczbę pokoi jako enum ("THREE"), a nie liczbę.
ROOMS_WORDS: dict[str, int] = {
    "ONE": 1, "TWO": 2, "THREE": 3, "FOUR": 4, "FIVE": 5,
    "SIX": 6, "SEVEN": 7, "EIGHT": 8, "NINE": 9, "TEN": 10,
    "MORE": 11,
    "JEDEN": 1, "DWA": 2, "TRZY": 3, "CZTERY": 4, "PIĘĆ": 5,
}

PRICE_KEYS = ("totalPrice", "price", "priceFromPerSquareMeter", "hidePrice")
AREA_KEYS = ("areaInSquareMeters", "area", "Area", "m")
ROOMS_KEYS = ("roomsNumber", "rooms_num", "Rooms_num", "rooms", "numberOfRooms")
TITLE_KEYS = ("title", "name", "adTitle")
DATE_CREATED_KEYS = ("dateCreatedFirst", "dateCreated", "createdAt", "created_at", "pushedUpAt")
DATE_MODIFIED_KEYS = ("dateModified", "modifiedAt", "updatedAt", "modified_at")
DESCRIPTION_KEYS = ("description", "descriptionHtml", "adDescription")


# ---------------------------------------------------------------------------
# drobne parsery tekstu
# ---------------------------------------------------------------------------

def parse_price(value: Any) -> tuple[int | None, str | None]:
    """'749 000 zł' / {'value': 749000, 'currency': 'PLN'} -> (749000, 'PLN')."""
    if value is None:
        return None, None
    if isinstance(value, dict):
        currency = value.get("currency") or value.get("unit")
        for key in ("value", "amount", "total", "grossPrice"):
            if value.get(key) is not None:
                amount, parsed_currency = parse_price(value[key])
                return amount, currency or parsed_currency
        return None, currency
    if isinstance(value, (int, float)):
        return int(round(value)), None

    text = str(value)
    currency = None
    lowered = text.lower()
    if "zł" in lowered or "pln" in lowered:
        currency = "PLN"
    elif "€" in text or "eur" in lowered:
        currency = "EUR"
    elif "$" in text or "usd" in lowered:
        currency = "USD"

    # Wywalamy separatory tysięcy (spacja zwykła, niełamiąca, wąska) i część groszową.
    cleaned = re.sub(r"[\s   ]", "", text)
    cleaned = cleaned.replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", cleaned)
    if not match:
        return None, currency  # np. "Zapytaj o cenę"
    number = float(match.group())
    return int(round(number)), currency


def parse_area(value: Any) -> float | None:
    """'64,50 m²' -> 64.5"""
    if value is None:
        return None
    if isinstance(value, dict):
        return parse_area(value.get("value") or value.get("area"))
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[\s  ]", "", str(value)).replace(",", ".")
    match = re.search(r"\d+(?:\.\d+)?", text)
    return float(match.group()) if match else None


def parse_rooms(value: Any) -> int | None:
    """'3 pokoje' / 'THREE' / ['3'] -> 3"""
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return parse_rooms(value[0]) if value else None
    if isinstance(value, dict):
        return parse_rooms(value.get("value") or value.get("rooms"))
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip()
    if text.upper() in ROOMS_WORDS:
        return ROOMS_WORDS[text.upper()]
    match = re.search(r"\d+", text)
    return int(match.group()) if match else None


TAG_RE = re.compile(r"<[^>]+>")
BREAK_RE = re.compile(r"(?i)<\s*(br\s*/?|/p|/div|/li|/h[1-6])\s*>")


def html_to_text(value: Any) -> str | None:
    """Opis z portalu przychodzi jako HTML — zamieniamy na czysty tekst."""
    if value is None:
        return None
    if isinstance(value, dict):
        for key in ("value", "text", "html"):
            if value.get(key):
                return html_to_text(value[key])
        return None
    text = BREAK_RE.sub("\n", str(value))
    text = TAG_RE.sub("", text)
    text = html.unescape(text)
    text = re.sub(r"[ \t ]+", " ", text)
    text = re.sub(r"\n\s*\n\s*\n+", "\n\n", text)
    return text.strip() or None


# ---------------------------------------------------------------------------
# nawigacja po JSON-ie
# ---------------------------------------------------------------------------

def json_dig(data: Any, path: str) -> Any:
    """Odczyt po ścieżce 'props.pageProps.data.searchAds.items'."""
    node = data
    for part in path.split("."):
        if isinstance(node, list):
            if not part.isdigit() or int(part) >= len(node):
                return None
            node = node[int(part)]
        elif isinstance(node, dict):
            if part not in node:
                return None
            node = node[part]
        else:
            return None
    return node


def find_list_of_offers(data: Any, max_depth: int = 12) -> list[dict[str, Any]] | None:
    """Awaryjne szukanie listy ofert po KSZTAŁCIE, gdy skonfigurowane ścieżki
    przestaną pasować (portal przebudował JSON).

    Szukamy najdłuższej listy słowników, które wyglądają jak ogłoszenie.
    """
    best: list[dict[str, Any]] | None = None

    def looks_like_offer(item: Any) -> bool:
        if not isinstance(item, dict):
            return False
        keys = set(item)
        has_id = bool(keys & {"id", "slug", "adId", "publicId"})
        has_shape = bool(keys & set(PRICE_KEYS) | keys & set(AREA_KEYS) | keys & set(TITLE_KEYS))
        return has_id and has_shape

    def walk(node: Any, depth: int) -> None:
        nonlocal best
        if depth > max_depth:
            return
        if isinstance(node, list):
            candidates = [i for i in node if looks_like_offer(i)]
            if candidates and (best is None or len(candidates) > len(best)):
                best = candidates
            for item in node:
                walk(item, depth + 1)
        elif isinstance(node, dict):
            for value in node.values():
                walk(value, depth + 1)

    walk(data, 0)
    return best


def find_offer_object(data: Any, max_depth: int = 12) -> dict[str, Any] | None:
    """To samo co wyżej, ale dla pojedynczej oferty (strona szczegółów)."""
    best: dict[str, Any] | None = None
    best_score = 0

    def score(item: dict[str, Any]) -> int:
        keys = set(item)
        points = 0
        points += 3 if keys & set(DESCRIPTION_KEYS) else 0
        points += 2 if keys & {"images", "photos"} else 0
        points += 2 if keys & set(PRICE_KEYS) else 0
        points += 1 if keys & set(TITLE_KEYS) else 0
        points += 1 if keys & {"id", "slug", "publicId"} else 0
        return points

    def walk(node: Any, depth: int) -> None:
        nonlocal best, best_score
        if depth > max_depth:
            return
        if isinstance(node, dict):
            value = score(node)
            if value > best_score and value >= 5:
                best, best_score = node, value
            for child in node.values():
                walk(child, depth + 1)
        elif isinstance(node, list):
            for child in node:
                walk(child, depth + 1)

    walk(data, 0)
    return best


def _first(data: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if isinstance(data, dict) and data.get(key) not in (None, "", [], {}):
            return data[key]
    return None


def _extract_location(data: dict[str, Any]) -> str | None:
    """Lokalizacja bywa stringiem, obiektem albo drzewem — bierzemy co się da."""
    candidate = _first(data, ("locationLabel", "location", "address", "locationDetails"))
    if candidate is None:
        return None
    if isinstance(candidate, str):
        return candidate.strip() or None
    if isinstance(candidate, dict):
        for key in ("value", "label", "name", "fullName", "shortLabel"):
            value = candidate.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        # Otodom: location.address.{city,district,street}.name
        address = candidate.get("address") if isinstance(candidate.get("address"), dict) else candidate
        parts: list[str] = []
        for key in ("province", "city", "district", "subdistrict", "street"):
            node = address.get(key) if isinstance(address, dict) else None
            if isinstance(node, dict):
                name = node.get("name") or node.get("label")
                number = node.get("number")
                if name:
                    parts.append(f"{name} {number}".strip() if number else str(name))
            elif isinstance(node, str) and node.strip():
                parts.append(node.strip())
        if parts:
            # od najbardziej szczegółowego
            return ", ".join(dict.fromkeys(reversed(parts)))
    return None


def _extract_characteristic(data: dict[str, Any], *names: str) -> Any:
    """Otodom trzyma część parametrów w liście `characteristics`."""
    items = data.get("characteristics")
    if not isinstance(items, list):
        return None
    wanted = {n.lower() for n in names}
    for item in items:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or item.get("label") or "").lower()
        if key in wanted:
            return item.get("value") or item.get("localizedValue") or item.get("currency")
    return None


def _extract_target(data: dict[str, Any], *names: str) -> Any:
    target = data.get("target")
    if not isinstance(target, dict):
        return None
    for name in names:
        if target.get(name) not in (None, "", []):
            return target[name]
    return None


# ---------------------------------------------------------------------------
# zdjęcia
# ---------------------------------------------------------------------------

def upgrade_image_url(url: str, profile: PortalProfile) -> str:
    """Miniatura -> pełna rozdzielczość, wg reguł z profilu portalu."""
    result = url
    for rule in profile.image_url_rules:
        pattern = rule.get("pattern")
        if not pattern:
            continue
        try:
            result = re.sub(pattern, rule.get("replacement", ""), result)
        except re.error as exc:
            log.warning("Zła regułka image_url_rules (%s): %s", pattern, exc)
    return result


def extract_images(data: Any, profile: PortalProfile, limit: int = 0) -> list[str]:
    """Wyciąga URL-e zdjęć w najlepszej dostępnej jakości, bez duplikatów."""
    raw = data.get("images") or data.get("photos") or data.get("gallery") if isinstance(data, dict) else data
    urls: list[str] = []

    def add(value: Any) -> None:
        if isinstance(value, str) and value.startswith("http"):
            urls.append(upgrade_image_url(value, profile))
        elif isinstance(value, dict):
            for key in profile.image_keys:
                candidate = value.get(key)
                if isinstance(candidate, str) and candidate.startswith("http"):
                    urls.append(upgrade_image_url(candidate, profile))
                    return
            for candidate in value.values():  # ostatnia deska ratunku
                if isinstance(candidate, str) and candidate.startswith("http"):
                    urls.append(upgrade_image_url(candidate, profile))
                    return

    if isinstance(raw, list):
        for item in raw:
            add(item)
    elif raw is not None:
        add(raw)

    deduped = list(dict.fromkeys(urls))
    return deduped[:limit] if limit else deduped


# ---------------------------------------------------------------------------
# ID oferty
# ---------------------------------------------------------------------------

def offer_id_from_url(url: str, profile: PortalProfile) -> str:
    pattern = profile.offer_id_pattern
    if pattern:
        match = re.search(pattern, url)
        if match:
            return match.group(1) if match.groups() else match.group(0)
    # Bez wzorca: stabilny skrót ze ścieżki URL-a (bez query stringa).
    path = url.split("?")[0].rstrip("/")
    return "u" + hashlib.sha1(path.encode("utf-8")).hexdigest()[:16]


def build_offer_url(item: dict[str, Any], profile: PortalProfile) -> str | None:
    for key in ("url", "link", "href", "canonicalUrl"):
        value = item.get(key)
        if isinstance(value, str) and value:
            if value.startswith("http"):
                return value
            return profile.base_url + ("" if value.startswith("/") else "/") + value
    slug = item.get("slug")
    if slug and profile.offer_url_template:
        return profile.offer_url_template.format(slug=slug)
    return None


# ---------------------------------------------------------------------------
# normalizacja
# ---------------------------------------------------------------------------

def offer_from_json(item: dict[str, Any], profile: PortalProfile, *, image_limit: int = 0) -> Offer | None:
    """Obiekt oferty z JSON-a osadzonego w stronie -> `Offer`."""
    if not isinstance(item, dict):
        return None

    url = build_offer_url(item, profile)
    if not url:
        log.debug("Pomijam pozycję bez URL-a: klucze=%s", list(item)[:10])
        return None

    raw_id = item.get("id") or item.get("publicId") or item.get("adId")
    offer_id = str(raw_id) if raw_id not in (None, "") else offer_id_from_url(url, profile)

    price_source = _first(item, PRICE_KEYS)
    if price_source is None:
        price_source = _extract_target(item, "Price") or _extract_characteristic(item, "price")
    price, currency = parse_price(price_source)

    ppm, _ = parse_price(
        _first(item, ("pricePerSquareMeter", "pricePerSquareMeter"))
        or _extract_characteristic(item, "price_per_m")
    )

    area = parse_area(_first(item, AREA_KEYS) or _extract_target(item, "Area")
                      or _extract_characteristic(item, "m"))
    rooms = parse_rooms(_first(item, ROOMS_KEYS) or _extract_target(item, "Rooms_num")
                        or _extract_characteristic(item, "rooms_num"))

    description = html_to_text(_first(item, DESCRIPTION_KEYS))
    title = _first(item, TITLE_KEYS)

    return Offer(
        offer_id=offer_id,
        url=url.split("?")[0],
        title=str(title).strip() if title else None,
        price=price,
        price_raw=str(price_source) if isinstance(price_source, str) else (
            f"{price} {currency}" if price is not None else None
        ),
        currency=currency or "PLN",
        price_per_m2=ppm,
        location=_extract_location(item),
        area=area,
        rooms=rooms,
        description=description,
        date_created=_stringify_date(_first(item, DATE_CREATED_KEYS)),
        date_modified=_stringify_date(_first(item, DATE_MODIFIED_KEYS)),
        image_urls=extract_images(item, profile, image_limit),
        portal=profile.key,
    )


def offer_from_dom(raw: dict[str, Any], profile: PortalProfile, *, image_limit: int = 0) -> Offer | None:
    """Słownik tekstów wyciągniętych selektorami CSS -> `Offer`.

    Ścieżka awaryjna, używana gdy w stronie nie ma JSON-a (albo zmienił kształt)
    oraz przy portalach renderowanych klasycznie.
    """
    url = raw.get("url")
    if not url:
        return None
    if not url.startswith("http"):
        url = profile.base_url + ("" if url.startswith("/") else "/") + url

    price, currency = parse_price(raw.get("price"))
    specs = " ".join(filter(None, [raw.get("area"), raw.get("rooms"), raw.get("specs")]))
    area = parse_area(_match_unit(specs, r"([\d\s,.]+)\s*m²"))
    rooms = parse_rooms(_match_unit(specs, r"(\d+)\s*(?:pok|pokoj)"))

    images = [u for u in (raw.get("images") or []) if isinstance(u, str)]
    images = list(dict.fromkeys(upgrade_image_url(u, profile) for u in images))

    return Offer(
        offer_id=offer_id_from_url(url, profile),
        url=url.split("?")[0],
        title=(raw.get("title") or "").strip() or None,
        price=price,
        price_raw=(raw.get("price") or "").strip() or None,
        currency=currency or "PLN",
        location=(raw.get("location") or "").strip() or None,
        area=area,
        rooms=rooms,
        description=html_to_text(raw.get("description")),
        date_created=_stringify_date(raw.get("date")),
        image_urls=images[:image_limit] if image_limit else images,
        portal=profile.key,
    )


def _match_unit(text: str, pattern: str) -> str | None:
    match = re.search(pattern, text or "", re.IGNORECASE)
    return match.group(1) if match else None


def _stringify_date(value: Any) -> str | None:
    if value in (None, "", [], {}):
        return None
    if isinstance(value, dict):
        return _stringify_date(_first(value, ("value", "date", "iso")))
    return str(value).strip() or None


def merge_detail(base: Offer, detail: Offer) -> Offer:
    """Nakłada dane ze strony oferty na to, co znaleźliśmy na listingu.

    Listing bywa bogatszy w cenę/lokalizację, szczegóły — w opis i galerię.
    Wygrywa wartość niepusta, przy konflikcie: szczegóły.
    """
    for name in ("title", "price", "price_raw", "currency", "price_per_m2", "location",
                 "area", "rooms", "description", "date_created", "date_modified"):
        value = getattr(detail, name)
        if value not in (None, ""):
            setattr(base, name, value)
    if detail.image_urls:
        base.image_urls = list(dict.fromkeys(base.image_urls + detail.image_urls))
    if detail.raw:
        base.raw = detail.raw
    return base
