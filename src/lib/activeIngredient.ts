// Helpers for parsing strength/dosage form and building therapeutic group keys

// Canonical dosage forms with aliases. Order matters: more specific first.
const DOSAGE_FORMS: Array<{ key: string; patterns: RegExp[] }> = [
  { key: "tablet",     patterns: [/\btab(let)?s?\b/i, /\bcomp(rime)?\b/i, /قرص|أقراص/] },
  { key: "capsule",    patterns: [/\bcap(sule)?s?\b/i, /كبسول/] },
  { key: "vial",       patterns: [/\bvial\b/i, /فيال|قارورة/] },
  { key: "ampoule",    patterns: [/\bamp(oule|s)?\b/i, /أمبول|امبول/] },
  { key: "syrup",      patterns: [/\bsyrup\b/i, /شراب/] },
  { key: "suspension", patterns: [/\bsusp(ension)?\b/i, /معلق/] },
  { key: "solution",   patterns: [/\bsol(ution)?\b/i, /محلول/] },
  { key: "infusion",   patterns: [/\binfusion\b/i, /\bIV bag\b/i, /تنقيط|محلول وريدي/] },
  { key: "injection",  patterns: [/\binj(ection)?\b/i, /حقن/] },
  { key: "drops",      patterns: [/\bdrops?\b/i, /قطرة|نقط/] },
  { key: "cream",      patterns: [/\bcream\b/i, /كريم/] },
  { key: "ointment",   patterns: [/\boint(ment)?\b/i, /مرهم/] },
  { key: "gel",        patterns: [/\bgel\b/i, /جل/] },
  { key: "spray",      patterns: [/\bspray\b/i, /بخاخ/] },
  { key: "inhaler",    patterns: [/\binhaler\b/i, /بخاخة/] },
  { key: "suppository",patterns: [/\bsupp(ository)?\b/i, /لبوس|تحاميل/] },
  { key: "patch",      patterns: [/\bpatch\b/i, /لاصق/] },
  { key: "powder",     patterns: [/\bpowder\b/i, /مسحوق|بودر/] },
];

// Forms that must NEVER be auto-merged together even with same ingredient.
export const ROUTE_OF: Record<string, string> = {
  tablet: "oral", capsule: "oral", syrup: "oral", suspension: "oral", solution: "oral",
  vial: "parenteral", ampoule: "parenteral", injection: "parenteral", infusion: "parenteral",
  drops: "topical", cream: "topical", ointment: "topical", gel: "topical", spray: "topical",
  inhaler: "inhalation", suppository: "rectal", patch: "transdermal", powder: "other",
};

export function extractDosageForms(...sources: (string | null | undefined)[]): string[] {
  const text = sources.filter(Boolean).join(" ");
  if (!text) return [];
  const found = new Set<string>();
  for (const f of DOSAGE_FORMS) {
    if (f.patterns.some((p) => p.test(text))) found.add(f.key);
  }
  return Array.from(found);
}
export function extractDosageForm(...sources: (string | null | undefined)[]): string | null {
  return extractDosageForms(...sources)[0] || null;
}

// Match patterns like "500 mg", "1g", "5%", "10 mcg", "250mg/5ml"
const STRENGTH_RE = /(\d+(?:[.,]\d+)?)\s*(mg\/ml|mcg\/ml|g\/ml|iu\/ml|iu|mg|mcg|gm|g|ml|l|%)\b/gi;

function normUnit(u: string): string {
  const x = u.toLowerCase();
  if (x === "g") return "gm";
  return x;
}

export function extractStrengths(...sources: (string | null | undefined)[]): string[] {
  const text = sources.filter(Boolean).join(" ");
  if (!text) return [];
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  STRENGTH_RE.lastIndex = 0;
  while ((m = STRENGTH_RE.exec(text)) !== null) {
    const num = m[1].replace(",", ".");
    out.add(`${num} ${normUnit(m[2])}`);
  }
  return Array.from(out);
}
export function extractStrength(...sources: (string | null | undefined)[]): string | null {
  return extractStrengths(...sources)[0] || null;
}

function cleanName(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(STRENGTH_RE, " ")
    .replace(/\b(vial|amp(oule)?s?|tab(let)?s?|cap(sule)?s?|syrup|susp(ension)?|drops?|cream|oint(ment)?|gel|spray|inhaler|supp(ository)?|patch|powder|sol(ution)?|inj(ection)?|infusion)\b/gi, " ")
    .replace(/[()\[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractActiveIngredient(
  scientificName?: string | null,
  originalName?: string | null,
  tradeName?: string | null,
): string | null {
  const candidate = scientificName || originalName || tradeName || "";
  const cleaned = cleanName(candidate);
  if (!cleaned) return null;
  // take first 1-3 latin words as ingredient
  const m = cleaned.match(/[A-Za-z][A-Za-z\-\/]+(?:\s+[A-Za-z][A-Za-z\-\/]+){0,2}/);
  return (m ? m[0] : cleaned).toLowerCase();
}

export function normalize(s: string | null | undefined): string {
  return (s || "").toString().trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildTherapeuticGroupKey(parts: {
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  unit?: string | null;
}): string | null {
  const ai = normalize(parts.active_ingredient);
  const st = normalize(parts.strength);
  const df = normalize(parts.dosage_form);
  const un = normalize(parts.unit);
  if (!ai || !st || !df) return null; // SAFETY: never group when strength or form missing
  return [ai, st, df, un].filter(Boolean).join(" | ");
}

export function buildStandardName(parts: {
  active_ingredient?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
}): string | null {
  const ai = parts.active_ingredient?.trim();
  if (!ai) return null;
  const cap = ai.replace(/\b\w/g, (c) => c.toUpperCase());
  return [cap, parts.strength, parts.dosage_form].filter(Boolean).join(" ");
}

export interface DictionaryDraft {
  original_item_name: string;
  scientific_name: string | null;
  trade_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  unit: string | null;
  standard_name: string | null;
  therapeutic_group_key: string | null;
  confidence_score: number;
  needs_review: boolean;
}

export function buildDictionaryDraft(input: {
  original_item_name?: string | null;
  scientific_name?: string | null;
  trade_name?: string | null;
  unit?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
}): DictionaryDraft | null {
  const original = (input.original_item_name || input.scientific_name || input.trade_name || "").trim();
  if (!original) return null;
  const strengthsAll = extractStrengths(input.scientific_name, original, input.trade_name);
  const formsAll = extractDosageForms(input.scientific_name, original, input.trade_name, input.unit);
  const ambiguousStrength = strengthsAll.length > 1 && !input.strength;
  const ambiguousForm = formsAll.length > 1 && !input.dosage_form;
  const strength = input.strength || (strengthsAll.length === 1 ? strengthsAll[0] : null);
  const dosage_form = input.dosage_form || (formsAll.length === 1 ? formsAll[0] : null);
  const active_ingredient = extractActiveIngredient(input.scientific_name, original, input.trade_name);
  const therapeutic_group_key = buildTherapeuticGroupKey({
    active_ingredient, strength, dosage_form, unit: input.unit,
  });
  const standard_name = buildStandardName({ active_ingredient, strength, dosage_form });
  // Confidence tiers
  let score = 0;
  if (active_ingredient) score += 0.4;
  if (strength) score += 0.3;
  if (dosage_form) score += 0.2;
  if (input.unit) score += 0.1;
  if (ambiguousStrength || ambiguousForm) score = Math.min(score, 0.4);
  const needs_review = !active_ingredient || !strength || !dosage_form || ambiguousStrength || ambiguousForm || score < 0.8;
  return {
    original_item_name: original,
    scientific_name: input.scientific_name || null,
    trade_name: input.trade_name || null,
    active_ingredient,
    strength,
    dosage_form,
    unit: input.unit || null,
    standard_name,
    therapeutic_group_key,
    confidence_score: Number(score.toFixed(2)),
    needs_review,
  };
}