export type DecisionStatus='new'|'approved'|'rejected'|'postponed'|'executed';
export type RecommendationAction={
 id:string;upload_batch_id:string;recommendation_key:string;recommendation_type:string;
 item_key:string|null;item_name:string|null;item_code?:string|null;unit?:string|null;
 from_location:string|null;to_location:string|null;suggested_qty:number|null;executed_qty:number|null;
 status:DecisionStatus;note:string|null;acted_by:string;acted_at:string;actor_name?:string|null;
 match_review_required?:boolean;override_unreviewed?:boolean;override_reason?:string|null;
 source?:'current'|'legacy_local';original_at?:string|null;
};
export const DECISION_LABEL:Record<DecisionStatus,string>={new:'قيد المراجعة',approved:'قرار مقبول',rejected:'مرفوض',postponed:'مؤجل',executed:'مسجل كمنفذ'};
export function latestDecisions(rows:RecommendationAction[]){
 const result:Record<string,RecommendationAction>={};
 const effective=(row:RecommendationAction)=>row.source==='legacy_local'&&row.original_at?row.original_at:row.acted_at;
 for(const row of [...rows].sort((a,b)=>Date.parse(effective(b))-Date.parse(effective(a))||b.id.localeCompare(a.id)))if(!result[row.recommendation_key])result[row.recommendation_key]=row;
 return result;
}
export async function loadNativeActions(call:(action:string,payload?:Record<string,unknown>)=>Promise<any>,batchId?:string){
 const rows:RecommendationAction[]=[];
 for(let offset=0;offset<100000;offset+=1000){
  const result=await call('recommendation_list',{offset,batch_id:batchId});
  rows.push(...result.rows);
  if(result.rows.length<1000)return rows;
 }
 throw new Error('سجل كبير؛ حدد ملفًا أو راجع مسؤول التشغيل بدل عرض سجل مبتور');
}
