import {useEffect, useState} from 'react';
import {subscribeInventoryRefresh} from './inventoryRefresh';

export function useInventoryRevision() {
  const [revision,setRevision]=useState(0);
  useEffect(()=>subscribeInventoryRefresh(()=>setRevision(value=>value+1)),[]);
  return revision;
}

export function useLiveInventory<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  useEffect(() => {
    let active = true, running = false, pending = false;
    async function refresh() {
      if (running) { pending = true; return; }
      running = true;
      setLoading(true);
      do {
        pending = false;
        try {
          const result = await load();
          if (active && !pending) { setData(result); setError(''); setUpdatedAt(new Date()); }
        } catch (e) {
          if (active && !pending) setError(e instanceof Error ? e.message : 'تعذر تحديث البيانات');
        }
      } while (active && pending);
      running = false;
      if (active) setLoading(false);
    }
    const unsubscribe = subscribeInventoryRefresh(refresh);
    void refresh();
    return () => { active = false; unsubscribe(); };
  }, [load]);
  return {data, loading, error, updatedAt};
}
