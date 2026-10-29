// Memory only: no inventory or credentials are persisted in browser storage.
export function createAnalysisCache<T>(limit=2,ttlMs=45_000){
  const entries=new Map<string,{expires:number;promise:Promise<T>}>();
  let scope='';
  return {
    clear(){entries.clear();scope='';},
    get(key:string,currentScope:string,load:()=>Promise<T>):Promise<T>{
      if(scope!==currentScope){entries.clear();scope=currentScope;}
      const existing=entries.get(key);
      if(existing&&existing.expires>Date.now()){
        entries.delete(key);entries.set(key,existing);return existing.promise;
      }
      const entry={expires:Number.POSITIVE_INFINITY,promise:null as Promise<T>|null};
      entry.promise=Promise.resolve().then(load).then(value=>{
        entry.expires=Date.now()+ttlMs;return value;
      },error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
      entries.delete(key);entries.set(key,entry as {expires:number;promise:Promise<T>});
      while(entries.size>limit)entries.delete(entries.keys().next().value!);
      return entry.promise;
    },
  };
}
