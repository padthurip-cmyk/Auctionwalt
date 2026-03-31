import { openDB } from 'idb';

const DB_NAME = 'auction-vault';
const DB_VERSION = 2;

let dbPromise;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore('invoices', { keyPath: 'id' });
          db.createObjectStore('items', { keyPath: 'id' });
          db.createObjectStore('sold', { keyPath: 'id' });
          db.createObjectStore('customers', { keyPath: 'id' });
          db.createObjectStore('settings', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'id' });
          }
        }
      },
    });
  }
  return dbPromise;
}

// Generic CRUD
export async function getAll(store) {
  const db = await getDB();
  return db.getAll(store);
}

export async function getOne(store, id) {
  const db = await getDB();
  return db.get(store, id);
}

export async function putOne(store, data) {
  const db = await getDB();
  return db.put(store, data);
}

export async function putMany(store, items) {
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all([...items.map(item => tx.store.put(item)), tx.done]);
}

export async function deleteOne(store, id) {
  const db = await getDB();
  return db.delete(store, id);
}

export async function deleteMany(store, ids) {
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all([...ids.map(id => tx.store.delete(id)), tx.done]);
}

export async function clearStore(store) {
  const db = await getDB();
  return db.clear(store);
}

export async function clearAll() {
  const stores = ['invoices', 'items', 'sold', 'customers', 'settings', 'files'];
  const db = await getDB();
  for (const store of stores) {
    if (db.objectStoreNames.contains(store)) {
      await db.clear(store);
    }
  }
}

// File storage — keeps original invoice PDFs/images
export async function saveFile(id, base64Data, fileName, fileType) {
  const db = await getDB();
  return db.put('files', { id, data: base64Data, fileName, fileType, savedAt: new Date().toISOString() });
}

export async function getFile(id) {
  const db = await getDB();
  return db.get('files', id);
}

// Settings helpers
export async function getSetting(key, defaultVal = null) {
  const db = await getDB();
  const r = await db.get('settings', key);
  return r ? r.value : defaultVal;
}

export async function setSetting(key, value) {
  const db = await getDB();
  return db.put('settings', { key, value });
}
