# Fetching backtest data from FTMO via cTrader

This is a standalone utility, unrelated to the InvoiceGuard product itself.
It downloads historical price bars (trendbars) from a cTrader account —
including an FTMO account traded through the cTrader platform — via
Spotware's public cTrader Open API, and writes them to a CSV file suitable
for backtesting.

It talks only to cTrader's own Open API servers. Nothing here scrapes FTMO
or requires your FTMO login/password — cTrader accounts (including
white-labelled ones like FTMO's) are accessed via OAuth2.

## 1. Create a cTrader Open API application

1. Go to https://connect.spotware.com/apps and log in with your cTrader ID
   (the same account used for your FTMO cTrader login, or any cTrader ID —
   the app itself is separate from any single trading account).
2. Create a new application. You'll get a **Client ID** and **Client
   Secret**.
3. Set a redirect URI you control (e.g. `http://localhost:3000/callback`)
   for the OAuth flow in the next step.

## 2. Get an OAuth2 access token authorized for your FTMO account

1. Open this URL in a browser (replace `CLIENT_ID` and `REDIRECT_URI`):

   ```
   https://connect.spotware.com/apps/auth?client_id=CLIENT_ID&redirect_uri=REDIRECT_URI&scope=accounts
   ```

2. Log in with the cTrader ID that owns your FTMO account and approve
   access. You'll be redirected to `REDIRECT_URI?code=AUTH_CODE`.
3. Exchange the code for an access token:

   ```bash
   curl -X POST https://openapi.ctrader.com/apps/token \
     -d "grant_type=authorization_code" \
     -d "code=AUTH_CODE" \
     -d "redirect_uri=REDIRECT_URI" \
     -d "client_id=CLIENT_ID" \
     -d "client_secret=CLIENT_SECRET"
   ```

   The response contains `access_token` (and a `refresh_token` you can use
   to get new ones once it expires).

## 3. Find your ctidTraderAccountId

Run the script without `CTRADER_ACCOUNT_ID` set — it will list every
account reachable with your access token, tagged `live=true/false`. Pick
the one matching your FTMO account (`live=false` for
Challenge/Verification accounts, `live=true` for a funded account), then
set `CTRADER_ACCOUNT_ID` to it.

## 4. Run the script

```bash
npm install   # pulls in @reiryoku/ctrader-layer

CTRADER_CLIENT_ID="..." \
CTRADER_CLIENT_SECRET="..." \
CTRADER_ACCESS_TOKEN="..." \
CTRADER_ENV="demo" \
npm run ctrader:fetch-backtest-data
```

Once you know your account id, fetch actual data:

```bash
CTRADER_CLIENT_ID="..." \
CTRADER_CLIENT_SECRET="..." \
CTRADER_ACCESS_TOKEN="..." \
CTRADER_ENV="demo" \
CTRADER_ACCOUNT_ID="12345678" \
CTRADER_SYMBOL="EURUSD" \
CTRADER_TIMEFRAME="M15" \
CTRADER_FROM="2024-01-01" \
CTRADER_TO="2024-06-01" \
CTRADER_OUTPUT="data/EURUSD_M15.csv" \
npm run ctrader:fetch-backtest-data
```

`CTRADER_ENV` must match the account type: `demo` for FTMO
Challenge/Verification accounts, `live` for a funded FTMO account — both
are still cTrader accounts, just served from different Open API hosts.

Output is a CSV with columns `timestamp,open,high,low,close,volume`,
sorted ascending by time, ready to load into your backtesting tool of
choice.

## Notes

- Never commit your Client Secret or access/refresh tokens. Keep them in
  your local `.env` (already gitignored) or your shell environment.
- Access tokens expire; use the `refresh_token` from step 2 with
  `grant_type=refresh_token` against the same `/apps/token` endpoint to get
  a new one without repeating the browser flow.
- The cTrader Open API limits how many bars can be returned per request;
  the script paginates automatically for large date ranges.
