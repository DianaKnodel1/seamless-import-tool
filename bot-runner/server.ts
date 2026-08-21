// Bot-Runner: holt Läufe aus der Queue und arbeitet die Schritte im Browser ab.
// Läuft als eigener Dienst (Node.js + Playwright), NICHT im Worker/Portal.
//
//   npm install && npx playwright install chromium
//   SUPABASE_URL=… SERVICE_ROLE_KEY=… npm start

import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext, BrowserType, Chromium, Page } from "playwright";

console.log(`[${new Date().toISOString()}] Runner-Bootstrap geladen`);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_MS = Number(process.env.POLL_MS ?? 5000);
const HEADLESS = process.env.HEADLESS !== "false";
const WORKER_NAME = process.env.WORKER_NAME ?? `runner-${process.pid}`;
// Ohne Proxy startet standardmäßig kein Lauf (REQUIRE_PROXY=false zum Testen).
const REQUIRE_PROXY = process.env.REQUIRE_PROXY !== "false";
// Zeitlimit für Seitenaufrufe (Proxys sind oft langsam).
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT_MS ?? 60000);
// Zeitlimit für Interaktionen (Klicks, Eingaben) – Bankstrecken laden träge.
const STEP_TIMEOUT = Number(process.env.STEP_TIMEOUT_MS ?? 35000);
const USER_AGENT = process.env.USER_AGENT ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL und SERVICE_ROLE_KEY bzw. SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein.");
  process.exit(1);
}

let db: SupabaseClient;
let chromium: BrowserType<Chromium>;
// Aktiver Browser-Kontext mit laufender Aufzeichnung (für Fehler-Traces).
let activeContext: BrowserContext | null = null;
const TRACE_ENABLED = process.env.TRACE !== "false";

/** Beendet die Aufzeichnung und legt das Trace-Zip in den Storage. */
async function stopTrace(runId: string, tag: string): Promise<string | null> {
  const ctx = activeContext;
  activeContext = null;
  if (!ctx || !TRACE_ENABLED) return null;
  const file = join(tmpdir(), `trace-${runId}-${Date.now()}.zip`);
  try {
    await ctx.tracing.stop({ path: file });
    const buf = await readFile(file);
    const path = `bot-runs/${runId}/${tag}-trace-${Date.now()}.zip`;
    await db.storage.from("documents").upload(path, buf, { contentType: "application/zip" });
    return path;
  } catch {
    return null;
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

interface Step {
  action: "goto" | "fill" | "click" | "select" | "wait" | "wait_for" | "screenshot" | "advance" | "extract" | "prompt" | "handoff";
  selector?: string;
  value?: string;
  pattern?: string;
  label?: string;
  optional?: boolean;
  timeout?: number;
  var_name?: string;
  url_pattern?: string;
  text_pattern?: string;
}

interface Run {
  id: string;
  profile_id: string;
  assignment_id?: string | null;
  proxy_id?: string | null;
  proxy_session?: string | null;
  input_data: Record<string, string>;
  credentials: Record<string, string>;
  run_vars?: Record<string, string> | null;
  resume_step?: number | null;
  storage_state?: any;
  log: { at: string; msg: string }[];
}

/** Ersetzt {{platzhalter}} durch Lauf-Daten. */
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key) => vars[key] ?? "");
}

/** Wandelt ein Glob-Muster (mit *) in einen regulären Ausdruck um. */
function globToRe(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(escaped, "i");
}


async function appendLog(runId: string, current: Run["log"], msg: string) {
  const log = [...current, { at: new Date().toISOString(), msg }].slice(-200);
  await db.from("bot_runs").update({ log }).eq("id", runId);
  console.log(`[${runId}] ${msg}`);
  return log;
}

/** Netzwerkfehler, bei denen ein erneuter Versuch sinnvoll ist. */
function isNetworkError(msg: string): boolean {
  return /ERR_TIMED_OUT|ERR_CONNECTION|ERR_NETWORK|ERR_PROXY|ERR_TUNNEL|ERR_EMPTY_RESPONSE|ERR_NAME_NOT_RESOLVED|Timeout .* exceeded/i.test(msg);
}

/** Fehler, der eine sofortige Übergabe an den Admin auslöst (kein Retry sinnvoll). */
class PageUnavailableError extends Error {}

/** Erkennt Fehler-/404-Seiten anhand von HTTP-Status, Titel und Seitentext. */
async function assertPageOk(page: Page, status: number | null, url: string) {
  if (status !== null && status >= 400) {
    throw new PageUnavailableError(
      `Die Seite ${url} antwortet mit HTTP ${status}. Bitte die URL im Bot-Profil prüfen/aktualisieren.`,
    );
  }
  const title = await page.title().catch(() => "");
  const heading = await page.locator("h1").first().innerText({ timeout: 3000 }).catch(() => "");
  const probe = `${title} ${heading}`;
  const errorPage = /(^|\W)(404|410)(\W|$)|Seite nicht gefunden|Fehlerseite|Page not found|Not Found|Zugriff verweigert|Access Denied|Forbidden|Service (?:nicht verfügbar|unavailable)|Wartungsarbeiten/i;
  if (errorPage.test(probe)) {
    throw new PageUnavailableError(
      `Die Seite ${url} ist eine Fehlerseite ("${(title || heading).trim()}"). Bitte die URL im Bot-Profil prüfen/aktualisieren.`,
    );
  }
}

/** Öffnet eine Seite mit mehreren Versuchen (Proxys sind oft langsam/instabil). */
async function gotoWithRetry(page: Page, url: string, timeout: number, onLog: (m: string) => Promise<void>) {
  const attempts = Number(process.env.GOTO_RETRIES ?? 3);
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await page.goto(url, { waitUntil: "commit", timeout });
      await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
      await assertPageOk(page, res?.status() ?? null, url);
      return;
    } catch (err: any) {
      if (err instanceof PageUnavailableError) throw err;
      lastErr = err;
      const msg = String(err?.message ?? err);
      if (attempt >= attempts || !isNetworkError(msg)) throw err;
      await onLog(`Seitenaufruf Versuch ${attempt}/${attempts} fehlgeschlagen (${msg.split("\n")[0]}) – neuer Versuch`);
      await page.waitForTimeout(2000 * attempt);
    }
  }
  throw lastErr;
}

/**
 * Prüft vor Interaktionsschritten, ob die aktuelle Seite eine Fehlerseite ist –
 * sonst wartet der Bot minutenlang auf Elemente, die es dort nie geben kann.
 */
async function assertCurrentPageOk(page: Page) {
  await assertPageOk(page, null, page.url());
}


/** Klickt gängige Cookie-/Consent-Buttons weg (auch in iFrames). */
async function dismissConsent(page: Page) {
  const names = /^(Alle akzeptieren|Alles akzeptieren|Akzeptieren|Zustimmen|Einverstanden|Alle Cookies akzeptieren|Auswahl bestätigen|OK)$/i;
  const frames = [page.mainFrame(), ...page.frames()];
  for (const frame of frames) {
    try {
      const btn = frame.getByRole("button", { name: names }).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        return;
      }
      const alt = frame.locator(
        "#onetrust-accept-btn-handler, button[data-testid='uc-accept-all-button'], #usercentrics-root >>> button",
      ).first();
      if (await alt.isVisible({ timeout: 500 }).catch(() => false)) {
        await alt.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(500);
        return;
      }
    } catch { /* Frame nicht erreichbar – ignorieren */ }
  }
}

/**
 * Zerlegt eine Selektor-Angabe in Alternativen.
 * Erlaubt: JSON-Array (["#a","text=Weiter"]) oder "a || b || c".
 */
function splitSelectors(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) return arr.map(String).map((s) => s.trim()).filter(Boolean);
    } catch { /* kein gültiges JSON – wie normalen Selektor behandeln */ }
  }
  return trimmed.split("||").map((s) => s.trim()).filter(Boolean);
}

/** Baut einen Locator: CSS/XPath, text=…, role=button:Name oder Klartext-Fallback. */
function toLocator(page: Page, sel: string) {
  const role = sel.match(/^role=([a-z]+)[:=](.+)$/i);
  if (role?.[1] && role[2]) {
    return page.getByRole(role[1] as any, { name: new RegExp(escapeRe(role[2]), "i") }).first();
  }
  const text = sel.match(/^text=["']?(.+?)["']?$/i);
  if (text?.[1]) {
    return page.getByText(new RegExp(escapeRe(text[1]), "i")).first();
  }
  return page.locator(sel).first();
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sucht den ersten Selektor aus der Liste, der auf der Seite existiert.
 * Fällt am Ende auf eine Text-/Rollen-Suche zurück.
 */
async function resolveLocator(page: Page, raw: string, timeout: number, onLog?: (m: string) => Promise<void>) {
  const list = splitSelectors(raw);
  const per = Math.max(1500, Math.round(timeout / Math.max(list.length, 1)));
  for (const sel of list) {
    const loc = toLocator(page, sel);
    const ok = await loc.waitFor({ state: "attached", timeout: per }).then(() => true).catch(() => false);
    if (ok) {
      if (onLog && sel !== list[0]) await onLog(`Alternativ-Selektor verwendet: "${sel}"`);
      return loc;
    }
  }
  // Fallback: Text aus dem Selektor als Button-/Link-Name interpretieren
  const hint = list[0]?.match(/text=["']?([^"'\]]+)/i)?.[1];
  if (hint) {
    const byRole = page.getByRole("button", { name: new RegExp(escapeRe(hint), "i") })
      .or(page.getByRole("link", { name: new RegExp(escapeRe(hint), "i") })).first();
    if (await byRole.count().catch(() => 0)) {
      if (onLog) await onLog(`Fallback über Beschriftung "${hint}" verwendet`);
      return byRole;
    }
  }
  return null;
}

/**
 * Robuster Klick: Consent wegklicken, scrollen, Alternativ-Selektoren,
 * Text-/Rollen-Suche und zuletzt JavaScript-Klick.
 */
async function clickWithRetry(page: Page, selector: string, timeout: number, onLog: (m: string) => Promise<void>) {
  const attempts = 3;
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) await dismissConsent(page);
      const el = await resolveLocator(page, selector, Math.round(timeout / attempts), onLog);
      if (!el) throw new Error(`Kein Element für "${selector}" gefunden`);
      await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => undefined);
      await el.click({ timeout: Math.round(timeout / attempts) });
      return;
    } catch (err: any) {
      lastErr = err;
      await onLog(`Klick Versuch ${attempt}/${attempts} auf "${selector}" fehlgeschlagen – neuer Versuch`);
    }
  }
  // Fallback: JavaScript-Klick (überdeckende Layer umgehen)
  for (const sel of splitSelectors(selector)) {
    const done = await page.evaluate((s) => {
      const node = document.querySelector(s) as HTMLElement | null;
      if (!node) return false;
      node.click();
      return true;
    }, sel).catch(() => false);
    if (done) { await onLog(`Klick auf "${sel}" per JavaScript ausgeführt`); return; }
  }
  throw lastErr;
}

/** Liest sichtbare, interaktive Elemente der Seite als Selektor-Vorschläge aus. */
async function collectCandidates(page: Page) {
  return await page.evaluate(() => {
    const out: Record<string, string>[] = [];
    const nodes = document.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [role=button], [role=link], [onclick]",
    );
    for (const el of Array.from(nodes).slice(0, 400)) {
      const rect = el.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== "hidden";
      if (!visible) continue;
      const anyEl = el as any;
      out.push({
        tag: el.tagName.toLowerCase(),
        type: anyEl.type ?? "",
        id: el.id ?? "",
        name: anyEl.name ?? "",
        testid: el.getAttribute("data-testid") ?? "",
        aria: el.getAttribute("aria-label") ?? "",
        text: (el.innerText || anyEl.value || el.getAttribute("placeholder") || "").trim().slice(0, 80),
        selector: el.id
          ? `#${el.id}`
          : anyEl.name
            ? `${el.tagName.toLowerCase()}[name="${anyEl.name}"]`
            : el.getAttribute("data-testid")
              ? `[data-testid="${el.getAttribute("data-testid")}"]`
              : "",
      });
      if (out.length >= 120) break;
    }
    return out;
  }).catch(() => [] as Record<string, string>[]);
}

/** Speichert Screenshot, HTML und Element-Kandidaten für einen Fehlerfall. */
async function captureDiagnostics(page: Page, runId: string, tag: string) {
  const stamp = Date.now();
  const base = `bot-runs/${runId}/${tag}-${stamp}`;
  const result: { screenshot_path?: string; html_path?: string; candidates?: Record<string, string>[] } = {};
  try {
    const buf = await page.screenshot({ fullPage: false });
    const path = `${base}.png`;
    await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
    result.screenshot_path = path;
  } catch { /* Screenshot nicht möglich */ }
  try {
    const html = await page.content();
    const path = `${base}.html`;
    await db.storage.from("documents").upload(path, new Blob([html], { type: "text/html" }), {
      contentType: "text/html",
    });
    result.html_path = path;
  } catch { /* HTML nicht lesbar */ }
  result.candidates = await collectCandidates(page);
  return result;
}



async function runSteps(page: Page, run: Run, steps: Step[]) {
  const vars = { ...run.input_data, ...run.credentials, ...(run.run_vars ?? {}) };
  let log = run.log ?? [];
  const startAt = Math.min(Math.max(Number(run.resume_step ?? 0), 0), Math.max(steps.length - 1, 0));
  if (startAt > 0) log = await appendLog(run.id, log, `Fortsetzung ab Schritt ${startAt + 1}`);

  for (let i = startAt; i < steps.length; i++) {

    const step = steps[i];
    if (!step) continue;
    const timeout = step.timeout ?? (step.action === "goto" ? NAV_TIMEOUT : STEP_TIMEOUT);
    const selector = step.selector ? render(step.selector, vars) : "";
    const value = step.value ? render(step.value, vars) : "";

    await db.from("bot_runs").update({ current_step: i + 1 }).eq("id", run.id);

    try {
      switch (step.action) {
        case "goto":
          await gotoWithRetry(page, value, timeout, async (m) => { log = await appendLog(run.id, log, m); });
          await dismissConsent(page);
          break;

        case "fill": {
          await assertCurrentPageOk(page);
          await dismissConsent(page);
          const el = await resolveLocator(page, selector, timeout, async (m) => { log = await appendLog(run.id, log, m); });
          if (!el) throw new Error(`Kein Eingabefeld für "${selector}" gefunden`);
          await el.fill(value, { timeout });
          break;
        }
        case "click":
          await assertCurrentPageOk(page);
          await dismissConsent(page);
          await clickWithRetry(page, selector, timeout, async (m) => { log = await appendLog(run.id, log, m); });
          break;

        case "select": {
          await assertCurrentPageOk(page);
          const el = await resolveLocator(page, selector, timeout, async (m) => { log = await appendLog(run.id, log, m); });
          if (!el) throw new Error(`Kein Auswahlfeld für "${selector}" gefunden`);
          await el.selectOption(value, { timeout });
          break;
        }
        case "wait":
          if (selector) {
            const el = await resolveLocator(page, selector, timeout, async (m) => { log = await appendLog(run.id, log, m); });
            if (!el) throw new Error(`Element "${selector}" ist nicht erschienen`);
            await el.waitFor({ state: "visible", timeout }).catch(() => undefined);
          } else {
            await page.waitForTimeout(Number(value) || 1000);
          }
          break;

        case "wait_for": {
          const urlPat = step.url_pattern ? render(step.url_pattern, vars) : "";
          const textPat = step.text_pattern ? render(step.text_pattern, vars) : "";
          if (urlPat) {
            await page.waitForURL(globToRe(urlPat), { timeout });
          }
          if (textPat) {
            await page.getByText(new RegExp(escapeRe(textPat), "i")).first()
              .waitFor({ state: "visible", timeout });
          }
          if (!urlPat && !textPat) await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
          await dismissConsent(page);
          break;
        }

        case "prompt": {
          const key = (step.var_name || "wert").toLowerCase();
          if (vars[key]) {
            log = await appendLog(run.id, log, `Rückfrage "${key}" bereits beantwortet – weiter`);
            break;
          }
          // Sitzung sichern, damit der Lauf später eingeloggt weitermachen kann.
          let storage: unknown = null;
          try { storage = await page.context().storageState(); } catch { /* egal */ }
          const shot = await page.screenshot({ fullPage: false }).catch(() => null);
          let shotPath: string | null = null;
          if (shot) {
            shotPath = `bot-runs/${run.id}/prompt-${Date.now()}.png`;
            await db.storage.from("documents").upload(shotPath, shot, { contentType: "image/png" })
              .catch(() => { shotPath = null; });
          }
          await db.from("bot_runs").update({
            status: "waiting_admin",
            pending_var: key,
            pending_prompt: step.label ?? `Bitte "${key}" eingeben`,
            resume_step: i,
            handoff_reason: step.label ?? `Bitte "${key}" eingeben`,
            handoff_url: page.url(),
            storage_state: storage,
            ...(shotPath ? { screenshot_path: shotPath } : {}),
          }).eq("id", run.id);
          await appendLog(run.id, log, `Rückfrage an Admin: ${step.label ?? key}`);
          return "handoff" as const;
        }

        case "screenshot": {

          const buf = await page.screenshot({ fullPage: false });
          const path = `bot-runs/${run.id}/${Date.now()}.png`;
          await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
          await db.from("bot_runs").update({ screenshot_path: path }).eq("id", run.id);
          break;
        }
        case "advance": {
          const maxClicks = Math.min(Math.max(Number(value) || 8, 1), 15);
          for (let clickIndex = 0; clickIndex < maxClicks; clickIndex++) {
            const bodyText = await page.locator("body").innerText({ timeout });
            if (/(Vorgangsnummer|Antragsnummer|Referenznummer|Vorgangs-ID|\bTID\b)/i.test(bodyText)) break;
            if (/(VideoIdent|PostIdent|Legitimation|Identifizierung|Ausweis.*(?:prüfen|hochladen)|photoTAN)/i.test(bodyText)) break;

            const next = page.getByRole("button", {
              name: /^(Weiter|Fortfahren|Bestätigen|Antrag absenden|Konto eröffnen|Jetzt eröffnen)$/i,
            }).or(page.getByRole("link", {
              name: /^(Weiter|Fortfahren|Bestätigen|Antrag absenden|Konto eröffnen|Jetzt eröffnen)$/i,
            })).first();
            if (!await next.isVisible().catch(() => false)) break;
            await next.click({ timeout });
            await page.waitForLoadState("domcontentloaded", { timeout }).catch(() => undefined);
            await page.waitForTimeout(800);
          }
          break;
        }
        case "extract": {
          const source = selector
            ? await page.locator(selector).first().innerText({ timeout })
            : await page.locator("body").innerText({ timeout });
          const pattern = step.pattern || step.value || "(?:Vorgangsnummer|Antragsnummer|Referenznummer|TID)\\s*[:#-]?\\s*([A-Z0-9][A-Z0-9./_-]{4,})";
          const match = source.match(new RegExp(pattern, "i"));
          const caseNumber = String(match?.[1] ?? match?.[0] ?? "").trim();
          if (!caseNumber) {
            const buf = await page.screenshot({ fullPage: false });
            const path = `bot-runs/${run.id}/case-number-missing-${Date.now()}.png`;
            await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
            await db.from("bot_runs").update({
              status: "waiting_admin",
              handoff_reason: "Kontoeröffnung erreicht, aber Vorgangsnummer nicht automatisch erkannt. Bitte Screenshot und Seite prüfen.",
              handoff_url: page.url(),
              screenshot_path: path,
            }).eq("id", run.id);
            await appendLog(run.id, log, "Vorgangsnummer nicht erkannt – Übergabe an Admin");
            return "handoff" as const;
          }
          await db.from("bot_runs").update({ vorgangsnummer: caseNumber }).eq("id", run.id);
          if (run.assignment_id) {
            await db.from("task_assignments").update({
              individual_case_number: caseNumber,
              updated_at: new Date().toISOString(),
            }).eq("id", run.assignment_id);
          }
          vars.vorgangsnummer = caseNumber;
          log = await appendLog(run.id, log, `Vorgangsnummer erkannt: ${caseNumber}`);
          break;
        }
        case "handoff": {
          const buf = await page.screenshot({ fullPage: false });
          const path = `bot-runs/${run.id}/handoff-${Date.now()}.png`;
          await db.storage.from("documents").upload(path, buf, { contentType: "image/png" });
          await db.from("bot_runs").update({
            status: "waiting_admin",
            handoff_reason: step.label ?? "Manueller Schritt erforderlich",
            handoff_url: page.url(),
            screenshot_path: path,
          }).eq("id", run.id);
          await appendLog(run.id, log, `Übergabe an Admin: ${step.label ?? "manueller Schritt"}`);
          return "handoff" as const;
        }
      }
      log = await appendLog(run.id, log, `Schritt ${i + 1}/${steps.length} ok: ${step.label ?? step.action}`);
    } catch (err: any) {
      const unavailable = err instanceof PageUnavailableError;
      if (step.optional && !unavailable) {
        log = await appendLog(run.id, log, `Schritt ${i + 1} übersprungen (optional): ${err.message}`);
        continue;
      }

      // Diagnose: Screenshot, HTML, Element-Kandidaten, URL und Titel festhalten.
      const pageUrl = (() => { try { return page.url(); } catch { return ""; } })();
      const pageTitle = await page.title().catch(() => "");
      const diag = await captureDiagnostics(page, run.id, `step-error-${i + 1}`);
      const tracePath = await stopTrace(run.id, `step-error-${i + 1}`);
      const debug = {
        step: i + 1,
        action: step.action,
        selector,
        selector_alternatives: selector ? splitSelectors(selector) : [],
        url: pageUrl,
        title: pageTitle,
        error: String(err?.message ?? err).slice(0, 500),
        html_path: diag.html_path ?? null,
        trace_path: tracePath,
        candidates: (diag.candidates ?? []).slice(0, 80),
        at: new Date().toISOString(),
      };
      await db.from("bot_runs").update({ debug }).eq("id", run.id);

      log = await appendLog(
        run.id, log,
        `Schritt ${i + 1} (${step.action}) fehlgeschlagen auf ${pageUrl || "unbekannter Seite"}${pageTitle ? ` ("${pageTitle}")` : ""}: ${err.message}`,
      );

      // Fehlerseite (404 o. Ä.) → sofort mit Klartext übergeben, kein langes Warten auf Elemente.
      if (unavailable) {
        await db.from("bot_runs").update({
          status: "waiting_admin",
          handoff_reason: `Schritt ${i + 1} (${step.label ?? step.action}): ${err.message}`,
          handoff_url: pageUrl,
          ...(diag.screenshot_path ? { screenshot_path: diag.screenshot_path } : {}),
        }).eq("id", run.id);
        return "handoff" as const;
      }

      // Element nicht gefunden/klickbar → an den Admin übergeben statt abbrechen.
      const isElementProblem = /Timeout .* exceeded|waiting for (?:selector|locator)|not (?:visible|attached|enabled)|Kein (?:Element|Eingabefeld|Auswahlfeld)|nicht erschienen/i.test(String(err?.message ?? ""));
      if (isElementProblem) {
        await db.from("bot_runs").update({
          status: "waiting_admin",
          handoff_reason: `Schritt ${i + 1} (${step.label ?? step.action}) konnte nicht ausgeführt werden – Element "${selector}" war nicht erreichbar. Bitte Screenshot und Element-Vorschläge prüfen und ggf. den Selektor im Bot-Profil korrigieren.`,
          handoff_url: pageUrl,
          ...(diag.screenshot_path ? { screenshot_path: diag.screenshot_path } : {}),
        }).eq("id", run.id);
        return "handoff" as const;
      }


      throw new Error(`Schritt ${i + 1} (${step.action}) fehlgeschlagen: ${err.message}`);

    }
  }

  return "done" as const;
}

async function processOne(): Promise<boolean> {
  // Debug-Log für Polling (nur lokal/journal)
  console.log(`[${new Date().toISOString()}] Polling queue...`);
  
  const { data: claimed, error } = await db.rpc("bot_claim_next_run", { _worker: WORKER_NAME });
  if (error) { 
    console.error("Fehler beim Abrufen aus der Queue (RPC):", error.message); 
    return false; 
  }
  
  const run = (Array.isArray(claimed) ? claimed[0] : claimed) as Run | undefined;
  if (!run) return false;
  
  console.log(`[${run.id}] Lauf gestartet (Profil: ${run.profile_id})`);

  const { data: profile } = await db
    .from("bot_profiles").select("steps").eq("id", run.profile_id).single();
  const steps = (profile?.steps ?? []) as Step[];

  // Proxy laden – jeder Lauf geht über eine eigene IP.
  let proxy: { server: string; username?: string; password?: string } | undefined;
  if (run.proxy_id) {
    const { data: p } = await db
      .from("bot_proxies")
      .select("kind, host, port, username, password")
      .eq("id", run.proxy_id).maybeSingle();
    if (p) {
      const scheme = p.kind === "socks5" ? "socks5" : "http";
      proxy = { server: `${scheme}://${p.host}:${p.port}` };
      // Chromium unterstützt bei SOCKS5 keine Benutzer/Passwort-Anmeldung.
      if (scheme === "http" && p.username) {
        proxy.username = p.username;
        proxy.password = p.password ?? undefined;
      }
    }
  }
  if (REQUIRE_PROXY && !proxy) {
    await db.from("bot_runs").update({
      status: "failed",
      last_error: "Kein Proxy verfügbar – Lauf abgebrochen.",
      finished_at: new Date().toISOString(),
    }).eq("id", run.id);
    return true;
  }

  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    userAgent: USER_AGENT,
    // Fortsetzung: gespeicherte Sitzung (Cookies) wiederherstellen.
    ...(run.storage_state ? { storageState: run.storage_state as any } : {}),
  });

  context.setDefaultNavigationTimeout(NAV_TIMEOUT);
  context.setDefaultTimeout(NAV_TIMEOUT);
  if (TRACE_ENABLED) {
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => undefined);
    activeContext = context;
  }
  const page = await context.newPage();

  try {
    // Vorabprüfung: erreicht der Runner (ggf. über den Proxy) überhaupt das Internet?
    const check = await page.goto("https://api.ipify.org?format=json", { waitUntil: "commit", timeout: 20000 })
      .then(() => true)
      .catch((err: any) => String(err?.message ?? err));
    if (check !== true) {
      const hint = proxy
        ? `Proxy ${proxy.server} nicht erreichbar oder blockiert (${String(check).split("\n")[0]}). Proxy-Zugangsdaten/IP-Freigabe prüfen.`
        : `Kein Internetzugang vom Bot-Server (${String(check).split("\n")[0]}). Firewall/DNS prüfen.`;
      if (proxy && run.proxy_id) {
        await db.from("bot_proxies").update({ is_active: false }).eq("id", run.proxy_id);
      }
      throw new Error(hint);
    }

    const result = await runSteps(page, run, steps);
    if (result === "done") {
      await db.from("bot_runs").update({
        status: "done", finished_at: new Date().toISOString(),
      }).eq("id", run.id);
    }
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const friendly = /ERR_TIMED_OUT/i.test(msg)
      ? `${msg} — Zeitüberschreitung: meist ein langsamer/blockierter Proxy oder eine Bot-Sperre der Bank.`
      : msg;
    const tracePath = await stopTrace(run.id, "run-error");
    await db.from("bot_runs").update({
      status: "failed",
      last_error: friendly.slice(0, 1000),
      finished_at: new Date().toISOString(),
      ...(tracePath ? { debug: { error: friendly.slice(0, 500), trace_path: tracePath, at: new Date().toISOString() } } : {}),
    }).eq("id", run.id);
    console.error(`[${run.id}] fehlgeschlagen:`, msg);
  } finally {
    if (activeContext) {
      await activeContext.tracing.stop().catch(() => undefined);
      activeContext = null;
    }
    await browser.close();
  }


  return true;
}

// Hauptschleife
async function mainLoop() {
  for (;;) {
    let worked = false;
    try {
      worked = await processOne();
    } catch (err) {
      console.error("Runner-Fehler in Hauptschleife:", err);
    }
    // Wenn nichts zu tun war, kurz warten. Wenn ein Lauf verarbeitet wurde, sofort weitermachen.
    if (!worked) {
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

async function bootstrap() {
  console.log(`[${new Date().toISOString()}] Lade Datenbank- und Browser-Module ...`);
  const [{ createClient }, playwright] = await Promise.all([
    import("@supabase/supabase-js"),
    import("playwright"),
  ]);
  db = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
    auth: { persistSession: false },
  });
  chromium = playwright.chromium;
  console.log(`[${new Date().toISOString()}] Bot-Runner gestartet (Poll ${POLL_MS}ms, headless=${HEADLESS}, worker=${WORKER_NAME})`);
  await mainLoop();
}

bootstrap().catch(err => {
  console.error("FATAL: Bot-Runner Hauptschleife abgebrochen:", err);
  process.exit(1);
});