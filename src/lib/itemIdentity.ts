import {buildStandardName,extractActiveIngredient,extractDosageForm,extractStrength} from "./activeIngredient";
import type {Movement,DictEntry} from "./batchAnalysis";
export const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export const normalize = (s: unknown) =>
  String(s ?? "").trim().toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ");

export const isMainLocation = (t: string) =>
  t === "main_warehouse" || t === "main_store";

type ItemKeyParts = {
  item_name?: string | null;
  item_code?: string | null;
  scientific_name?: string | null;
  trade_name?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  unit?: string | null;
  therapeutic_group_key?: string | null;
};

export function itemKeyFromParts(parts: ItemKeyParts) {
  const active = extractActiveIngredient(parts.scientific_name, parts.item_name, parts.trade_name);
  const strength = parts.strength || extractStrength(parts.scientific_name, parts.item_name, parts.trade_name);
  const dosage = parts.dosage_form || extractDosageForm(parts.scientific_name, parts.item_name, parts.trade_name, parts.unit);
  if (parts.therapeutic_group_key) return `ai::${[parts.therapeutic_group_key,strength,dosage,parts.unit].map(normalize).join('|')}`;
  if (active && strength) {
    return `ai::${[active, strength, dosage || "", parts.unit || ""].map(normalize).join("|")}`;
  }
  return normalize(parts.item_code || `${parts.item_name || ""}|${parts.scientific_name || ""}|${parts.unit || ""}`);
}

export function itemKeyAliases(r: Movement) {
  const values = [
    r.item_code,
    r.item_name,
    r.scientific_name,
    r.trade_name,
    itemKeyFromParts({...r,therapeutic_group_key:null}),
    r.therapeutic_group_key?`ai::${normalize(r.therapeutic_group_key)}|${normalize(r.unit)}`:null,
    `${r.item_name || ""}|${r.scientific_name || ""}|${r.trade_name || ""}|${r.unit || ""}`,
  ];
  return Array.from(new Set(values.map(normalize).filter(Boolean)));
}

export const itemKey = (r: Movement) => itemKeyFromParts(r);

export function itemDisplayName(r: Movement) {
  const active = extractActiveIngredient(r.scientific_name, r.item_name, r.trade_name);
  const strength = r.strength || extractStrength(r.scientific_name, r.item_name, r.trade_name);
  const dosage = r.dosage_form || extractDosageForm(r.scientific_name, r.item_name, r.trade_name, r.unit);
  return buildStandardName({ active_ingredient: active, strength, dosage_form: dosage })
    || r.scientific_name
    || r.item_name
    || r.trade_name
    || r.item_code
    || "صنف بدون اسم";
}

export function itemTradeNames(r: Movement) {
  const display = normalize(itemDisplayName(r));
  const scientific = normalize(r.scientific_name);
  const values = [r.trade_name, r.item_name]
    .map((v) => (v || "").trim())
    .filter(Boolean)
    .filter((v) => {
      const n = normalize(v);
      return n && n !== display && n !== scientific;
    });
  return Array.from(new Set(values));
}

export function tradeNamesLabel(names?: string[] | null) {
  const clean = Array.from(new Set((names || []).map((n) => n.trim()).filter(Boolean)));
  if (!clean.length) return "";
  return `الاسم التجاري: ${clean.slice(0, 3).join("، ")}${clean.length > 3 ? ` +${clean.length - 3}` : ""}`;
}


export function enrichMovementsWithDictionary(movements: Movement[], dict: Map<string, DictEntry>) {
  return movements.map((m) => {
    const d = dict.get(normalize(m.item_name)) || dict.get(normalize(m.scientific_name)) || dict.get(normalize(m.trade_name));
    if (!d) return m;
    return {
      ...m,
      scientific_name: m.scientific_name || d.active_ingredient || d.scientific_name,
      trade_name: m.trade_name || d.trade_name,
      strength: m.strength || d.strength,
      dosage_form: m.dosage_form || d.dosage_form,
      unit: m.unit || d.unit,
      therapeutic_group_key: m.therapeutic_group_key || d.therapeutic_group_key,
    };
  });
}
