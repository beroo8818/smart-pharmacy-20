import {api,tokenStore} from '../desktop/client';
import {notifyInventoryChanged} from '../../../../shared/inventoryRefresh';

// Compatibility for legacy metadata pages; all data stays behind authenticated local IPC.
class LocalQuery {
  private operation='select';private values:unknown;private filters:{op:string;key:string;value:unknown}[]=[];
  private ordering:{key:string;ascending:boolean}[]=[];private start=0;private end=Infinity;private one=false;
  constructor(private table:string){}
  select(_fields='*'){return this;}
  eq(key:string,value:unknown){this.filters.push({op:'eq',key,value});return this;}
  in(key:string,value:unknown[]){this.filters.push({op:'in',key,value});return this;}
  gt(key:string,value:unknown){this.filters.push({op:'gt',key,value});return this;}
  order(key:string,options?:{ascending?:boolean}){this.ordering.push({key,ascending:options?.ascending!==false});return this;}
  limit(size:number){this.end=size-1;return this;}
  range(from:number,to:number){this.start=from;this.end=to;return this;}
  maybeSingle(){this.one=true;return this;}
  single(){return this.maybeSingle();}
  insert(values:unknown){this.operation='insert';this.values=values;return this;}
  update(values:unknown){this.operation='update';this.values=values;return this;}
  delete(){this.operation='delete';return this;}
  async execute(){
    try{
      const result=await api.operations.call({token:tokenStore.get(),action:'local_table',payload:{table:this.table,operation:this.operation,filters:this.filters,values:this.values}});
      if(!result.ok)throw new Error(result.error||'تعذر تنفيذ العملية المحلية');
      const rows=[...(result.rows||[])].sort((a,b)=>{for(const order of this.ordering){const av=a[order.key],bv=b[order.key];const compare=av==null?-1:bv==null?1:av<bv?-1:av>bv?1:0;if(compare)return compare*(order.ascending?1:-1);}return 0;}).slice(this.start,this.end+1);
      if(this.operation!=='select')notifyInventoryChanged();
      return {data:this.one?rows[0]||null:rows,error:null};
    }catch(error){return {data:null,error:{message:error instanceof Error?error.message:'تعذر الاتصال المحلي'}};}
  }
  then(resolve:any,reject?:any){return this.execute().then(resolve,reject);}
}
export const supabase:any={from:(table:string)=>new LocalQuery(table),rpc:async()=>({data:null,error:{message:'هذا الإجراء غير متاح عبر اتصال محلي؛ استخدم شاشة الإدارة المحلية'}})};
