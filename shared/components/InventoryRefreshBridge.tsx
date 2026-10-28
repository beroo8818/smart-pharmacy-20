import {useEffect} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {subscribeInventoryRefresh} from '../inventoryRefresh';

const prefixes = ['dashboard-continuous','alerts-continuous','continuous-dac','reports-current-history','item-current-history','transfer-history','item-stock-ledger','upload_batches','inventory_movements','latest-batch-dac','group-current-stock'];
export default function InventoryRefreshBridge() {
  const client = useQueryClient();
  useEffect(() => subscribeInventoryRefresh(() => {
    void client.invalidateQueries({predicate: query => typeof query.queryKey[0] === 'string' && prefixes.some(prefix => (query.queryKey[0] as string).startsWith(prefix))});
  }), [client]);
  return null;
}
