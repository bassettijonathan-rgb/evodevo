/**
 * Minimal IndexedDB key–value helper (one database, a few object stores).
 * Every call is wrapped so the app keeps working when storage is unavailable
 * (private windows, blocked site data): failures resolve to empty results.
 */
const DB = 'evodevo';
const STORES = ['nodes', 'meta'] as const;
type Store = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | null> {
  return open().then((db) => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? (req.result as T) : null);
      tx.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  }));
}

export const idb = {
  put: (store: Store, key: IDBValidKey, value: unknown) => run(store, 'readwrite', (s) => s.put(value, key)),
  putMany: (store: Store, entries: [IDBValidKey, unknown][]) => run(store, 'readwrite', (s) => { for (const [k, v] of entries) s.put(v, k); }),
  get: <T>(store: Store, key: IDBValidKey) => run<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>),
  getAll: <T>(store: Store) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>),
  clear: (store: Store) => run(store, 'readwrite', (s) => s.clear()),
};
