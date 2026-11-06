
const DB_NAME = 'ProjectNotesDB';
const DB_VERSION = 3;

const PROJECTS = 'projects';
const PAGES = 'pages';
const TASKS = 'tasks';

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(PROJECTS)) {
        db.createObjectStore(PROJECTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(PAGES)) {
        const pages = db.createObjectStore(PAGES, {
          keyPath: 'id'
        });
        pages.createIndex('projectId', 'projectId');
      }

      if (!db.objectStoreNames.contains(TASKS)) {
        const tasks = db.createObjectStore(TASKS, {
          keyPath: 'id'
        });
        tasks.createIndex('projectId', 'projectId');
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    request.onblocked = () => reject(
      new Error(
        'Zavři ostatní karty se zápisníkem a načti stránku znovu.'
      )
    );
  });
}

async function requestInStore(storeName, mode, action) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;

    const request = action(tx.objectStore(storeName));

    request.onsuccess = () => {
      result = request.result;
    };

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('Transakce byla přerušena.'));
    };
  });
}

// PROJEKTY

export const getAllProjects = () =>
  requestInStore(PROJECTS, 'readonly', s => s.getAll());

export const saveProject = p =>
  requestInStore(PROJECTS, 'readwrite', s => s.put(p));

export const removeProject = id =>
  requestInStore(PROJECTS, 'readwrite', s => s.delete(id));

export const countProjects = () =>
  requestInStore(PROJECTS, 'readonly', s => s.count());

// STRÁNKY

export const getPages = projectId =>
  requestInStore(
    PAGES,
    'readonly',
    s => s.index('projectId').getAll(projectId)
  );

export const savePage = p =>
  requestInStore(PAGES, 'readwrite', s => s.put(p));

export const removePage = id =>
  requestInStore(PAGES, 'readwrite', s => s.delete(id));

// ÚKOLY

export const getTasks = projectId =>
  requestInStore(
    TASKS,
    'readonly',
    s => s.index('projectId').getAll(projectId)
  );

export const saveTask = task =>
  requestInStore(TASKS, 'readwrite', s => s.put(task));

export const removeTask = id =>
  requestInStore(TASKS, 'readwrite', s => s.delete(id));

// SMAZÁNÍ PROJEKTU VČETNĚ STRÁNEK A ÚKOLŮ

export async function removeProjectWithPages(projectId) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      [PROJECTS, PAGES, TASKS],
      'readwrite'
    );

    tx.objectStore(PROJECTS).delete(projectId);

    for (const storeName of [PAGES, TASKS]) {
      const store = tx.objectStore(storeName);

      const cursorRequest = store
        .index('projectId')
        .openKeyCursor(IDBKeyRange.only(projectId));

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;

        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
    }

    tx.oncomplete = () => {
      db.close();
      resolve();
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(
        tx.error || new Error('Mazání se nezdařilo.')
      );
    };
  });
}
