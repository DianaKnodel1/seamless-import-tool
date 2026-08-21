// Nimmt Schritte des Browser-Recorders entgegen. Öffentlich erreichbar, aber
// nur mit gültigem, kurzlebigem Aufnahme-Token (SHA-256-Hash in der DB).
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const StepSchema = z.object({
  t: z.number(),
  kind: z.enum(["click", "input", "select", "check", "submit", "navigate"]),
  url: z.string().max(2000).optional().default(""),
  selectors: z.array(z.string().max(400)).max(6).optional(),
  label: z.string().max(120).optional(),
  tag: z.string().max(20).optional(),
  type: z.string().max(30).optional(),
  name: z.string().max(120).optional(),
  guess: z.string().max(40).optional(),
  sample: z.string().max(60).optional(),
  checked: z.boolean().optional(),
});

const Body = z.object({
  token: z.string().min(20).max(128).regex(/^[a-f0-9]+$/i),
  steps: z.array(StepSchema).max(200),
  final: z.boolean().optional().default(false),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/bot-recordings")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let payload: unknown;
        try { payload = await request.json(); } catch { return json({ ok: false }, 400); }
        const parsed = Body.safeParse(payload);
        if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tokenHash = await sha256(parsed.data.token);
        const { data: rec } = await supabaseAdmin
          .from("bot_recordings")
          .select("id, raw_steps, status, expires_at")
          .eq("token_hash", tokenHash)
          .maybeSingle();

        const row = rec as any;
        if (!row) return json({ ok: false, error: "not_found" }, 404);
        if (row.status === "stopped" || new Date(row.expires_at).getTime() < Date.now()) {
          return json({ ok: false, error: "expired" }, 410);
        }

        const merged = [...((row.raw_steps ?? []) as unknown[]), ...parsed.data.steps].slice(-1500);
        const { error } = await supabaseAdmin
          .from("bot_recordings")
          .update({
            raw_steps: merged,
            status: parsed.data.final ? "stopped" : "recording",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        if (error) {
          console.error("[bot-recordings] update error:", error.message);
          return json({ ok: false }, 500);
        }
        return json({ ok: true, count: merged.length });
      },
    },
  },
});
