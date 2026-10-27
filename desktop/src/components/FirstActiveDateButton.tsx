import { useState } from "react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Lets the user mark when an item was first introduced.
 * Used by continuous analysis to compute a more accurate ADC.
 */
export default function FirstActiveDateButton({
  itemCode,
  itemName,
  currentDate,
  variant = "outline",
  size = "sm",
  className,
}: {
  itemCode: string | null | undefined;
  itemName?: string | null;
  currentDate?: string | null;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(currentDate ? new Date(currentDate) : undefined);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  async function save(d: Date | undefined) {
    if (!itemCode) {
      toast.error("لا يوجد كود لهذا الصنف — لا يمكن حفظ التاريخ.");
      return;
    }
    if (!d) return;
    setSaving(true);
    try {
      const iso = format(d, "yyyy-MM-dd");
      const { error } = await (supabase as any)
        .from("item_master")
        .update({ first_active_date: iso })
        .eq("item_code", itemCode);
      if (error) throw error;
      toast.success(`تم تحديد تاريخ بداية استخدام ${itemName || itemCode}`);
      setOpen(false);
      // Refresh any continuous analysis queries
      qc.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && (k.includes("continuous") || k.includes("alerts") || k.includes("dashboard"));
      }});
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || "فشل الحفظ");
    } finally { setSaving(false); }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size={size}
          className={cn("gap-2", className)}
          disabled={saving}
        >
          {currentDate ? <CalendarIcon className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {currentDate
            ? `تاريخ البداية: ${currentDate}`
            : "تحديد تاريخ بداية الاستخدام"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => { setDate(d); save(d); }}
          disabled={(d) => d > new Date()}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}