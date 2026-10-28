import {beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import Backup from '@/pages/Backup';
const fixture=vi.hoisted(()=>({admin:true,export:vi.fn(),restore:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({roles:[fixture.admin?'system_admin':'sub_pharmacist'],access:null,hasRole:()=>fixture.admin})}));
vi.mock('@/integrations/desktop/client',()=>({api:{backup:{export:(...args:any[])=>fixture.export(...args),restore:(...args:any[])=>fixture.restore(...args)}},tokenStore:{get:()=> 'test-session'}}));
beforeEach(()=>{cleanup();fixture.admin=true;fixture.export.mockReset();fixture.restore.mockReset();});
it('exports the actual local database through the authenticated native API',async()=>{
  fixture.export.mockResolvedValue({ok:true,path:'test-backup.db'});
  render(<Backup/>);
  fireEvent.click(screen.getByRole('button',{name:'حفظ نسخة قاعدة البيانات'}));
  expect((await screen.findByRole('status')).textContent).toContain('test-backup.db');
  expect(fixture.export).toHaveBeenCalledWith({token:'test-session'});
});
it('does not expose the database backup to a branch employee',()=>{
  fixture.admin=false;render(<Backup/>);
  expect(screen.queryByRole('button')).toBeNull();expect(fixture.export).not.toHaveBeenCalled();
});
it('shows an export failure without reporting a successful backup',async()=>{
  fixture.export.mockResolvedValue({ok:false,error:'test disk full'});render(<Backup/>);
  fireEvent.click(screen.getByRole('button',{name:'حفظ نسخة قاعدة البيانات'}));
  expect((await screen.findByRole('alert')).textContent).toContain('test disk full');expect(screen.queryByRole('status')).toBeNull();
});
it('requires an explicit confirmation before choosing a restore database',async()=>{
 fixture.restore.mockResolvedValue({ok:true,restartRequired:true});render(<Backup/>);
 const button=screen.getByRole('button',{name:'اختيار نسخة واسترجاعها'});expect(button.hasAttribute('disabled')).toBe(true);
 fireEvent.change(screen.getByLabelText('اكتب «استرجاع» للتأكيد'),{target:{value:'استرجاع'}});
 fireEvent.click(button);expect(fixture.restore).toHaveBeenCalledWith({token:'test-session',confirm:true});
 expect((await screen.findByRole('status')).textContent).toContain('يعاد فتحه');
});
