// Aufnahme-Modus: Admin startet eine Aufnahme, klickt den Antrag im eigenen
// Browser durch (Bookmarklet) und übernimmt den bereinigten Ablauf als Bot-Profil.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cleanRecording, type CleanStep, type RawRecordedStep } from "./recording-clean";

async function requireAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase
    .from("user_roles").select("role")
    .eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Nicht autorisiert");
}

/** SHA-256-Hex (Web Crypto, im Worker verfügbar). */
export async function hashToken(token: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface BotRecordingRow {
  id: string;
  name: string;
  start_url: string | null;
  status: string;
  profile_id: string | null;
  raw_steps: RawRecordedStep[];
  cleaned_steps: CleanStep[];
  created_at: string;
  expires_at: string;
}

const StartInput = z.object({
  name: z.string().min(1).max(160),
  start_url: z.string().url().max(500).optional().or(z.literal("")),
  profile_id: z.string().uuid().nullable().optional(),
});

/** Legt eine Aufnahme an und liefert Token + fertiges Bookmarklet zurück. */
export const startBotRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => StartInput.parse(i))
  .handler(async ({ data, context }): Promise<{ id: string; token: string }> => {
    await requireAdmin(context);
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const db = context.supabase as any;
    const { data: row, error } = await db.from("bot_recordings").insert({
      name: data.name,
      start_url: data.start_url || null,
      profile_id: data.profile_id || null,
      token_hash: await hashToken(token),
      created_by: context.userId,
      status: "recording",
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: String(row.id), token };
  });

export const listBotRecordings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: BotRecordingRow[] }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data, error } = await db
      .from("bot_recordings")
      .select("id, name, start_url, status, profile_id, raw_steps, cleaned_steps, created_at, expires_at")
      .order("created_at", { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as BotRecordingRow[] };
  });

/** Bereinigt den Mitschnitt und liefert Vorher/Nachher zurück. */
export const buildBotRecordingSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{
    steps: CleanStep[]; notes: string[]; placeholders: string[]; raw_count: number;
  }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { data: rec, error } = await db
      .from("bot_recordings").select("raw_steps, start_url").eq("id", data.id).single();
    if (error) throw new Error(error.message);
    const raw = (rec?.raw_steps ?? []) as RawRecordedStep[];
    const result = cleanRecording(raw, rec?.start_url ?? undefined);
    await db.from("bot_recordings")
      .update({ cleaned_steps: result.steps, status: "cleaned", updated_at: new Date().toISOString() })
      .eq("id", data.id);
    return { ...result, raw_count: raw.length };
  });

export const deleteBotRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_recordings").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Beendet die Aufnahme (der Recorder schreibt danach nichts mehr). */
export const stopBotRecording = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    await requireAdmin(context);
    const db = context.supabase as any;
    const { error } = await db.from("bot_recordings")
      .update({ status: "stopped", updated_at: new Date().toISOString() }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
