import {todayISO} from '../inventoryHistory';
export default function InventoryRefreshStatus({updatedAt, loading}:{updatedAt:Date|null;loading:boolean}) {
  return <p className="text-sm" role="status">{loading?'جارٍ تحديث الحسابات...':updatedAt?`آخر حساب ناجح: ${todayISO(updatedAt)} - ${updatedAt.toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo'})}`:'لم يكتمل حساب البيانات بعد.'} | تحديث عند الفتح والعودة للنافذة، وكل دقيقة أثناء ظهورها. لا يعمل والبرنامج مغلق.</p>;
}
