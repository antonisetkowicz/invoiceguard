#!/usr/bin/env python3
"""Testy logiki bez sieci i bez przeglądarki.

Sprawdzają to, co najłatwiej zepsuć przy przenoszeniu na inny portal:
parsowanie cen/metrażu/pokoi, wyciąganie ofert z JSON-a, zamianę miniatur na
pełną rozdzielczość oraz cały mechanizm diffa w SQLite.

    python selftest.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
import parsers
import report as report_mod
from config import load_config
from models import Offer

PASSED = 0
FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    global PASSED
    if condition:
        PASSED += 1
        print(f"  ✓ {name}")
    else:
        FAILED.append(f"{name}{(' — ' + detail) if detail else ''}")
        print(f"  ✗ {name}{(' — ' + detail) if detail else ''}")


def eq(name: str, actual, expected) -> None:
    check(name, actual == expected, f"otrzymano {actual!r}, oczekiwano {expected!r}")


# --------------------------------------------------------------------------
# fixture: fragment __NEXT_DATA__ w kształcie, jaki serwuje Otodom
# --------------------------------------------------------------------------

NEXT_DATA = {
    "props": {
        "pageProps": {
            "data": {
                "searchAds": {
                    "items": [
                        {
                            "id": 64123456,
                            "slug": "mieszkanie-3-pokoje-mokotow-ID4xK9p",
                            "title": "Słoneczne 3 pokoje, Mokotów, bez PCC",
                            "totalPrice": {"value": 749000, "currency": "PLN"},
                            "pricePerSquareMeter": {"value": 11523, "currency": "PLN"},
                            "areaInSquareMeters": 65.0,
                            "roomsNumber": "THREE",
                            "dateCreated": "2026-08-01 09:12:00",
                            "location": {
                                "address": {
                                    "city": {"name": "Warszawa"},
                                    "district": {"name": "Mokotów"},
                                    "street": {"name": "Puławska", "number": "12"},
                                }
                            },
                            "images": [
                                {
                                    "small": "https://cdn.example.com/v1/files/aaa/image;s=350x265",
                                    "large": "https://cdn.example.com/v1/files/aaa/image;s=655x491",
                                },
                                {
                                    "large": "https://cdn.example.com/v1/files/bbb/image;s=655x491;q=80",
                                },
                            ],
                        },
                        {
                            "id": 64222222,
                            "slug": "kawalerka-wola-ID4zzz1",
                            "title": "Kawalerka Wola",
                            "totalPrice": {"value": 480000, "currency": "PLN"},
                            "areaInSquareMeters": 28.4,
                            "roomsNumber": "ONE",
                            "images": [],
                        },
                    ]
                }
            }
        }
    }
}

DETAIL_DATA = {
    "props": {
        "pageProps": {
            "ad": {
                "id": 64123456,
                "slug": "mieszkanie-3-pokoje-mokotow-ID4xK9p",
                "title": "Słoneczne 3 pokoje, Mokotów, bez PCC",
                "description": "<p>Mieszkanie po <strong>remoncie</strong>.</p><br/><p>Cicha okolica.</p>",
                "target": {"Price": 749000, "Area": "65", "Rooms_num": ["3"]},
                "characteristics": [{"key": "price", "value": "749000"}],
                "createdAt": "2026-08-01T09:12:00+02:00",
                "modifiedAt": "2026-08-09T11:00:00+02:00",
                "images": [
                    {"large": "https://cdn.example.com/v1/files/aaa/image;s=655x491"},
                    {"large": "https://cdn.example.com/v1/files/ccc/image;s=655x491"},
                ],
            }
        }
    }
}


def test_text_parsers() -> None:
    print("\n[1] Parsery tekstu")
    eq("cena '749 000 zł'", parsers.parse_price("749 000 zł"), (749000, "PLN"))
    eq("cena z niełamiącą spacją", parsers.parse_price("1 250 000 zł"), (1250000, "PLN"))
    eq("cena jako obiekt", parsers.parse_price({"value": 480000, "currency": "PLN"}), (480000, "PLN"))
    eq("'Zapytaj o cenę' -> brak", parsers.parse_price("Zapytaj o cenę"), (None, None))
    eq("metraż '64,50 m²'", parsers.parse_area("64,50 m²"), 64.5)
    eq("pokoje 'THREE'", parsers.parse_rooms("THREE"), 3)
    eq("pokoje '2 pokoje'", parsers.parse_rooms("2 pokoje"), 2)
    eq("pokoje ['3']", parsers.parse_rooms(["3"]), 3)
    eq("HTML -> tekst",
       parsers.html_to_text("<p>Ala <b>ma</b> kota.</p><br/><p>I psa.</p>"),
       "Ala ma kota.\n\nI psa.")


def test_json_extraction(profile) -> None:
    print("\n[2] Wyciąganie ofert z __NEXT_DATA__")
    items = parsers.json_dig(NEXT_DATA, "props.pageProps.data.searchAds.items")
    check("json_dig znajduje listę", isinstance(items, list) and len(items) == 2)

    offer = parsers.offer_from_json(items[0], profile)
    eq("offer_id z pola id", offer.offer_id, "64123456")
    eq("URL z szablonu + slug", offer.url,
       "https://www.otodom.pl/pl/oferta/mieszkanie-3-pokoje-mokotow-ID4xK9p")
    eq("cena", offer.price, 749000)
    eq("cena za m²", offer.price_per_m2, 11523)
    eq("metraż", offer.area, 65.0)
    eq("pokoje z enuma", offer.rooms, 3)
    check("lokalizacja złożona z adresu",
          offer.location is not None and "Mokotów" in offer.location and "Warszawa" in offer.location,
          str(offer.location))
    eq("zdjęcia podniesione do pełnej rozdzielczości",
       offer.image_urls,
       ["https://cdn.example.com/v1/files/aaa/image;s=1280x1024",
        "https://cdn.example.com/v1/files/bbb/image;s=1280x1024"])

    eq("limit zdjęć respektowany",
       len(parsers.offer_from_json(items[0], profile, image_limit=1).image_urls), 1)

    print("\n[3] Fallback: szukanie listy po kształcie")
    broken = {"zupelnie": {"inna": {"struktura": NEXT_DATA["props"]["pageProps"]["data"]["searchAds"]["items"]}}}
    found = parsers.find_list_of_offers(broken)
    check("znaleziono listę mimo zmiany ścieżki", found is not None and len(found) == 2)

    detail_node = parsers.find_offer_object(DETAIL_DATA)
    check("znaleziono obiekt oferty na stronie szczegółów", detail_node is not None)
    detail = parsers.offer_from_json(detail_node, profile)
    check("opis odhtmlowany", detail.description == "Mieszkanie po remoncie.\n\nCicha okolica.",
          repr(detail.description))
    eq("data modyfikacji", detail.date_modified, "2026-08-09T11:00:00+02:00")


def test_id_from_url(profile) -> None:
    print("\n[4] ID oferty z URL-a")
    eq("wzorzec ID z configu",
       parsers.offer_id_from_url(
           "https://www.otodom.pl/pl/oferta/mieszkanie-3-pokoje-mokotow-ID4xK9p", profile),
       "ID4xK9p")
    fallback = parsers.offer_id_from_url("https://www.otodom.pl/pl/oferta/bez-wzorca", profile)
    check("fallback to stabilny skrót", fallback.startswith("u") and len(fallback) == 17, fallback)
    eq("skrót ignoruje query string",
       parsers.offer_id_from_url("https://www.otodom.pl/pl/oferta/bez-wzorca?a=1", profile),
       fallback)


def _offer(**kwargs) -> Offer:
    base = dict(
        offer_id="ID1", url="https://www.otodom.pl/pl/oferta/x-ID1", title="Mieszkanie",
        price=500000, area=50.0, rooms=2, location="Warszawa", portal="otodom",
        image_urls=["https://cdn.example.com/1.jpg"],
    )
    base.update(kwargs)
    return Offer(**base)


def test_db_diff(cfg) -> None:
    print("\n[5] Diff w SQLite")
    with tempfile.TemporaryDirectory() as tmp:
        conn = db.connect(Path(tmp) / "test.db")

        run1 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [_offer()], run_id=run1, detect_removals=True,
                                missing_runs_threshold=2)
        eq("pierwszy przebieg: nowa oferta", (len(diff.new), len(diff.changed)), (1, 0))

        run2 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [_offer()], run_id=run2, detect_removals=True,
                                missing_runs_threshold=2)
        eq("ta sama oferta: bez zmian", (len(diff.new), len(diff.changed), diff.unchanged), (0, 0, 1))

        run3 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [_offer(price=460000)], run_id=run3, detect_removals=True,
                                missing_runs_threshold=2)
        eq("obniżka ceny wykryta", len(diff.changed), 1)
        change = diff.changed[0][1][0]
        eq("typ zmiany", change.change_type, "price")
        eq("stara/nowa cena", (change.old_value, change.new_value), ("500000", "460000"))

        # Przebieg bez szczegółów nie może zgubić opisu ani zdjęć.
        run4 = db.start_run(conn, "test", "http://example")
        db.record_scrape(conn, [_offer(price=460000, description="Ładne mieszkanie")],
                         run_id=run4, detect_removals=True, missing_runs_threshold=2)
        run5 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [_offer(price=460000, description=None, image_urls=[])],
                                run_id=run5, detect_removals=True, missing_runs_threshold=2)
        eq("brak opisu w listingu nie kasuje opisu z bazy", len(diff.changed), 0)
        eq("opis nadal w bazie", db.get_offer(conn, "ID1")["description"], "Ładne mieszkanie")
        eq("zdjęcia nadal w bazie", len(db.offer_image_urls(conn, "ID1")), 1)

        # Zniknięcie oferty: dopiero po 2 przebiegach.
        run6 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [], run_id=run6, detect_removals=True,
                                missing_runs_threshold=2)
        eq("1. nieobecność: jeszcze nie usunięta", len(diff.removed), 0)
        eq("status nadal aktywny", db.get_offer(conn, "ID1")["status"], "active")

        run7 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [], run_id=run7, detect_removals=True,
                                missing_runs_threshold=2)
        eq("2. nieobecność: oznaczona jako usunięta", len(diff.removed), 1)
        eq("status removed", db.get_offer(conn, "ID1")["status"], "removed")

        # Niepełny przebieg NIE może kasować ofert.
        run8 = db.start_run(conn, "test", "http://example")
        db.record_scrape(conn, [_offer(offer_id="ID2", url="https://x/ID2")], run_id=run8,
                         detect_removals=True, missing_runs_threshold=2)
        run9 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [], run_id=run9, detect_removals=False,
                                missing_runs_threshold=2)
        eq("bez detect_removals nic nie znika", len(diff.removed), 0)
        eq("ID2 nadal aktywna", db.get_offer(conn, "ID2")["status"], "active")

        # Powrót oferty do wyników.
        run10 = db.start_run(conn, "test", "http://example")
        diff = db.record_scrape(conn, [_offer(price=460000)], run_id=run10,
                                detect_removals=False, missing_runs_threshold=2)
        eq("oferta przywrócona", len(diff.restored), 1)
        eq("status z powrotem aktywny", db.get_offer(conn, "ID1")["status"], "active")

        print("\n[6] Raport markdown")
        db.finish_run(conn, run3, "ok", offers_seen=1, complete=True)
        text = report_mod.markdown_for_run(conn, run3, cfg)
        check("raport ma sekcję zmian", "Zmiany w ofertach" in text)
        check("raport pokazuje różnicę ceny", "500 000 zł → 460 000 zł" in text, text[:400])
        check("raport liczy procent", "-8.0%" in text, text[:400])

        empty_text = report_mod.markdown_for_run(conn, run2, cfg)
        check("raport bez zmian mówi wprost", "Brak zmian" in empty_text)

        counters = db.stats(conn)
        eq("statystyki: 2 oferty", counters["offers_total"], 2)
        conn.close()


def main() -> int:
    print("Testy monitora ofert (bez sieci, bez przeglądarki)")
    cfg = load_config()
    print(f"  konfiguracja: {cfg.path} (portal: {cfg.portal.name})")

    test_text_parsers()
    test_json_extraction(cfg.portal)
    test_id_from_url(cfg.portal)
    test_db_diff(cfg)

    print("\n" + "=" * 60)
    if FAILED:
        print(f"NIEPOWODZENIE: {len(FAILED)} z {PASSED + len(FAILED)} testów")
        for item in FAILED:
            print(f"  ✗ {item}")
        return 1
    print(f"OK: wszystkie {PASSED} testów przeszło")
    return 0


if __name__ == "__main__":
    sys.exit(main())
