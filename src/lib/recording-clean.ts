// Bereinigt einen Roh-Mitschnitt des Browser-Recorders zu einem Bot-Ablauf.
// Reine Funktion – nutzbar auf Server und Client, ohne Seiteneffekte.

export interface RawRecordedStep {
  /** Zeitstempel in ms. */
  t: number;
  kind: "click" | "input" | "select" | "check" | "submit" | "navigate";
  url: string;
  /** Selektor-Alternativen, beste zuerst. */
  selectors?: string[];
  /** Sichtbarer Text / Beschriftung des Elements. */
  label?: string;
  tag?: string;
  type?: string;
  name?: string;
  /** Vom Recorder geratener Platzhalter-Name, z. B. "email". */
  guess?: string;
  /** Nur für unkritische Felder (Auswahl, Checkbox) übertragen. */
  sample?: string;
  checked?: boolean;
}

export interface CleanStep {
  action: "goto" | "fill" | "click" | "select" | "wait" | "wait_for" | "screenshot" | "prompt" | "handoff";
  selector?: string;
  value?: string;
  label?: string;
  optional?: boolean;
  url_pattern?: string;
  var_name?: string;
}

export interface CleanResult {
  steps: CleanStep[];
  /** Kurze Begründungen, was zusammengefasst oder entfernt wurde. */
  notes: string[];
  /** Alle im Ablauf verwendeten Platzhalter. */
  placeholders: string[];
}

const CONSENT_RE =
  /(alle akzeptieren|alles akzeptieren|akzeptieren|zustimmen|einverstanden|cookies? akzeptieren|auswahl bestätigen|accept all)/i;

/** Erkennt zufällig generierte IDs/Klassen (React, Angular, Build-Hashes). */
function looksRandom(sel: string): boolean {
  return /[a-f0-9]{8,}|:r[0-9a-z]+:|__[a-z0-9]{5,}|ng-tns|css-[a-z0-9]{5,}|\bnth-child\(\d+\)\s*>\s*.*nth-child/i.test(sel);
}

/** Wählt bis zu drei stabile Selektor-Alternativen aus. */
export function pickSelectors(list: string[] | undefined): string {
  const all = (list ?? []).map((s) => s.trim()).filter(Boolean);
  const stable = all.filter((s) => !looksRandom(s));
  const chosen = (stable.length ? stable : all).slice(0, 3);
  return chosen.join(" || ");
}

/** Leitet aus Feldname/Typ/Beschriftung einen Platzhalter ab. */
export function guessPlaceholder(step: RawRecordedStep): string {
  if (step.guess) return step.guess;
  const hay = `${step.name ?? ""} ${step.label ?? ""} ${step.type ?? ""}`.toLowerCase();
  const table: [RegExp, string][] = [
    [/e-?mail/, "email"],
    [/pass|kennwort/, "password"],
    [/tel|phone|mobil|handy/, "phone"],
    [/vorname|first ?name|given/, "first_name"],
    [/nachname|last ?name|surname|family/, "last_name"],
    [/geburt|birth|dob/, "birth_date"],
    [/stra|street|addr/, "street"],
    [/haus?nr|house/, "house_number"],
    [/plz|zip|postal/, "zip"],
    [/ort|city|stadt/, "city"],
    [/land|country/, "country"],
    [/iban/, "iban"],
    [/beruf|occupation|job/, "occupation"],
    [/staat|nationalit/, "nationality"],
  ];
  for (const [re, key] of table) if (re.test(hay)) return key;
  return "";
}

function urlPattern(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/[0-9a-f-]{8,}(?=\/|$)/gi, "/*");
    return `${u.origin}${path}*`;
  } catch {
    return url;
  }
}

/**
 * Wandelt den Mitschnitt in einen kompakten, robusten Ablauf um:
 * Doppelklicks/Scroll-Rauschen zusammenfassen, Cookie-Banner optional machen,
 * eingegebene Werte durch Platzhalter ersetzen.
 */
export function cleanRecording(raw: RawRecordedStep[], startUrl?: string): CleanResult {
  const notes: string[] = [];
  const steps: CleanStep[] = [];
  const placeholders = new Set<string>();
  const events = [...raw].sort((a, b) => a.t - b.t);

  const first = startUrl || events.find((e) => e.url)?.url;
  if (first) steps.push({ action: "goto", value: first, label: "Startseite öffnen" });

  let unnamed = 0;
  let lastUrl = first ?? "";
  let removed = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const prev = events[i - 1];
    const selector = pickSelectors(e.selectors);

    // Seitenwechsel: nur merken, kein eigener Schritt (der Klick löst ihn aus).
    if (e.kind === "navigate") {
      if (e.url && e.url !== lastUrl) {
        const prevWasClick = prev && prev.kind === "click" && e.t - prev.t < 15000;
        if (prevWasClick) {
          steps.push({ action: "wait_for", url_pattern: urlPattern(e.url), label: "Auf nächste Seite warten" });
        } else {
          steps.push({ action: "goto", value: e.url, label: "Seite öffnen" });
        }
        lastUrl = e.url;
      }
      continue;
    }

    if (!selector) { removed++; continue; }

    if (e.kind === "submit") {
      if (prev && prev.kind === "click" && e.t - prev.t < 1500) { removed++; continue; }
      steps.push({ action: "click", selector, label: e.label || "Formular absenden" });
      continue;
    }

    if (e.kind === "click") {
      if (CONSENT_RE.test(e.label ?? "")) {
        if (!steps.some((s) => s.label === "Cookie-Banner")) {
          steps.push({ action: "click", selector, optional: true, label: "Cookie-Banner" });
        } else removed++;
        continue;
      }
      const last = steps[steps.length - 1];
      if (last?.action === "click" && last.selector === selector && prev && e.t - prev.t < 800) {
        removed++; continue; // Doppelklick
      }
      steps.push({ action: "click", selector, label: e.label || "Klick" });
      continue;
    }

    if (e.kind === "check") {
      steps.push({ action: "click", selector, label: e.label || "Auswahl setzen" });
      continue;
    }

    if (e.kind === "select") {
      steps.push({ action: "select", selector, value: e.sample ?? "", label: e.label || "Auswahl" });
      continue;
    }

    // Eingabe: mehrfaches Tippen ins selbe Feld zusammenfassen
    const key = guessPlaceholder(e) || `feld_${++unnamed}`;
    placeholders.add(key);
    const last = steps[steps.length - 1];
    if (last?.action === "fill" && last.selector === selector) {
      last.value = `{{${key}}}`;
      removed++;
      continue;
    }
    steps.push({ action: "fill", selector, value: `{{${key}}}`, label: e.label || key });
  }

  // Verifizierungs-/Abschluss-Bausteine anhängen
  steps.push({ action: "screenshot", label: "Stand sichern" });
  steps.push({
    action: "prompt",
    var_name: "verify_url",
    label: "Verifizierungslink aus der E-Mail einfügen",
  });
  steps.push({ action: "goto", value: "{{verify_url}}", label: "Verifizierungslink öffnen" });
  steps.push({ action: "handoff", label: "Übergabe an Admin (Legitimation)" });
  placeholders.add("verify_url");

  if (removed) notes.push(`${removed} überflüssige Ereignisse zusammengefasst oder entfernt.`);
  notes.push("Eingegebene Werte wurden durch Platzhalter ersetzt – keine Klartextdaten gespeichert.");
  notes.push("Instabile Selektoren wurden gefiltert, je Schritt bis zu drei Alternativen (||).");

  return { steps, notes, placeholders: [...placeholders] };
}
