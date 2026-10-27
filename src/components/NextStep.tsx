import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";

export type NextStepProps = {
  title?: string;
  description: string;
  to: string;
  cta: string;
};

/** Standard "What to do next" box for the end of every page. */
export default function NextStep({ title = "الخطوة التالية", description, to, cta }: NextStepProps) {
  return (
    <Card className="p-5 mt-6 bg-primary/5 border-primary/20" dir="rtl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-primary mb-1">{title}</div>
          <div className="text-sm text-foreground leading-relaxed">{description}</div>
        </div>
        <Link
          to={to}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 shrink-0"
        >
          {cta}
          <ArrowLeft className="w-4 h-4" />
        </Link>
      </div>
    </Card>
  );
}