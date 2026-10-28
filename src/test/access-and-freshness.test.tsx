import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {basicPermissions,defaultPermissions,hasPermission,type AccessProfile} from '../../shared/accessPolicy';
import {canAccessPage} from '../lib/permissions';
import {reportingFreshness,type ReportingLocation} from '../../shared/reportingFreshness';
import PermissionEditor from '../../shared/components/PermissionEditor';
import ReportingFreshness from '../../shared/components/ReportingFreshness';
import ReportCenter from '../../shared/components/ReportCenter';
import {buildShortageReport} from '../../shared/shortageReports';
import {currentGroupStock} from '../../shared/currentGroupStock';
import {itemKeyFromParts} from '../lib/batchAnalysis';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const basic:AccessProfile={configured:true,permissions:basicPermissions(),location_ids:['a'],all_branches:false};
const location=(id:string,date:string|null,extra={}):ReportingLocation=>({id,name:id,type:'sub_pharmacy',last_full_balance:date,last_balance:date,last_consumption:date,...extra});
it('uses explicit profiles instead of a broad role while preserving unconfigured legacy roles',()=>{
 expect(canAccessPage(['warehouse_keeper'],'/upload',{...basic,permissions:['screen.report-center','data.branches']})).toBe(false);
 expect(canAccessPage(['viewer'],'/upload',{...basic,permissions:['screen.upload','data.upload']})).toBe(true);
 expect(canAccessPage(['viewer'],'/settings',basic)).toBe(false);
 expect(canAccessPage(['viewer'],'/account',{...basic,permissions:[]})).toBe(true);
 expect(canAccessPage(['pharmacy_manager'],'/branch-access')).toBe(true);
});
it('starts employees with limited basic permissions, not management or warehouse access',()=>{
 expect(hasPermission(['viewer'],basic,'permissions.manage')).toBe(false);
 expect(hasPermission(['viewer'],basic,'data.warehouse')).toBe(false);
 expect(hasPermission(['viewer'],basic,'data.upload')).toBe(true);
 expect(basic.all_branches).toBe(false);expect(basic.location_ids).toEqual(['a']);
});
it('keeps missing and stale branches visible and does not reset full reporting after a partial upload',()=>{
 const rows=reportingFreshness([location('never',null),location('old','2026-09-01',{last_balance:'2026-10-27',last_partial_balance:'2026-10-27'}),location('current','2026-10-01')],35,'2026-10-28');
 expect(rows.filter(r=>r.late).map(r=>r.id)).toEqual(expect.arrayContaining(['never','old']));expect(rows.find(r=>r.id==='current')?.late).toBe(false);
 expect(rows.find(r=>r.id==='old')?.age).toBe(57);
});
it('does not consider future or missing report dates reliable',()=>{
 expect(reportingFreshness([location('future','2026-12-01')],35,'2026-10-28')[0].late).toBe(true);
});
it('lets a manager select two branches and change the default checklist before saving',async()=>{
 vi.spyOn(window,'confirm').mockReturnValue(true);
 const data={actor_id:'manager',actor_role:'system_admin',access:{...basic,permissions:defaultPermissions(['system_admin']),all_branches:true},users:[{id:'employee',name:'Employee',role:'viewer',access:basic}],locations:[{id:'a',name:'Branch A'},{id:'b',name:'Branch B'},{id:'c',name:'Branch C'}]};
 const call=vi.fn(async(action:string)=>action==='access_overview'?data:{ok:true});
 render(<PermissionEditor call={call}/>);
 fireEvent.change(await screen.findByLabelText('المستخدم'),{target:{value:'employee'}});
 fireEvent.click(screen.getByLabelText('Branch B'));fireEvent.click(screen.getByLabelText('التنبيهات'));
 fireEvent.click(screen.getByRole('button',{name:'حفظ الصلاحيات'}));
 await waitFor(()=>expect(call).toHaveBeenCalledWith('access_save',expect.objectContaining({user_id:'employee',location_ids:['a','b'],all_branches:false,permissions:expect.arrayContaining(['screen.alerts'])})));
 expect(call.mock.calls.some(([action])=>action==='access_save')).toBe(true);
});
it('does not let a pharmacy manager check security-sensitive grants',async()=>{
 const data={actor_id:'manager',actor_role:'pharmacy_manager',access:{...basic,permissions:defaultPermissions(['pharmacy_manager']),all_branches:true},users:[{id:'employee',name:'Employee',role:'viewer',access:basic}],locations:[{id:'a',name:'Branch A'}]};
 render(<PermissionEditor call={async()=>data}/>);
 fireEvent.change(await screen.findByLabelText('المستخدم'),{target:{value:'employee'}});
 expect(screen.getByLabelText('تعديل صلاحيات الموظفين')).toBeDisabled();
});
it('shows a registered branch with no report rather than dropping it from completeness',async()=>{
 render(<ReportingFreshness load={async()=>({completeScope:true,locations:[location('Branch missing',null)]})}/>);
 expect(await screen.findByRole('cell',{name:'Branch missing'})).toBeTruthy();
 expect(screen.getByText(/لا تعتبر إجمالي المستشفى مكتمل البيانات/)).toBeTruthy();
});
it('warns inside the hospital report when a registered branch has never reported',async()=>{
 const row=(name:string,main=false)=>({key:name,itemKey:'M1',itemName:'Medicine',itemCode:'M1',unit:'tab',locationName:name,locationType:main?'main_warehouse':'sub_pharmacy',balance:50,adc:2,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-01',snapshotBoundary:'end_of_day',consumptionPeriods:[],kind:'below'});
 render(<ReportCenter initialKind="hospital30" load={async()=>[row('A'),row('Store',true)]} loadFreshness={async()=>({completeScope:true,locations:[location('missing',null)]})}/>);
 expect(await screen.findByRole('cell',{name:/تقارير مواقع متأخرة أو غير مسجلة/})).toBeTruthy();
 expect(screen.getAllByRole('cell',{name:'غير متاح'}).length).toBeGreaterThan(0);
});
it('computes split totals, a 30-day average and replenishment quantity, sorted by coverage',()=>{
 const row=(key:string,name:string,balance:number,adc:number,main=false)=>({key:key+name,itemKey:key,itemName:key,unit:'tab',locationName:name,locationType:main?'main_warehouse':'sub_pharmacy',balance,adc,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-01',consumptionPeriods:[]});
 const result=buildShortageReport([row('slow','A',10,1),row('slow','Store',10,0,true),row('urgent','A',2,1),row('urgent','Store',3,0,true)],'hospital30');
 expect(result.map(r=>r.item)).toEqual(['urgent','slow']);expect(result[0]).toMatchObject({warehouseBalance:3,branchesBalance:2,hospitalBalance:5,monthlyNeed:30,needed:25,days:5});
});
it('keeps group stock current and excludes warehouse dispensing from final consumption',()=>{
 const cell=(name:string,balance:number,adc:number,main=false)=>({key:name,itemName:'Medicine',unit:'tab',locationName:name,locationType:main?'main_warehouse':'sub_pharmacy',balance,adc,days:balance/adc,hasBalance:true,hasConsumption:true,snapshotDate:'2026-10-01',mixedSnapshots:false});
 const definition={original_item_name:'Medicine',strength:'500 mg',dosage_form:'tablet',unit:'tab',approved:true};
 const group=currentGroupStock([cell('A',30,1),cell('Store',20,99,true)],[definition]);
 expect(group.totals).toMatchObject({balance:50,adc:1,issued:30,days:50});
 expect(currentGroupStock([cell('A',30,1)],[{...definition,needs_review:true,approved:false}]).totals.balance).toBeNull();
 expect(currentGroupStock([cell('A',30,1)],[definition,{...definition,strength:'1 g'}]).totals.balance).toBeNull();
});
it('does not merge different strengths under the same manual dictionary group',()=>{
 const base={item_name:'Medicine',scientific_name:'Medicine',strength:'500 mg',dosage_form:'tablet',unit:'tab',therapeutic_group_key:'manual'};
 expect(itemKeyFromParts(base)).not.toBe(itemKeyFromParts({...base,strength:'1 g'}));
});
