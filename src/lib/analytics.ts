// Core inventory analytics: AMC, MoS, Safety Stock, Reorder Point, status, forecasting

export type StockStatus = "shortage" | "overstock" | "deadstock" | "expiry" | "ok";

export interface MovementRow {
  month: string; // YYYY-MM-01
  issued_qty: number;
  closing_balance: number;
  expiry_date?: string | null;
}

// Average Monthly Consumption
export function amc(rows: MovementRow[]): number {
  if (!rows.length) return 0;
  const issued = rows.map((r) => Number(r.issued_qty) || 0);
  return issued.reduce((a, b) => a + b, 0) / issued.length;
}

// Weighted Moving Average — recent months get more weight
export function weightedMA(rows: MovementRow[]): number {
  if (!rows.length) return 0;
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  let totalW = 0;
  let sum = 0;
  sorted.forEach((r, i) => {
    const w = i + 1;
    totalW += w;
    sum += w * (Number(r.issued_qty) || 0);
  });
  return totalW ? sum / totalW : 0;
}

// Simple Exponential Smoothing
export function expSmoothing(rows: MovementRow[], alpha = 0.4): number {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  if (!sorted.length) return 0;
  let s = Number(sorted[0].issued_qty) || 0;
  for (let i = 1; i < sorted.length; i++) {
    s = alpha * (Number(sorted[i].issued_qty) || 0) + (1 - alpha) * s;
  }
  return s;
}

export interface ItemAnalytics {
  amc: number;
  maxIssued: number;
  minIssued: number;
  trend: "rising" | "falling" | "stable" | "volatile";
  currentBalance: number;
  monthsOfStock: number;
  forecastNext: number;
  forecast3: number;
  safetyStock: number;
  reorderPoint: number;
  status: StockStatus;
  severity: "low" | "medium" | "high";
  why: string;
  action: string;
  confidence: "high" | "medium" | "low";
}

export interface AnalyticsConfig {
  safetyPct?: number; // default 0.25
  leadTimeDays?: number; // default 30
  overStockMonths?: number; // default 6
  deadStockMonths?: number; // default 6 — no movement window
  shortageMos?: number; // default 1.0 months of stock threshold
}

export function analyzeItem(
  rows: MovementRow[],
  cfg: AnalyticsConfig = {}
): ItemAnalytics {
  const {
    safetyPct = 0.25,
    leadTimeDays = 30,
    overStockMonths = 6,
    deadStockMonths = 6,
    shortageMos = 1.0,
  } = cfg;

  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const issued = sorted.map((r) => Number(r.issued_qty) || 0);
  const _amc = amc(sorted);
  const maxIssued = issued.length ? Math.max(...issued) : 0;
  const minIssued = issued.length ? Math.min(...issued) : 0;
  const current =
    sorted.length > 0
      ? Number(sorted[sorted.length - 1].closing_balance) || 0
      : 0;

  // Trend: compare first half mean vs second half mean
  let trend: ItemAnalytics["trend"] = "stable";
  if (issued.length >= 4) {
    const mid = Math.floor(issued.length / 2);
    const a = issued.slice(0, mid).reduce((x, y) => x + y, 0) / mid;
    const b =
      issued.slice(mid).reduce((x, y) => x + y, 0) / (issued.length - mid);
    const variance =
      issued.reduce((acc, v) => acc + Math.pow(v - _amc, 2), 0) /
      issued.length;
    const cv = _amc ? Math.sqrt(variance) / _amc : 0;
    if (cv > 0.6) trend = "volatile";
    else if (b > a * 1.15) trend = "rising";
    else if (b < a * 0.85) trend = "falling";
  }

  // Forecast
  const forecastNext = weightedMA(sorted) || _amc;
  const forecast3 = forecastNext * 3;

  const monthsOfStock = _amc > 0 ? current / _amc : current > 0 ? 99 : 0;
  const leadMonths = leadTimeDays / 30;
  const safetyStock = _amc * safetyPct;
  const reorderPoint = _amc * leadMonths + safetyStock;

  // Last movement
  let monthsWithoutMovement = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if ((Number(sorted[i].issued_qty) || 0) > 0) break;
    monthsWithoutMovement++;
  }

  // Expiry check
  const earliestExpiry = sorted
    .map((r) => r.expiry_date)
    .filter(Boolean)
    .map((d) => new Date(d as string).getTime())
    .sort()[0];
  const monthsToExpiry = earliestExpiry
    ? (earliestExpiry - Date.now()) / (1000 * 60 * 60 * 24 * 30)
    : Infinity;

  let status: StockStatus = "ok";
  let severity: ItemAnalytics["severity"] = "low";
  let why = "الرصيد ضمن الحدود الآمنة.";
  let action = "لا حاجة لإجراء الآن.";

  if (monthsToExpiry < 6 && current > 0 && current > _amc * monthsToExpiry) {
    status = "expiry";
    severity = monthsToExpiry < 3 ? "high" : "medium";
    why = `أقرب تاريخ انتهاء صلاحية خلال ${monthsToExpiry.toFixed(
      1
    )} شهر، والكمية المتاحة (${current.toFixed(
      0
    )}) أكبر مما يمكن استهلاكه قبل الانتهاء.`;
    action = "استخدم الكمية قريبة الانتهاء أولًا أو حوّلها لمكان يحتاجها.";
  } else if (monthsWithoutMovement >= deadStockMonths && current > 0) {
    status = "deadstock";
    severity = "medium";
    why = `لم يُصرف من هذا الصنف منذ ${monthsWithoutMovement} شهرًا، والرصيد الحالي ${current.toFixed(
      0
    )} وحدة.`;
    action = "راجع لجنة الصيدلة لتقييم استمرار الاحتفاظ بالصنف.";
  } else if (current < reorderPoint || monthsOfStock < shortageMos) {
    status = "shortage";
    severity = monthsOfStock < 0.5 ? "high" : "medium";
    why = `الرصيد الحالي (${current.toFixed(
      0
    )}) يغطي ${monthsOfStock.toFixed(
      1
    )} شهر فقط، ومتوسط الصرف الشهري ${_amc.toFixed(0)} وحدة.`;
    action = `اطلب كمية لا تقل عن ${Math.max(
      0,
      Math.ceil(reorderPoint - current + _amc)
    )} وحدة لتغطية فترة التوريد ومخزون الأمان.`;
  } else if (monthsOfStock > overStockMonths) {
    status = "overstock";
    severity = monthsOfStock > overStockMonths * 1.5 ? "high" : "medium";
    why = `الرصيد يكفي لـ${monthsOfStock.toFixed(
      1
    )} شهر، وهو أعلى من الحد المسموح (${overStockMonths} شهور).`;
    action = "لا تطلب هذا الشهر، وفكر بتحويل الفائض لصيدلية ناقصة.";
  }

  // Confidence
  let confidence: "high" | "medium" | "low" = "low";
  if (issued.length >= 8 && trend !== "volatile") confidence = "high";
  else if (issued.length >= 4) confidence = "medium";

  return {
    amc: _amc,
    maxIssued,
    minIssued,
    trend,
    currentBalance: current,
    monthsOfStock,
    forecastNext,
    forecast3,
    safetyStock,
    reorderPoint,
    status,
    severity,
    why,
    action,
    confidence,
  };
}

export const STATUS_LABEL_AR: Record<StockStatus, string> = {
  shortage: "نقص متوقع",
  overstock: "زيادة",
  deadstock: "راكد",
  expiry: "قرب انتهاء صلاحية",
  ok: "آمن",
};