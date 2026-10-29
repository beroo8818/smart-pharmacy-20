type Reply<O>={id:number;result?:O;error?:string};
export type AnalysisWorker={
  postMessage:(message:unknown)=>void;
  terminate:()=>void;
  onmessage:((event:MessageEvent)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
  onmessageerror:((event:MessageEvent)=>void)|null;
};

export function createAnalysisWorker<I,O>(factory:()=>AnalysisWorker,fallback:(input:I)=>Promise<O>){
  let worker:AnalysisWorker|null=null,sequence=0,idle:ReturnType<typeof setTimeout>|undefined;
  const pending=new Map<number,{resolve:(value:O)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
  function stop(error:Error){
    if(idle)clearTimeout(idle);
    worker?.terminate();worker=null;
    for(const job of pending.values()){clearTimeout(job.timer);job.reject(error);}
    pending.clear();
  }
  function getWorker(){
    if(worker)return worker;
    worker=factory();
    worker.onmessage=event=>{
      const reply=event.data as Reply<O>,job=pending.get(reply.id);
      if(!job)return;
      clearTimeout(job.timer);pending.delete(reply.id);
      if(reply.error)job.reject(new Error(reply.error));else job.resolve(reply.result as O);
      if(!pending.size)idle=setTimeout(()=>{worker?.terminate();worker=null;},60_000);
    };
    worker.onerror=()=>stop(new Error('تعذر تشغيل حساب المخزون في الخلفية؛ أعد فتح الشاشة'));
    worker.onmessageerror=()=>stop(new Error('تعذر قراءة نتيجة حساب المخزون'));
    return worker;
  }
  return {
    run(input:I):Promise<O>{
      if(typeof Worker==='undefined')return fallback(input);
      if(idle)clearTimeout(idle);
      return new Promise((resolve,reject)=>{
        try{
          const target=getWorker(),id=++sequence;
          const timer=setTimeout(()=>stop(new Error('استغرق الحساب وقتًا طويلًا؛ أعد المحاولة')),120_000);
          pending.set(id,{resolve,reject,timer});
          try{target.postMessage({id,input});}catch(error){clearTimeout(timer);pending.delete(id);reject(error as Error);}
        }catch(error){reject(error as Error);}
      });
    },
    dispose:()=>stop(new Error('تم إغلاق حساب المخزون')),
  };
}
