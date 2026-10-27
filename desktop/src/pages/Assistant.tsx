import { useEffect, useMemo, useRef, useState } from "react";
import { api, tokenStore, Movement } from "@/integrations/desktop/client";
import { analyzeMovements, AnalysisRow, fmtNum, KIND_LABEL, loadLatestDataset, normalize, tradeNamesLabel } from "@/lib/desktopAnalytics";

interface Msg { role: "user" | "assistant"; content: string; }

function answer(question: string, rows: AnalysisRow[]): string {
  const q = normalize(question);
  if (!rows.length) return "لا توجد بيانات محفوظة. ارفع ملف Excel أولاً من صفحة (رفع البيانات).";

  // Detect pharmacy filter
  const pharmacies = Array.from(new Set(rows.map((r) => r.locationName)));
  const matchedPharmacy = pharmacies.find((p) => q.includes(normalize(p)));
  const scope = matchedPharmacy ? rows.filter((r) => r.locationName === matchedPharmacy) : rows;

  const ask = (kw: string[]) => kw.some((k) => q.includes(k));
  const nameLine = (r: AnalysisRow) => [r.itemName, tradeNamesLabel(r.tradeNames)].filter(Boolean).join(" — ");

  if (ask(["نقص", "ناقص", "حرج", "خطر", "shortage"])) {
    const list = scope.filter((r) => ["critical", "danger", "below"].includes(r.kind)).slice(0, 25);
    if (!list.length) return `لا يوجد نقص حاد ${matchedPharmacy ? `في ${matchedPharmacy}` : "في أي صيدلية"} حالياً.`;
    return `الأصناف الناقصة ${matchedPharmacy ? `في ${matchedPharmacy}` : ""} (${list.length}):\n` +
      list.map((r, i) => `${i + 1}. ${nameLine(r)} — ${r.locationName} — رصيد ${fmtNum(r.balance)} يكفي ${r.days == null ? "0" : Math.round(r.days)} يوم (${KIND_LABEL[r.kind]})`).join("\n");
  }
  if (ask(["زياده", "زائد", "overstock", "فائض"])) {
    const list = scope.filter((r) => ["over", "very_over"].includes(r.kind)).slice(0, 25);
    if (!list.length) return `لا توجد زيادات ملحوظة ${matchedPharmacy ? `في ${matchedPharmacy}` : ""}.`;
    return `الأصناف الزائدة:\n` + list.map((r, i) => `${i + 1}. ${nameLine(r)} — ${r.locationName} — رصيد ${fmtNum(r.balance)} يكفي ${r.days == null ? "" : Math.round(r.days)} يوم`).join("\n");
  }
  if (ask(["راكد", "deadstock", "بدون صرف"])) {
    const list = scope.filter((r) => r.kind === "deadstock").slice(0, 25);
    if (!list.length) return "لا توجد أصناف راكدة.";
    return `الأصناف الراكدة:\n` + list.map((r, i) => `${i + 1}. ${nameLine(r)} — ${r.locationName} — رصيد ${fmtNum(r.balance)} بدون صرف`).join("\n");
  }
  if (ask(["كم صنف", "عدد", "احصاء", "ملخص", "summary"])) {
    const counts: Record<string, number> = {};
    for (const r of scope) counts[r.kind] = (counts[r.kind] || 0) + 1;
    return `ملخص ${matchedPharmacy ? matchedPharmacy : "كل المواقع"}:\n` +
      Object.entries(counts).map(([k, v]) => `• ${KIND_LABEL[k as keyof typeof KIND_LABEL]}: ${fmtNum(v)}`).join("\n");
  }

  // Free-text item search
  const matches = scope.filter((r) => normalize(`${r.itemName} ${r.tradeNames.join(" ")}`).includes(q) || normalize(r.itemCode).includes(q)).slice(0, 15);
  if (matches.length) {
    return `وجدت ${matches.length} نتيجة:\n` + matches.map((r, i) =>
      `${i + 1}. ${nameLine(r)} — ${r.locationName} — رصيد ${fmtNum(r.balance)} / منصرف ${fmtNum(r.issued)} / ${KIND_LABEL[r.kind]}`
    ).join("\n");
  }

  return "لم أفهم السؤال بشكل كافٍ. جرب: «ما الأصناف الناقصة في صيدلية الطوارئ؟» أو «الأصناف الراكدة» أو «ملخص الحالة» أو اكتب اسم صنف معين للبحث.";
}

export default function Assistant() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [messages, setMessages] = useState<Msg[]>([
    { role: "assistant", content: "مرحبًا. اسألني عن النقص أو الزيادة أو الراكد أو ابحث عن صنف معين. أجيب من آخر ملف Excel محفوظ على جهازك (بدون إنترنت)." },
  ]);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { (async () => {
    const { movements } = await loadLatestDataset(api, tokenStore.get());
    setMovements(movements);
  })(); }, []);

  const rows = useMemo(() => analyzeMovements(movements, 30), [movements]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim(); if (!text) return;
    const reply = answer(text, rows);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: reply }]);
    setInput("");
  }

  return (
    <div className="p-6 max-w-[900px] space-y-5">
      <header><h1 className="text-2xl font-bold">المساعد الذكي</h1><p className="text-sm text-muted-fg mt-1">اسأل بالعربية عن حالة الأصناف. يعمل محلياً على بياناتك بدون إنترنت.</p></header>
      <div className="card p-5 flex flex-col h-[600px]">
        <div className="flex-1 overflow-auto space-y-3 mb-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === "user" ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-white" : "bg-muted text-foreground"}`}>{m.content}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <form onSubmit={send} className="flex gap-2">
          <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="مثلاً: ما الأصناف الناقصة؟ أو اكتب اسم صنف..." />
          <button className="btn-primary" type="submit" disabled={!input.trim()}>إرسال</button>
        </form>
      </div>
    </div>
  );
}
