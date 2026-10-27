import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import PageHeader from "@/components/PageHeader";
import {
  Upload,
  CalendarClock,
  Activity,
  Cloud,
  FileDown,
  GitCompare,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";

type Tone = "primary" | "emerald" | "amber" | "violet" | "sky" | "rose";

type Card6 = {
  to: string;
  icon: any;
  title: string;
  subtitle: string;
  steps: string[];
  cta: string;
  tone: Tone;
};

const TONE: Record<Tone, { bg: string; fg: string; ring: string }> = {
  primary: { bg: "bg-primary/10", fg: "text-primary", ring: "group-hover:ring-primary/30" },
  emerald: { bg: "bg-emerald-500/10", fg: "text-emerald-600 dark:text-emerald-400", ring: "group-hover:ring-emerald-500/30" },
  amber:   { bg: "bg-amber-500/10",   fg: "text-amber-600 dark:text-amber-400",     ring: "group-hover:ring-amber-500/30" },
  violet:  { bg: "bg-violet-500/10",  fg: "text-violet-600 dark:text-violet-400",   ring: "group-hover:ring-violet-500/30" },
  sky:     { bg: "bg-sky-500/10",     fg: "text-sky-600 dark:text-sky-400",         ring: "group-hover:ring-sky-500/30" },
  rose:    { bg: "bg-rose-500/10",    fg: "text-rose-600 dark:text-rose-400",       ring: "group-hover:ring-rose-500/30" },
};

const CARDS: Card6[] = [
  {
    to: "/upload",
    icon: Upload,
    title: "رفع ملف شهري",
    subtitle: "ارفع ملف Excel الشهري واحفظ رصيد نهاية الشهر بسهولة.",
    steps: ["اختر ملف Excel من جهازك", "حدّد الشهر وتاريخ الرصيد", "راجع الملخص ثم احفظ"],
    cta: "ابدأ الرفع",
    tone: "primary",
  },
  {
    to: "/upload?kind=weekly",
    icon: CalendarClock,
    title: "رفع تحديث أسبوعي",
    subtitle: "حدّث الأرصدة خلال الشهر بدون انتظار نهاية الشهر.",
    steps: ["حدّد تاريخ الرصيد الجديد", "ارفع الملف الحديث", "يصبح نقطة بداية أحدث للحساب"],
    cta: "ابدأ التحديث الأسبوعي",
    tone: "emerald",
  },
  {
    to: "/stock-transactions",
    icon: Activity,
    title: "تسجيل وارد أو منصرف",
    subtitle: "سجّل حركة بسيطة: وارد، منصرف، مرتجع، أو تحويل بين الصيدليات.",
    steps: ["اختر نوع الحركة", "حدّد الصنف والكمية والموقع", "احفظ — يتم تحديث الرصيد المتوقع فورًا"],
    cta: "سجّل حركة",
    tone: "amber",
  },
  {
    to: "/google-sync",
    icon: Cloud,
    title: "استيراد من Google Sheet / CSV",
    subtitle: "ألصق رابط Sheet كـ CSV أو ارفع ملف CSV، شاهد الملخص ثم اعتمد الحفظ.",
    steps: ["ألصق الرابط أو ارفع CSV", "اضغط مزامنة الآن", "راجع الملخص ثم احفظ"],
    cta: "ابدأ المزامنة",
    tone: "sky",
  },
  {
    to: "/help#template",
    icon: FileDown,
    title: "تحميل قالب Excel موحد",
    subtitle: "حمّل القالب الجاهز بالأعمدة المطلوبة لتسهيل الرفع.",
    steps: ["اضغط تحميل القالب", "املأ البيانات", "ارفعه من بطاقة الرفع الشهري"],
    cta: "تحميل القالب",
    tone: "rose",
  },
  {
    to: "/reports/compare",
    icon: GitCompare,
    title: "مقارنة شهر بشهر",
    subtitle: "قارن بين رفعتين وشاهد ما الذي تغيّر وأين زاد النقص.",
    steps: ["اختر شهر الأساس وشهر المقارنة", "تصفّح الأقسام", "صدّر ملف Excel"],
    cta: "افتح المقارنة",
    tone: "violet",
  },
];

export default function OperationCenter() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto" dir="rtl">
      <PageHeader
        title="مركز التشغيل"
        description="ابدأ من هنا. اختر بطاقة وتنفّذ المهمة في خطوتين — بدون الحاجة لمعرفة تقنية."
      />

      <Card className="p-4 mb-6 bg-primary/5 border-primary/20">
        <div className="text-sm leading-relaxed">
          نصيحة: كل ما تحدّث البيانات بانتظام (شهريًا أو أسبوعيًا)، كل ما الرصيد المتوقع
          وتنبيهات النقص تصبح أدق وأكثر فائدة.
        </div>
      </Card>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map((it) => {
          const t = TONE[it.tone];
          const Icon = it.icon;
          return (
            <Link key={it.to} to={it.to} className="group block">
              <Card className={`p-5 h-full transition-all ring-1 ring-transparent hover:shadow-md ${t.ring}`}>
                <div className="flex items-start gap-3 mb-3">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t.bg} ${t.fg}`}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-lg leading-tight">{it.title}</h3>
                    <p className="text-sm text-muted-foreground mt-1">{it.subtitle}</p>
                  </div>
                </div>
                <ul className="space-y-1.5 mb-4">
                  {it.steps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                      <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${t.fg}`} />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
                <div className="inline-flex items-center gap-1.5 text-sm font-medium text-primary group-hover:underline">
                  {it.cta}
                  <ArrowLeft className="w-4 h-4" />
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card className="p-4 mt-6">
        <h4 className="font-bold mb-2 text-sm">كيف يحسب البرنامج الرصيد المتوقع اليوم؟</h4>
        <p className="text-sm text-muted-foreground leading-relaxed">
          نأخذ آخر رصيد رفعته كنقطة بداية، ونضيف عليه الحركات التي حدثت <b>بعد</b> تاريخ ذلك الرصيد
          فقط (وارد، منصرف، مرتجع، تحويلات). الحركات الأقدم من آخر رصيد محسوبة بالفعل داخل الرصيد —
          لا نحسبها مرتين. الأصناف الجديدة (أقل من شهر) تظهر بدرجة ثقة أقل لأن بياناتها قليلة.
        </p>
      </Card>
    </div>
  );
}