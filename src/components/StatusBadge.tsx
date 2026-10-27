import { STATUS_LABEL_AR, StockStatus } from "@/lib/analytics";

const cls: Record<StockStatus, string> = {
  shortage: "status-danger",
  expiry: "status-warning",
  overstock: "status-warning",
  deadstock: "status-info",
  ok: "status-success",
};

export default function StatusBadge({ status }: { status: StockStatus }) {
  return <span className={cls[status]}>{STATUS_LABEL_AR[status]}</span>;
}