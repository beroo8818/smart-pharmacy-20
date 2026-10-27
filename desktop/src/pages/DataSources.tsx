import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  Upload,
  CalendarClock,
  Activity,
  GitCompare,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

type Item = {
  to: string;
  icon: any;
  title: string;
  subtitle: string;
  steps: string[];
  cta: string;
  tone: "primary" | "emerald" | "amber" | "violet";
};

const ITEMS: Item[] = [
  {
    to: "/upload",
    icon: Upload,
    title: "رفع ملف شهري",
    subtitle: "ارفع ملف Excel الشهري واحفظ رصيد نهاية الشهر.",
    steps: [
      "اختر ملف Excel",
      "حدّد الشهر وتاريخ الرصيد",
      "راجع الملخص ثم احفظ",
    ],
    cta: "ابدأ الرفع",
    tone: "primary",
  },
  {
    to: "/upload?kind=weekly",
    icon: CalendarClock,
    title: "رفع تحديث أسبوعي",
    subtitle: "حدّث الرصيد خلال الشهر بدون انتظار نهاية الشهر.",
    steps: [
      "حدّد تاريخ الرصيد الجديد",
      "ارفع الملف",
      "يصبح نقطة بداية جديدة للحساب",
    ],
    cta: "ابدأ التحديث الأسبوعي",
    tone: "emerald",
  },
  {
    to: "/stock-transactions",
    icon: Activity,
    title: "تسجيل حركة مخزن",
    subtitle:
      "سجّل حركة بسيطة: وارد، منصرف، مرتجع، أو تحويل بين الصيدليات.",
    steps: [
      "اختر نوع الحركة",
      "حدّد الصنف والكمية والموقع",
      "احفظ — يتم تحديث الرصيد المتوقع فورًا",
    ],
    cta: "سجّل حركة",
    tone: "amber",
  },
  {
    to: "/reports/compare",
    icon: GitCompare,
    title: "مقارنة شهر بشهر",
    subtitle: "قارن بين رفعتين وشاهد ماذا تغير وأين زاد النقص.",
    steps: [
      "اختر شهر الأساس وشهر المقارنة",
      "تصفّح الأقسام (زاد/قل/خطر/تحسنت)",
      "صدّر ملف Excel",
    ],
    cta: "افتح المقارنة",
    tone: "violet",
  },
];

const TONE: Record<Item["tone"], { bg: string; fg: string; ring: string }> = {
  primary: {
    bg: "bg-primary/10",
    fg: "text-primary",
    ring: "group-hover:ring-primary/30",
  },
  emerald: {
    bg: "bg-emerald-500/10",
    fg: "text-emerald-600 dark:text-emerald-400",
    ring: "group-hover:ring-emerald-500/30",
  },
  amber: {
    bg: "bg-amber-500/10",
    fg: "text-amber-600 dark:text-amber-400",
    ring: "group-hover:ring-amber-500/30",
  },
  violet: {
    bg: "bg-violet-500/10",
    fg: "text-violet-600 dark:text-violet-400",
    ring: "group-hover:ring-violet-500/30",
  },
};

export default function DataSources() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto" dir="rtl">
      <PageHeader
        title="مصادر البيانات والتحديثات"
        description="من هنا تحدّث البيانات بأبسط الطرق — اختر ما يناسبك وابدأ في خطوتين."
      />

      <Card className="p-4 mb-6 bg-primary-soft/40 border-primary/20">
        <div className="text-sm leading-relaxed">
          نصيحة: كل ما تحدّث البيانات بانتظام، كل ما الرصيد المتوقع وتنبيهات
          النقص تكون أدق. لا تحتاج معرفة تقنية — فقط اختر بطاقة وابدأ.
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {ITEMS.map((it) => {
          const t = TONE[it.tone];
          const Icon = it.icon;
          return (
            <Link key={it.to} to={it.to} className="group block">
              <Card
                className={`p-5 h-full transition-all ring-1 ring-transparent hover:shadow-md ${t.ring}`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t.bg} ${t.fg}`}
                  >
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg mb-1">{it.title}</h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      {it.subtitle}
                    </p>
                    <ul className="space-y-1.5 mb-4">
                      {it.steps.map((s, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 text-sm text-foreground/80"
                        >
                          <CheckCircle2
                            className={`w-4 h-4 shrink-0 ${t.fg}`}
                          />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      variant="outline"
                      size="sm"
                      className="group-hover:bg-primary group-hover:text-primary-foreground group-hover:border-primary"
                    >
                      {it.cta}
                      <ArrowLeft className="w-4 h-4 mr-1" />
                    </Button>
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="p-4 mt-6">
        <h4 className="font-bold mb-2 text-sm">كيف يحسب البرنامج الأرقام؟</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          نعتمد على آخر رصيد رفعته، ونضيف عليه الحركات الجديدة (وارد، منصرف،
          مرتجع، تحويلات) لنعرض <b>الرصيد المتوقع اليوم</b> في اللوحة الرئيسية
          والتنبيهات ومركز العمل اليومي. الأصناف الجديدة (أقل من شهر) تظهر
          بدرجة ثقة أقل لأن بياناتها ما زالت قليلة.
        </p>
      </Card>
    </div>
  );
}
