// Aufklappbare Karte für einen Lauf, der auf einen Admin wartet:
// Screenshot, Seiten-Link, Lauf-Daten zum Kopieren, Rückfrage-Eingabe und Diagnose.
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBotArtifactUrl, resumeBotRun, type BotRunRow } from "@/lib/bots.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, ChevronRight, Copy, ExternalLink } from "lucide-react";

interface Props {
  run: BotRunRow;
  profileName: string;
  employeeName?: string | undefined;
  claimedByName?: string | undefined;
  onClaim: (release: boolean) => void;
  onDone: () => void;
  onDiagnose: () => void;
  onResumed?: (() => void) | undefined;
}


const FIELD_LABEL: Record<string, string> = {
  first_name: "Vorname",
  last_name: "Nachname",
  full_name: "Name",
  email: "E-Mail",
  phone: "Telefon",
  password: "Passwort",
  birthdate: "Geburtsdatum",
  street: "Straße",
  zip: "PLZ",
  city: "Ort",
};

export function BotHandoffCard({
  run, profileName, employeeName, claimedByName, onClaim, onDone, onDiagnose, onResumed,
}: Props) {
  const { toast } = useToast();
  const signUrl = useServerFn(getBotArtifactUrl);
  const resume = useServerFn(resumeBotRun);
  const [open, setOpen] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);

  async function submitAnswer() {
    if (!answer.trim()) return;
    setSending(true);
    try {
      await resume({ data: { id: run.id, value: answer.trim() } });
      toast({ title: "Antwort gespeichert", description: "Der Bot macht an der Pausenstelle weiter." });
      setAnswer("");
      onResumed?.();
    } catch (e: any) {
      toast({ title: "Fehler", description: e.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  }


  const claimed = !!run.claimed_by;

  useEffect(() => {
    let active = true;
    if (open && run.screenshot_path && !shot) {
      signUrl({ data: { path: run.screenshot_path } })
        .then((r) => { if (active) setShot(r.url); })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [open, run.screenshot_path, shot, signUrl]);

  const fields = Object.entries({ ...run.input_data, ...run.credentials })
    .filter(([, v]) => typeof v === "string" && v.length > 0);

  async function copy(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    toast({ title: `${label} kopiert` });
  }

  function takeOver() {
    onClaim(claimed);
    if (!claimed) {
      setOpen(true);
      if (run.handoff_url) window.open(run.handoff_url, "_blank", "noopener");
    }
  }

  return (
    <div className="text-xs border-t border-border pt-2">
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-left flex items-start gap-1.5 min-w-0"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
          <span className="min-w-0">
            <span className="font-medium">{profileName}</span>
            {employeeName && <span className="text-muted-foreground"> · {employeeName}</span>}
            {claimed && (
              <span className="text-status-info">
                {" "}· übernommen{claimedByName ? ` von ${claimedByName}` : ""}
                {run.claimed_at ? ` · ${new Date(run.claimed_at).toLocaleTimeString("de-DE")}` : ""}
              </span>
            )}
            <span className="block text-muted-foreground mt-0.5">
              {run.handoff_reason || "Manueller Schritt erforderlich"}
            </span>
          </span>
        </button>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={takeOver}>
            {claimed ? "Freigeben" : "Übernehmen"}
          </Button>
          <Button size="sm" className="h-7 text-xs" onClick={onDone}>Erledigt</Button>
        </div>
      </div>

      {run.pending_var && (
        <div className="mt-2 ml-5 rounded-lg border border-status-info/40 bg-status-info/5 p-2 space-y-1.5">
          <p className="font-medium text-foreground">
            {run.pending_prompt || `Bitte "${run.pending_var}" eingeben`}
          </p>
          <div className="flex gap-1.5">
            <Input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitAnswer(); }}
              placeholder={run.pending_var === "verify_url" ? "https://… (Link aus der E-Mail)" : "Wert eingeben"}
              className="h-8 text-xs"
            />
            <Button size="sm" className="h-8 text-xs" disabled={sending || !answer.trim()} onClick={submitAnswer}>
              {sending ? "…" : "Weiter"}
            </Button>
          </div>
          <p className="text-muted-foreground">
            Der Bot setzt danach automatisch ab Schritt {(run.resume_step ?? 0) + 1} fort – eingeloggt, ohne Neustart.
          </p>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 pl-5">

          <div className="flex flex-wrap gap-2">
            {run.handoff_url && (
              <Button
                size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                onClick={() => window.open(run.handoff_url!, "_blank", "noopener")}
              >
                <ExternalLink className="h-3 w-3" /> Seite öffnen
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onDiagnose}>
              Diagnose
            </Button>
            {run.handoff_url && (
              <Button
                size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                onClick={() => copy(run.handoff_url!, "Link")}
              >
                <Copy className="h-3 w-3" /> Link kopieren
              </Button>
            )}
          </div>

          {fields.length > 0 && (
            <div className="rounded-lg border bg-muted/20 p-2 space-y-1">
              <p className="font-medium text-foreground">Daten für die manuelle Bearbeitung</p>
              {fields.map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">{FIELD_LABEL[k] ?? k}</span>
                  <span className="flex items-center gap-1 min-w-0">
                    <code className="truncate max-w-[240px]">{v}</code>
                    <Button
                      size="sm" variant="ghost" className="h-6 w-6 p-0"
                      onClick={() => copy(String(v), FIELD_LABEL[k] ?? k)}
                      aria-label={`${FIELD_LABEL[k] ?? k} kopieren`}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                  </span>
                </div>
              ))}
              {run.vorgangsnummer && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Vorgangsnummer</span>
                  <code>{run.vorgangsnummer}</code>
                </div>
              )}
            </div>
          )}

          {run.screenshot_path ? (
            shot ? (
              <a href={shot} target="_blank" rel="noopener noreferrer" className="block">
                <img
                  src={shot}
                  alt={`Screenshot des Bot-Laufs für ${profileName}`}
                  loading="lazy"
                  className="rounded-lg border max-h-72 w-auto"
                />
                <span className="text-muted-foreground">Screenshot in voller Größe öffnen</span>
              </a>
            ) : (
              <p className="text-muted-foreground">Screenshot wird geladen …</p>
            )
          ) : (
            <p className="text-muted-foreground">Für diesen Lauf wurde kein Screenshot gespeichert.</p>
          )}
        </div>
      )}
    </div>
  );
}
