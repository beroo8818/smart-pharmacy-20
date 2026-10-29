// Repeated monthly/location observations share identity, not quantities or dates.
export function memoizeItem<T extends object,I>(signature:(row:T)=>unknown[],build:(row:T)=>I){
  const objects=new WeakMap<T,I>(),identities=new Map<string,I>();
  return (row:T):I=>{
    const cached=objects.get(row);
    if(cached!==undefined)return cached;
    const key=JSON.stringify(signature(row));
    let value=identities.get(key);
    if(value===undefined){value=build(row);identities.set(key,value);}
    objects.set(row,value);return value;
  };
}
