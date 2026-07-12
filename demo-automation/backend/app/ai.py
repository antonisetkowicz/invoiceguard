import json
import re

from anthropic import AsyncAnthropic

from app.config import settings

_client: AsyncAnthropic | None = None

SYSTEM_PROMPT = """Jesteś asystentem sprzedaży B2B. Na podstawie zgłoszenia leada:
1. Oceń jakość leada w skali 0-100 (qualified_score) na podstawie konkretności,
   pilności i wartości biznesowej wiadomości.
2. Napisz spersonalizowaną odpowiedź email (2-3 zdania), dopasowaną do branży
   klienta wspomnianej w wiadomości. Odpowiedź ma być uprzejma, konkretna i
   zachęcać do dalszego kontaktu.

Odpowiedz WYŁĄCZNIE w formacie JSON, bez dodatkowego tekstu, w postaci:
{"qualified_score": <int 0-100>, "ai_response": "<treść odpowiedzi email>"}
"""


class AIQualificationError(Exception):
    pass


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        if not settings.anthropic_api_key:
            raise AIQualificationError("ANTHROPIC_API_KEY nie jest skonfigurowany")
        _client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    return _client


def _extract_json(text: str) -> dict:
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise AIQualificationError(f"Nie znaleziono JSON w odpowiedzi modelu: {text!r}")
    return json.loads(match.group(0))


async def qualify_lead(name: str, company: str | None, message: str) -> tuple[int, str]:
    client = _get_client()
    user_prompt = (
        f"Imię i nazwisko: {name}\n"
        f"Firma: {company or 'nie podano'}\n"
        f"Wiadomość: {message}\n"
    )

    try:
        response = await client.messages.create(
            model=settings.anthropic_model,
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:
        raise AIQualificationError(f"Błąd wywołania Claude API: {exc}") from exc

    raw_text = "".join(
        block.text for block in response.content if getattr(block, "type", None) == "text"
    )

    try:
        data = _extract_json(raw_text)
        qualified_score = int(data["qualified_score"])
        ai_response = str(data["ai_response"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise AIQualificationError(f"Nie udało się sparsować odpowiedzi modelu: {exc}") from exc

    qualified_score = max(0, min(100, qualified_score))
    return qualified_score, ai_response
