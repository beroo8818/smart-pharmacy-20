import { supabase } from "@/integrations/supabase/client";
import {notifyInventoryChanged} from '../../shared/inventoryRefresh';
export async function operationsCall(action: string, payload: Record<string, unknown> = {}) {
  const { data, error } = await supabase.rpc("hospital_operations" as any, { p_action: action, p_payload: payload } as any);
  if (error) throw new Error(error.message);
  const result = data as any;
  if (!result?.ok) throw new Error(result?.error || "تعذر تنفيذ العملية");
  if (['submit','save_import','access_save','assign','revoke','dictionary_create'].includes(action) && !result.requiresRevision && !result.duplicate) notifyInventoryChanged();
  return result;
}
