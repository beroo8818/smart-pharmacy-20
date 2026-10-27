import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

type AuditPayload = {
  userId: string | null | undefined;
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: Json | null;
  newValue?: Json | null;
};

export async function logAudit({
  userId,
  action,
  entityType,
  entityId,
  oldValue = null,
  newValue = null,
}: AuditPayload) {
  if (!userId) return;
  const { error } = await supabase.from("audit_log").insert({
    user_id: userId,
    action,
    entity_type: entityType,
    entity_id: entityId ?? null,
    old_value: oldValue,
    new_value: newValue,
  });
  if (error) {
    console.warn("audit log skipped:", error.message);
  }
}
