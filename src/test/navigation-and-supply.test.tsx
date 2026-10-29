import {afterEach,expect,it} from 'vitest';
import {cleanup,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import SidebarNavigation from '../../shared/components/SidebarNavigation';
import {NAVIGATION_GROUPS} from '../../shared/navigation';
import {basicPermissions,accessPage} from '../../shared/accessPolicy';
import {hospitalPurchaseQuantity} from '../../shared/supplyPolicy';
afterEach(cleanup);
const show=(path='/home',allowed=(route:string)=>true)=>render(<MemoryRouter initialEntries={[path]}><SidebarNavigation allowed={allowed}/></MemoryRouter>);
it('puts work above administrative pages with no duplicated routes',()=>{
 const routes=NAVIGATION_GROUPS.flatMap(group=>group.items.map(item=>item[0]));expect(new Set(routes).size).toBe(routes.length);
 expect(NAVIGATION_GROUPS.slice(0,2).every(group=>!group.administrative)).toBe(true);
 expect(NAVIGATION_GROUPS.slice(2).every(group=>group.administrative)).toBe(true);
 show();expect(within(screen.getByRole('navigation',{name:'الشغل والتقارير'})).getByRole('link',{name:'رفع البيانات'})).toBeTruthy();
 expect(screen.getByText('الإدارة والبيانات والحساب').closest('details')?.open).toBe(false);
});
it('opens administrative navigation for the current account page',()=>{
 show('/account');expect(screen.getByText('الإدارة والبيانات والحساب').closest('details')?.open).toBe(true);
 expect(screen.getByRole('link',{name:'كلمة مرور حسابي'}).getAttribute('aria-current')).toBe('page');
});
it('keeps hidden management and warehouse pages out of a basic employee menu',()=>{
 const access={configured:true,permissions:basicPermissions(),location_ids:['a'],all_branches:false};
 show('/my-pharmacy',path=>accessPage(['sub_pharmacist'],path,access));
 expect(screen.queryByText('صلاحيات المستخدمين')).toBeNull();expect(screen.queryByText('إدارة الفروع والمستخدمين')).toBeNull();
 expect(screen.queryByText('النسخ الاحتياطي والاسترجاع')).toBeNull();expect(screen.getByText('كلمة مرور حسابي')).toBeTruthy();
});
it('marks only the most specific current route',()=>{
 show('/reports/compare');const active=document.querySelectorAll('[aria-current="page"]');expect(active.length).toBe(1);expect(active[0].textContent).toContain('مقارنة شهر بشهر');
});
it('does not invent a purchase when stock exists but reserve blocks distribution',()=>{
 expect(hospitalPurchaseQuantity(300,10,30)).toBe(0);expect(hospitalPurchaseQuantity(500,10,30)).toBe(0);
});
it('calculates the hospital gap without adding the same branch shortage twice',()=>{
 expect(hospitalPurchaseQuantity(250,10,30)).toBe(50);expect(hospitalPurchaseQuantity(250,10,14)).toBe(0);
 expect(hospitalPurchaseQuantity(0,0,30)).toBe(0);expect(hospitalPurchaseQuantity(0,1.1,30)).toBe(33);
});
it('does not recommend a quantity from invalid stock or target inputs',()=>{
 for(const args of [[-1,10,30],[NaN,10,30],[10,-1,30],[10,10,0],[10,Infinity,30]])expect(hospitalPurchaseQuantity(...args as [number,number,number])).toBeNull();
});
