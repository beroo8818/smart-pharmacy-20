import {expect,it} from 'vitest';
import {answerStockQuestion} from '../../shared/stockAssistant';
import type {ReportStock} from '../../shared/operationalReports';
const row=(extra:Partial<ReportStock>={}):ReportStock=>({key:'a',itemKey:'a',itemName:'Test medicine',itemCode:'M1',unit:'vial',locationName:'Branch A',locationType:'sub_pharmacy',balance:20,adc:2,days:10,hasBalance:true,hasConsumption:true,mixedSnapshots:false,snapshotDate:'2026-10-28',kind:'below',consumptionPeriods:[],...extra});
it('answers from the current ledger result instead of an old upload',()=>{expect(answerStockQuestion('ناقص',[row({balance:18})])).toContain('Test medicine');expect(answerStockQuestion('M1',[row({hasBalance:false,days:null})])).toContain('غير معلوم');});
it('does not pronounce the hospital safe when branch data is unknown',()=>{const result=answerStockQuestion('ناقص',[row({hasBalance:false,days:null})]);expect(result).toContain('ليس');expect(result).toContain('تحتاج مراجعة');expect(result).not.toContain('لا يوجد نقص');});
it('does not count unknown coverage as a shortage and scopes a named branch',()=>{const result=answerStockQuestion('ناقص Branch B',[row(),row({locationName:'Branch B',days:null,hasConsumption:false})]);expect(result).not.toContain('Test medicine | Branch A');expect(result).toContain('تحتاج مراجعة');});
