import {todayISO} from './inventoryHistory';

export const INVENTORY_REFRESH_MS = 60_000;
export const INVENTORY_CHANGE_KEY = 'dawa-inventory-change';
const CHANGE_EVENT = 'dawa-inventory-changed';
const listeners = new Set<() => void>();
let stop: (() => void) | undefined;
let writeRevision=0;

export function inventoryDataVersion(){
  try{return `${writeRevision}|${localStorage.getItem(INVENTORY_CHANGE_KEY)||''}`;}
  catch{return String(writeRevision);}
}

// Only an invalidation marker is shared between tabs, never stock or user data.
export function notifyInventoryChanged() {
  writeRevision++;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
  try { localStorage.setItem(INVENTORY_CHANGE_KEY, `${Date.now()}-${Math.random()}`); } catch { /* Local events still work when storage is unavailable. */ }
}

export function subscribeInventoryRefresh(listener: () => void) {
  listeners.add(listener);
  if (!stop && typeof window !== 'undefined') {
    let scheduled: ReturnType<typeof setTimeout> | undefined;
    let lastDay = todayISO();
    const queue = () => {
      if (document.visibilityState === 'hidden' || scheduled !== undefined) return;
      scheduled = setTimeout(() => {
        scheduled = undefined;
        lastDay = todayISO();
        listeners.forEach(fn => fn());
      }, 0);
    };
    const storage = (event: StorageEvent) => { if (event.key === INVENTORY_CHANGE_KEY || event.key === null) queue(); };
    const tick = () => {
      // A foreground poll also discovers writes made by another client/server.
      if (todayISO() !== lastDay || document.visibilityState !== 'hidden') queue();
    };
    window.addEventListener(CHANGE_EVENT, queue);
    window.addEventListener('storage', storage);
    window.addEventListener('focus', queue);
    window.addEventListener('online', queue);
    document.addEventListener('visibilitychange', queue);
    const timer = setInterval(tick, INVENTORY_REFRESH_MS);
    stop = () => {
      clearInterval(timer);
      if (scheduled !== undefined) clearTimeout(scheduled);
      window.removeEventListener(CHANGE_EVENT, queue);
      window.removeEventListener('storage', storage);
      window.removeEventListener('focus', queue);
      window.removeEventListener('online', queue);
      document.removeEventListener('visibilitychange', queue);
      stop = undefined;
    };
  }
  return () => { listeners.delete(listener); if (!listeners.size) stop?.(); };
}
