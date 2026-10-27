import { loadContinuousAnalysis, type ProjectedRow } from "@/lib/continuousAnalysis";
import { useEffect, useMemo, useState } from "react";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, fmtMonth, fmtNum, loadLatestDataset, suggestTransfers, normalize } from "@/lib/desktopAnalytics";
import ItemIdentity from "@/components/ItemIdentity";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeft } from "lucide-react";

export default function Transfers() {
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [rows, setRows] = useState<ProjectedRow[]>([]);
  const [target, setTarget] = useState(30);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    (async () => {
      const d = await loadContinuousAnalysis({ targetDays: target, groupBy: "sku" });
      setBatch(d.latestBatch);
      setRows(d.rows);
      setLoading(false);
    })();
  }, [target]);

  const transfers = useMemo(
    () => suggestTransfers(rows, target),
    [rows, target]
  );

  const filtered = useMemo(() => {
    const s = normalize(q);
    if (!s) return transfers;
    return transfers.filter((x) =>
      normalize(`${x.itemName} ${x.tradeNames?.join(" ")} ${x.itemCode || ""} ${x.from} ${x.to}`).includes(s)
    );
  }, [transfers, q]);

  const noData = !loading && !batch;

  return (
    <div className="p-8 max-w-[1600px]">
      <PageHeader
        title="التحويلات المقترحة"
        description="اقتراح نقل الفائض لتغطية النقص بناءً على هدف التغطية المحدد."
      />

      <Card className="p-5 mb-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
            >
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input
              placeholder="اسم الصنف أو الصيدلية..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {batch && (
        <Card className="p-4 mb-4 text-sm border-primary/20 bg-primary/5">
          <div className="font-medium text-primary">
            مصدر التحليل: ملف {batch.file_name}، شهر {fmtMonth(batch.month)}، عدد الصفوف {fmtNum(batch.row_count)}
          </div>
        </Card>
      )}

      <Card className="p-5">
        {loading ? (
          <div className="text-muted-foreground">جارٍ التحميل...</div>
        ) : noData ? (
          <div className="text-muted-foreground text-center py-8">لا توجد بيانات محفوظة. ارفع ملفًا أولًا.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد تحويلات مقترحة بناءً على هدف التغطية الحالي.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-right p-2 min-w-[280px] w-[26%]">المادة العلاجية</th>
                  <th className="text-right p-2 min-w-[140px]">من</th>
                  <th className="text-right p-2"></th>
                  <th className="text-right p-2 min-w-[140px]">إلى</th>
                  <th className="text-right p-2">الكمية</th>
                  <th className="text-right p-2 min-w-[260px]">السبب</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                    <td className="p-2 font-medium align-top min-w-[280px] max-w-[420px]">
                      <ItemIdentity name={s.itemName} tradeNames={s.tradeNames} code={s.itemCode} />
                    </td>
                    <td className="p-2 align-top whitespace-normal break-words" dir="auto">
                      <div>{s.from}</div>
                    </td>
                    <td className="p-2 align-top">
                      <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                    </td>
                    <td className="p-2 align-top whitespace-normal break-words" dir="auto">{s.to}</td>
                    <td className="p-2 font-bold align-top whitespace-nowrap">{fmtNum(s.qty)}</td>
                    <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
