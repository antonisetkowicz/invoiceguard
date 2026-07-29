import dns from "node:dns/promises";
import net from "node:net";
import { LIMITS } from "./config";

export class UnsafeUrlError extends Error {}

/**
 * Normalizuje to, co user wkleił w formularzu: "sklep.pl", "SKLEP.PL/",
 * "http://sklep.pl?utm_source=x" → "https://sklep.pl".
 */
export function normalizeInputUrl(raw: string): string {
  let value = raw.trim();
  if (!value) throw new UnsafeUrlError("Podaj adres strony.");
  if (!/^https?:\/\//i.test(value)) value = "https://" + value;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new UnsafeUrlError("To nie wygląda na poprawny adres strony.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Obsługujemy tylko adresy http:// i https://.");
  }
  if (!parsed.hostname.includes(".") || parsed.hostname.endsWith(".")) {
    throw new UnsafeUrlError("Adres musi zawierać poprawną domenę, np. twojafirma.pl");
  }

  parsed.hash = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || key.toLowerCase() === "fbclid") {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString().replace(/\/$/, "") || parsed.origin;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata cloudów
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === "::1" || normalized === "::") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local
    if (normalized.startsWith("fe80")) return true; // link-local
    // IPv4-mapped (::ffff:10.0.0.1)
    const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "instance-data",
]);

/**
 * Ochrona przed SSRF: silnik pobiera adres podany przez obcą osobę, więc każdy
 * hop (także po przekierowaniu) musi trafiać w publiczny adres IP.
 */
export async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new UnsafeUrlError("Dozwolone są tylko adresy http:// i https://.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UnsafeUrlError("Ten adres wskazuje na zasób wewnętrzny.");
  }
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new UnsafeUrlError("Ten adres wskazuje na sieć prywatną.");
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("Nie udało się rozwiązać domeny. Sprawdź adres.");
  }
  if (addresses.length === 0) throw new UnsafeUrlError("Domena nie ma adresu IP.");
  for (const { address } of addresses) {
    if (isPrivateIp(address)) throw new UnsafeUrlError("Ten adres wskazuje na sieć prywatną.");
  }
}

export interface SafeFetchResult {
  finalUrl: string;
  status: number;
  headers: Headers;
  body: string;
  bytes: number;
  loadMs: number;
}

/**
 * fetch z ręczną obsługą przekierowań, żeby zwalidować KAŻDY hop
 * (inaczej publiczna domena mogłaby przekierować na 169.254.169.254).
 */
export async function safeFetch(
  url: string,
  opts: { maxBytes?: number; timeoutMs?: number; accept?: string } = {}
): Promise<SafeFetchResult> {
  const maxBytes = opts.maxBytes ?? LIMITS.maxHtmlBytes;
  const timeoutMs = opts.timeoutMs ?? LIMITS.fetchTimeoutMs;
  const startedAt = Date.now();

  let current = url;
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    await assertPublicUrl(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent":
            "SiteAuditBot/1.0 (+audyt strony WWW; kontakt przez stronę zlecającego)",
          accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8",
          "accept-language": "pl-PL,pl;q=0.9,en;q=0.6",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { finalUrl: current, status: response.status, headers: response.headers, body: "", bytes: 0, loadMs: Date.now() - startedAt };
      }
      current = new URL(location, current).toString();
      continue;
    }

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return {
      finalUrl: current,
      status: response.status,
      headers: response.headers,
      body: new TextDecoder("utf-8").decode(merged),
      bytes,
      loadMs: Date.now() - startedAt,
    };
  }

  throw new UnsafeUrlError("Zbyt wiele przekierowań — strona zapętla adresy.");
}

export function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, "");
    const hb = new URL(b).hostname.replace(/^www\./, "");
    return ha === hb;
  } catch {
    return false;
  }
}
