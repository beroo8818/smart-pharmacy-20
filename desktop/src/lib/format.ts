export const fmtNum = (n: number | null | undefined, digits = 0) =>
  n == null || isNaN(Number(n))
    ? "—"
    : Number(n).toLocaleString("ar-EG", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });

export const fmtMonth = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ar-EG", { year: "numeric", month: "long" });
};

export const fmtDate = (d: string | Date) => {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("ar-EG", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};