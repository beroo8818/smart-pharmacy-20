import {Link,useLocation} from 'react-router-dom';
import {Activity,ArrowLeftRight,Bell,BookOpen,Cloud,Compass,Database,FileBarChart,FlaskConical,GitCompare,HardDriveDownload,HelpCircle,History,KeyRound,LayoutDashboard,Pill,Settings,ShieldAlert,Sparkles,Target,Upload} from 'lucide-react';
import {NAVIGATION_GROUPS} from '../navigation';
import AnalysisSourceControl from './AnalysisSourceControl';
const icons={Activity,ArrowLeftRight,Bell,BookOpen,Cloud,Compass,Database,FileBarChart,FlaskConical,GitCompare,HardDriveDownload,HelpCircle,History,KeyRound,LayoutDashboard,Pill,Settings,ShieldAlert,Sparkles,Target,Upload};
export default function SidebarNavigation({allowed}:{allowed:(path:string)=>boolean}){
 const {pathname}=useLocation();
 const groups=NAVIGATION_GROUPS.map(group=>({...group,items:group.items.filter(([to])=>allowed(to))})).filter(group=>group.items.length);
 const active=groups.flatMap(g=>g.items).filter(([to])=>pathname===to||pathname.startsWith(to+'/')).sort((a,b)=>b[0].length-a[0].length)[0]?.[0];
 const section=(group:typeof groups[number])=><section key={group.id} aria-label={group.label} className="mb-3"><h2 className="px-3 py-2 text-xs font-semibold text-muted-foreground">{group.label}</h2>{group.items.map(([to,label,icon])=>{
  const Icon=icons[icon];return <Link key={to} to={to} aria-current={active===to?'page':undefined} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${active===to?'bg-primary-soft text-primary font-semibold':'text-foreground/80 hover:bg-muted'}`}><Icon className="w-4 h-4 shrink-0"/><span>{label}</span></Link>;
 })}</section>;
 const administrative=groups.filter(g=>g.administrative);
 return <div className="flex flex-col flex-1 min-h-0"><nav aria-label="الشغل والتقارير" className="flex-1 min-h-0 overflow-y-auto p-3"><AnalysisSourceControl/>{groups.filter(g=>!g.administrative).map(section)}</nav>{administrative.length>0&&<details key={administrative.some(g=>g.items.some(([to])=>active===to))?'admin-active':'admin-idle'} open={administrative.some(g=>g.items.some(([to])=>active===to))} className="border-t border-border"><summary className="cursor-pointer p-3 text-sm font-semibold">الإدارة والبيانات والحساب</summary><nav aria-label="الإدارة والبيانات والحساب" className="p-3 max-h-[35vh] overflow-y-auto">{administrative.map(section)}</nav></details>}</div>;
}
