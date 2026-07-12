from telegram import Bot, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.error import TelegramError

from app.config import settings
from app.models import Lead


class TelegramNotificationError(Exception):
    pass


def _build_summary(lead: Lead) -> str:
    score = lead.qualified_score if lead.qualified_score is not None else "brak"
    ai_response = lead.ai_response or "(jeszcze nie wygenerowano)"
    return (
        "🆕 <b>Nowy lead do zatwierdzenia</b>\n\n"
        f"<b>Imię i nazwisko:</b> {lead.name}\n"
        f"<b>Email:</b> {lead.email}\n"
        f"<b>Firma:</b> {lead.company or 'brak'}\n"
        f"<b>Wiadomość:</b> {lead.message or 'brak'}\n"
        f"<b>Qualified score:</b> {score}\n\n"
        f"<b>Proponowana odpowiedź AI:</b>\n{ai_response}"
    )


async def send_approval_request(lead: Lead) -> None:
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        raise TelegramNotificationError(
            "TELEGRAM_BOT_TOKEN lub TELEGRAM_CHAT_ID nie jest skonfigurowany"
        )

    keyboard = InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("✅ Zatwierdź", callback_data=f"approve:{lead.id}"),
                InlineKeyboardButton("✏️ Edytuj", callback_data=f"edit:{lead.id}"),
            ]
        ]
    )

    bot = Bot(token=settings.telegram_bot_token)
    try:
        async with bot:
            await bot.send_message(
                chat_id=settings.telegram_chat_id,
                text=_build_summary(lead),
                parse_mode="HTML",
                reply_markup=keyboard,
            )
    except TelegramError as exc:
        raise TelegramNotificationError(f"Błąd wysyłki na Telegram: {exc}") from exc
