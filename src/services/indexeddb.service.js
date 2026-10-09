import { logError } from './storage.service.js';

export const IDB_NAME = 'cantinho_vectors_db';
export const IDB_STORE = 'vectors';
export const IDB_STORE_SNAPSHOTS = 'snapshots';
export const IDB_STORE_CHAT = 'chat_history';
export const IDB_STORE_APP_DATA = 'app_data';

export function openVecDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 3);
    req.onupgradeneeded = () => {
      const dbInstance = req.result;
      if (!dbInstance.objectStoreNames.contains(IDB_STORE)) {
        dbInstance.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(IDB_STORE_SNAPSHOTS)) {
        dbInstance.createObjectStore(IDB_STORE_SNAPSHOTS, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(IDB_STORE_CHAT)) {
        dbInstance.createObjectStore(IDB_STORE_CHAT, { keyPath: 'id' });
      }
      if (!dbInstance.objectStoreNames.contains(IDB_STORE_APP_DATA)) {
        dbInstance.createObjectStore(IDB_STORE_APP_DATA, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveDbToIdb(dbData) {
  try {
    const idb = await openVecDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_APP_DATA, 'readwrite');
      tx.objectStore(IDB_STORE_APP_DATA).put({ key: 'main_db', data: dbData, updated_at: new Date().toISOString() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => {
        logError('indexeddb.saveDb', tx.error);
        reject(tx.error);
      };
    });
  } catch (e) {
    logError('indexeddb.saveDb_open', e);
    return false;
  }
}

export async function loadDbFromIdb() {
  try {
    const idb = await openVecDB();
    return new Promise((resolve) => {
      const tx = idb.transaction(IDB_STORE_APP_DATA, 'readonly');
      const req = tx.objectStore(IDB_STORE_APP_DATA).get('main_db');
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}
