import { tradeNamesLabel } from "@/lib/desktopAnalytics";

type Props = {
  name: string;
  tradeNames?: string[] | null;
  code?: string | null;
  className?: string;
};

export default function ItemIdentity({ name, tradeNames, code, className = "" }: Props) {
  const tradeLabel = tradeNamesLabel(tradeNames);

  return (
    <div className={className}>
      <div className="font-semibold whitespace-normal break-words leading-snug" dir="auto" title={name}>
        {name}
      </div>
      {tradeLabel && (
        <div className="text-[11px] text-muted-fg mt-0.5 whitespace-normal break-words leading-snug" dir="auto">
          {tradeLabel}
        </div>
      )}
      {code && (
        <div className="text-[11px] text-muted-fg mt-0.5 whitespace-normal break-words leading-snug" dir="ltr">
          {code}
        </div>
      )}
    </div>
  );
}
