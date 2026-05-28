// storage.ts — IndexedDB persistent storage service with warm-connection pre-initialization
const DB_NAME = 'DocMindStorage';
const STORE_NAME = 'files';

let dbInstance: IDBDatabase | null = null;

// Pre-initialize connection immediately on script load so it is fully warm on app boot
const dbPromise: Promise<IDBDatabase> = new Promise((resolve, reject) => {
  if (typeof window === 'undefined' || !window.indexedDB) {
    reject(new Error('IndexedDB is not supported in this browser'));
    return;
  }
  
  try {
    const request = indexedDB.open(DB_NAME, 1);
    
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(request.result);
    };
    
    request.onerror = () => {
      reject(request.error);
    };
  } catch (e) {
    reject(e);
  }
});

export const fileStorage = {
  /**
   * Gets the active database instance (awaits warm connection if not ready)
   */
  async getDb(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance;
    return dbPromise;
  },

  /**
   * Saves a raw binary File object directly to IndexedDB
   */
  async saveFile(file: File): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(file, 'currentFile');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Retrieves the stored File object
   */
  async getFile(): Promise<File | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get('currentFile');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  /**
   * Clears the IndexedDB store to reclaim disk space
   */
  async clear(): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
};

export default fileStorage;
