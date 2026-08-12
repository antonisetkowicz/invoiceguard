#!/usr/bin/env python3
"""Monitor ofert nieruchomości — punkt wejścia.

    python main.py --scrape     # pobierz i zapisz do bazy
    python main.py --watch      # pobierz, porównaj z poprzednim stanem, zrób raport
    python main.py --report     # odtwórz raport ostatniego przebiegu (bez scrapowania)

Kody wyjścia (przydatne w cronie):
    0 — OK
    1 — błąd (sieć, konfiguracja, przeglądarka)
    2 — wykryto blokadę anty-botową; przebieg przerwany, NIC nie obchodzimy
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

import db
import images as images_mod
import report as report_mod
from config import Config, ConfigError, load_config
from models import BlockedError, ScraperError

EXIT_OK, EXIT_ERROR, EXIT_BLOCKED = 0, 1, 2

log = logging.getLogger("monitor")


def setup_logging(verbose: bool, quiet: bool) -> None:
    level = logging.DEBUG if verbose else (logging.WARNING if quiet else logging.INFO)
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    # Playwright potrafi być gadatliwy na DEBUG.
    logging.getLogger("asyncio").setLevel(logging.WARNING)


def apply_overrides(cfg: Config, args: argparse.Namespace) -> Config:
    if args.url:
        cfg.search_url = args.url
    if args.limit is not None:
        cfg.max_offers_per_run = args.limit
    if args.pages is not None:
        cfg.max_pages = args.pages
    if args.headful:
        cfg.headless = False
    if args.no_images:
        cfg.download_images = False
    if args.no_details:
        cfg.fetch_details = False
    return cfg


# ---------------------------------------------------------------------------
# tryby
# ---------------------------------------------------------------------------

def do_scrape(cfg: Config, args: argparse.Namespace, mode: str) -> int:
    """Scrape + zapis + (dla trybu watch) raport."""
    from scraper import RateLimiter, Scraper  # import tutaj: nie wymuszamy Playwrighta na --report

    conn = db.connect(cfg.db_path)
    run_id: int | None = None
    if not args.dry_run:
        run_id = db.start_run(conn, mode, cfg.search_url)

    try:
        with Scraper(cfg) as scraper:
            result = scraper.run(progress=lambda msg: log.info("… %s", msg))
            log.info(
                "Zebrano %d ofert (strony: %d, szczegóły: %d, nieudane szczegóły: %d, "
                "pełne pokrycie wyników: %s)",
                len(result.offers), result.pages_visited, result.details_fetched,
                result.detail_failures, "tak" if result.complete else "nie",
            )

            if args.dry_run:
                _print_dry_run(result)
                return EXIT_OK

            if not result.complete:
                log.info(
                    "Przebieg nie objął całego zbioru wyników (limit ofert/stron) — "
                    "pomijam wykrywanie usuniętych ofert, żeby nie fałszować raportu"
                )

            diff = db.record_scrape(
                conn,
                result.offers,
                run_id=run_id,
                portal=cfg.portal.key,
                detect_removals=result.complete,
                missing_runs_threshold=cfg.missing_runs_threshold,
            )
            log.info("Różnice: %s", diff.summary())

            saved = 0
            if cfg.download_images:
                image_limiter = RateLimiter(cfg.image_min_delay, cfg.image_max_delay)
                saved = images_mod.download_all(
                    scraper.request_context, conn, result.offers, cfg, image_limiter
                )
                log.info("Pobrano %d nowych plików zdjęć do %s", saved, cfg.images_dir)

        db.finish_run(conn, run_id, "ok", diff, len(result.offers), saved, result.complete)

        if mode == "watch":
            _emit_report(cfg, conn, run_id, diff.has_changes)
        return EXIT_OK

    except BlockedError as exc:
        if run_id is not None:
            db.finish_run(conn, run_id, "blocked", error=str(exc))
        log.error("BLOKADA — przebieg przerwany.\n%s", exc)
        return EXIT_BLOCKED
    except (ScraperError, ConfigError) as exc:
        if run_id is not None:
            db.finish_run(conn, run_id, "error", error=str(exc))
        log.error("Przebieg nieudany: %s", exc)
        return EXIT_ERROR
    except KeyboardInterrupt:
        if run_id is not None:
            db.finish_run(conn, run_id, "error", error="przerwane przez użytkownika")
        log.warning("Przerwane przez użytkownika")
        return EXIT_ERROR
    finally:
        conn.close()


def _print_dry_run(result) -> None:
    print(f"\n--- DRY RUN: {len(result.offers)} ofert, nic nie zapisano ---\n")
    for offer in result.offers:
        print(f"  [{offer.offer_id}] {offer.short()}")
        print(f"      {offer.url}")
        print(f"      lokalizacja: {offer.location or '—'} · zdjęć: {len(offer.image_urls)}"
              f" · opis: {'jest' if offer.description else 'brak'}")


def _emit_report(cfg: Config, conn, run_id: int, has_changes: bool) -> None:
    if not has_changes and cfg.skip_report_when_no_changes:
        log.info("Brak zmian — raportu nie generuję (watch.skip_report_when_no_changes)")
        return

    text = report_mod.markdown_for_run(conn, run_id, cfg)
    if cfg.write_markdown:
        path = report_mod.write_markdown(cfg, run_id, text)
        log.info("Raport: %s", path)
    if cfg.webhook.get("enabled"):
        report_mod.send_webhook(cfg, text, report_mod.structured_changes(conn, run_id))
    print("\n" + text + "\n")


def do_report(cfg: Config, args: argparse.Namespace) -> int:
    conn = db.connect(cfg.db_path)
    try:
        if args.run_id:
            run_id = args.run_id
        else:
            row = db.last_run(conn)
            if row is None:
                log.error("Baza nie zawiera żadnego zakończonego przebiegu — uruchom najpierw --scrape")
                return EXIT_ERROR
            run_id = row["id"]

        text = report_mod.markdown_for_run(conn, run_id, cfg)
        print(text)
        if cfg.write_markdown:
            log.info("Raport zapisany: %s", report_mod.write_markdown(cfg, run_id, text))
        if args.send_webhook:
            report_mod.send_webhook(cfg, text, report_mod.structured_changes(conn, run_id))
        return EXIT_OK
    except ValueError as exc:
        log.error("%s", exc)
        return EXIT_ERROR
    finally:
        conn.close()


def do_debug_dump(cfg: Config, args: argparse.Namespace) -> int:
    from scraper import Scraper

    url = args.debug_dump if isinstance(args.debug_dump, str) else cfg.search_url
    try:
        with Scraper(cfg) as scraper:
            written = scraper.debug_dump(url, cfg.debug_dir)
    except BlockedError as exc:
        log.error("BLOKADA: %s", exc)
        return EXIT_BLOCKED
    except ScraperError as exc:
        log.error("%s", exc)
        return EXIT_ERROR

    print("\nZrzucono do diagnostyki:")
    for name, path in written.items():
        print(f"  {name:12s} {path}")
    print(
        "\nJak tego użyć: otwórz next_data_paths.txt i znajdź ścieżkę do listy ofert,\n"
        "a potem wpisz ją w config.yaml → portals.<portal>.next_data.list_paths.\n"
    )
    return EXIT_OK


def do_stats(cfg: Config) -> int:
    conn = db.connect(cfg.db_path)
    try:
        counters = db.stats(conn)
        print(f"\nBaza: {cfg.db_path}")
        print(f"  oferty aktywne : {counters['offers_active']}")
        print(f"  oferty usunięte: {counters['offers_removed']}")
        print(f"  zdjęcia        : {counters['images_downloaded']}/{counters['images_total']} pobranych")
        rows = conn.execute(
            "SELECT id, started_at, status, offers_seen, new_count, changed_count, removed_count "
            "FROM runs ORDER BY id DESC LIMIT 10"
        ).fetchall()
        if rows:
            print("\n  Ostatnie przebiegi:")
            print("   id  data                  status    ofert  nowe  zmiany  usunięte")
            for r in rows:
                print(f"  {r['id']:>4}  {r['started_at'][:19]}  {r['status']:<8}  "
                      f"{r['offers_seen']:>5}  {r['new_count']:>4}  {r['changed_count']:>6}  "
                      f"{r['removed_count']:>8}")
        print()
        return EXIT_OK
    finally:
        conn.close()


# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Lokalny monitor ofert nieruchomości (Otodom i pokrewne).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Przykłady:\n"
            "  python main.py --scrape --limit 10\n"
            "  python main.py --watch\n"
            "  python main.py --report --run-id 7\n"
            "  python main.py --debug-dump           # gdy portal zmienił strukturę\n"
        ),
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--scrape", action="store_true", help="pobierz oferty i zapisz do bazy")
    mode.add_argument("--watch", action="store_true",
                      help="pobierz, porównaj z poprzednim stanem i wygeneruj raport zmian")
    mode.add_argument("--report", action="store_true",
                      help="odtwórz raport z bazy, bez wchodzenia na portal")
    mode.add_argument("--stats", action="store_true", help="podsumowanie zawartości bazy")
    mode.add_argument("--init-db", action="store_true", help="załóż pustą bazę i wyjdź")
    mode.add_argument("--debug-dump", nargs="?", const=True, metavar="URL",
                      help="zrzuć HTML/__NEXT_DATA__/screenshot do poprawiania selektorów")

    parser.add_argument("--config", default=None, help="ścieżka do config.yaml")
    parser.add_argument("--url", default=None, help="nadpisz search.url z configu")
    parser.add_argument("--limit", type=int, default=None, help="nadpisz limit ofert na przebieg")
    parser.add_argument("--pages", type=int, default=None, help="nadpisz limit stron wyników")
    parser.add_argument("--run-id", type=int, default=None, help="numer przebiegu dla --report")
    parser.add_argument("--headful", action="store_true", help="pokaż okno przeglądarki")
    parser.add_argument("--no-images", action="store_true", help="nie pobieraj plików zdjęć")
    parser.add_argument("--no-details", action="store_true",
                        help="nie wchodź na strony ofert (tylko listing)")
    parser.add_argument("--dry-run", action="store_true",
                        help="pokaż, co zostałoby pobrane, ale nie zapisuj do bazy")
    parser.add_argument("--send-webhook", action="store_true",
                        help="wyślij webhook także w trybie --report")
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("-q", "--quiet", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    setup_logging(args.verbose, args.quiet)

    try:
        cfg = apply_overrides(load_config(args.config), args)
    except ConfigError as exc:
        log.error("Błąd konfiguracji: %s", exc)
        return EXIT_ERROR

    if args.init_db:
        db.connect(cfg.db_path).close()
        print(f"Baza gotowa: {cfg.db_path}")
        return EXIT_OK
    if args.stats:
        return do_stats(cfg)
    if args.report:
        return do_report(cfg, args)
    if args.debug_dump:
        return do_debug_dump(cfg, args)
    return do_scrape(cfg, args, mode="watch" if args.watch else "scrape")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.exit(main())
