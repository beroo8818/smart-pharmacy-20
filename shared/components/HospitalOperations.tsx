import { useEffect, useState } from "react";
import { OPS_STATUS, validateReport, type OpsCall, type OpsOverview, type OpsRow } from "../operations";
import { previousMonth, todayISO, validateReportDates, type ReportDates } from "../inventoryHistory";
import ReportPeriodFields from './ReportPeriodFields';
import BranchExcelUpload from './BranchExcelUpload';

type Overview = OpsOverview & { catalog: Pick<OpsRow, "item_code" | "item_name" | "unit">[] };
const box = "border rounded-lg p-5 space-y-3 bg-card";
const control = "border rounded p-2 bg-background w-full";
const button = "border rounded px-4 py-2 bg-primary text-primary-foreground disabled:opacity-50";

export default function HospitalOperations({ call, local = false, access = false }: { call: OpsCall; local?: boolean; access?: boolean }) {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [location, setLocation] = useState(""), [newLocation, setNewLocation] = useState("");
  const [userId, setUserId] = useState(""), [username, setUsername] = useState(""), [name, setName] = useState(""), [password, setPassword] = useState("");
  const [kind, setKind] = useState("monthly"), [month, setMonth] = useState(previousMonth(todayISO())), [snapshot, setSnapshot] = useState(todayISO());
  const [reportDates,setReportDates]=useState<ReportDates>({});
  const [code, setCode] = useState(""), [balance, setBalance] = useState(""), [issued, setIssued] = useState(""), [rows, setRows] = useState<OpsRow[]>([]);
  const [query, setQuery] = useState(""), [qty, setQty] = useState(""), [note, setNote] = useState("");
  async function load() {
    const result = await call("overview");
    setData({...result,reports:result.reports.map((r:OpsOverview['reports'][number])=>({...r,kind:r.consumption_only?'period_consumption':r.kind}))});
    setLocation((old) => result.locations.some((l:any)=>l.id===old)?old:result.location_id||result.locations.find((l:any)=>l.type==='sub_pharmacy')?.id||'');
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, [call]);
  async function run(action: string, payload: Record<string, unknown>, done = "تم الحفظ") {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { let result = await call(action, payload);
      if(result.requiresRevision){if(!confirm(result.error+' هل تحفظ التصحيح مع الاحتفاظ بالسجل السابق؟'))return false;result=await call(action,{...payload,confirm_revision:true});}
      setMessage(result.duplicate ? "هذه البيانات مسجلة بالفعل؛ لم تتم إضافتها مرة ثانية" : done); await load(); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر الحفظ"); return false; }
    finally { setBusy(false); }
  }
  const catalog = (data?.catalog || []).filter((r) => `${r.item_code} ${r.item_name}`.toLowerCase().includes(query.toLowerCase()));
  const item = data?.catalog.find((r) => `${r.item_code}|${r.unit}` === code);
  const selectedLocation = data?.locations.find((l) => l.id === location);
  const locationName = (id: string) => data?.locations.find((l) => l.id === id)?.name || "صيدلية غير متاحة";
  function addRow() {
    try {
      if (!item) throw new Error("اختر صنفًا معروفًا. تعريف الأصناف والوحدات من خلال المدير.");
      const next = [...rows, { ...item, balance: kind==='period_consumption'||balance.trim() === "" ? null : Number(balance), issued: kind !== "partial_update" && issued.trim() !== "" ? Number(issued) : null }];
      validateReport(next, kind); setRows(next); setBalance(""); setIssued(""); setError("");
    } catch (e) { setError((e as Error).message); }
  }
  async function changeStatus(id: string, status: string) {
    const reason = prompt(status === 'received' ? "رقم مستند التسليم. تأكد أن المسؤول سجل حركة التحويل مرة واحدة؛ تغيير الحالة هنا لا يسجل حركة مخزون." : "سبب القرار أو رقم المستند (5 أحرف على الأقل)");
    if (reason) await run("request_status", { id, status, note: reason });
  }
  if (!data) return <div className="p-6" dir="rtl">{error ? <p role="alert">{error} تأكد من تطبيق ترقية قاعدة البيانات؛ لا يتم استخدام وضع بلا صلاحيات كبديل.</p> : "جارٍ تحميل صيدليتي..."}</div>;
  return <div className="p-6 space-y-5 max-w-[1400px]" dir="rtl">
    <h1 className="text-2xl font-bold">{access ? "إدارة الفروع والمستخدمين" : data.manager ? "متابعة الصيدليات والتحديثات" : "صيدليتي"}</h1>
    <div className="text-sm text-muted-foreground">{local ? 'وضع محلي - هذا الجهاز' : 'وضع الويب'}</div>
    {error && <div role="alert" className="border border-red-500 rounded p-3">{error}</div>}
    {message && <div role="status" className="border border-emerald-500 rounded p-3">{message}</div>}
    <section className={box}>
      <label>الصيدلية<select aria-label="الصيدلية" className={control} value={location} disabled={data.locations.filter(l=>l.type==='sub_pharmacy').length<2 || rows.length > 0} onChange={(e) => setLocation(e.target.value)}>
        <option value="">لم يتم تعيين صيدلية</option>{data.locations.filter((l) => l.type === 'sub_pharmacy').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select></label>
      <p className="text-sm">{selectedLocation ? `العمل الحالي: ${selectedLocation.name}` : "اطلب من المدير تعيين الفرع لحسابك قبل التسجيل."}</p>
      <div className="flex gap-3 flex-wrap"><a className="underline" href={local ? '#/report-center' : '/report-center'}>أرصدتي وتقاريري</a><button className="underline" onClick={() => document.getElementById('new-report')?.scrollIntoView()}>تحديث الرصيد والمنصرف</button><button className="underline" onClick={() => document.getElementById('requests')?.scrollIntoView()}>طلبات الأصناف</button><a className="underline" href={local ? '#/workflows' : '/workflows'}>خطوات الشغل</a></div>
    </section>
    {access && data.manager && <section className={box}>
      <h2 className="font-bold">الفروع وحسابات الموظفين</h2>
      <label>اسم صيدلية جديدة<input className={control} value={newLocation} onChange={(e) => setNewLocation(e.target.value)} /></label>
      <button className={button} disabled={busy || !newLocation.trim()} onClick={async () => { if (await run('location_create', { name: newLocation })) setNewLocation(''); }}>إضافة صيدلية</button>
      <label>الموظف<select className={control} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">اختر موظفًا</option>{data.users.filter((u) => !u.roles.some((r) => ['system_admin','pharmacy_manager','warehouse_keeper'].includes(r))).map((u) => <option key={u.id} value={u.id}>{u.name || u.email} {u.assigned_location_id ? `(${locationName(u.assigned_location_id)})` : '(بدون فرع)'}</option>)}</select></label>
      <button className={button} disabled={busy || !userId || !location} onClick={() => run('assign', { user_id: userId, location_id: location })}>تعيين صيدلي فرعي للصيدلية المختارة</button>{' '}
      <button className="border rounded p-2" disabled={busy || !userId} onClick={() => { if (confirm('إيقاف صلاحية هذا الموظف؟')) run('revoke', { user_id: userId }); }}>إيقاف الوصول</button>
      {local && <div className="grid md:grid-cols-2 gap-3 border-t pt-3">
        <label>اسم الدخول<input className={control} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" /></label>
        <label>اسم الموظف<input className={control} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>كلمة مرور أولية (8 أحرف على الأقل)<input className={control} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
        <button className={button} disabled={busy || !location || password.length < 8 || !username} onClick={async () => { if (await run('user_create', { username, name, password, location_id: location })) { setPassword(''); setUsername(''); setName(''); } }}>إنشاء حساب فرعي محلي</button>
      </div>}
    </section>}
    {!access && <>
      <section className={box} id="new-report">
        <h2 className="text-lg font-bold">1. تحديث الرصيد والمنصرف</h2>
        <p className="text-sm">التقرير يحفظ مباشرة بعد التحقق، ويظهر في التحليل بدون انتظار اعتماد المدير. التصحيح لا يحذف النسخة السابقة.</p>
        <div className="grid md:grid-cols-3 gap-3">
          <label>نوع التقرير<select className={control} value={kind} disabled={rows.length > 0} onChange={(e) => setKind(e.target.value)}><option value="monthly">رصيد ومنصرف فترة من الشهر</option><option value="period_consumption">منصرف فترة فقط بدون رصيد جديد</option><option value="partial_update">تحديث رصيد فقط لبعض الأصناف</option></select></label>
          <label>شهر التقرير<input className={control} type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          {kind!=='period_consumption'&&<label>تاريخ الرصيد<input className={control} type="date" max={todayISO()} value={snapshot} onChange={(e) => setSnapshot(e.target.value)} /></label>}
        </div>
        <ReportPeriodFields month={month+'-01'} kind={kind} value={reportDates} onChange={setReportDates}/>
        <BranchExcelUpload catalog={data.catalog} branchName={selectedLocation?.name || ''} kind={kind} disabled={busy} onRows={(next)=>{setRows(next);setMessage(`تم تجهيز ${next.length} صنف من الملف؛ راجع الجدول ثم احفظ التحديث مباشرة`);setError('');}} />
        <details className="border rounded p-3"><summary>إدخال يدوي اختياري</summary>
        <label>ابحث بالكود أو الاسم<input className={control} value={query} onChange={(e) => setQuery(e.target.value)} /></label>
        <label>الصنف والوحدة<select className={control} value={code} onChange={(e) => setCode(e.target.value)}><option value="">اختر الصنف</option>{catalog.map((r, i) => <option key={`${r.item_code}|${r.unit}|${i}`} value={`${r.item_code}|${r.unit}`}>{r.item_code} - {r.item_name} ({r.unit})</option>)}</select></label>
        <div className="grid md:grid-cols-3 gap-3">{kind!=='period_consumption'&&<label>الرصيد الفعلي<input className={control} type="number" min="0" step="any" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>}
          {kind !== 'partial_update' && <label>منصرف الفترة المحددة<input className={control} type="number" min="0" step="any" value={issued} onChange={(e) => setIssued(e.target.value)} /></label>}
          <button className={button} disabled={busy || !location} onClick={addRow}>إضافة الصنف للتقرير</button></div>
        </details>
        <table className="w-full text-sm"><thead><tr><th>الصنف</th><th>الوحدة</th><th>الرصيد</th><th>المنصرف</th><th>تعديل</th></tr></thead><tbody>{rows.map((r, i) => <tr key={r.item_code}><td>{r.item_name}</td><td>{r.unit}</td><td>{r.balance}</td><td>{r.issued ?? 'لا يضاف منصرف'}</td><td><button onClick={() => setRows(rows.filter((_, index) => index !== i))}>إزالة من المسودة</button></td></tr>)}</tbody></table>
        <button className={button} disabled={busy || !rows.length || !location} onClick={async () => {
          let dates:ReportDates;
          const balanceDate=kind==='period_consumption'?reportDates.issued_to||'':snapshot;
          try { dates=validateReportDates(month+'-01',balanceDate,kind,reportDates,todayISO(),true); } catch(e){setError((e as Error).message);return;}
          if (!confirm(`حفظ ${rows.length} صنف في ${selectedLocation?.name} بعد مراجعة المعاينة؟`)) return;
          if (await run('submit', { location_id: location, month: month + '-01', snapshot_date: balanceDate, kind, ...dates, rows }, 'تم الحفظ وظهر التحديث في التحليل')) setRows([]);
        }}>حفظ التحديث مباشرة</button>
      </section>
      <section className={box}>
        <h2 className="text-lg font-bold">2. سجل التحديثات المحفوظة</h2>
        <div className="text-sm text-muted-foreground">أحدث 2000 تقرير متاح لحسابك</div>
        {data.reports.map((r) => <details key={r.id} className="border rounded p-3"><summary>{locationName(r.location_id)} | {r.month.slice(0,7)} | {r.kind==='period_consumption'?'لا يغير الرصيد':'رصيد '+r.snapshot_date} | {r.kind === 'monthly' ? 'رصيد ومنصرف' : r.kind==='period_consumption'?'منصرف فترة فقط':'تحديث رصيد'} | {OPS_STATUS[r.status]}</summary>
          <p>فترة المنصرف: {r.kind==='partial_update'?'لا يضيف منصرفًا':r.issued_from&&r.issued_to?r.issued_from+' إلى '+r.issued_to:'شهر كامل وفق بيانات النسخة السابقة'}</p>
          {r.kind!=='period_consumption'&&<p>حد الرصيد: {r.snapshot_boundary==='start_of_day'?'بداية اليوم':r.snapshot_boundary==='end_of_day'?'نهاية اليوم':'غير محدد في التقرير القديم'}</p>}
          <table className="w-full my-3 text-sm"><thead><tr><th>الكود والصنف</th><th>الوحدة</th><th>الرصيد</th><th>المنصرف</th></tr></thead><tbody>{r.rows.map((entry) => <tr key={entry.item_code}><td>{entry.item_code} - {entry.item_name}</td><td>{entry.unit}</td><td>{entry.balance}</td><td>{entry.issued ?? 'غير مسجل'}</td></tr>)}</tbody></table><p>{r.note}</p>
          {r.status==='pending'&&<p>تقرير قديم لم يدخل الأرصدة. ارفعه كتحديث جديد بعد التأكد من الفترة؛ لم يتم حفظه أو اعتماده تلقائيًا.</p>}
        </details>)}{!data.reports.length && <p>لا توجد تقارير مقدمة لحسابك.</p>}
      </section>
      <section className={box} id="requests">
        <h2 className="text-lg font-bold">3. طلب صنف ومتابعة التجهيز</h2>
        <label>الصنف المطلوب<select className={control} value={code} onChange={(e)=>setCode(e.target.value)}><option value="">اختر الصنف</option>{catalog.map((r,i)=><option key={`${r.item_code}-${i}`} value={`${r.item_code}|${r.unit}`}>{r.item_name} ({r.unit})</option>)}</select></label>
        <div className="text-sm">حالة الطلب لا تسجل حركة مخزون تلقائيًا.</div>
        <label>الكمية المطلوبة<input className={control} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <label>سبب الطلب<input className={control} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <button className={button} disabled={busy || !location || !item || !(Number(qty) > 0) || note.trim().length < 5} onClick={async () => { if (await run('request', { location_id: location, ...item, qty: Number(qty), note })) { setQty(''); setNote(''); } }}>إرسال طلب توفير</button>
        {data.transfers.map((r) => <div key={r.id} className="border rounded p-3 space-y-2"><b>{locationName(r.location_id)}: {r.item_name} | {r.qty} {r.unit} | {OPS_STATUS[r.status]}</b><p className="whitespace-pre-line">{r.note}</p>
          {r.status === 'requested' && data.manager && <button disabled={busy} onClick={() => changeStatus(r.id,'rejected')}>إلغاء مع السبب</button>}
          {['requested','approved'].includes(r.status) && (data.manager || !data.location_id) && <button className={button} disabled={busy} onClick={() => changeStatus(r.id,'preparing')}>بدء التجهيز</button>}
          {r.status === 'preparing' && <button className={button} disabled={busy} onClick={() => changeStatus(r.id,'received')}>تأكيد الاستلام الفعلي</button>}
        </div>)}
      </section>
    </>}
  </div>;
}
