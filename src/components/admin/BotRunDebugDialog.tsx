// Zeigt die Diagnosedaten eines fehlgeschlagenen Bot-Schritts:
// Screenshot, Seiten-HTML, Playwright-Trace und Selektor-Vorschläge.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getBotArtifactUrl, type BotRunDebug, type BotRunRow } from "@/lib/bots.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  run: BotRunRow | null;
  onClose: () => void;
}

export function BotRunDebugDialog({ run, onClose }: Props) {
  const signUrl = useServerFn(getBotArtifactUrl);
  const [busy, setBusy] = useState<string | null>(null);
  const debug = (run?.debug ?? null) as BotRunDebug | null;

  async function open(path: string) {
    setBusy(path);
    try {
      const { url } = await signUrl({ data: { path } });
      if (url) window.open(url, "_blank", "noopener");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={!!run} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Diagnose zum Lauf</DialogTitle>
        </DialogHeader>

        {!debug ? (
          <p className="text-sm text-muted-foreground py-4">
            Für diesen Lauf liegen keine Diagnosedaten vor. Sie entstehen automatisch, sobald ein
            Schritt fehlschlägt.
          </p>
        ) : (
          <div className="space-y-4 py-2 text-sm">
            <div className="rounded-lg border bg-muted/20 p-3 space-y-1 text-xs">
              <p><span className="text-muted-foreground">Schritt:</span> {debug.step} ({debug.action})</p>
              <p className="break-all"><span className="text-muted-foreground">Selektor:</span> <code>{debug.selector || "–"}</code></p>
              <p className="break-all"><span className="text-muted-foreground">Seite:</span> {debug.url || "–"}</p>
              {debug.title && <p><span className="text-muted-foreground">Titel:</span> {debug.title}</p>}
              {debug.error && <p className="text-destructive break-all">{debug.error}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              {run?.screenshot_path && (
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={busy === run.screenshot_path}
                  onClick={() => open(run.screenshot_path!)}>
                  Screenshot öffnen
                </Button>
              )}
              {debug.html_path && (
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={busy === debug.html_path}
                  onClick={() => open(debug.html_path!)}>
                  Seiten-HTML öffnen
                </Button>
              )}
              {debug.trace_path && (
                <Button size="sm" variant="outline" className="h-7 text-xs"
                  disabled={busy === debug.trace_path}
                  onClick={() => open(debug.trace_path!)}>
                  Trace herunterladen
                </Button>
              )}
            </div>

            {(debug.candidates?.length ?? 0) > 0 && (
              <div>
                <h3 className="text-xs font-semibold mb-2">
                  Sichtbare Elemente auf der Seite – als Selektor ins Bot-Profil kopieren
                </h3>
                <div className="border rounded-lg overflow-hidden">
                  <table className="w-full text-[11px]">
                    <thead className="bg-muted/30">
                      <tr>
                        {["Element", "Beschriftung", "Selektor-Vorschlag"].map((h) => (
                          <th key={h} className="text-left px-2 py-1.5 font-medium text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {debug.candidates!.map((c, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-2 py-1 font-mono">{c.tag}{c.type ? `[${c.type}]` : ""}</td>
                          <td className="px-2 py-1">{c.text || c.aria || "–"}</td>
                          <td className="px-2 py-1 font-mono break-all">
                            {c.selector || (c.text ? `text=${c.text}` : "–")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">
                  Tipp: Mehrere Alternativen im Profil mit <code>||</code> trennen, z. B.{" "}
                  <code>#weiter || text=Weiter</code>. Der Bot nimmt den ersten Treffer.
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
