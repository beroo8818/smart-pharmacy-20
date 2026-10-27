import { tradeNamesLabel } from "@/lib/batchAnalysis";
import { Link } from "react-router-dom";

type Props = {
  name: string;
  tradeNames?: string[] | null;
  code?: string | null;
  href?: string | null;
  className?: string;
};

export default function ItemIdentity({ name, tradeNames, code, href, className = "" }: Props) {
  const tradeLabel = tradeNamesLabel(tradeNames);
  const main = href ? (
    <Link to={href} className="text-primary hover:underline">{name}</Link>
  ) : name;

  return (
    <div className={className}>
      <div className="font-medium whitespace-normal break-words leading-snug" dir="auto" title={name}>
        {main}
      </div>
      {tradeLabel && (
        <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-normal break-words leading-snug" dir="auto">
          {tradeLabel}
        </div>
      )}
      {code && (
        <div className="text-[11px] text-muted-foreground mt-0.5 whitespace-normal break-words leading-snug" dir="auto">
          {code}
        </div>
      )}
    </div>
  );
}
