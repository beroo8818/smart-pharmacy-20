import { buildInventoryHistory, locationKey, todayISO } from "../../shared/inventoryHistory";
import { applyStockLedger } from "../../shared/stockLedger";
import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fmtMonth, fmtNum } from "@/lib/format";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import ItemIdentity from "@/components/ItemIdentity";
import { itemDisplayName, itemKey as analysisItemKey, itemKeyAliases, itemTradeNames, sortBatchesForAnalysis } from "@/lib/batchAnalysis";
import { fetchMovementsForBatches, fetchRecentBatches, fetchStockTransactions } from "@/lib/continuousAnalysis";

function DetailsBlock({ title, items, calc, why }: { title: string; items: [string, string][]; calc: string; why: string }) {
  return (
    <div>
      <div className="font-semibold mb-2" dir="auto">{title}</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        {items.map(([k, v]) => (
          <div key={k} className="rounded-md border border-border bg-card p-2">
            <div className="text-[10px] text-muted-foreground">{k}</div>
            <div className="font-semibold mt-0.5">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-1" dir="auto"><span className="text-muted-foreground">الحسابات: </span>{calc}</div>
      <div className="mt-1" dir="auto"><span className="text-muted-foreground">السبب: </span>{why}</div>
    </div>
  );
}

type CoverageBucket =
  | "critical"
  | "danger"
  | "below"
  | "safe"
  | "over"
  | "very_over"
  | "deadstock"
  | "no_data";

type UploadBatch = {
  id: string;
  file_name: string;
  month: string;
  rows_saved: number;
  rows_ignored: number;
  status: string;
  created_at: string;
  created_by: string;
  snapshot_date?: string | null;
  batch_kind?: string | null;
};

type InventoryMovement = {
  id: string;
  upload_batch_id: string;
  month: string;
  item_name: string | null;
  item_code: string | null;
  scientific_name: string | null;
  trade_name: string | null;
  unit: string | null;
  location_name: string;
  location_type: string;
  issued_quantity: number | string | null;
  current_balance: number | string | null;
  source_sheet: string | null;
  source_row_number: number | null;
  created_at: string;
};

type DbError = { message: string } | null;
type DbQuery<T> = PromiseLike<{ data: T[] | null; error: DbError }> & {
  select: (columns: string) => DbQuery<T>;
  eq: (column: string, value: string) => DbQuery<T>;
  order: (column: string, options?: { ascending?: boolean }) => DbQuery<T>;
  range: (from: number, to: number) => DbQuery<T>;
};
type DbClient = { from: <T>(table: string) => DbQuery<T> };
const db = supabase as unknown as DbClient;

const BUCKET_LABEL: Record<CoverageBucket, string> = {
  critical: "خطر عالي جدًا",
  danger: "خطر",
  below: "أقل من الهدف",
  safe: "آمن",
  over: "زائد",
  very_over: "زائد جدًا",
  deadstock: "راكد",
  no_data: "بيانات غير كافية",
};

const BUCKET_CLASS: Record<CoverageBucket, string> = {
  critical: "bg-destructive/15 text-destructive border border-destructive/30",
  danger: "bg-destructive/10 text-destructive border border-destructive/20",
  below: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30",
  safe: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30",
  over: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/30",
  very_over: "bg-sky-500/20 text-sky-700 dark:text-sky-300 border border-sky-500/40",
  deadstock: "bg-muted text-muted-foreground border border-border",
  no_data: "bg-muted text-muted-foreground border border-border",
};

function normalize(s: unknown) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ");
}

function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function bucketize(days: number | null, target: number, balance: number, adc: number, allowDeadstock = true): CoverageBucket {
  if (adc <= 0) return balance > 0 && allowDeadstock ? "deadstock" : "no_data";
  if (days == null) return "no_data";
  if (days < 7) return "critical";
  if (days < 14) return "danger";
  if (days < target) return "below";
  if (days <= target * 2) return "safe";
  if (days <= target * 3) return "over";
  return "very_over";
}

function isMainLocation(locationType: string) {
  return locationType === "main_warehouse" || locationType === "main_store";
}

function rawItemKey(r: InventoryMovement) {
  return normalize(r.item_code || `${r.item_name || ""}|${r.scientific_name || ""}|${r.trade_name || ""}|${r.unit || ""}`);
}

function withDictionary(r: InventoryMovement, dict?: DictRow) {
  if (!dict) return r as any;
  return {
    ...r,
    scientific_name: r.scientific_name || dict.active_ingredient,
    strength: dict.strength,
    dosage_form: dict.dosage_form,
    unit: r.unit || dict.unit,
    therapeutic_group_key: dict.therapeutic_group_key,
  } as any;
}

type DictRow = {
  original_item_name: string;
  scientific_name: string | null;
  trade_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  unit: string | null;
  therapeutic_group_key: string | null;
  standard_name: string | null;
  needs_review: boolean;
  approved: boolean;
};

type AnalysisMode = "raw" | "ingredient" | "group";

export default function Items() {
  const [searchParams] = useSearchParams();
  const batchFromUrl = searchParams.get("batch");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState<number>(30);
  const [scope, setScope] = useState<string>(searchParams.get("scope") || "all_branches");
  const [dataMode, setDataMode] = useState<"latest" | "month" | "all">("latest");
  const [monthFilter, setMonthFilter] = useState("");
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("simple");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("group");
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false);

  const dictQuery = useQuery({
    queryKey: ["aid-dict"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("active_ingredient_dictionary")
        .select("original_item_name,scientific_name,trade_name,active_ingredient,strength,dosage_form,unit,therapeutic_group_key,standard_name,needs_review,approved")
        .range(0, 49999);
      if (error) throw error;
      return (data || []) as DictRow[];
    },
  });

  const dictMap = useMemo(() => {
    const m = new Map<string, DictRow>();
    (dictQuery.data || []).forEach((d) => {
      for (const candidate of [d.original_item_name, d.scientific_name, d.trade_name, d.standard_name, d.therapeutic_group_key]) {
        const key = (candidate || "").toLowerCase();
        if (key) m.set(key, d);
      }
    });
    return m;
  }, [dictQuery.data]);

  function lookupDict(r: InventoryMovement) {
    return dictMap.get((r.item_name || "").toLowerCase())
      || dictMap.get((r.scientific_name || "").toLowerCase())
      || dictMap.get((r.trade_name || "").toLowerCase())
      || null;
  }

  function itemKey(r: InventoryMovement): string | null {
    const raw = rawItemKey(r);
    if (analysisMode === "raw") return raw;
    const dict = lookupDict(r);
    if (!dict) return analysisItemKey(r as any);
    if (!includeUnreviewed && dict.needs_review && !dict.approved) return analysisItemKey(r as any);
    if (analysisMode === "ingredient") {
      return analysisItemKey(withDictionary(r, dict));
    }
    // group mode
    return analysisItemKey(withDictionary(r, dict));
  }

  function displayLabel(r: InventoryMovement): { name: string; sub: string; href: string | null } {
    if (analysisMode === "raw") {
      const name = r.item_name || r.trade_name || r.scientific_name || r.item_code || "—";
      const sub = [r.item_code, r.scientific_name].filter(Boolean).join(" — ");
      return { name, sub, href: null };
    }
    const dict = lookupDict(r);
    if (!dict) return { name: itemDisplayName(r as any), sub: "غير مرتبط بقاموس المواد", href: null };
    if (analysisMode === "ingredient" && dict.active_ingredient) {
      const label = dict.standard_name || [dict.active_ingredient, dict.strength, dict.dosage_form].filter(Boolean).join(" ");
      return { name: label, sub: "تجميع حسب المادة الفعالة والتركيز", href: null };
    }
    if (analysisMode === "group" && dict.therapeutic_group_key) {
      return {
        name: dict.standard_name || dict.therapeutic_group_key,
        sub: dict.therapeutic_group_key,
        href: `/active-ingredients/group/${encodeURIComponent(dict.therapeutic_group_key)}`,
      };
    }
    return { name: itemDisplayName(withDictionary(r, dict)), sub: dict.active_ingredient || "", href: null };
  }

  const batchesQuery = useQuery({
    queryKey: ["upload_batches"],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      return await fetchRecentBatches() as UploadBatch[];
    },
  });

  const batches = batchesQuery.data || [];
  const latestBatch = batches[0] || null;
  const selectedBatchId = dataMode === "latest" ? batchFromUrl || latestBatch?.id || null : null;
  const selectedBatch = batches.find((b) => b.id === selectedBatchId) || (selectedBatchId ? null : latestBatch);
  const effectiveMonth = dataMode === "month" ? monthFilter || latestBatch?.month?.substring(0, 7) || "" : "";

  const movementsQuery = useQuery({
    queryKey: ["inventory_movements", dataMode, selectedBatchId, effectiveMonth, batches.map((b) => b.id).join(",")],
    enabled: !batchesQuery.isLoading && (dataMode === "all" || dataMode === "month" || !!selectedBatchId),
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      if (dataMode === "latest" && !batchFromUrl) return await fetchMovementsForBatches(batches.map((b) => b.id)) as InventoryMovement[];
      let query = db
        .from<InventoryMovement>("inventory_movements")
        .select("id,upload_batch_id,month,item_name,item_code,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance,source_sheet,source_row_number,created_at")
        .order("month", { ascending: true })
        .order("created_at", { ascending: true })
        .range(0, 49999);

      if (dataMode === "latest" && selectedBatchId) query = query.eq("upload_batch_id", selectedBatchId);
      if (dataMode === "month" && effectiveMonth) query = query.eq("month", `${effectiveMonth}-01`);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as InventoryMovement[];
    },
  });

  const movements = useMemo(() => movementsQuery.data || [], [movementsQuery.data]);
  const transactionsQuery = useQuery({
    queryKey:['item-stock-ledger',batches.map(b=>b.id).join('|')],
    enabled:dataMode==='latest'&&!batchFromUrl&&batches.length>0,
    queryFn:()=>fetchStockTransactions(batches.reduce((date,b)=>(b.snapshot_date||b.month)<date?(b.snapshot_date||b.month):date,todayISO())),
  });

  const sourceText = useMemo(() => {
    if (!movements.length) return null;
    if (dataMode === "latest" && selectedBatch) {
      if (!batchFromUrl) return "آخر رصيد مسجل مع الحركات اللاحقة، ومتوسط المنصرف وفق أيام الفترات المسجلة. الأرصدة ليست جردًا موحدًا إذا اختلفت تواريخ التحديث أو كانت بياناتها ناقصة.";
      return `مصدر التحليل: ملف ${selectedBatch.file_name}، شهر ${fmtMonth(selectedBatch.month)}، عدد الصفوف ${fmtNum(selectedBatch.rows_saved)}`;
    }
    if (dataMode === "month") {
      const monthBatches = new Set(movements.map((m) => m.upload_batch_id)).size;
      return `مصدر التحليل: شهر ${effectiveMonth}، عدد الملفات ${fmtNum(monthBatches)}، عدد الصفوف ${fmtNum(movements.length)}`;
    }
    return `مصدر التحليل: كل الملفات المحفوظة، عدد الملفات ${fmtNum(new Set(movements.map((m) => m.upload_batch_id)).size)}، عدد الصفوف ${fmtNum(movements.length)}`;
  }, [dataMode, effectiveMonth, movements, selectedBatch]);

  const perItemLoc = useMemo(() => {
    const history = buildInventoryHistory(batches, movements.map((m) => ({
      sample: m, batchId: m.upload_batch_id, item: itemKey(m) || rawItemKey(m),
      sku: [m.item_code, m.trade_name, m.item_name, m.unit].map(normalize).join("|"),
      locationName: m.location_name, locationType: m.location_type,
      balance: m.current_balance, issued: m.issued_quantity,
    })), dataMode === "all" ? 1200 : 3, todayISO());
    const out = new Map<string, { balance: number; amc: number; snapshot: string; valid: boolean; knownBalance: boolean; loc: { id: string; name: string; type: string }; sample: InventoryMovement }>();
    const ledger=applyStockLedger(history,dataMode==='latest'&&!batchFromUrl?transactionsQuery.data||[]:[],todayISO(),m=>itemKey(m)||rawItemKey(m),m=>itemKeyAliases(m as any),normalize,movements);
    const ledgerReady = dataMode!=='latest'||!!batchFromUrl||(!transactionsQuery.isPending&&!transactionsQuery.isError);
    for (const value of ledger) {
      const key = `${itemKey(value.sample)}|${locationKey(value.locName, value.locType)}`;
      out.set(key, { balance: value.latestBalance + value.adjustments.receipts - value.adjustments.issues + value.adjustments.transfersIn - value.adjustments.transfersOut + value.adjustments.returns, amc: value.issuedAverage,
        snapshot: value.latestSnapshot+'|'+(value.snapshotBoundary||'unknown'), knownBalance: ledgerReady && value.hasBalance && !value.mixedSnapshots && !value.ledgerWarnings.length, valid: ledgerReady && value.hasBalance && value.hasConsumption && !value.mixedSnapshots && !value.ledgerWarnings.length,
        loc: { id: locationKey(value.locName, value.locType), name: value.locName, type: value.locType }, sample: value.sample });
    }
    return out;
  }, [movements, batches, dataMode, analysisMode, dictMap, includeUnreviewed, transactionsQuery.data, transactionsQuery.isPending, transactionsQuery.isError, batchFromUrl]);

  const locations = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: string }>();
    for (const value of perItemLoc.values()) {
      const site=value.loc;
      if(!map.has(site.id)) map.set(site.id,site);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [perItemLoc]);

  const branches = useMemo(() => locations.filter((l) => !isMainLocation(l.type)), [locations]);
  const mainStores = useMemo(() => locations.filter((l) => isMainLocation(l.type)), [locations]);
  const hasMain = mainStores.length > 0;

  const mainStoreSources = useMemo(() => {
    const labels = new Set<string>();
    for (const m of mainStores) {
      const idx = m.name.indexOf("—");
      if (idx > 0) labels.add(m.name.slice(idx + 1).trim());
    }
    return Array.from(labels);
  }, [mainStores]);

  const rows = useMemo(() => {
    const itemSamples = new Map<string, { sample: InventoryMovement; aliasCount: number; reviewCount: number; tradeNames: Set<string> }>();
    const aliasNames = new Map<string, Set<string>>();
    for (const m of movements) {
      const k = itemKey(m);
      if (!k) continue;
      const cur = itemSamples.get(k);
      const dict = lookupDict(m);
      const needs = dict?.needs_review && !dict?.approved ? 1 : 0;
      if (!cur) {
        itemSamples.set(k, { sample: m, aliasCount: 1, reviewCount: needs, tradeNames: new Set(itemTradeNames(withDictionary(m, dict))) });
        aliasNames.set(k, new Set([(m.item_name || "").toLowerCase()]));
      } else {
        itemTradeNames(withDictionary(m, dict)).forEach((n) => cur.tradeNames.add(n));
        const set = aliasNames.get(k)!;
        const nm = (m.item_name || "").toLowerCase();
        if (!set.has(nm)) { set.add(nm); cur.aliasCount += 1; cur.reviewCount += needs; }
      }
    }

    return Array.from(itemSamples.entries())
      .map(([key, meta]) => {
        const sample = meta.sample;
        let brBalance = 0;
        let brAmc = 0;
        let complete = true;
        let brBalancesKnown = true;
        let mainBalancesKnown = true;
        const snapshotDates = new Set<string>();
        const perBranch: Array<{ loc: { id: string; name: string; type: string }; balance: number; knownBalance:boolean; amc: number; adc: number; days: number | null; bucket: CoverageBucket }> = [];

        for (const b of branches) {
          const v = perItemLoc.get(`${key}|${locationKey(b.name, b.type)}`);
          if (!v) continue;
          brBalance += v.balance;
          complete &&= v.valid;
          brBalancesKnown &&= v.knownBalance;
          snapshotDates.add(v.snapshot);
          brAmc += v.amc;
          const adc = v.amc / 30;
          const days = v.valid && adc > 0 ? v.balance / adc : null;
          perBranch.push({ loc: b, balance: v.balance, knownBalance:v.knownBalance, amc: v.amc, adc, days, bucket: v.valid ? bucketize(days, target, v.balance, adc) : "no_data" });
        }

        const brAdc = brAmc / 30;
        const branchesAligned = snapshotDates.size <= 1;
        const brDays = complete && branchesAligned && brAdc > 0 ? brBalance / brAdc : null;
        let mainBalance = 0;
        let mainPresent = false;
        for (const m of mainStores) {
          const v = perItemLoc.get(`${key}|${locationKey(m.name, m.type)}`);
          if (!v) continue;
          mainPresent = true;
          mainBalance += v.balance;
          mainBalancesKnown &&= v.knownBalance;
          snapshotDates.add(v.snapshot);
        }
        const mainDays = mainPresent && mainBalancesKnown && complete && snapshotDates.size <= 1 && brAdc > 0 ? mainBalance / brAdc : null;
        const hospitalBalance = brBalance + mainBalance;
        const hospitalDays = mainPresent && mainBalancesKnown && complete && snapshotDates.size <= 1 && brAdc > 0 ? hospitalBalance / brAdc : null;

        return {
          key,
          itemName: displayLabel(sample).name,
          tradeNames: Array.from(meta.tradeNames),
          itemSub: displayLabel(sample).sub,
          itemHref: displayLabel(sample).href,
          aliasCount: meta.aliasCount,
          reviewCount: meta.reviewCount,
          itemCode: sample.item_code,
          scientificName: sample.scientific_name,
          unit: sample.unit,
          brBalance,
          brBalancesKnown,
          mainBalancesKnown,
          brAmc,
          brAdc,
          brDays,
          brBucket: complete && branchesAligned ? bucketize(brDays, target, brBalance, brAdc) : "no_data" as CoverageBucket,
          mainBalance,
          mainPresent,
          mainDays,
          mainBucket: hasMain ? !mainBalancesKnown||!complete||snapshotDates.size>1?'no_data' as CoverageBucket:bucketize(mainDays, target, mainBalance, brAdc, false) : null,
          hospitalBalance,
          hospitalDays,
          hospitalBucket: hasMain ? !mainBalancesKnown||!complete||snapshotDates.size>1?'no_data' as CoverageBucket:bucketize(hospitalDays, target, hospitalBalance, brAdc, false) : null,
          perBranch,
        };
      })
      .filter((r) => r.perBranch.length > 0 || r.mainPresent);
  }, [branches, hasMain, mainStores, movements, perItemLoc, target, analysisMode, dictMap, includeUnreviewed]);

  const filtered = useMemo(() => {
    const s = normalize(q);
    return rows.filter((r) => {
      if (s) {
        const hay = normalize(`${r.itemName} ${r.tradeNames.join(" ")} ${r.itemCode || ""} ${r.scientificName || ""}`);
        if (!hay.includes(s)) return false;
      }
      if (scope.startsWith("branch:")) {
        const bid = scope.slice("branch:".length);
        return r.perBranch.some((b) => b.loc.id === bid);
      }
      return true;
    });
  }, [q, rows, scope]);

  function recommendation(r: (typeof rows)[number]) {
    if (scope.startsWith("branch:")) {
      const bid = scope.slice("branch:".length);
      const b = r.perBranch.find((x) => x.loc.id === bid);
      if (!b) return "—";
      if (b.bucket === "deadstock") return "صنف راكد — راجع جدوى الاحتفاظ به.";
      if (b.bucket === "no_data") return "الرصيد أو المنصرف غير مؤكد؛ راجع البيانات والحركات.";
      if (b.days != null && b.days < target) {
        if (r.mainPresent && r.mainDays != null && r.mainDays >= target) return `اصرف من المخزن الرئيسي إلى ${b.loc.name}.`;
        const donor = r.perBranch.find((x) => x.loc.id !== bid && x.days != null && x.days > target * 2);
        if (donor) return `اقترح تحويل من ${donor.loc.name} (لديها فائض).`;
        if (!r.mainPresent) return "ناقصة — لا يمكن تحديد قرار الشراء بدون بيانات المخزن الرئيسي.";
        return "يحتاج إلى طلب توريد أو شراء.";
      }
      if (b.bucket === "very_over") return "كمية فائضة جدًا — حوّلها لصيدلية تحتاجها.";
      if (b.bucket === "over") return "كمية زائدة — تابع الاستهلاك.";
      return "ضمن الحد الآمن.";
    }
    if (r.brBucket === "deadstock") return "صنف راكد على مستوى الصيدليات الفرعية.";
    if (r.brBucket === "no_data") return "بيانات غير كافية.";
    const brNeeds = r.brDays != null && r.brDays < target;
    if (brNeeds && !hasMain) return "الصيدليات الفرعية أقل من هدف التغطية، لكن لا يمكن تحديد قرار الشراء بدون رصيد المخزن الرئيسي.";
    if (brNeeds && hasMain && r.mainDays != null && r.mainDays >= target) return "اصرف من المخزن الرئيسي إلى الصيدليات الناقصة.";
    if (hasMain && r.hospitalDays != null && r.hospitalDays < target) return "يحتاج الصنف إلى طلب توريد أو شراء.";
    if (r.brBucket === "very_over") return "كمية فائضة جدًا — أعد التوزيع.";
    if (r.brBucket === "over") return "كمية زائدة على مستوى الصيدليات الفرعية.";
    return "ضمن الحد الآمن.";
  }

  function whyText(r: (typeof rows)[number]) {
    if (scope.startsWith("branch:")) {
      const bid = scope.slice("branch:".length);
      const b = r.perBranch.find((x) => x.loc.id === bid);
      if (!b) return "—";
      if (b.bucket==='no_data') return 'الرصيد أو المنصرف غير مؤكد؛ القيم الغائبة ليست صفرًا.';
      if (b.adc <= 0) return b.balance > 0 ? `لا يوجد صرف من هذا الصنف في ${b.loc.name} رغم وجود رصيد ${fmtNum(b.balance)} وحدة.` : `لا يوجد رصيد ولا صرف من هذا الصنف في ${b.loc.name}.`;
      return `هذا الصنف يغطي ${b.days!.toFixed(0)} يوم في ${b.loc.name}، لأن الرصيد الحالي ${fmtNum(b.balance)} وحدة ومتوسط الصرف اليومي ${fmtNum(b.adc, 1)} وحدة.`;
    }
    if (r.brBucket==='no_data') return 'الرصيد أو المنصرف غير مؤكد؛ راجع تواريخ الأرصدة والحركات.';
    if (r.brAdc <= 0) return r.brBalance > 0 ? `لا يوجد صرف على مستوى الصيدليات الفرعية رغم وجود رصيد ${(r.brBalancesKnown ? fmtNum(r.brBalance) : "غير مكتمل")} وحدة.` : "لا يوجد رصيد ولا صرف على مستوى الصيدليات الفرعية.";
    return `الصيدليات الفرعية تغطي ${r.brDays!.toFixed(0)} يوم: رصيد ${(r.brBalancesKnown ? fmtNum(r.brBalance) : "غير مكتمل")} ÷ متوسط الصرف اليومي ${fmtNum(r.brAdc, 1)}.`;
  }

  const loading = batchesQuery.isLoading || movementsQuery.isLoading || transactionsQuery.isLoading;
  const showBranchCol = scope.startsWith("branch:");
  const noSavedData = !loading && batches.length === 0;
  const selectedMonthValue = effectiveMonth || "";
  const detailed = viewMode === "detailed";

  function scopeLabel(r: (typeof rows)[number]): string {
    if (showBranchCol) {
      const bid = scope.slice("branch:".length);
      const b = r.perBranch.find((x) => x.loc.id === bid);
      return b?.loc.name || "—";
    }
    if (scope === "main") return "المخزن الرئيسي";
    if (scope === "hospital") return "إجمالي المستشفى";
    return "إجمالي الصيدليات الفرعية";
  }

  return (
    <div className="p-8 max-w-[1600px]">
      <PageHeader
        title="تحليل المواد العلاجية"
        description="حساب أيام التغطية من البيانات المحفوظة فعليًا بعد رفع ملفات Excel."
      />
      {transactionsQuery.isError&&<p role="alert" className="p-3 border rounded">تعذر قراءة الحركات؛ لا تعتمد الأرصدة الحالية قبل إعادة المحاولة.</p>}

      <Card className="p-5 mb-4">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground block mb-1">طريقة التحليل</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={analysisMode}
              onChange={(e) => setAnalysisMode(e.target.value as AnalysisMode)}
            >
              <option value="group">حسب المادة الفعالة + التركيز + الشكل (موصى به)</option>
              <option value="ingredient">حسب المادة الفعالة والتركيز</option>
              <option value="raw">حسب الصنف كما في الملف</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">مصدر البيانات</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm"
              value={dataMode}
              onChange={(e) => setDataMode(e.target.value as "latest" | "month" | "all")}
            >
              <option value="latest">آخر ملف مرفوع</option>
              <option value="month">الشهر</option>
              <option value="all">كل الملفات المحفوظة</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">الشهر</label>
            <Input
              type="month"
              value={selectedMonthValue}
              disabled={dataMode !== "month"}
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">بحث</label>
            <Input placeholder="اسم المادة أو الكود..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">نطاق التحليل</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all_branches">إجمالي الصيدليات الفرعية</option>
              {branches.map((b) => <option key={b.id} value={`branch:${b.id}`}>صيدلية: {b.name}</option>)}
              {hasMain && <option value="main">المخزن الرئيسي</option>}
              {hasMain && <option value="hospital">إجمالي المستشفى</option>}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">هدف التغطية (يوم)</label>
            <select className="w-full rounded-md border border-input bg-background px-3 h-10 text-sm" value={target} onChange={(e) => setTarget(Number(e.target.value))}>
              <option value={14}>14 يوم</option>
              <option value={30}>30 يوم</option>
              <option value={60}>60 يوم</option>
              <option value={90}>90 يوم</option>
            </select>
          </div>
        </div>
        {analysisMode !== "raw" && (
          <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={includeUnreviewed} onChange={(e) => setIncludeUnreviewed(e.target.checked)} />
            تضمين الأصناف غير المعتمدة في التجميع (افتراضيًا تُعرض كأصناف منفصلة)
          </label>
        )}
      </Card>

      {analysisMode === "ingredient" && (
        <Card className="p-4 mb-4 border-amber-500/40 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              هذا التحليل قد يدمج أشكالًا أو تركيزات مختلفة (مثل 500 mg مع 1 gm، أو tablet مع syrup).
              استخدمه للمراجعة العامة فقط وليس لاتخاذ قرارات صرف أو تحويل.
              يفضل استخدام "حسب المادة الفعالة + التركيز + الشكل".
            </div>
          </div>
        </Card>
      )}

      {sourceText && (
        <Card className="p-4 mb-4 text-sm border-primary/20 bg-primary-soft/30">
          <div className="font-medium text-primary">{sourceText}</div>
          {hasMain && mainStoreSources.length > 0 && (
            <div className="text-xs text-primary/80 mt-1">
              مصدر رصيد المخزن الرئيسي: عمود {mainStoreSources.join("، ")}
            </div>
          )}
          {selectedBatchId && <div className="text-xs text-muted-foreground mt-1">upload_batch_id: <span dir="ltr">{selectedBatchId}</span></div>}
        </Card>
      )}

      {!hasMain && movements.length > 0 && (
        <div className="mb-4 text-xs text-amber-600 dark:text-amber-400">
          لا توجد بيانات كافية لحساب تغطية المخزن الرئيسي أو إجمالي المستشفى. البيانات الحالية تحتوي على صيدليات فرعية فقط.
        </div>
      )}

      <Card className="p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="text-xs text-muted-foreground">
            وضع العرض: <span className="font-medium text-foreground">{detailed ? "تفصيلي" : "مبسط"}</span>
            {!detailed && " — يعرض اسم الصنف، النطاق، أيام التغطية، الحالة، الإجراء فقط."}
          </div>
          <div className="inline-flex rounded-md border border-input overflow-hidden text-sm">
            <button
              onClick={() => setViewMode("simple")}
              className={`px-3 h-9 ${!detailed ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              عرض مبسط
            </button>
            <button
              onClick={() => setViewMode("detailed")}
              className={`px-3 h-9 border-r border-input ${detailed ? "bg-primary text-primary-foreground" : "bg-background"}`}>
              عرض تفصيلي
            </button>
          </div>
        </div>
        {loading ? (
          <div className="text-muted-foreground">جارٍ التحميل...</div>
        ) : noSavedData || movements.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد بيانات محفوظة للتحليل. من فضلك ارفع ملفًا واحفظه أولًا.</div>
        ) : filtered.length === 0 ? (
          <div className="text-muted-foreground text-center py-8">لا توجد نتائج مطابقة</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-right p-2 sticky right-0 bg-card min-w-[300px] w-[26%]">المادة العلاجية</th>
                  <th className="text-right p-2 min-w-[140px]">الصيدلية / النطاق</th>
                  {detailed && <th className="text-right p-2">رصيد الفرعية</th>}
                  {detailed && <th className="text-right p-2">متوسط منصرف (30 يومًا)</th>}
                  {detailed && <th className="text-right p-2">متوسط يومي</th>}
                  <th className="text-right p-2 whitespace-nowrap">يكفي (يوم)</th>
                  {detailed && hasMain && <th className="text-right p-2">رصيد المخزن الرئيسي</th>}
                  {detailed && hasMain && <th className="text-right p-2 whitespace-nowrap">تغطية المخزن (يوم)</th>}
                  {detailed && hasMain && <th className="text-right p-2">إجمالي رصيد المستشفى</th>}
                  {detailed && hasMain && <th className="text-right p-2 whitespace-nowrap">تغطية المستشفى (يوم)</th>}
                  <th className="text-right p-2">الحالة</th>
                  <th className="text-right p-2 min-w-[240px]">الإجراء المقترح</th>
                  {detailed && <th className="text-right p-2 min-w-[280px]">الشرح</th>}
                  <th className="text-right p-2 w-[1%] whitespace-nowrap">تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isOpen = !!expanded[r.key];
                  const toggle = () => setExpanded((s) => ({ ...s, [r.key]: !s[r.key] }));
                  if (showBranchCol) {
                    const bid = scope.slice("branch:".length);
                    const b = r.perBranch.find((x) => x.loc.id === bid);
                    if (!b) return null;
                    return (
                    <Fragment key={r.key}>
                      <tr key={r.key} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-2 sticky right-0 bg-card font-medium align-top min-w-[300px] max-w-[420px]">
                          <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} href={r.itemHref} />
                          {analysisMode !== "raw" && r.aliasCount > 1 && (
                            <div className="text-[11px] text-muted-foreground mt-1">يحتوي على {r.aliasCount} اسم من الملف{r.reviewCount > 0 ? ` — ${r.reviewCount} يحتاج مراجعة` : ""}</div>
                          )}
                        </td>
                        <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{b.loc.name}</td>
                        {detailed && <td className="p-2 align-top whitespace-nowrap">{b.knownBalance?fmtNum(b.balance):'غير مؤكد'}</td>}
                        {detailed && <td className="p-2 align-top whitespace-nowrap">{fmtNum(b.amc, 1)}</td>}
                        {detailed && <td className="p-2 align-top whitespace-nowrap">{fmtNum(b.adc, 2)}</td>}
                        <td className="p-2 align-top whitespace-nowrap font-semibold">{b.days == null ? "—" : `${b.days.toFixed(0)} يوم`}</td>
                        {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{(r.mainPresent && r.mainBalancesKnown ? fmtNum(r.mainBalance) : "غير مسجل")}</td>}
                        {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{r.mainDays == null ? "—" : `${r.mainDays.toFixed(0)} يوم`}</td>}
                        {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{(r.mainPresent && r.mainBalancesKnown && r.brBalancesKnown ? fmtNum(r.hospitalBalance) : "غير مكتمل")}</td>}
                        {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{r.hospitalDays == null ? "—" : `${r.hospitalDays.toFixed(0)} يوم`}</td>}
                        <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${BUCKET_CLASS[b.bucket]}`}>{BUCKET_LABEL[b.bucket]}</span></td>
                        <td className="p-2 text-xs align-top whitespace-normal break-words" dir="auto">{recommendation(r)}</td>
                        {detailed && <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{whyText(r)}</td>}
                        <td className="p-2 align-top">
                          <Button size="sm" variant="outline" onClick={toggle} className="whitespace-nowrap">
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            {isOpen ? "إخفاء" : "عرض التفاصيل"}
                          </Button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-muted/30 border-b border-border/50">
                          <td colSpan={20} className="p-4 text-xs">
                            <DetailsBlock title={`تفاصيل: ${r.itemName} — ${b.loc.name}`}
                              items={[
                                ["رصيد الصيدلية", b.knownBalance?fmtNum(b.balance):'غير مؤكد'],
                                ["متوسط منصرف (30 يومًا)", fmtNum(b.amc, 1)],
                                ["متوسط يومي", fmtNum(b.adc, 2)],
                                ["تغطية الصيدلية (يوم)", b.days == null ? "—" : `${b.days.toFixed(0)}`],
                                ...(hasMain ? ([
                                  ["رصيد المخزن الرئيسي", (r.mainPresent && r.mainBalancesKnown ? fmtNum(r.mainBalance) : "غير مسجل")],
                                  ["تغطية المخزن (يوم)", r.mainDays == null ? "—" : `${r.mainDays.toFixed(0)}`],
                                  ["إجمالي رصيد المستشفى", (r.mainPresent && r.mainBalancesKnown && r.brBalancesKnown ? fmtNum(r.hospitalBalance) : "غير مكتمل")],
                                  ["تغطية المستشفى (يوم)", r.hospitalDays == null ? "—" : `${r.hospitalDays.toFixed(0)}`],
                                ] as [string, string][]) : []),
                              ]}
                              calc={b.knownBalance?`الحساب: ${fmtNum(b.balance)} ÷ ${fmtNum(b.adc, 2)} = ${b.days == null ? "—" : b.days.toFixed(1)} يوم (هدف ${target}).`:'لا تحسب التغطية من رصيد غير مؤكد.'}
                              why={whyText(r)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    );
                  }

                  const bucket = scope === "main" && r.mainBucket ? r.mainBucket : scope === "hospital" && r.hospitalBucket ? r.hospitalBucket : r.brBucket;
                  return (
                  <Fragment key={r.key}>
                    <tr key={r.key} className="border-b border-border/50 hover:bg-muted/30">
                      <td className="p-2 sticky right-0 bg-card font-medium align-top min-w-[300px] max-w-[420px]">
                        <ItemIdentity name={r.itemName} tradeNames={r.tradeNames} href={r.itemHref} />
                        {analysisMode === "raw" && (r.itemCode || r.scientificName) && <div className="text-[11px] text-muted-foreground mt-1 whitespace-normal break-words" dir="auto">{r.itemCode || ""} {r.scientificName ? `— ${r.scientificName}` : ""}</div>}
                        {analysisMode !== "raw" && r.aliasCount > 1 && (
                          <div className="text-[11px] text-muted-foreground mt-1">يحتوي على {r.aliasCount} اسم من الملف{r.reviewCount > 0 ? ` — ${r.reviewCount} يحتاج مراجعة` : ""}</div>
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{scopeLabel(r)}</td>
                      {detailed && <td className="p-2 align-top whitespace-nowrap">{(r.brBalancesKnown ? fmtNum(r.brBalance) : "غير مكتمل")}</td>}
                      {detailed && <td className="p-2 align-top whitespace-nowrap">{fmtNum(r.brAmc, 1)}</td>}
                      {detailed && <td className="p-2 align-top whitespace-nowrap">{fmtNum(r.brAdc, 2)}</td>}
                      <td className="p-2 align-top whitespace-nowrap font-semibold">{r.brDays == null ? "—" : `${r.brDays.toFixed(0)} يوم`}</td>
                      {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{(r.mainPresent && r.mainBalancesKnown ? fmtNum(r.mainBalance) : "غير مسجل")}</td>}
                      {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{r.mainDays == null ? "—" : `${r.mainDays.toFixed(0)} يوم`}</td>}
                      {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{(r.mainPresent && r.mainBalancesKnown && r.brBalancesKnown ? fmtNum(r.hospitalBalance) : "غير مكتمل")}</td>}
                      {detailed && hasMain && <td className="p-2 align-top whitespace-nowrap">{r.hospitalDays == null ? "—" : `${r.hospitalDays.toFixed(0)} يوم`}</td>}
                      <td className="p-2"><span className={`px-2 py-1 rounded text-xs ${BUCKET_CLASS[bucket]}`}>{BUCKET_LABEL[bucket]}</span></td>
                      <td className="p-2 text-xs align-top whitespace-normal break-words" dir="auto">{recommendation(r)}</td>
                      {detailed && <td className="p-2 text-xs text-muted-foreground align-top whitespace-normal break-words" dir="auto">{whyText(r)}</td>}
                      <td className="p-2 align-top">
                        <Button size="sm" variant="outline" onClick={toggle} className="whitespace-nowrap">
                          {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          {isOpen ? "إخفاء" : "عرض التفاصيل"}
                        </Button>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-muted/30 border-b border-border/50">
                        <td colSpan={20} className="p-4 text-xs">
                          <DetailsBlock title={`تفاصيل: ${r.itemName} — ${scopeLabel(r)}`}
                            items={[
                              ["رصيد الصيدليات الفرعية", (r.brBalancesKnown ? fmtNum(r.brBalance) : "غير مكتمل")],
                              ["متوسط منصرف الفروع (30 يومًا)", fmtNum(r.brAmc, 1)],
                              ["متوسط يومي", fmtNum(r.brAdc, 2)],
                              ["تغطية الفرعية (يوم)", r.brDays == null ? "—" : `${r.brDays.toFixed(0)}`],
                              ...(hasMain ? ([
                                ["رصيد المخزن الرئيسي", (r.mainPresent && r.mainBalancesKnown ? fmtNum(r.mainBalance) : "غير مسجل")],
                                ["تغطية المخزن (يوم)", r.mainDays == null ? "—" : `${r.mainDays.toFixed(0)}`],
                                ["إجمالي رصيد المستشفى", (r.mainPresent && r.mainBalancesKnown && r.brBalancesKnown ? fmtNum(r.hospitalBalance) : "غير مكتمل")],
                                ["تغطية المستشفى (يوم)", r.hospitalDays == null ? "—" : `${r.hospitalDays.toFixed(0)}`],
                              ] as [string, string][]) : []),
                            ]}
                            calc={`الحساب: ${(r.brBalancesKnown ? fmtNum(r.brBalance) : "غير مكتمل")} ÷ ${fmtNum(r.brAdc, 2)} = ${r.brDays == null ? "—" : r.brDays.toFixed(1)} يوم (هدف ${target}).`}
                            why={whyText(r)} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 text-xs text-muted-foreground flex flex-wrap gap-3">
        <span>التصنيف بناءً على هدف {target} يوم:</span>
        <span>&lt; 7: خطر عالي جدًا</span>
        <span>7-14: خطر</span>
        <span>14-{target}: أقل من الهدف</span>
        <span>{target}-{target * 2}: آمن</span>
        <span>{target * 2}-{target * 3}: زائد</span>
        <span>&gt; {target * 3}: زائد جدًا</span>
      </div>
    </div>
  );
}
