import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Simple SHA-256 hash for the PIN (family-only app; not high-value credential)
async function hashPin(pin: string): Promise<string> {
  const enc = new TextEncoder().encode(pin);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const getParentSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("parent_settings")
      .select("parent_id, pin_hash, dyslexia_font, active_learner_id")
      .eq("parent_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      // Create if missing (defensive; the trigger should have created it)
      const { data: created, error: cerr } = await context.supabase
        .from("parent_settings")
        .insert({ parent_id: context.userId })
        .select()
        .single();
      if (cerr) throw new Error(cerr.message);
      return { ...created, has_pin: false };
    }
    return { ...data, has_pin: !!data.pin_hash };
  });

export const setPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pin: string }) => z.object({ pin: z.string().regex(/^\d{4}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const hash = await hashPin(data.pin);
    const { error } = await context.supabase
      .from("parent_settings")
      .update({ pin_hash: hash })
      .eq("parent_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const verifyPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pin: string }) => z.object({ pin: z.string().regex(/^\d{4}$/) }).parse(d))
  .handler(async ({ data, context }) => {
    const hash = await hashPin(data.pin);
    const { data: row } = await context.supabase
      .from("parent_settings")
      .select("pin_hash")
      .eq("parent_id", context.userId)
      .maybeSingle();
    return { ok: row?.pin_hash === hash };
  });

export const setActiveLearner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("parent_settings")
      .update({ active_learner_id: data.learner_id })
      .eq("parent_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

