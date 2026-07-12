#!/usr/bin/env python3
"""Seed the `leads` table with realistic demo data.

By default the table is truncated and re-seeded (idempotent). Pass --keep
to leave existing rows in place and just append the demo leads on top.

Each demo lead tries to go through the real Claude qualification (same
code path as POST /webhook/lead) so qualified_score/ai_response are
authentic. If ANTHROPIC_API_KEY is missing or the call fails, a curated
fallback score/response is used instead so the table is always ready to
demo, even offline. Pass --no-ai to always use the fallback values
(useful to avoid burning API credits before a call).

Usage:
    python scripts/seed_demo_data.py
    python scripts/seed_demo_data.py --keep
    python scripts/seed_demo_data.py --no-ai
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import delete  # noqa: E402

from app.ai import AIQualificationError, qualify_lead  # noqa: E402
from app.database import Base, async_session_factory, engine  # noqa: E402
from app.models import Lead  # noqa: E402

# 6 leads spanning different industries and "hotness" levels, so that
# passing them through Claude produces a realistically spread-out
# qualified_score distribution (very hot -> lukewarm -> cold).
DEMO_LEADS = [
    {
        "name": "Michał Sowiński",
        "email": "michal.sowinski@modernshop.pl",
        "company": "ModernShop",
        "message": (
            "Prowadzimy sklep e-commerce z odzieżą (ok. 40 tys. zamówień miesięcznie) i "
            "pilnie szukamy sposobu na automatyczną kwalifikację zapytań od hurtowników "
            "oraz partnerów afiliacyjnych — obecnie handlowiec ręcznie przegląda kilkadziesiąt "
            "maili dziennie i przez to tracimy dobre okazje. Mamy już zatwierdzony budżet na "
            "wdrożenie jeszcze w tym miesiącu, jestem dyrektorem operacyjnym i mogę podjąć "
            "decyzję jednoosobowo. Chcielibyśmy zobaczyć demo jeszcze w tym tygodniu."
        ),
        "fallback_score": 91,
        "fallback_response": (
            "Dziękujemy za wiadomość! Rozumiemy pilność sytuacji — świetnie, że mają Państwo "
            "już zatwierdzony budżet. Umówmy demo jeszcze w tym tygodniu, aby pokazać, jak "
            "nasza platforma poradzi sobie z wolumenem 40 tys. zamówień miesięcznie."
        ),
    },
    {
        "name": "Katarzyna Lis",
        "email": "k.lis@primemarketing.pl",
        "company": "Prime Marketing",
        "message": (
            "Nasza agencja obsługuje kilkunastu klientów B2B i szukamy narzędzia do "
            "automatycznej kwalifikacji leadów napływających z kampanii naszych klientów. "
            "Porównujemy kilka rozwiązań, w tym Wasze — jeśli cena i wdrożenie będą sensowne, "
            "chcielibyśmy zacząć w przyszłym miesiącu."
        ),
        "fallback_score": 64,
        "fallback_response": (
            "Dziękujemy za zainteresowanie! Chętnie przygotujemy porównanie funkcji i cennik "
            "dopasowany do obsługi wielu klientów agencji, żeby ułatwić decyzję przed startem "
            "w przyszłym miesiącu."
        ),
    },
    {
        "name": "Adam Krupa",
        "email": "adam@flowmetrics.io",
        "company": "FlowMetrics",
        "message": (
            "Jesteśmy startupem SaaS (B2B analytics) i tracimy leady, bo nasz zespół sprzedaży "
            "nie nadąża z odpowiadaniem na zapytania z formularza — średni czas reakcji to 2 dni, "
            "a konkurencja odpowiada w kilka minut. Potrzebujemy integracji z naszym CRM "
            "(HubSpot) i chcemy uruchomić pilotaż jeszcze w tym kwartale, mamy na to wydzielony "
            "budżet."
        ),
        "fallback_score": 87,
        "fallback_response": (
            "Rozumiemy, jak kosztowne jest 2-dniowe opóźnienie w odpowiedzi na leady. Nasza "
            "integracja z HubSpot pozwoli skrócić czas reakcji do minut — zaplanujmy pilotaż "
            "jeszcze w tym kwartale."
        ),
    },
    {
        "name": "Grzegorz Malinowski",
        "email": "g.malinowski@malinowski-nieruchomosci.pl",
        "company": "Malinowski Nieruchomości",
        "message": "Widziałem coś o automatyzacji leadów, jestem ciekaw co to takiego, proszę o więcej informacji.",
        "fallback_score": 18,
        "fallback_response": (
            "Dziękujemy za zainteresowanie! Prześlemy materiały wprowadzające do automatyzacji "
            "kwalifikacji leadów — zapraszamy do kontaktu, gdy będą Państwo gotowi na kolejny krok."
        ),
    },
    {
        "name": "Joanna Wrona",
        "email": "j.wrona@kancelaria-wrona.pl",
        "company": "Kancelaria Wrona i Wspólnicy",
        "message": (
            "Zbieramy informacje o narzędziach do automatyzacji obsługi zapytań klientów, na "
            "razie jesteśmy na etapie researchu, decyzja raczej nie wcześniej niż za pół roku."
        ),
        "fallback_score": 29,
        "fallback_response": (
            "Dziękujemy za wiadomość! W pełni rozumiemy, że to dopiero etap researchu — "
            "prześlemy materiały, do których będzie można wrócić przy podejmowaniu decyzji za "
            "pół roku."
        ),
    },
    {
        "name": "Natalia Górecka",
        "email": "natalia@cloudpay.tech",
        "company": "CloudPay",
        "message": (
            "Nasz obecny dostawca automatyzacji leadów zawodzi nas technicznie (regularne "
            "awarie) i tracimy przez to klientów — potrzebujemy migracji w ciągu 2 tygodni. "
            "Jestem CEO, mam pełną decyzyjność i budżet gotowy do wypłaty od razu po podpisaniu "
            "umowy."
        ),
        "fallback_score": 96,
        "fallback_response": (
            "Rozumiemy pilność sytuacji przy awariach obecnego dostawcy. Jako CEO ma Pani pełną "
            "decyzyjność — przygotujmy plan migracji w ciągu 2 tygodni i umówmy pilny call "
            "jeszcze dziś."
        ),
    },
]


async def qualify_with_fallback(entry: dict, use_ai: bool) -> tuple[int, str]:
    if use_ai:
        try:
            score, response = await qualify_lead(
                name=entry["name"], company=entry["company"], message=entry["message"]
            )
            print(f"  [AI]       {entry['name']} -> {score}/100")
            return score, response
        except AIQualificationError as exc:
            print(f"  [fallback] {entry['name']}: Claude API niedostępne ({exc})")
    else:
        print(f"  [fallback] {entry['name']} (--no-ai)")
    return entry["fallback_score"], entry["fallback_response"]


async def seed(keep: bool, use_ai: bool) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session_factory() as session:
        if not keep:
            await session.execute(delete(Lead))
            await session.commit()
            print("Wyczyszczono tabelę leads.")
        else:
            print("Zachowano istniejące dane (--keep) — dopisuję nowe leady.")

        print(f"Kwalifikuję {len(DEMO_LEADS)} przykładowych leadów...")
        for entry in DEMO_LEADS:
            score, response = await qualify_with_fallback(entry, use_ai)
            session.add(
                Lead(
                    name=entry["name"],
                    email=entry["email"],
                    company=entry["company"],
                    message=entry["message"],
                    status="qualified",
                    ai_response=response,
                    qualified_score=score,
                )
            )
        await session.commit()

    await engine.dispose()
    print(f"Gotowe — dodano {len(DEMO_LEADS)} leadów demo.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--keep",
        action="store_true",
        help="Nie czyść tabeli przed wstawieniem demo leadów (domyślnie tabela jest czyszczona)",
    )
    parser.add_argument(
        "--no-ai",
        action="store_true",
        help="Pomiń wywołania Claude API i użyj przygotowanych wcześniej wyników",
    )
    args = parser.parse_args()

    try:
        asyncio.run(seed(keep=args.keep, use_ai=not args.no_ai))
    except Exception as exc:  # connection errors, missing DB, etc.
        print(f"BŁĄD: nie udało się zaseedować bazy: {exc}", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
