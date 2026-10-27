import PageHeader from "@/components/PageHeader";
import { Card } from "@/components/ui/card";

const items = [
  { t: "النقص (Shortage)", d: "الرصيد الحالي للصنف أقل من نقطة إعادة الطلب، أو يكفي لأقل من شهر صرف عادي. يجب التحرك للطلب فورًا." },
  { t: "الزيادة (Overstock)", d: "الرصيد الحالي يكفي لأكثر من ٦ أشهر من الصرف المتوسط. لا داعي لطلب جديد ويفضل تحويل الفائض." },
  { t: "الراكد (Dead Stock)", d: "صنف لم يُصرف منه أي كميات لـ٦ شهور متتالية أو أكثر مع وجود رصيد." },
  { t: "قريب الانتهاء (Expiry Risk)", d: "تاريخ الانتهاء قريب (أقل من ٦ شهور)، والكمية الموجودة أكبر مما يمكن استهلاكه قبل التاريخ." },
  { t: "متوسط الصرف الشهري (AMC)", d: "إجمالي ما تم صرفه خلال الأشهر السابقة مقسومًا على عددها. مؤشر بسيط لاستهلاك الصنف." },
  { t: "أشهر التغطية (Months of Stock)", d: "الرصيد الحالي مقسومًا على متوسط الصرف الشهري. يخبرنا كم شهرًا سيكفي المخزون الحالي." },
  { t: "نقطة إعادة الطلب (Reorder Point)", d: "AMC × (مدة التوريد بالأيام / ٣٠) + مخزون الأمان. عند الوصول لها يجب البدء بالطلب." },
  { t: "مخزون الأمان (Safety Stock)", d: "كمية احتياطية لتغطية أي تقلب مفاجئ. الافتراضي ٢٥٪ من متوسط الصرف الشهري." },
];

export default function Help() {
  return (
    <div className="p-8 max-w-[900px]">
      <PageHeader title="المساعدة وشرح المصطلحات" description="شرح مبسط للمفاهيم المستخدمة في التطبيق." />
      <div className="grid md:grid-cols-2 gap-4">
        {items.map((it, i) => (
          <Card key={i} className="p-5">
            <div className="font-bold mb-2 text-primary">{it.t}</div>
            <div className="text-sm text-muted-foreground leading-relaxed">{it.d}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}