import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function isMissingLastSeenColumnError(error: { message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes("last_seen_at") && (
    message.includes("schema cache") ||
    message.includes("could not find") ||
    message.includes("column")
  );
}

const Schema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(500),
});

export type UserActivity = {
  last_sign_in_at: string | null;
  last_seen_at: string | null;
};

export type UserActivityResult = {
  activity: Record<string, UserActivity>;
  /** Fehlertext der Login-Quelle (auth.users via RPC), falls sie nicht verfügbar ist. */
  signInError: string | null;
  /** Fehlertext der Aktivitäts-Quelle (profiles.last_seen_at), falls sie nicht verfügbar ist. */
  seenError: string | null;
};

export const getLastSignIns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Schema.parse(input))
  .handler(async ({ data, context }): Promise<UserActivityResult> => {
    // Admin-Gate: nur Admins dürfen Login-Zeitstempel fremder User abfragen.
    const { data: roleRow, error: roleErr } = await (context.supabase as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) throw new Error(roleErr.message);
    if (!roleRow) throw new Error("Nicht autorisiert");

    const sb = context.supabase as any;

    // Beide Quellen unabhängig voneinander: fällt eine aus, bleibt die andere nutzbar.
    const [rpcRes, profRes] = await Promise.all([
      sb.rpc("get_last_sign_ins", { _user_ids: data.user_ids })
        .then((r: any) => r, (e: any) => ({ data: null, error: { message: String(e?.message ?? e) } })),
      sb.from("profiles").select("user_id, last_seen_at").in("user_id", data.user_ids)
        .then((r: any) => r, (e: any) => ({ data: null, error: { message: String(e?.message ?? e) } })),
    ]);

    const map: Record<string, UserActivity> = {};
    for (const id of data.user_ids) {
      map[id] = { last_sign_in_at: null, last_seen_at: null };
    }
    if (!rpcRes.error) {
      for (const r of (rpcRes.data ?? []) as Array<{ user_id: string; last_sign_in_at: string | null }>) {
        if (map[r.user_id]) map[r.user_id]!.last_sign_in_at = r.last_sign_in_at;
      }
    }
    if (!profRes.error) {
      for (const r of (profRes.data ?? []) as Array<{ user_id: string; last_seen_at: string | null }>) {
        if (map[r.user_id]) map[r.user_id]!.last_seen_at = r.last_seen_at;
      }
    }

    const seenError = profRes.error
      ? (isMissingLastSeenColumnError(profRes.error)
          ? "Spalte profiles.last_seen_at fehlt auf diesem System (Migration noch nicht eingespielt)."
          : String(profRes.error.message ?? profRes.error))
      : null;

    return {
      activity: map,
      signInError: rpcRes.error ? String(rpcRes.error.message ?? rpcRes.error) : null,
      seenError,
    };
  });

