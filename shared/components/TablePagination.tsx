import {useEffect,useState,type ReactNode} from 'react';
import {flushSync} from 'react-dom';

export function usePagedRows<T>(rows:T[],pageSize=100){
  const [page,setPage]=useState(0),[printing,setPrinting]=useState(false);
  const pages=Math.max(1,Math.ceil(rows.length/pageSize)),current=Math.min(page,pages-1);
  useEffect(()=>setPage(0),[rows]);
  useEffect(()=>{
    const before=()=>flushSync(()=>setPrinting(true)),after=()=>setPrinting(false);
    window.addEventListener('beforeprint',before);window.addEventListener('afterprint',after);
    return()=>{window.removeEventListener('beforeprint',before);window.removeEventListener('afterprint',after);};
  },[]);
  return {visible:printing?rows:rows.slice(current*pageSize,(current+1)*pageSize),page:current,pages,setPage,total:rows.length,pageSize};
}

export default function TablePagination({page,pages,setPage,total,pageSize,hint}:{page:number;pages:number;setPage:(page:number)=>void;total:number;pageSize:number;hint?:string}){
  if(total<=pageSize)return null;
  return <nav aria-label="صفحات الجدول" className="flex flex-wrap items-center gap-3 p-3 border rounded print:hidden">
    <button className="border rounded p-2" disabled={page===0} onClick={()=>setPage(page-1)}>الصفحة السابقة</button>
    <span>صفحة {page+1} من {pages} | عرض {page*pageSize+1} إلى {Math.min(total,(page+1)*pageSize)} من {total}</span>
    <button className="border rounded p-2" disabled={page+1>=pages} onClick={()=>setPage(page+1)}>الصفحة التالية</button>
    <span>{hint||'التصدير والطباعة يشملان كل الصفوف المطابقة، وليس الصفحة فقط.'}</span>
  </nav>;
}

export function PagedInventoryList<T>({items,render,className='grid gap-3'}:{items:T[];render:(item:T)=>ReactNode;className?:string}){
  const paging=usePagedRows(items,40);
  return <><TablePagination {...paging} hint="العدد الإجمالي يشمل كل النتائج؛ استخدم الصفحات أو البحث للوصول للباقي."/><div className={className}>{paging.visible.map(render)}</div></>;
}
