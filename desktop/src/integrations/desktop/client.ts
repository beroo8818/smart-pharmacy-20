export type Role = "system_admin" | "pharmacy_manager" | "warehouse_keeper" | "viewer";
export interface SessionUser { id: string; username: string; full_name: string; role: Role; }

export interface UploadBatch {
  id: string; file_name: string; month: string; status: string;
  row_count: number; uploaded_by: string | null; uploaded_at: string; notes: string | null;
  snapshot_date?: string | null;
  batch_kind?: string | null;
}

export interface Movement {
  id: string; upload_batch_id: string; item_master_id: string; location_id: string;
  month: string; opening_balance: number; received_qty: number; issued_qty: number;
  closing_balance: number; unit_price: number | null; expiry_date: string | null;
  min_stock: number | null; max_stock: number | null; lead_time_days: number | null;
  item_code: string | null; item_name_ar: string | null; item_name_en: string | null;
  active_ingredient_ar: string | null; strength: string | null;
  dosage_form: string | null; unit: string | null;
  location_name: string; location_type: "main_warehouse" | "sub_pharmacy";
}

type Api = {
  auth: {
    login: (a: { username: string; password: string }) => Promise<{ ok: boolean; token?: string; user?: SessionUser; error?: string }>;
    logout: (a: { token: string }) => Promise<{ ok: boolean }>;
    me: (a: { token: string }) => Promise<{ ok: boolean; user?: SessionUser }>;
    changePassword: (a: { token: string; oldPassword: string; newPassword: string }) => Promise<{ ok: boolean; error?: string }>;
    listUsers: (a: { token: string }) => Promise<{ ok: boolean; users?: any[]; error?: string }>;
    createUser: (a: { token: string; username: string; full_name: string; password: string; role: Role }) => Promise<{ ok: boolean; error?: string }>;
    setUserActive: (a: { token: string; userId: string; active: boolean }) => Promise<{ ok: boolean }>;
  };
  queries: {
    latestBatch: (a: { token: string }) => Promise<{ ok: boolean; batch: UploadBatch | null }>;
    listBatches: (a: { token: string }) => Promise<{ ok: boolean; batches: UploadBatch[] }>;
    movementsByBatch: (a: { token: string; batchId: string }) => Promise<{ ok: boolean; movements: Movement[] }>;
    listBatchesContinuous: (a: { token: string; limit?: number }) => Promise<{ ok: boolean; batches: UploadBatch[] }>;
    movementsByBatchIds: (a: { token: string; batchIds: string[] }) => Promise<{ ok: boolean; movements: Movement[] }>;
    listLocations: (a: { token: string }) => Promise<{ ok: boolean; locations: any[] }>;
    getSettings: () => Promise<{ ok: boolean; settings: Record<string, string> }>;
    setSetting: (a: { token: string; key: string; value: string }) => Promise<{ ok: boolean }>;
  };
  upload: {
    parseExcel: (a: { token: string; filePath?: string }) => Promise<any>;
    saveBatch: (a: any) => Promise<any>;
  };
  backup: {
    export: (a: { token: string }) => Promise<{ ok: boolean; path?: string; error?: string }>;
    restore: (a: { token: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  maintenance: {
    wipeAll: (a: { token: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  stockTxn: {
    list: (a: { token: string; sinceISO?: string; limit?: number }) => Promise<{ ok: boolean; rows?: StockTxn[]; error?: string }>;
    insert: (a: { token: string; txn: Omit<StockTxn, "id" | "created_at" | "created_by"> }) => Promise<{ ok: boolean; id?: string; error?: string }>;
    delete: (a: { token: string; id: string }) => Promise<{ ok: boolean; error?: string }>;
  };
  audit: {
    insert: (a: { token: string; action: string; entity?: string | null; entity_id?: string | null; details?: unknown }) => Promise<{ ok: boolean; id?: number; error?: string }>;
    list: (a: { token: string; limit?: number }) => Promise<{ ok: boolean; rows?: AuditRow[]; error?: string }>;
  };
  app: {
    version: () => Promise<{ ok: boolean; version: string }>;
    dbPath: () => Promise<{ ok: boolean; path: string }>;
  };
};

declare global { interface Window { api?: Api } }

export type StockTxnType =
  | "warehouse_receipt"
  | "warehouse_issue_to_pharmacy"
  | "pharmacy_issue"
  | "pharmacy_transfer"
  | "warehouse_return"
  | "pharmacy_return_to_warehouse";

export interface StockTxn {
  id: string;
  txn_date: string;
  txn_type: StockTxnType;
  item_key: string;
  item_name: string | null;
  item_code: string | null;
  unit: string | null;
  from_location_name: string | null;
  from_location_type: string | null;
  to_location_name: string | null;
  to_location_type: string | null;
  qty: number;
  note: string | null;
  source_batch_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface AuditRow {
  id: number;
  user_id: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  details: string | null;
  at: string;
}

export const STOCK_TXN_LABEL: Record<StockTxnType, string> = {
  warehouse_receipt: "وارد للمخزن",
  warehouse_issue_to_pharmacy: "منصرف من المخزن لصيدلية",
  pharmacy_issue: "منصرف من الصيدلية",
  pharmacy_transfer: "تحويل بين صيدليات",
  warehouse_return: "مرتجع للمخزن",
  pharmacy_return_to_warehouse: "مرتجع من صيدلية للمخزن",
};

function stub(): Api {
  const warn = () => {
    console.warn("[Dawa] window.api unavailable - run via Electron (npm run dev).");
    return Promise.resolve({ ok: false, error: "Electron API غير متاح" });
  };
  const g: Partial<Record<keyof Api, unknown>> = {};
  for (const ns of ["auth", "queries", "upload", "backup", "maintenance", "stockTxn", "audit", "app"]) {
    g[ns] = new Proxy({}, { get: () => warn });
  }
  return g as Api;
}

export const api: Api = (typeof window !== "undefined" ? window.api : undefined) || stub();

const TOKEN_KEY = "dawa_token";
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY) || "",
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};
