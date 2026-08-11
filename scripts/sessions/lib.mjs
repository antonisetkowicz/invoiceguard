/**
 * lib.mjs — wspólna biblioteka systemu /wznow
 *
 * Czyta lokalne transkrypty Claude Code (~/.claude/projects/<enc-cwd>/<sessionId>.jsonl),
 * rozpoznaje sesje zatrzymane przez limit, wylicza moment odnowienia limitu
 * i kategoryzuje sesje wg projektu (repo git / katalog roboczy).
 *
 * Zero zależności zewnętrznych — czysty Node >= 18.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

export const HOME = os.homedir();
export const PROJECTS_DIR = process.env.CLAUDE_PROJECTS_DIR || path.join(HOME, '.claude', 'projects');
export const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
export const STATE_DIR = process.env.WZNOW_STATE_DIR || path.join(REPO_ROOT, '.claude', 'session-state');

/** Okno limitu Claude odnawia się co 5 godzin — fallback gdy transkrypt nie podał czasu resetu. */
export const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Detekcja limitów
// ---------------------------------------------------------------------------

/**
 * Wzorce komunikatów oznaczających zatrzymanie przez limit.
 * `type` decyduje, czy wznowienie jest automatyczne:
 *   - "five_hour" / "rate"  → limit odnawia się sam, wznawiamy automatycznie
 *   - "weekly" / "spend"    → potrzebna decyzja/portfel człowieka, eskalacja
 */
export const LIMIT_PATTERNS = [
  { re: /claude ai usage limit reached/i, type: 'five_hour' },
  { re: /5-?\s?hour limit reached/i, type: 'five_hour' },
  { re: /usage limit reached/i, type: 'five_hour' },
  { re: /osi[ąa]gni[ęe]to limit/i, type: 'five_hour' },
  { re: /approaching (?:your )?usage limit/i, type: 'five_hour' },
  { re: /weekly limit reached/i, type: 'weekly' },
  { re: /weekly usage limit/i, type: 'weekly' },
  { re: /monthly spend limit/i, type: 'spend' },
  { re: /spend limit/i, type: 'spend' },
  { re: /insufficient credits?/i, type: 'spend' },
  { re: /credit balance is too low/i, type: 'spend' },
  { re: /"type"\s*:\s*"rate_limit_error"/i, type: 'rate' },
  { re: /rate[_ ]limit[_ ]error/i, type: 'rate' },
  { re: /api error:?\s*429/i, type: 'rate' },
  { re: /too many requests/i, type: 'rate' },
];

/** Typy limitów, które odnawiają się same → wolno wznawiać automatycznie. */
export const AUTO_RESUMABLE_TYPES = new Set(['five_hour', 'rate']);

/** Zwraca {type, pattern} albo null. */
export function matchLimit(text) {
  if (!text) return null;
  for (const { re, type } of LIMIT_PATTERNS) {
    if (re.test(text)) return { type, pattern: re.source };
  }
  return null;
}

/**
 * Wyciąga moment odnowienia limitu z treści komunikatu.
 * Obsługuje: `...limit reached|1786500000` (epoch s/ms), `retry-after: 3600`,
 * ISO-8601, oraz `resets at 3pm` / `resets 15:30`.
 * Zwraca ISO string albo null.
 */
export function extractResetAt(text, referenceIso) {
  if (!text) return null;
  const ref = referenceIso ? new Date(referenceIso) : new Date();

  // 1) format Claude Code: "Claude AI usage limit reached|1786500000"
  const epoch = text.match(/limit reached\s*\|\s*(\d{10,13})/i);
  if (epoch) {
    const raw = Number(epoch[1]);
    return new Date(raw < 1e12 ? raw * 1000 : raw).toISOString();
  }

  // 2) retry-after w sekundach
  const retry = text.match(/retry[-_ ]?after["'\s:]+(\d+)/i);
  if (retry) return new Date(ref.getTime() + Number(retry[1]) * 1000).toISOString();

  // 3) jawny ISO w pobliżu słowa reset
  const iso = text.match(/reset[^"\n]{0,40}?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)/i);
  if (iso) {
    const d = new Date(iso[1].endsWith('Z') ? iso[1] : `${iso[1]}Z`);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // 4) "resets at 3pm" / "resets 15:30" — najbliższe wystąpienie takiej godziny
  const clock = text.match(/resets?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (clock) {
    let hour = Number(clock[1]);
    const min = Number(clock[2] || 0);
    const ampm = (clock[3] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour <= 23 && min <= 59) {
      const d = new Date(ref);
      d.setHours(hour, min, 0, 0);
      if (d.getTime() <= ref.getTime()) d.setDate(d.getDate() + 1);
      return d.toISOString();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parsowanie transkryptów
// ---------------------------------------------------------------------------

/** Wyciąga płaski tekst z wpisu transkryptu (content bywa stringiem albo listą bloków). */
export function entryText(entry) {
  const parts = [];
  const push = (v) => { if (typeof v === 'string' && v) parts.push(v); };

  push(entry.content);
  const msg = entry.message;
  if (msg) {
    if (typeof msg.content === 'string') push(msg.content);
    else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (!block || typeof block !== 'object') continue;
        push(block.text);
        if (typeof block.content === 'string') push(block.content);
        else if (Array.isArray(block.content)) for (const b of block.content) push(b?.text);
      }
    }
  }
  if (entry.toolUseResult && typeof entry.toolUseResult === 'string') push(entry.toolUseResult);
  return parts.join('\n');
}

/** Wpisy, które liczą się jako realna aktywność rozmowy. */
const MEANINGFUL_TYPES = new Set(['user', 'assistant', 'system']);

/**
 * Parsuje jeden plik .jsonl i zwraca podsumowanie sesji.
 */
export async function parseTranscript(filePath) {
  const stat = fs.statSync(filePath);
  const session = {
    session_id: path.basename(filePath, '.jsonl'),
    transcript: filePath,
    cwd: null,
    git_branch: null,
    version: null,
    entrypoint: null,
    first_prompt: null,
    last_prompt: null,
    started_at: null,
    last_activity_at: null,
    user_messages: 0,
    assistant_messages: 0,
    size_bytes: stat.size,
    limit_event: null,          // {at, type, pattern, reset_at, text}
    activity_after_limit: false,
    parse_errors: 0,
  };

  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { session.parse_errors++; continue; }

    if (e.cwd) session.cwd = e.cwd;
    if (e.gitBranch) session.git_branch = e.gitBranch;
    if (e.version) session.version = e.version;
    if (e.entrypoint) session.entrypoint = e.entrypoint;

    const ts = e.timestamp || null;
    if (ts) {
      if (!session.started_at) session.started_at = ts;
      session.last_activity_at = ts;
    }

    if (!MEANINGFUL_TYPES.has(e.type)) continue;
    if (e.attachment) continue; // wpisy techniczne (deferred tools itp.)

    const text = entryText(e);

    if (e.type === 'user' && !e.isSidechain && text && !text.startsWith('<')) {
      session.user_messages++;
      if (!session.first_prompt) session.first_prompt = text.slice(0, 600);
      session.last_prompt = text.slice(0, 600);
    }
    if (e.type === 'assistant' && !e.isSidechain) session.assistant_messages++;

    // Komunikat o limicie liczy się TYLKO z wpisu systemowego/błędu albo z
    // krótkiej wiadomości asystenta. Inaczej sesja, w której ktoś ROZMAWIA o
    // limitach (albo je cytuje), zostałaby wzięta za zatrzymaną przez limit.
    const errorish = e.type === 'system' || e.isApiErrorMessage === true
      || (e.type === 'assistant' && text.length < 400);
    const strongMarker = /^\s*(claude ai usage limit reached|api error:?\s*429)/i.test(text);
    const hit = (errorish || strongMarker) ? matchLimit(text) : null;
    if (hit) {
      session.limit_event = {
        at: ts,
        type: hit.type,
        pattern: hit.pattern,
        reset_at: extractResetAt(text, ts),
        text: text.slice(0, 300).replace(/\s+/g, ' ').trim(),
      };
      session.activity_after_limit = false;
    } else if (session.limit_event && text.trim().length > 0) {
      // po komunikacie o limicie pojawiła się realna treść → sesja ruszyła dalej
      session.activity_after_limit = true;
    }
  }

  return finalizeSession(session);
}

/** Domyka wyliczane pola: reset_at, status, project. */
export function finalizeSession(session, now = Date.now()) {
  const ev = session.limit_event;
  const blocked = Boolean(ev) && !session.activity_after_limit;

  if (blocked) {
    if (ev.reset_at) {
      ev.reset_at_estimated = false;
    } else if (AUTO_RESUMABLE_TYPES.has(ev.type)) {
      // limit 5h bez jawnego czasu → zakładamy okno 5h od zdarzenia
      const base = ev.at ? new Date(ev.at).getTime() : now;
      ev.reset_at = new Date(base + FIVE_HOURS_MS).toISOString();
      ev.reset_at_estimated = true;
    } else {
      // limit tygodniowy/wydatków nie odnawia się w znanym oknie — nie zgadujemy
      ev.reset_at = null;
      ev.reset_at_estimated = false;
    }
  }

  const lastMs = session.last_activity_at ? new Date(session.last_activity_at).getTime() : 0;
  session.status = blocked
    ? 'blocked_by_limit'
    : (now - lastMs < 30 * 60 * 1000 ? 'active' : 'idle');

  session.auto_resumable = blocked && AUTO_RESUMABLE_TYPES.has(ev.type);
  session.limit_type = blocked ? ev.type : null;
  session.reset_at = blocked ? ev.reset_at : null;
  session.reset_passed = Boolean(session.reset_at) && new Date(session.reset_at).getTime() <= now;
  session.age_days = lastMs ? +((now - lastMs) / 86400000).toFixed(2) : null;

  const proj = describeProject(session.cwd);
  session.project = proj.name;
  session.project_root = proj.root;
  session.project_stack = proj.stack;
  session.cwd_exists = proj.exists;

  return session;
}

// ---------------------------------------------------------------------------
// Kategoryzacja wg projektu
// ---------------------------------------------------------------------------

const projectCache = new Map();

/** Znajduje korzeń projektu (najbliższy katalog z .git), nazwę i stack. */
export function describeProject(cwd) {
  if (!cwd) return { name: '(nieznany)', root: null, stack: [], exists: false };
  if (projectCache.has(cwd)) return projectCache.get(cwd);

  let root = cwd;
  let exists = fs.existsSync(cwd);
  if (exists) {
    let dir = cwd;
    while (dir && dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, '.git'))) { root = dir; break; }
      dir = path.dirname(dir);
    }
  }

  const stack = [];
  let name = path.basename(root) || root;
  if (exists) {
    const probe = [
      ['package.json', 'node'],
      ['pyproject.toml', 'python'],
      ['requirements.txt', 'python'],
      ['go.mod', 'go'],
      ['Cargo.toml', 'rust'],
      ['Gemfile', 'ruby'],
      ['pom.xml', 'java'],
      ['next.config.ts', 'next'],
      ['next.config.js', 'next'],
      ['prisma', 'prisma'],
    ];
    for (const [file, tag] of probe) {
      if (fs.existsSync(path.join(root, file)) && !stack.includes(tag)) stack.push(tag);
    }
    try {
      const pkgPath = path.join(root, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) name = pkg.name;
      }
    } catch { /* nieczytelny package.json — zostaje nazwa z katalogu */ }
  }

  const out = { name, root, stack, exists };
  projectCache.set(cwd, out);
  return out;
}

/**
 * Domyślne reguły tematyczne — nadpisywalne plikiem .claude/session-rules.json.
 * KOLEJNOŚĆ MA ZNACZENIE: wygrywa pierwsza pasująca reguła, dlatego wąskie
 * kategorie stoją wyżej niż szeroki „feature" (inaczej „dodaj testy" wpadłoby
 * do feature zamiast do testów).
 */
export const DEFAULT_RULES = [
  { kategoria: 'bug/fix', wzorce: ['\\bbug\\b', '\\bfix\\b', 'napraw', 'błąd', 'blad', 'nie działa', 'error', 'crash', 'failing'] },
  { kategoria: 'testy', wzorce: ['\\btest', 'testy', 'coverage', 'vitest', 'pytest', 'playwright'] },
  { kategoria: 'deploy/infra', wzorce: ['deploy', 'wdroż', 'wdroz', 'vercel', 'docker', 'ci/cd', 'github action', 'render\\.yaml'] },
  { kategoria: 'marketing/sprzedaż', wzorce: ['cold[- ]?mail', 'marketing', 'kampani', 'lead', 'klient', 'sprzedaż', 'sprzedaz', 'instagram', 'reklam'] },
  { kategoria: 'automatyzacja', wzorce: ['automat', 'cron', 'routine', 'harmonogram', 'pipeline', 'subagent', 'workflow', 'n8n'] },
  { kategoria: 'research', wzorce: ['zbadaj', 'research', 'sprawdź rynek', 'analiz', 'porówn', 'porown', 'jakie (są|sa)'] },
  { kategoria: 'dokumentacja', wzorce: ['readme', 'dokumentacj', '\\bdocs?\\b', 'opisz'] },
  { kategoria: 'refactor', wzorce: ['refactor', 'refaktor', 'uporządkuj', 'uprość', 'uproszcz', 'cleanup', 'posprzątaj'] },
  { kategoria: 'feature', wzorce: ['\\bdodaj\\b', 'zbuduj', 'stwórz', 'stworz', 'zrób', 'zrob', 'implement', '\\badd\\b', 'build', 'nowa funkcj'] },
];

export function loadRules() {
  const file = path.join(REPO_ROOT, '.claude', 'session-rules.json');
  if (!fs.existsSync(file)) return DEFAULT_RULES;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(parsed?.reguly) && parsed.reguly.length) return parsed.reguly;
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch { /* zły JSON → reguły domyślne, nie wywalamy skanu */ }
  return DEFAULT_RULES;
}

/** Przypisuje kategorię tematyczną na podstawie pierwszego promptu. */
export function categorize(session, rules = DEFAULT_RULES) {
  const hay = `${session.first_prompt || ''}\n${session.last_prompt || ''}`.toLowerCase();
  if (!hay.trim()) return 'nieokreślona';
  for (const rule of rules) {
    for (const w of rule.wzorce || []) {
      try { if (new RegExp(w, 'i').test(hay)) return rule.kategoria; }
      catch { /* niepoprawny regex w regułach użytkownika — pomijamy */ }
    }
  }
  return 'inne';
}

// ---------------------------------------------------------------------------
// Skan katalogu projektów
// ---------------------------------------------------------------------------

export async function scanLocalSessions({ projectsDir = PROJECTS_DIR } = {}) {
  const sessions = [];
  if (!fs.existsSync(projectsDir)) return sessions;

  const rules = loadRules();
  for (const dirent of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const dir = path.join(projectsDir, dirent.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      try {
        const s = await parseTranscript(path.join(dir, f));
        s.encoded_dir = dirent.name;
        s.kategoria = categorize(s, rules);
        s.source = 'local';
        sessions.push(s);
      } catch (err) {
        sessions.push({
          session_id: path.basename(f, '.jsonl'),
          transcript: path.join(dir, f),
          source: 'local',
          status: 'parse_failed',
          error: String(err && err.message || err),
        });
      }
    }
  }
  sessions.sort((a, b) => String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || '')));
  return sessions;
}

/**
 * Grupuje sesje w projekty. Klucz to nazwa katalogu/repo (bez ścieżki), więc
 * sesja lokalna w `/Users/ja/invoiceguard` i sesja zdalna z repo
 * `antonisetkowicz/invoiceguard` trafiają do JEDNEGO projektu. Wszystkie
 * źródłowe ścieżki/repo zostają widoczne w polu `roots`.
 */
export function groupByProject(sessions) {
  const map = new Map();
  for (const s of sessions) {
    const raw = s.project_root || s.project || '(nieznany)';
    const key = String(raw).replace(/\.git$/, '').split(/[/\\]/).filter(Boolean).pop()?.toLowerCase()
      || String(raw).toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        project: key,
        roots: new Set(),
        stack: s.project_stack || [],
        sessions: 0,
        lokalne: 0,
        zdalne: 0,
        blocked: 0,
        auto_resumable: 0,
        needs_human: 0,
        branches: new Set(),
        kategorie: {},
        last_activity_at: null,
        session_ids: [],
      });
    }
    const p = map.get(key);
    p.sessions++;
    if (s.source === 'remote') p.zdalne++; else p.lokalne++;
    if (raw) p.roots.add(String(raw));
    if (!p.stack?.length && s.project_stack?.length) p.stack = s.project_stack;
    p.session_ids.push(s.session_id);
    if (s.git_branch) p.branches.add(s.git_branch);
    if (s.kategoria) p.kategorie[s.kategoria] = (p.kategorie[s.kategoria] || 0) + 1;
    if (s.status === 'blocked_by_limit') {
      p.blocked++;
      if (s.auto_resumable) p.auto_resumable++; else p.needs_human++;
    }
    if (!p.last_activity_at || String(s.last_activity_at || '') > p.last_activity_at) {
      p.last_activity_at = s.last_activity_at || p.last_activity_at;
    }
  }
  return [...map.values()]
    .map((p) => ({ ...p, branches: [...p.branches], roots: [...p.roots] }))
    .sort((a, b) => String(b.last_activity_at || '').localeCompare(String(a.last_activity_at || '')));
}

// ---------------------------------------------------------------------------
// Sesje zdalne (Claude Code Remote / claude.ai/code)
// ---------------------------------------------------------------------------

/**
 * Normalizuje wpis z `mcp__Claude_Code_Remote__list_sessions` do tego samego
 * kształtu co sesja lokalna. Sesji zdalnej nie da się odczytać z dysku —
 * jedyne sygnały to `post_turn_summary`, `status_bucket` i `last_init_error`.
 */
export function normalizeRemoteSession(raw, now = Date.now(), rules = DEFAULT_RULES) {
  const meta = raw.external_metadata || {};
  const summary = raw.post_turn_summary || meta.post_turn_summary || {};
  const detail = summary.status_detail || '';
  const initError = meta.last_init_error || null;

  const repo = raw.session_context?.sources?.[0]?.git_repository?.url
    || raw.session_context?.outcomes?.[0]?.git_repository?.git_info?.repo
    || null;
  const branch = raw.session_context?.outcomes?.[0]?.git_repository?.git_info?.branches?.[0]
    || Object.values(meta.current_branches || {})[0]
    || null;

  const failed = summary.status_category === 'failed'
    || raw.status_bucket === 'SESSION_STATUS_BUCKET_FAILED';
  const hit = failed ? matchLimit(detail) : null;

  const s = {
    session_id: raw.id,
    source: 'remote',
    title: raw.title || null,
    cwd: null,
    project: repo ? repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '') : '(bez repo)',
    project_root: repo,
    project_stack: [],
    cwd_exists: false,
    git_branch: branch,
    entrypoint: raw.origin || null,
    environment_kind: raw.environment_kind || null,
    session_status: raw.session_status || null,
    status_bucket: raw.status_bucket || null,
    connection_status: raw.connection_status || null,
    first_prompt: raw.title || null,
    last_prompt: detail || null,
    started_at: raw.created_at || null,
    last_activity_at: raw.updated_at || null,
    status_detail: detail || null,
    limit_event: null,
    activity_after_limit: false,
    init_error: initError ? { kind: initError.error_kind, message: initError.message } : null,
  };

  if (hit) {
    s.limit_event = {
      at: raw.updated_at || null,
      type: hit.type,
      pattern: hit.pattern,
      reset_at: extractResetAt(detail, raw.updated_at),
      text: detail.slice(0, 300),
    };
  }

  const archived = raw.session_status === 'SESSION_STATUS_ARCHIVED';
  const blocked = Boolean(s.limit_event) && !archived;

  if (blocked && !s.limit_event.reset_at && AUTO_RESUMABLE_TYPES.has(s.limit_event.type)) {
    const base = s.limit_event.at ? new Date(s.limit_event.at).getTime() : now;
    s.limit_event.reset_at = new Date(base + FIVE_HOURS_MS).toISOString();
    s.limit_event.reset_at_estimated = true;
  }

  s.status = archived
    ? 'archived'
    : blocked
      ? 'blocked_by_limit'
      : (raw.session_status === 'SESSION_STATUS_RUNNING' ? 'active' : 'idle');
  s.limit_type = blocked ? s.limit_event.type : null;
  s.auto_resumable = blocked && AUTO_RESUMABLE_TYPES.has(s.limit_event.type) && !s.init_error;
  s.reset_at = blocked ? s.limit_event.reset_at : null;
  s.reset_passed = Boolean(s.reset_at) && new Date(s.reset_at).getTime() <= now;
  const lastMs = s.last_activity_at ? new Date(s.last_activity_at).getTime() : 0;
  s.age_days = lastMs ? +((now - lastMs) / 86400000).toFixed(2) : null;
  s.kategoria = categorize(s, rules);
  return s;
}

/** Wyciąga listę sesji z surowej odpowiedzi MCP (dopuszcza kilka kształtów). */
export function extractRemoteList(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.ccr?.data || payload?.data || payload?.sessions || [];
}

// ---------------------------------------------------------------------------
// Pomocnicze IO
// ---------------------------------------------------------------------------

export function ensureStateDir() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  return STATE_DIR;
}

export function writeJson(file, data) {
  ensureStateDir();
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}

/**
 * Wczytuje politykę systemu /wznow z `.claude/wznow.config.json`.
 * Plik jest commitowany (bez sekretów), dzięki czemu ta sama polityka działa
 * w sesji lokalnej i w świeżej sesji zdalnej odpalonej przez Routine.
 */
export function loadConfig() {
  const file = path.join(REPO_ROOT, '.claude', 'wznow.config.json');
  const cfg = readJson(file, {}) || {};
  // klucze zaczynające się od "//" to komentarze w JSON-ie
  return Object.fromEntries(Object.entries(cfg).filter(([k]) => !k.startsWith('//')));
}

/**
 * Wczytuje `.env` z korzenia repo do process.env (bez nadpisywania istniejących).
 * Repo trzyma sekrety wyłącznie w .env — skrypty czytają je same, bez zależności.
 */
export function loadEnv(file = path.join(REPO_ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}

export function fmtAge(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.max(0, Math.floor(diff / 60000))} min temu`;
  if (h < 48) return `${h} h temu`;
  return `${Math.floor(h / 24)} dni temu`;
}
