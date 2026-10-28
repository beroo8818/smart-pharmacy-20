import {useAuth as usePermissionsAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../shared/accessPolicy';
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, useEffect } from "react";
import { Download, Check, EyeOff, Pencil } from "lucide-react";
import XLSX from "xlsx-js-style";
import {
  fetchLatestBatch,
  fetchMovementsByBatch,
  Movement,
  num,
  normalize,
  itemKey,
} from "@/lib/batchAnalysis";
import { fmtMonth, fmtNum } from "@/lib/format";

type IssueType =
  | "no_name"
  | "no_data"
  | "stock_no_issue"
  | "outlier_issue"
  | "negative_balance"
  | "duplicate"
  | "no_unit"
  | "no_code";

const TYPE_LABEL: Record<IssueType, string> = {
  no_name: "بدون اسم صنف واضح",
  no_data: "بدون رصيد وبدون منصرف",
  stock_no_issue: "رصيد كبير ومنصرف صفر",
  outlier_issue: "منصرف كبير جدًا مقارنة بباقي الصيدليات",
  negative_balance: "رصيد سلبي",
  duplicate: "صنف مكرر في نفس الصيدلية والشهر",
  no_unit: "صنف بدون وحدة",
  no_code: "صنف بدون كود أو اسم موحد",
};

const TYPE_SEVERITY: Record<IssueType, "fatal" | "warn" | "info"> = {
  no_name: "fatal",
  negative_balance: "fatal",
  duplicate: "warn",
  outlier_issue: "warn",
  stock_no_issue: "warn",
  no_unit: "info",
  no_code: "info",
  no_data: "info",
};

const SEV_CLASS: Record<string, string> = {
  fatal: "bg-destructive/15 text-destructive border-destructive/40",
  warn: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  info: "bg-muted text-foreground/70 border-border",
};
const SEV_LABEL: Record<string, string> = {
  fatal: "قاتلة",
  warn: "تحذير",
  info: "ملاحظة",
};

type Issue = {
  id: string;
  type: IssueType;
  itemName: string;
  location: string;
  sheet: string;
  rowNumber: number | null;
  reason: string;
  action: string;
  movement: Movement;
};

type Decision = "approved" | "ignored" | "edited";

function detectIssues(movs: Movement[]): Issue[] {
  const out: Issue[] = [];

  // group for duplicates: same item+location+month
  const dupMap = new Map<string, Movement[]>();
  // group for outliers: per itemKey -> issued values across pharmacies
  const itemIssued = new Map<string, number[]>();

  for (const m of movs) {
    const k = `${itemKey(m)}|${normalize(m.location_name)}|${m.month}`;
    const arr = dupMap.get(k) || [];
    arr.push(m);
    dupMap.set(k, arr);
    const ik = itemKey(m);
    const ia = itemIssued.get(ik) || [];
    ia.push(num(m.issued_quantity));
    itemIssued.set(ik, ia);
  }

  // outlier threshold: > median * 5 AND > 50
  const outlierLimit = new Map<string, number>();
  for (const [k, arr] of itemIssued) {
    if (arr.length < 3) continue;
    const sorted = [...arr].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    if (median <= 0) continue;
    outlierLimit.set(k, Math.max(50, median * 5));
  }

  const seenDup = new Set<string>();

  movs.forEach((m, idx) => {
    const issued = num(m.issued_quantity);
    const balance = num(m.current_balance);
    const name = (m.item_name || m.trade_name || m.scientific_name || "").trim();
    const sheet = (m as any).source_sheet || m.location_name || "";
    const rowNo = (m as any).source_row_number ?? null;
    const base = {
      id: `${m.id}`,
      itemName: name || m.item_code || "بدون اسم",
      location: m.location_name,
      sheet,
      rowNumber: rowNo,
      movement: m,
    };

    if (!name && !m.item_code) {
      out.push({
        ...base,
        id: `${m.id}-no_name`,
        type: "no_name",
        reason: "الصف لا يحتوي على اسم صنف ولا كود.",
        action: "أضف اسم الصنف أو كوده ثم أعد الرفع.",
      });
    } else if (!name) {
      out.push({
        ...base,
        id: `${m.id}-no_code_name`,
        type: "no_code",
        reason: "الصنف بدون اسم موحد (يوجد كود فقط).",
        action: "أضف اسم الصنف في القاموس.",
      });
    } else if (!m.item_code) {
      out.push({
        ...base,
        id: `${m.id}-no_code`,
        type: "no_code",
        reason: "الصنف بدون كود موحد.",
        action: "أضف كود الصنف لتسهيل المطابقة.",
      });
    }

    if (issued === 0 && balance === 0) {
      out.push({
        ...base,
        id: `${m.id}-no_data`,
        type: "no_data",
        reason: "صف بدون رصيد وبدون منصرف.",
        action: "تأكد إن كان الصف ضروريًا أو احذفه.",
      });
    }

    if (balance >= 100 && issued === 0) {
      out.push({
        ...base,
        id: `${m.id}-stock_no_issue`,
        type: "stock_no_issue",
        reason: `رصيد ${fmtNum(balance)} بدون أي صرف.`,
        action: "راجع إن كان الصنف راكدًا أو يحتاج تحويل.",
      });
    }

    if (balance < 0) {
      out.push({
        ...base,
        id: `${m.id}-negative_balance`,
        type: "negative_balance",
        reason: `الرصيد ${fmtNum(balance)} أقل من صفر.`,
        action: "صحّح الرصيد قبل اعتماد الملف.",
      });
    }

    if (!m.unit) {
      out.push({
        ...base,
        id: `${m.id}-no_unit`,
        type: "no_unit",
        reason: "وحدة القياس غير موجودة.",
        action: "أضف الوحدة (علبة/شريط/قرص...).",
      });
    }

    const lim = outlierLimit.get(itemKey(m));
    if (lim != null && issued > lim) {
      out.push({
        ...base,
        id: `${m.id}-outlier`,
        type: "outlier_issue",
        reason: `المنصرف ${fmtNum(issued)} مرتفع جدًا مقارنة بباقي الصيدليات.`,
        action: "تحقق من رقم الصرف؛ قد يكون خطأ إدخال.",
      });
    }

    // duplicates
    const k = `${itemKey(m)}|${normalize(m.location_name)}|${m.month}`;
    const arr = dupMap.get(k);
    if (arr && arr.length > 1 && !seenDup.has(k)) {
      seenDup.add(k);
      out.push({
        ...base,
        id: `${k}-duplicate`,
        type: "duplicate",
        reason: `الصنف مكرر ${arr.length} مرات في نفس الصيدلية وشهر ${fmtMonth(m.month)}.`,
        action: "وحّد الصفوف المكررة قبل الرفع.",
      });
    }
  });

  return out;
}

export default function DataReview() {
  const permissionAuth=usePermissionsAuth();
  const mayReportExport=hasPermission(permissionAuth.roles,permissionAuth.access,'report.export');
  const mayReportPrint=hasPermission(permissionAuth.roles,permissionAuth.access,'report.print');
  const { data: batch } = useQuery({
    queryKey: ["latest-batch-review"],
    queryFn: fetchLatestBatch,
  });
  const { data: movs = [], isLoading } = useQuery({
    queryKey: ["movs-review", batch?.id],
    enabled: !!batch?.id,
    queryFn: () => fetchMovementsByBatch(batch!.id),
  });

  const issues = useMemo(() => detectIssues(movs), [movs]);

  const [typeFilter, setTypeFilter] = useState<IssueType | "all">("all");
  const [pharmacyFilter, setPharmacyFilter] = useState("");
  const [search, setSearch] = useState("");

  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [editing, setEditing] = useState<Issue | null>(null);
  const [editNote, setEditNote] = useState("");

  const storageKey = batch?.id ? `dawa_review_${batch.id}` : "";
  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setDecisions(JSON.parse(raw));
      else setDecisions({});
    } catch { /* ignore */ }
  }, [storageKey]);
  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(decisions));
  }, [storageKey, decisions]);

  const pharmacies = useMemo(
    () =>
      Array.from(new Set(issues.map((i) => i.location))).sort((a, b) =>
        a.localeCompare(b, "ar"),
      ),
    [issues],
  );

  const filtered = useMemo(() => {
    const s = normalize(search);
    return issues.filter((i) => {
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (pharmacyFilter && i.location !== pharmacyFilter) return false;
      if (s && !normalize(i.itemName).includes(s) && !normalize(i.location).includes(s))
        return false;
      return true;
    });
  }, [issues, typeFilter, pharmacyFilter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: issues.length };
    let fatal = 0, warn = 0, info = 0;
    for (const i of issues) {
      c[i.type] = (c[i.type] || 0) + 1;
      const sev = TYPE_SEVERITY[i.type];
      if (sev === "fatal") fatal++;
      else if (sev === "warn") warn++;
      else info++;
    }
    return { byType: c, fatal, warn, info };
  }, [issues]);

  function setDecision(id: string, d: Decision) {
    setDecisions((prev) => ({ ...prev, [id]: d }));
  }

  function exportExcel() {
    const head = [
      "نوع المشكلة",
      "الخطورة",
      "اسم الصنف",
      "الصيدلية",
      "الشيت",
      "رقم الصف",
      "الرصيد",
      "المنصرف",
      "الوحدة",
      "السبب",
      "الإجراء المقترح",
      "القرار",
    ];
    const rows = filtered.map((i) => [
      TYPE_LABEL[i.type],
      SEV_LABEL[TYPE_SEVERITY[i.type]],
      i.itemName,
      i.location,
      i.sheet,
      i.rowNumber ?? "",
      num(i.movement.current_balance),
      num(i.movement.issued_quantity),
      i.movement.unit || "",
      i.reason,
      i.action,
      decisions[i.id] === "approved"
        ? "اعتُمد"
        : decisions[i.id] === "ignored"
          ? "تجاهل"
          : decisions[i.id] === "edited"
            ? "تعديل"
            : "",
    ]);
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    head.forEach((_, i) => {
      const a = XLSX.utils.encode_cell({ r: 0, c: i });
      if (ws[a])
        (ws[a] as any).s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "1F4E79" } },
          alignment: { horizontal: "center" },
        };
    });
    ws["!cols"] = head.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "مراجعة البيانات");
    if(!mayReportExport){window.alert('تصدير التقارير غير مسموح لهذا الحساب');return;}
    XLSX.writeFile(wb, "مراجعة_البيانات_المشكوك_فيها.xlsx");
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto" dir="rtl">
      <PageHeader
        title="مراجعة البيانات المشكوك فيها"
        description={
          batch
            ? `آخر ملف: ${batch.file_name} — ${fmtMonth(batch.month)}`
            : "لا يوجد ملف محفوظ بعد."
        }
        actions={
          <Button onClick={exportExcel} disabled={!filtered.length}>
            <Download className="w-4 h-4 ml-1" /> تصدير Excel
          </Button>
        }
      />

      <div className="grid md:grid-cols-4 gap-3 mb-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">إجمالي الملاحظات</div>
          <div className="text-2xl font-bold">{counts.byType.all || 0}</div>
        </Card>
        <Card className="p-4 border-destructive/40">
          <div className="text-xs text-muted-foreground">قاتلة</div>
          <div className="text-2xl font-bold text-destructive">{counts.fatal}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">تحذير</div>
          <div className="text-2xl font-bold text-amber-600">{counts.warn}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">ملاحظات</div>
          <div className="text-2xl font-bold">{counts.info}</div>
        </Card>
      </div>

      {counts.fatal > 0 && (
        <Card className="p-3 mb-4 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          يوجد {counts.fatal} مشكلة قاتلة — يُفضّل تصحيحها قبل اعتماد الملف.
          المشاكل الأخرى (تحذير/ملاحظة) لا تمنع الحفظ.
        </Card>
      )}

      <Card className="p-4 mb-4">
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">نوع المشكلة</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
            >
              <option value="all">الكل ({counts.byType.all || 0})</option>
              {(Object.keys(TYPE_LABEL) as IssueType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]} ({counts.byType[t] || 0})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">الصيدلية</label>
            <select
              className="w-full border border-input rounded-md px-3 py-2 bg-background text-sm"
              value={pharmacyFilter}
              onChange={(e) => setPharmacyFilter(e.target.value)}
            >
              <option value="">الكل</option>
              {pharmacies.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">بحث</label>
            <Input
              placeholder="اسم صنف أو صيدلية…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-muted-foreground">جارٍ التحليل…</div>
        ) : !filtered.length ? (
          <div className="p-10 text-center text-muted-foreground">
            لا توجد مشاكل مطابقة.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-right p-2">اسم الصنف</th>
                  <th className="text-right p-2">الصيدلية</th>
                  <th className="text-right p-2">نوع المشكلة</th>
                  <th className="text-right p-2">الخطورة</th>
                  <th className="text-right p-2">الشيت</th>
                  <th className="text-right p-2">الصف</th>
                  <th className="text-right p-2">السبب</th>
                  <th className="text-right p-2">الإجراء</th>
                  <th className="text-right p-2">القرار</th>
                  <th className="text-right p-2 w-[1%]">الإجراءات</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const d = decisions[i.id];
                  const sev = TYPE_SEVERITY[i.type];
                  return (
                    <tr key={i.id} className="border-t border-border">
                      <td className="p-2 font-medium">{i.itemName}</td>
                      <td className="p-2">{i.location}</td>
                      <td className="p-2">{TYPE_LABEL[i.type]}</td>
                      <td className="p-2">
                        <span className={`px-2 py-0.5 rounded border text-xs ${SEV_CLASS[sev]}`}>
                          {SEV_LABEL[sev]}
                        </span>
                      </td>
                      <td className="p-2">{i.sheet}</td>
                      <td className="p-2">{i.rowNumber ?? "—"}</td>
                      <td className="p-2 text-muted-foreground">{i.reason}</td>
                      <td className="p-2 text-muted-foreground">{i.action}</td>
                      <td className="p-2">
                        {d ? (
                          <span
                            className={`px-2 py-0.5 rounded text-xs ${
                              d === "approved"
                                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                : d === "ignored"
                                  ? "bg-muted text-muted-foreground"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {d === "approved" ? "اعتُمد" : d === "ignored" ? "متجاهل" : "تعديل"}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">بانتظار</span>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDecision(i.id, "approved")}
                          >
                            <Check className="w-3 h-3 ml-1" /> اعتماد
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDecision(i.id, "ignored")}
                          >
                            <EyeOff className="w-3 h-3 ml-1" /> تجاهل
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditing(i);
                              setEditNote("");
                            }}
                          >
                            <Pencil className="w-3 h-3 ml-1" /> تعديل
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل ملاحظة</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">الصنف</div>
                <div className="font-medium">{editing.itemName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">الصيدلية</div>
                <div>{editing.location}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">المشكلة</div>
                <div>{TYPE_LABEL[editing.type]}</div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  ملاحظة التعديل (تُحفظ محليًا لمراجع التدقيق)
                </label>
                <Input
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder="مثال: تم تصحيح الرصيد بعد المراجعة مع الصيدلية"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                التعديل الفعلي للأرقام يتم من خلال إعادة رفع ملف مصحّح. هذه الشاشة تسجّل القرار فقط.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button
              onClick={() => {
                if (editing) setDecision(editing.id, "edited");
                setEditing(null);
              }}
            >
              حفظ القرار
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
