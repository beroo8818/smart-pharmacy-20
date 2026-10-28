import {useState} from 'react';
import {useLiveInventory} from '../useLiveInventory';
import {answerStockQuestion} from '../stockAssistant';
import type {ReportStock} from '../operationalReports';
export default function StockAssistant({load}:{load:()=>Promise<ReportStock[]>}){
 const {data,error,loading}=useLiveInventory(load);
 const [question,setQuestion]=useState(''),[messages,setMessages]=useState<{question:string;answer:string;at:string}[]>([]);
 return <div className="p-6 max-w-5xl space-y-4" dir="rtl"><h1 className="text-2xl font-bold">مساعد المخزون</h1>
 <p>بحث محلي موحد في الرصيد الحالي والحركات ضمن صلاحياتك، وليس نموذج ذكاء اصطناعي أو توصية علاجية. لا يرسل أسئلتك لخدمة خارجية.</p>
 <p>جرب: الأصناف الناقصة، ملخص، أو كود الصنف. كل إجابة تخص وقت إنشائها؛ الإجمالي الموثوق من مركز التقارير.</p>
 {error&&<p role="alert">{String(error)}</p>}
 <form className="flex gap-2" onSubmit={e=>{e.preventDefault();if(!question.trim()||!data||error||loading)return;setMessages(m=>[...m,{question,answer:answerStockQuestion(question,data),at:new Date().toLocaleString('ar-EG')}]);setQuestion('');}}>
 <label className="flex-1">سؤالك<input className="border rounded p-2 w-full" value={question} onChange={e=>setQuestion(e.target.value)}/></label><button className="border rounded px-4" disabled={loading||!!error||!data||!question.trim()}>عرض الإجابة</button></form>
 {messages.map((m,i)=><section key={i} className="border rounded p-4 space-y-2"><h2 className="font-bold">{m.question}</h2><p className="text-sm">{m.at}</p><p className="whitespace-pre-wrap">{m.answer}</p></section>)}</div>;
}
