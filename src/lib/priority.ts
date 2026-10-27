import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Priority = "very_urgent" | "urgent" | "watch" | "low";

export const PRIO_ORDER: Priority[] = ["very_urgent", "urgent", "watch", "low"];

export const PRIO_LABEL: Record<Priority, string> = {
  very_urgent: "عاجل جدًا",
  urgent: "عاجل",
  watch: "متابعة",
  low: "منخفض",
};

// Colors per spec:
// - dark red for very_urgent
// - red for urgent
// - yellow for watch
// - gray for low
export const PRIO_CLASS: Record<Priority, string> = {
  very_urgent: "bg-[hsl(0_84%_30%)] text-white border border-[hsl(0_84%_25%)]",
  urgent: "bg-destructive/15 text-destructive border border-destructive/40",
  watch: "bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40",
  low: "bg-muted text-muted-foreground border border-border",
};

export const PRIO_RANK: Record<Priority, number> = { very_urgent: 0, urgent: 1, watch: 2, low: 3 };

function bumpUp(p: Priority): Priority {
  if (p === "low") return "watch";
  if (p === "watch") return "urgent";
  if (p === "urgent") return "very_urgent";
  return "very_urgent";
}

export type PriorityKind =
  | "critical" | "danger" | "below" | "safe" | "over" | "very_over" | "deadstock" | "no_data";

export interface PriorityInput {
  days: number | null;
  kind?: PriorityKind | string;
  targetDays?: number;
  isVital?: boolean;
  /** No main-store availability AND no donor branch available */
  noMainNoDonor?: boolean;
  /** Expiry within ~60 days for deadstock/over override (optional) */
  nearExpiry?: boolean;
}

export function computePriority(inp: PriorityInput): Priority {
  const { days, kind, targetDays = 30, isVital, noMainNoDonor, nearExpiry } = inp;
  let base: Priority;
  if (days != null && days < 7) base = "very_urgent";
  else if (days != null && days < 14) base = "urgent";
  else if (days != null && days < targetDays) base = "watch";
  else if (kind === "over" || kind === "very_over" || kind === "deadstock") {
    base = nearExpiry ? "watch" : "low";
  } else if (kind === "no_data") base = "low";
  else base = "low";

  if (isVital) base = bumpUp(base);
  if (noMainNoDonor) base = "very_urgent";
  return base;
}

function normalizeCode(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/** Loads Vital item codes/names from item_master.ven_class. */
export function useVitalSet() {
  const q = useQuery({
    queryKey: ["item_master_vital"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("item_master")
        .select("item_code,item_name_ar,item_name_en,ven_class")
        .range(0, 49999);
      if (error) return new Set<string>();
      const set = new Set<string>();
      for (const r of (data || []) as any[]) {
        const v = String(r.ven_class || "").trim().toLowerCase();
        if (v === "v" || v === "vital" || v.includes("حيوي") || v.includes("vit")) {
          if (r.item_code) set.add(normalizeCode(r.item_code));
          if (r.item_name_ar) set.add(normalizeCode(r.item_name_ar));
          if (r.item_name_en) set.add(normalizeCode(r.item_name_en));
        }
      }
      return set;
    },
  });
  const vitalSet = q.data || new Set<string>();
  const isVital = (code: string | null | undefined, name?: string | null) => {
    if (code && vitalSet.has(normalizeCode(code))) return true;
    if (name && vitalSet.has(normalizeCode(name))) return true;
    return false;
  };
  return { vitalSet, isVital };
}

/** Priority filter shared UI helper — returns the option list for a <select>. */
export const PRIO_FILTER_OPTIONS: { value: "all" | Priority; label: string }[] = [
  { value: "all", label: "كل الأولويات" },
  { value: "very_urgent", label: PRIO_LABEL.very_urgent },
  { value: "urgent", label: PRIO_LABEL.urgent },
  { value: "watch", label: PRIO_LABEL.watch },
  { value: "low", label: PRIO_LABEL.low },
];