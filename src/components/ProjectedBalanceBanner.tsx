import { Card } from "@/components/ui/card";
import { AlertTriangle, CalendarClock, Activity, ShieldCheck } from "lucide-react";
import type { ContinuousDataset } from "@/lib/continuousAnalysis";
import { todayISO } from "../../shared/inventoryHistory";
import { CONFIDENCE_CLASS, CONFIDENCE_LABEL, type Confidence } from "@/lib/continuousAnalysis";
import { fmtNum } from "@/lib/format";

function dominantConfidence(rows: ContinuousDataset["rows"]): Confidence {
  if (!rows.length) return "weak";
  const counts: Record<Confidence, number> = { high: 0, medium: 0, low: 0, weak: 0 };
  rows.forEach((r) => counts[r.confidence]++);
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as Confidence);
}

/**
 * Daily projected-balance status banner.
 * Shows: last snapshot, snapshot date, days since, projected total, confidence.
 * Warns when snapshot is older than 7 days.
 */
export default function ProjectedBalanceBanner({
  dataset,
}: { dataset: ContinuousDataset | undefined | null }) {
  if (!dataset || !dataset.latestBatch) return null;
  const dates = dataset.rows.filter(r=>r.hasBalance).map(r=>r.snapshotDate).filter(Boolean).sort();
  const snapshotDate = dates[0] || null;
  const today = todayISO();
  const daysSince = snapshotDate ? Math.max(0,Math.floor((Date.parse(today)-Date.parse(snapshotDate))/86400000)) : 0;
  const conf = dominantConfidence(dataset.rows);
  const stale = daysSince > 7;

  return (
    <Card className="p-5 mb-4 border-primary/20">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" />
          <h3 className="font-bold">حالة بيانات الرصيد</h3>
        </div>
        <span className={`px-2 py-1 rounded text-xs border ${CONFIDENCE_CLASS[conf]}`}>
          <ShieldCheck className="w-3 h-3 inline ml-1" />
          {CONFIDENCE_LABEL[conf]}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Cell label="سجلات الأصناف والمواقع" value={fmtNum(dataset.rows.length)} />
        <Cell label="أقدم تاريخ رصيد مستخدم" value={snapshotDate || "—"} />
        <Cell label="عمر أقدم رصيد" value={`${daysSince} يوم`} tone={stale ? "warn" : undefined} />
        <Cell label="سجلات تحتاج مراجعة" value={fmtNum(dataset.rows.filter((row) => row.kind === "no_data").length)} highlight />
        <Cell label="درجة الثقة" value={CONFIDENCE_LABEL[conf]} />
      </div>

      {stale && (
        <div className="mt-4 flex items-center gap-2 p-3 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-sm">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <div>
            <b>الرصيد قديم</b> — مر <b>{daysSince}</b> يومًا على آخر تحديث.
            يفضل تحديث الرصيد أو رفع ملف جديد لضمان دقة التوقعات.
          </div>
        </div>
      )}

      <div className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
        <CalendarClock className="w-3 h-3" />
        المعروض: الرصيد المسجل + الحركات الفعلية. التوقع مستقل، ولا يخصم مرة ثانية فوق المنصرف الفعلي. لا تجمع كميات أصناف بوحدات مختلفة.
      </div>
    </Card>
  );
}

function Cell({ label, value, tone, highlight }: {
  label: string; value: string; tone?: "warn"; highlight?: boolean;
}) {
  const color = tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : highlight ? "text-primary" : "text-foreground";
  return (
    <div className="border border-border rounded-lg p-3 bg-card">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div className={`font-semibold ${color}`}>{value}</div>
    </div>
  );
}
