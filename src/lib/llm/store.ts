import "server-only";
import { db } from "../db";
import type { Cooldown, LlmStore, Slot } from "./router";
import { slotKey } from "./router";

/** Cooldowns and per-day usage persisted in Postgres, shared across invocations. */
export class DbLlmStore implements LlmStore {
  async loadCooldowns() {
    const { data, error } = await db()
      .from("llm_cooldowns")
      .select("provider, model, key_id, until, level, last_error")
      .gt("until", new Date().toISOString());
    if (error) throw new Error(error.message);
    const map = new Map<string, Cooldown>();
    for (const r of data ?? []) {
      map.set(slotKey({ provider: r.provider, model: r.model, keyId: r.key_id }), {
        until: new Date(r.until).getTime(),
        level: r.level,
        lastError: r.last_error ?? undefined,
      });
    }
    return map;
  }

  async loadUsageToday() {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await db().from("llm_usage").select("provider, model, key_id, requests").eq("day", today);
    if (error) throw new Error(error.message);
    const map = new Map<string, number>();
    for (const r of data ?? []) map.set(slotKey({ provider: r.provider, model: r.model, keyId: r.key_id }), r.requests);
    return map;
  }

  async saveCooldown(slot: Slot, c: Cooldown | null) {
    const q = db().from("llm_cooldowns");
    if (!c) {
      await q.delete().match({ provider: slot.provider, model: slot.model, key_id: slot.keyId });
      return;
    }
    await q.upsert({
      provider: slot.provider,
      model: slot.model,
      key_id: slot.keyId,
      until: new Date(c.until).toISOString(),
      level: c.level,
      last_error: c.lastError ?? null,
      updated_at: new Date().toISOString(),
    });
  }

  async recordUsage(slot: Slot, ok: boolean) {
    await db().rpc("llm_record", { p_provider: slot.provider, p_model: slot.model, p_key_id: slot.keyId, p_ok: ok });
  }
}
