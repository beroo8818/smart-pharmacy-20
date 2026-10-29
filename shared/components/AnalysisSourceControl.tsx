import {analysisSource,setAnalysisSource,type AnalysisSource} from '../analysisSource';
import {useInventoryRevision} from '../useLiveInventory';

export default function AnalysisSourceControl(){
  useInventoryRevision();
  const source=analysisSource();
  return <section className="border-b p-3 text-xs space-y-2" aria-label="مصدر التحليل المستمر">
    <label className="block">مصدر التحليل والتقارير
      <select className="border rounded p-2 w-full bg-background mt-1" value={source} onChange={e=>setAnalysisSource(e.target.value as AnalysisSource)}>
        <option value="history">كل الرفعات المحفوظة</option>
        <option value="latest_file">آخر ملف محفوظ فقط - للتجربة</option>
      </select>
    </label>
    <p>{source==='latest_file'?'عرض محدود بآخر رفعة وحركات أصنافها؛ لا يمثل كامل المستشفى. لا يحذف الملفات القديمة.':'آخر رصيد معروف لكل صنف وموقع، ولو من ملف قديم. رفع ملف جزئي لا يمسح الأصناف الغائبة.'}</p>
  </section>;
}
