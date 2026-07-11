# Trading bot - obraz produkcyjny
FROM python:3.11-slim

WORKDIR /app

# Zaleznosci najpierw (cache warstw)
COPY trading_bot/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY trading_bot/ trading_bot/

# Nie-root user
RUN useradd --create-home bot && chown -R bot:bot /app
USER bot

# Domyslnie paper trading; klucze API przez env (TRADINGBOT_...)
ENTRYPOINT ["python", "-m", "trading_bot.main"]
CMD ["--mode", "paper"]
