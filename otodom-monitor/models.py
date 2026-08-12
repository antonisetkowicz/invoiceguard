"""Wspólne struktury danych.

Trzymamy je w osobnym module, żeby `db.py` i `parsers.py` mogły ich używać
bez zależności krzyżowych.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any


# Pola, których zmiana jest traktowana jako "zmiana oferty" i trafia do raportu.
# Świadomie NIE ma tu `date_modified` — portal odświeża tę datę sam z siebie,
# raport zalałby się szumem.
TRACKED_FIELDS: tuple[str, ...] = (
    "title",
    "price",
    "price_per_m2",
    "location",
    "area",
    "rooms",
    "description",
)

# Ludzkie nazwy pól do raportu markdown.
FIELD_LABELS: dict[str, str] = {
    "title": "tytuł",
    "price": "cena",
    "price_per_m2": "cena za m²",
    "location": "lokalizacja",
    "area": "metraż",
    "rooms": "pokoje",
    "description": "opis",
    "images": "zdjęcia",
}


@dataclass
class Offer:
    """Jedna oferta nieruchomości, znormalizowana niezależnie od portalu."""

    offer_id: str
    url: str
    title: str | None = None
    price: int | None = None
    price_raw: str | None = None
    currency: str | None = None
    price_per_m2: int | None = None
    location: str | None = None
    area: float | None = None
    rooms: int | None = None
    description: str | None = None
    date_created: str | None = None
    date_modified: str | None = None
    image_urls: list[str] = field(default_factory=list)
    portal: str = "otodom"
    raw: dict[str, Any] | None = None

    def content_hash(self) -> str:
        """Hash pól śledzonych + zestawu zdjęć — tania detekcja "coś się zmieniło"."""
        payload: list[Any] = [getattr(self, name) for name in TRACKED_FIELDS]
        payload.append(sorted(self.image_urls))
        blob = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        return hashlib.sha256(blob.encode("utf-8")).hexdigest()

    def short(self) -> str:
        parts = [self.title or self.offer_id]
        if self.price is not None:
            parts.append(f"{self.price:,}".replace(",", " ") + " zł")
        if self.area:
            parts.append(f"{self.area:g} m²")
        if self.rooms:
            parts.append(f"{self.rooms} pok.")
        return " · ".join(parts)


@dataclass
class OfferChange:
    """Pojedyncza różnica wykryta między przebiegami."""

    offer_id: str
    change_type: str  # new | price | field | images | removed | restored
    field: str | None = None
    old_value: str | None = None
    new_value: str | None = None
    title: str | None = None
    url: str | None = None

    def label(self) -> str:
        return FIELD_LABELS.get(self.field or "", self.field or self.change_type)


@dataclass
class DiffResult:
    """Wynik porównania świeżego scrape'u ze stanem w bazie."""

    new: list[Offer] = field(default_factory=list)
    changed: list[tuple[Offer, list[OfferChange]]] = field(default_factory=list)
    removed: list[dict[str, Any]] = field(default_factory=list)
    restored: list[Offer] = field(default_factory=list)
    unchanged: int = 0
    removal_detection_ran: bool = False

    @property
    def has_changes(self) -> bool:
        return bool(self.new or self.changed or self.removed or self.restored)

    def summary(self) -> str:
        return (
            f"nowe: {len(self.new)}, zmienione: {len(self.changed)}, "
            f"usunięte: {len(self.removed)}, przywrócone: {len(self.restored)}, "
            f"bez zmian: {self.unchanged}"
        )


class ScraperError(Exception):
    """Błąd, przez który przebieg nie ma sensu kontynuować."""


class BlockedError(ScraperError):
    """Portal pokazał captcha / blokadę anty-botową.

    Świadomie NIE próbujemy tego obchodzić — przebieg kończy się czytelnym
    komunikatem i kodem wyjścia 2.
    """
