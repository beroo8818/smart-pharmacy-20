import { Card } from "@/components/ui/card";
import { fmtMonth, fmtNum } from "@/lib/format";
import type { UploadBatch } from "@/lib/batchAnalysis";

export default function DataSourceCard({
  batch, loading, targetDays, rowsCount, extra,
}: {
  batch: UploadBatch | null;
  loading?: boolean;
  targetDays?: number;
  rowsCount?: number;
  extra?: React.ReactNode;
}) {
  if (loading) {
    return <Card className="p-4 mb-4 bg-muted/30"><div className="text-sm text-muted-foreground">جارٍ التحميل...</div></Card>;
  }
  if (!batch) {
    return <Card className="p-4 mb-4 bg-muted/30"><div className="text-sm text-muted-foreground">لا توجد بيانات محفوظة. ارفع ملفًا واحفظه أولًا.</div></Card>;
  }
  return (
    <Card className="p-4 mb-4 bg-muted/30">
      <div className="grid md:grid-cols-5 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">مصدر البيانات</div>
          <div className="font-medium truncate" dir="auto" title={batch.file_name}>{batch.file_name}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">الشهر</div>
          <div className="font-medium">{fmtMonth(batch.month)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">upload_batch_id</div>
          <div className="font-mono text-[11px] break-all">{batch.id}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">عدد الصفوف المحفوظة</div>
          <div className="font-medium">{fmtNum(rowsCount ?? batch.rows_saved)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">هدف التغطية</div>
          <div className="font-medium">{targetDays ?? 30} يوم</div>
        </div>
      </div>
      {extra && <div className="mt-3 text-xs text-muted-foreground">{extra}</div>}
    </Card>
  );
}