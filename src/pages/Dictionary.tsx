import PageHeader from "@/components/PageHeader";
import DataSourceCard from "@/components/DataSourceCard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchLatestBatch, fetchMovementsByBatch, normalize, itemKey as makeKey,
} from "@/lib/batchAnalysis";
import { fmtNum } from "@/lib/format";

export default function Dictionary() {
  const [q, setQ] = useState("");

  const batchQ = useQuery({ queryKey: ["latest-batch-dict"], queryFn: fetchLatestBatch });
  const batch = batchQ.data || null;
  const movQ = useQuery({
    queryKey: ["movements-dict", batch?.id],
    enabled: !!batch?.id,
    queryFn: () => fetchMovementsByBatch(batch!.id),
  });
  const movements = movQ.data || [];
  const loading = batchQ.isLoading || movQ.isLoading;

  const items = useMemo(() => {
    const map = new Map<string, { key: string; name: string; code: string | null; sci: string | null; unit: string | null; locations: Set<string> }>();
    for (const m of movements) {
      const k = makeKey(m as any);
      const cur = map.get(k);
      if (!cur) {
        map.set(k, {
          key: k,
          name: m.item_name || m.trade_name || m.scientific_name || m.item_code || "—",
          code: m.item_code, sci: m.scientific_name, unit: m.unit,
          locations: new Set([m.location_name]),
        });
      } else cur.locations.add(m.location_name);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [movements]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    if (!s) return items;
    return items.filter((i) => normalize(`${i.name} ${i.code || ""} ${i.sci || ""}`).includes(s));
  }, [items, q]);

  return (
    <div className="p-8 max-w-[1400px]">
      <PageHeader title="قاموس الأصناف" description="كل الأصناف الموجودة في آخر ملف محفوظ مع المادة الفعالة والصيدليات." />
      <DataSourceCard batch={batch} loading={loading} rowsCount={movements.length} />

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <Input
            placeholder="ابحث بالاسم أو المادة الفعالة أو الكود..."
            value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md"
          />
          <div className="text-xs text-muted-foreground">عدد الأصناف: {fmtNum(filtered.length)}</div>
        </div>
        {loading ? <div className="text-muted-foreground">جارٍ التحميل...</div> : (
          <div className="overflow-auto max-h-[640px] border rounded">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b sticky top-0 bg-background">
                <tr>
                  <th className="text-right p-2">الكود</th>
                  <th className="text-right p-2">اسم الصنف</th>
                  <th className="text-right p-2">المادة الفعالة</th>
                  <th className="text-right p-2">الوحدة</th>
                  <th className="text-right p-2">الصيدليات</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.key} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="p-2 font-mono text-[11px]" dir="ltr">{i.code || "—"}</td>
                    <td className="p-2" dir="auto">{i.name}</td>
                    <td className="p-2">{i.sci || "—"}</td>
                    <td className="p-2">{i.unit || "—"}</td>
                    <td className="p-2">{i.locations.size}</td>
                    <td className="p-2">
                      <Link to={`/items/${encodeURIComponent(i.key)}`} className="text-primary text-xs">تحليل</Link>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">لا توجد نتائج</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
