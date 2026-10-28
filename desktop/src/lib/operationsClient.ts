import { api, tokenStore } from "@/integrations/desktop/client";
export async function operationsCall(action: string, payload: Record<string, unknown> = {}) {
  const result = await api.operations.call({ token: tokenStore.get(), action, payload });
  if (!result?.ok) throw new Error(result?.error || "تعذر تنفيذ العملية");
  return result;
}
