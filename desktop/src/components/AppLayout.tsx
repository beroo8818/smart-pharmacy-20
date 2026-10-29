import {type ReactNode} from 'react';
import {useNavigate} from 'react-router-dom';
import {LogOut} from 'lucide-react';
import {useAuth} from '@/hooks/useAuth';
import {canSeeNav} from '@/lib/permissions';
import {Button} from '@/components/ui/button';
import SidebarNavigation from '../../../shared/components/SidebarNavigation';
const ROLE_LABEL:Record<string,string>={system_admin:'مدير النظام',pharmacy_manager:'مدير الصيدلية',warehouse_keeper:'أمين المخزن',sub_pharmacist:'صيدلي فرعي',viewer:'مشاهد'};
export default function AppLayout({children}:{children:ReactNode}){
 const {user,signOut,roles,access}=useAuth(),navigate=useNavigate();
 async function logout(){await signOut();navigate('/auth');}
 return <div className="min-h-screen flex bg-background">
  <aside className="w-64 shrink-0 h-screen sticky top-0 border-l border-border bg-card flex flex-col">
   <div className="p-5 border-b border-border"><div className="flex items-center gap-2"><div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold">د</div><div><div className="font-bold text-base leading-none">دواء</div><div className="text-xs text-muted-foreground mt-1">إدارة أرصدة المستشفى</div></div></div></div>
   <SidebarNavigation allowed={path=>canSeeNav(roles,path,access)}/>
   <div className="p-3 border-t border-border shrink-0">
    <div className="text-xs text-muted-foreground mb-2 px-1 truncate">{user?.full_name||user?.username}</div>
    <div className="mb-3 px-2 py-2 rounded-md bg-primary-soft/50 border border-primary/20"><div className="text-[10px] text-muted-foreground mb-1">دورك الحالي</div><div className="text-xs font-semibold text-primary leading-tight">{roles.length?roles.map(role=>ROLE_LABEL[role]||role).join('، '):'بدون دور'}</div></div>
    <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={logout}><LogOut className="w-4 h-4"/> تسجيل الخروج</Button>
   </div>
  </aside><main className="flex-1 min-w-0 overflow-x-hidden">{children}</main>
 </div>;
}
