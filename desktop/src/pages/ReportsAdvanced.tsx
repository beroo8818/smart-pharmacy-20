import {useAuth} from '@/hooks/useAuth';
import {hasPermission} from '../../../shared/accessPolicy';
import { loadContinuousAnalysis, type ProjectedRow } from "@/lib/continuousAnalysis";

import {useLiveInventory} from '../../../shared/useLiveInventory';
import { useMemo } from "react";
import * as XLSX from "xlsx";
import { api, tokenStore, Movement, UploadBatch } from "@/integrations/desktop/client";
import { analyzeMovements, fmtMonth, fmtNum, KIND_LABEL, loadLatestDataset, suggestTransfers } from "@/lib/desktopAnalytics";

function exportXlsx(name: string, rows: Record<string, unknown>[]) {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ ملاحظة: "لا توجد بيانات" }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "report");
  XLSX.writeFile(wb, `${name}.xlsx`);
}

const load=()=>loadContinuousAnalysis({groupBy:'sku'});
export default function ReportsAdvanced(){
 const {roles,access}=useAuth();const mayExport=hasPermission(roles,access,'report.export');
 const {data,loading,error}=useLiveInventory(load);
 const batch=data?.latestBatch||null,rows=data?.rows||[];
 const transfers=useMemo(()=>suggestTransfers(rows,30),[rows]);
 const reports = [
  { title:"تقرير حالة المخزون", desc:"كل صنف وموقع مع الرصيد وأيام التغطية", build:()=>rows.map(r=>({الصنف:r.itemName,الاسم_التجاري:r.tradeNames.join("، "),الكود:r.itemCode,الموقع:r.locationName,الوحدة:r.unit,تاريخ_الرصيد:r.snapshotDate,الرصيد:r.balance,المنصرف_المعياري_30_يوما:r.issued,أيام_التغطية:r.days,الحالة:KIND_LABEL[r.kind],الإجراء:r.action})) },
  { title:"تقرير النقص", desc:"الأصناف الحرجة والأقل من الهدف", build:()=>rows.filter(r=>["critical","danger","below"].includes(r.kind)).map(r=>({الصنف:r.itemName,الاسم_التجاري:r.tradeNames.join("، "),الموقع:r.locationName,الرصيد:r.balance,المنصرف:r.issued,السبب:r.why,الإجراء:r.action})) },
  { title:"تقرير الزيادة", desc:"الأصناف ذات رصيد أعلى من الاحتياج", build:()=>rows.filter(r=>["over","very_over"].includes(r.kind)).map(r=>({الصنف:r.itemName,الاسم_التجاري:r.tradeNames.join("، "),الموقع:r.locationName,الرصيد:r.balance,أيام_التغطية:r.days,الإجراء:r.action})) },
  { title:"تقرير الراكد", desc:"رصيد موجود بدون صرف في الملف الحالي", build:()=>rows.filter(r=>r.kind==="deadstock").map(r=>({الصنف:r.itemName,الاسم_التجاري:r.tradeNames.join("، "),الموقع:r.locationName,الرصيد:r.balance,الإجراء:r.action})) },
  { title:"تقرير التحويلات المقترحة", desc:"تحويلات من الفائض إلى النقص", build:()=>transfers.map(t=>({الصنف:t.itemName,الاسم_التجاري:t.tradeNames.join("، "),الكود:t.itemCode,من:t.from,إلى:t.to,الكمية:t.qty,السبب:t.reason})) },
  { title:"ملخص الحالات", desc:"عدد الأصناف في كل حالة", build:()=>Object.entries(rows.reduce((a,r)=>{a[KIND_LABEL[r.kind]]=(a[KIND_LABEL[r.kind]]||0)+1;return a},{} as Record<string,number>)).map(([الحالة,العدد])=>({الحالة,العدد})) },
 ];
 if(error)return <p role="alert" className="p-6">تعذر تحديث التقارير: {error}. أوقف التصدير حتى نجاح التحديث.</p>;
 return <div className="p-6 space-y-5"><header><h1 className="text-2xl font-bold">التقارير</h1><p className="text-sm text-muted-fg mt-1">تنزيل تقارير Excel من آخر بيانات محفوظة.</p></header>{loading?<div className="card p-8 text-center text-muted-fg">جارٍ التحميل...</div>:!batch?<div className="card p-8 text-center">لا توجد بيانات محفوظة.</div>:<><section className="card p-5 text-sm text-muted-fg">مصدر التقارير: {batch.file_name} — {fmtMonth(batch.month)} — {fmtNum(rows.length)} صف محلل</section><div className="grid md:grid-cols-2 gap-4">{reports.map((r,i)=><section key={i} className="card p-5 flex items-center justify-between gap-4"><div><div className="font-bold">{r.title}</div><div className="text-xs text-muted-fg mt-1">{r.desc}</div></div><button className="btn-outline shrink-0" disabled={!mayExport} onClick={()=>{if(mayExport)exportXlsx(r.title,r.build());}}>تنزيل</button></section>)}</div></>}</div>
}
