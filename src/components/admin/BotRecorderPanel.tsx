// Aufnahme-Modus: Admin klickt den Antrag im eigenen Browser durch,
// der Mitschnitt wird bereinigt und als Bot-Profil übernommen.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  startBotRecording, listBotRecordings, buildBotRecordingSteps,
  deleteBotRecording, stopBotRecording, importBotRecordingSteps,
} from "@/lib/bot-recordings.functions";

import { saveBotProfile, type BotProfileRow, type BotStep } from "@/lib/bots.functions";
import type { CleanStep } from "@/lib/recording-clean";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Copy, Trash2, Circle, Square } from "lucide-react";

interface Props {
  profiles: BotProfileRow[];
  onSaved: () => void;
}

function bookmarklet(origin: string, token: string) {
  return `javascript:(function(){var s=document.createElement('script');s.src='${origin}/api/public/bot-recorder-script?t=${token}&_='+Date.now();document.body.appendChild(s);})();`;
}

export function BotRecorderPanel({ profiles, onSaved }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const start = useServerFn(startBotRecording);
  const load = useServerFn(listBotRecordings);
  const build = useServerFn(buildBotRecordingSteps);
  const stop = useServerFn(stopBotRecording);
  const remove = useServerFn(deleteBotRecording);
  const importSteps = useServerFn(importBotRecordingSteps);
  const saveProfile = useServerFn(saveBotProfile);

  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; steps: CleanStep[]; notes: string[]; raw: number } | null>(null);
  const [json, setJson] = useState("");
  const [pasteFor, setPasteFor] = useState<string | null>(null);
  const [pasteJson, setPasteJson] = useState("");


  const listQ = useQuery({
    queryKey: ["bot-recordings"],
    queryFn: () => load(),
    refetchInterval: 6000,
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  const startM = useMutation({
    mutationFn: () => start({ data: { name: name || "Aufnahme", start_url: startUrl } }),
    onSuccess: (r) => {
      setToken(r.token);
      qc.invalidateQueries({ queryKey: ["bot-recordings"] });
      toast({ title: "Aufnahme bereit", description: "Lesezeichen anlegen und auf der Bankseite anklicken." });
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const buildM = useMutation({
    mutationFn: (id: string) => build({ data: { id } }),
    onSuccess: (r, id) => {
      setPreview({ id, steps: r.steps, notes: r.notes, raw: r.raw_count });
      setJson(JSON.stringify(r.steps, null, 2));
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const saveM = useMutation({
    mutationFn: async (target: { profile: BotProfileRow | null; recName: string }) => {
      let steps: BotStep[];
      try { steps = JSON.parse(json); } catch (e: any) { throw new Error(`JSON ungültig: ${e.message}`); }
      const first = steps.find((s) => s.action === "goto");
      return saveProfile({
        data: {
          ...(target.profile ? { id: target.profile.id } : {}),
          name: target.profile?.name ?? target.recName,
          provider_key: target.profile?.provider_key ??
            (target.recName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "aufnahme"),
          start_url: target.profile?.start_url ?? String(first?.value ?? startUrl ?? "https://example.com"),
          description: "Aus Browser-Aufnahme erstellt.",
          handoff_note: "",
          steps,
          is_active: true,
        },
      });
    },
    onSuccess: () => {
      toast({ title: "Profil gespeichert", description: "Der Ablauf steht jetzt als Bot-Profil bereit." });
      setPreview(null); onSaved();
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const importM = useMutation({
    mutationFn: (v: { id: string; json: string }) => importSteps({ data: v }),
    onSuccess: (r) => {
      toast({ title: "Schritte übernommen", description: `${r.count} Ereignisse gespeichert.` });
      setPasteFor(null); setPasteJson("");
      qc.invalidateQueries({ queryKey: ["bot-recordings"] });
    },
    onError: (e: any) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  const rows = listQ.data?.rows ?? [];


  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">Neue Aufnahme</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deutsche Bank – Girokonto" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Start-URL (optional)</Label>
            <Input value={startUrl} onChange={(e) => setStartUrl(e.target.value)} placeholder="https://…" />
          </div>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startM.mutate()} disabled={startM.isPending}>
          <Circle className="h-3 w-3 fill-current" /> Aufnahme starten
        </Button>

        {token && (
          <div className="rounded-lg border border-status-info/40 bg-status-info/5 p-3 space-y-2 text-xs">
            <p className="font-medium text-foreground">So nimmst du auf</p>
            <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
              <li>Ziehe diesen Link in deine Lesezeichenleiste (oder kopiere ihn als Lesezeichen-Adresse):</li>
            </ol>
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
              <a
                href={bookmarklet(origin, token)}
                onClick={(e) => e.preventDefault()}
                className="inline-flex items-center rounded-md border bg-background px-2 py-1 font-medium"
              >
                Bot-Aufnahme
              </a>
              <Button
                size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                onClick={() => {
                  navigator.clipboard.writeText(bookmarklet(origin, token));
                  toast({ title: "Lesezeichen-Code kopiert" });
                }}
              >
                <Copy className="h-3 w-3" /> Code kopieren
              </Button>
            </div>
            <ol start={2} className="list-decimal ml-4 space-y-1 text-muted-foreground">
              <li>Bankseite öffnen, Lesezeichen „Bot-Aufnahme" anklicken – unten rechts erscheint die Leiste.</li>
              <li>Antrag ganz normal ausfüllen. Eingegebene Werte werden <strong>nicht</strong> gespeichert, nur die Felder.</li>
              <li>Auf „Stopp" klicken und hier unten „Ablauf erzeugen" wählen.</li>
            </ol>
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4 space-y-2">
        <h3 className="text-sm font-semibold">Aufnahmen</h3>
        {rows.length === 0 && <p className="text-xs text-muted-foreground">Noch keine Aufnahmen.</p>}
        {rows.map((r) => (
          <div key={r.id} className="border-t pt-2 text-xs space-y-2">
            <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-medium">{r.name}</span>
              <Badge variant="secondary" className="ml-2 text-[10px]">{r.status}</Badge>
              <p className="text-muted-foreground mt-0.5">
                {(r.raw_steps?.length ?? 0)} Ereignisse · {new Date(r.created_at).toLocaleString("de-DE")}
              </p>
            </div>
            <div className="flex gap-1.5 shrink-0">
              {r.status === "recording" && (
                <Button
                  size="sm" variant="outline" className="h-7 text-xs gap-1"
                  onClick={async () => { await stop({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["bot-recordings"] }); }}
                >
                  <Square className="h-3 w-3" /> Stoppen
                </Button>
              )}
              <Button
                size="sm" variant="outline" className="h-7 text-xs"
                onClick={() => { setPasteFor(pasteFor === r.id ? null : r.id); setPasteJson(""); }}
              >
                Schritte einfügen
              </Button>
              <Button
                size="sm" className="h-7 text-xs"
                onClick={() => buildM.mutate(r.id)}
                disabled={buildM.isPending || (r.raw_steps?.length ?? 0) === 0}
              >
                Ablauf erzeugen
              </Button>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={async () => { await remove({ data: { id: r.id } }); qc.invalidateQueries({ queryKey: ["bot-recordings"] }); }}
                aria-label="Aufnahme löschen"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
            </div>
            {pasteFor === r.id && (
              <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2">
                <p className="text-[11px] text-muted-foreground">
                  Falls die Bankseite das Senden blockiert: in der Recorder-Leiste auf „Kopieren“ klicken und den Text hier einfügen.
                </p>
                <Textarea
                  rows={4} className="font-mono text-[11px]" value={pasteJson}
                  onChange={(e) => setPasteJson(e.target.value)}
                  placeholder='[{"t":…,"kind":"click", …}]'
                />
                <Button
                  size="sm" className="h-7 text-xs"
                  disabled={importM.isPending || pasteJson.trim().length < 2}
                  onClick={() => importM.mutate({ id: r.id, json: pasteJson })}
                >
                  Übernehmen
                </Button>
              </div>
            )}
          </div>
        ))}

      </div>

      {preview && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Bereinigter Ablauf</h3>
            <span className="text-xs text-muted-foreground">
              {preview.raw} Ereignisse → {preview.steps.length} Schritte
            </span>
          </div>
          <ul className="text-[11px] text-muted-foreground list-disc ml-4 space-y-0.5">
            {preview.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
          <ol className="text-xs space-y-1">
            {preview.steps.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-muted-foreground w-6 shrink-0">{i + 1}.</span>
                <span className="min-w-0">
                  <Badge variant="outline" className="text-[10px] mr-1.5">{s.action}</Badge>
                  {s.label}
                  {s.selector && <code className="ml-1 text-muted-foreground break-all">{s.selector}</code>}
                  {s.value && <code className="ml-1">{s.value}</code>}
                  {s.optional && <span className="ml-1 text-muted-foreground">(optional)</span>}
                </span>
              </li>
            ))}
          </ol>
          <div className="space-y-1.5">
            <Label className="text-xs">Feinschliff (JSON)</Label>
            <Textarea rows={10} className="font-mono text-xs" value={json} onChange={(e) => setJson(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm" className="h-8 text-xs"
              onClick={() => saveM.mutate({ profile: null, recName: rows.find((r) => r.id === preview.id)?.name ?? "Aufnahme" })}
              disabled={saveM.isPending}
            >
              Als neues Profil speichern
            </Button>
            {profiles.map((p) => (
              <Button
                key={p.id} size="sm" variant="outline" className="h-8 text-xs"
                onClick={() => saveM.mutate({ profile: p, recName: p.name })}
                disabled={saveM.isPending}
              >
                In „{p.name}" übernehmen
              </Button>
            ))}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setPreview(null)}>
              Verwerfen
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
