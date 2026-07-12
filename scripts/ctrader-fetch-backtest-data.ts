/**
 * Standalone utility (unrelated to the InvoiceGuard app itself) that downloads
 * historical price data (trendbars) from a cTrader account via the cTrader
 * Open API, for use as backtesting data. FTMO offers cTrader as one of its
 * trading platforms, so an FTMO account's price history can be pulled here
 * using standard cTrader Open API credentials.
 *
 * This script only talks to Spotware's cTrader Open API using credentials
 * you provide via environment variables — it never touches FTMO's own
 * servers or scrapes anything. You must have:
 *   1. A cTrader Open API application (Client ID + Client Secret), created
 *      at https://connect.spotware.com/apps
 *   2. An OAuth2 access token obtained via that app's authorization flow,
 *      scoped to your FTMO cTrader trading account.
 *   3. The numeric ctidTraderAccountId for your FTMO account (run this
 *      script once without CTRADER_ACCOUNT_ID to list accounts reachable by
 *      your access token, then set it).
 *
 * Usage:
 *   CTRADER_CLIENT_ID=... \
 *   CTRADER_CLIENT_SECRET=... \
 *   CTRADER_ACCESS_TOKEN=... \
 *   CTRADER_ENV=demo \
 *   npx tsx scripts/ctrader-fetch-backtest-data.ts
 *
 *   # once you know your account id:
 *   CTRADER_CLIENT_ID=... CTRADER_CLIENT_SECRET=... CTRADER_ACCESS_TOKEN=... \
 *   CTRADER_ENV=live CTRADER_ACCOUNT_ID=12345678 \
 *   CTRADER_SYMBOL=EURUSD CTRADER_TIMEFRAME=M15 \
 *   CTRADER_FROM=2024-01-01 CTRADER_TO=2024-06-01 \
 *   CTRADER_OUTPUT=data/EURUSD_M15.csv \
 *   npx tsx scripts/ctrader-fetch-backtest-data.ts
 *
 * Required env vars:
 *   CTRADER_CLIENT_ID       cTrader Open API application client id
 *   CTRADER_CLIENT_SECRET   cTrader Open API application client secret
 *   CTRADER_ACCESS_TOKEN    OAuth2 access token authorized for your account
 *
 * Optional env vars:
 *   CTRADER_ENV             "demo" or "live" (default "demo") — matches
 *                            whether your FTMO cTrader account is a demo
 *                            (Challenge/Verification) or funded/live account
 *   CTRADER_ACCOUNT_ID      numeric ctidTraderAccountId; if omitted the
 *                            script lists reachable accounts and exits
 *   CTRADER_SYMBOL          symbol name, e.g. EURUSD (default EURUSD)
 *   CTRADER_TIMEFRAME       one of M1 M2 M3 M4 M5 M10 M15 M30 H1 H4 D1 W1 MN1
 *                            (default H1)
 *   CTRADER_FROM            start date, YYYY-MM-DD (default 90 days ago)
 *   CTRADER_TO              end date, YYYY-MM-DD (default today)
 *   CTRADER_OUTPUT          output CSV path (default ./data/<symbol>_<tf>.csv)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CTraderConnection } from "@reiryoku/ctrader-layer";

const TRENDBAR_PERIODS = [
  "M1", "M2", "M3", "M4", "M5", "M10", "M15", "M30",
  "H1", "H4", "H12", "D1", "W1", "MN1",
] as const;
type TrendbarPeriod = (typeof TRENDBAR_PERIODS)[number];

const MAX_BARS_PER_REQUEST = 5000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseDateToUnixMs(value: string, fallback: Date): number {
  if (!value) return fallback.getTime();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: "${value}" (expected YYYY-MM-DD)`);
  }
  return parsed.getTime();
}

async function main() {
  const clientId = requireEnv("CTRADER_CLIENT_ID");
  const clientSecret = requireEnv("CTRADER_CLIENT_SECRET");
  const accessToken = requireEnv("CTRADER_ACCESS_TOKEN");

  const env = (process.env.CTRADER_ENV ?? "demo").toLowerCase();
  if (env !== "demo" && env !== "live") {
    throw new Error(`CTRADER_ENV must be "demo" or "live", got "${env}"`);
  }
  const host = env === "demo" ? "demo.ctraderapi.com" : "live.ctraderapi.com";

  const accountIdEnv = process.env.CTRADER_ACCOUNT_ID;
  const symbolName = (process.env.CTRADER_SYMBOL ?? "EURUSD").toUpperCase();
  const period = (process.env.CTRADER_TIMEFRAME ?? "H1").toUpperCase() as TrendbarPeriod;
  if (!TRENDBAR_PERIODS.includes(period)) {
    throw new Error(
      `CTRADER_TIMEFRAME must be one of ${TRENDBAR_PERIODS.join(", ")}, got "${period}"`
    );
  }

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const fromMs = parseDateToUnixMs(process.env.CTRADER_FROM ?? "", ninetyDaysAgo);
  const toMs = parseDateToUnixMs(process.env.CTRADER_TO ?? "", now);
  if (fromMs >= toMs) {
    throw new Error("CTRADER_FROM must be earlier than CTRADER_TO");
  }

  const outputPath =
    process.env.CTRADER_OUTPUT ?? `data/${symbolName}_${period}.csv`;

  console.log(`Connecting to cTrader Open API (${host})...`);
  const connection = new CTraderConnection({ host, port: 5035 });
  await connection.open();

  console.log("Authenticating application...");
  await connection.sendCommand("ProtoOAApplicationAuthReq", {
    clientId,
    clientSecret,
  });

  if (!accountIdEnv) {
    console.log("No CTRADER_ACCOUNT_ID set — listing accounts reachable by this access token:");
    const accountsRes = await connection.sendCommand(
      "ProtoOAGetAccountListByAccessTokenReq",
      { accessToken }
    );
    const accounts = (accountsRes as any).ctidTraderAccount ?? [];
    for (const acc of accounts) {
      console.log(
        `  ctidTraderAccountId=${acc.ctidTraderAccountId} live=${acc.isLive}`
      );
    }
    console.log(
      "\nSet CTRADER_ACCOUNT_ID to the id of your FTMO account and re-run."
    );
    await connection.close();
    return;
  }

  const ctidTraderAccountId = Number(accountIdEnv);

  console.log(`Authenticating account ${ctidTraderAccountId}...`);
  await connection.sendCommand("ProtoOAAccountAuthReq", {
    ctidTraderAccountId,
    accessToken,
  });

  console.log(`Resolving symbol "${symbolName}"...`);
  const symbolsRes = await connection.sendCommand("ProtoOASymbolsListReq", {
    ctidTraderAccountId,
  });
  const symbols = (symbolsRes as any).symbol ?? [];
  const match = symbols.find(
    (s: any) => String(s.symbolName).toUpperCase() === symbolName
  );
  if (!match) {
    await connection.close();
    throw new Error(
      `Symbol "${symbolName}" not found on this account. Available symbols: ` +
        symbols.map((s: any) => s.symbolName).slice(0, 30).join(", ") +
        (symbols.length > 30 ? ", ..." : "")
    );
  }
  const symbolId = match.symbolId;

  console.log(
    `Fetching ${period} trendbars for ${symbolName} (symbolId=${symbolId}) ` +
      `from ${new Date(fromMs).toISOString()} to ${new Date(toMs).toISOString()}...`
  );

  const rows: string[] = ["timestamp,open,high,low,close,volume"];
  let windowTo = toMs;
  let fetchedAny = true;

  while (windowTo > fromMs && fetchedAny) {
    const res = await connection.sendCommand("ProtoOAGetTrendbarsReq", {
      ctidTraderAccountId,
      symbolId,
      period,
      fromTimestamp: fromMs,
      toTimestamp: windowTo,
      count: MAX_BARS_PER_REQUEST,
    });

    const trendbars = ((res as any).trendbar ?? []) as any[];
    fetchedAny = trendbars.length > 0;
    if (!fetchedAny) break;

    // cTrader encodes bars with a low + deltas from low for high/close/open,
    // and a period-start UTC timestamp in minutes.
    for (const bar of trendbars) {
      const low = Number(bar.low);
      const open = low + Number(bar.deltaOpen ?? 0);
      const high = low + Number(bar.deltaHigh ?? 0);
      const close = low + Number(bar.deltaClose ?? 0);
      const timestampMs = Number(bar.utcTimestampInMinutes) * 60_000;
      rows.push(
        `${new Date(timestampMs).toISOString()},${open},${high},${low},${close},${bar.volume ?? 0}`
      );
    }

    const earliest = Math.min(
      ...trendbars.map((b: any) => Number(b.utcTimestampInMinutes) * 60_000)
    );
    if (earliest >= windowTo) break; // safety against infinite loop
    windowTo = earliest - 60_000;

    console.log(`  fetched ${trendbars.length} bars, earliest so far: ${new Date(earliest).toISOString()}`);
    // Be polite to the API between paginated requests.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await connection.close();

  // Bars were collected newest-window-first; sort ascending by time for a
  // clean backtest-ready CSV.
  const header = rows[0];
  const dataRows = rows.slice(1).sort();
  const csv = [header, ...dataRows].join("\n") + "\n";

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, csv, "utf8");

  console.log(`\nSaved ${dataRows.length} bars to ${outputPath}`);
}

main().catch((error) => {
  console.error("Failed to fetch cTrader backtest data:", error);
  process.exitCode = 1;
});
