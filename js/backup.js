
import { openDatabase } from './database.js';

const STORES = ['projects', 'pages', 'tasks'];
const FORMAT = 'ProjectNotesBackup';
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Načtení všech dat v jedné konzistentní transakci.
export async function readBackupData() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readonly');
    const data = {};
    let error = null;

    for (const name of STORES) {
      const request = tx.objectStore(name).getAll();

      request.onsuccess = () => {
        data[name] = request.result;
      };
    }

    tx.oncomplete = () => {
      db.close();

      resolve({
        format: FORMAT,
        version: 1,
        exportedAt: new Date().toISOString(),
        data
      });
    };

    tx.onerror = () => {
      error = tx.error;
    };

    tx.onabort = () => {
      db.close();
      reject(error || tx.error || new Error(
        'Nepodařilo se načíst databázi.'
      ));
    };
  });
}

// Uložení souboru pomocí prohlížeče.
export function downloadJSON(data) {
  const json = JSON.stringify(data, null, 2);

  const blob = new Blob([json], {
    type: 'application/json;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);

  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');

  const link = document.createElement('a');
  link.href = url;
  link.download = `ProjectNotes_zaloha_${stamp}.json`;

  document.body.appendChild(link);
  link.click();
  link.remove();

  // Uvolnění dočasné adresy po dokončení stahování.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export async function exportBackup() {
  const data = await readBackupData();
  downloadJSON(data);

  return {
    projects: data.data.projects.length,
    pages: data.data.pages.length,
    tasks: data.data.tasks.length
  };
}

// Kontrola struktury záložního souboru.
function validateBackup(backup) {
  if (
    !backup ||
    typeof backup !== 'object' ||
    Array.isArray(backup) ||
    backup.format !== FORMAT ||
    backup.version !== 1 ||
    !backup.data
  ) {
    throw new Error(
      'Soubor není platnou zálohou ProjectNotes.'
    );
  }

  for (const store of STORES) {
    if (!Array.isArray(backup.data[store])) {
      throw new Error(
        `V záloze chybí seznam ${store}.`
      );
    }

    const ids = new Set();

    for (const item of backup.data[store]) {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        typeof item.id !== 'string' ||
        !item.id ||
        ids.has(item.id)
      ) {
        throw new Error(
          `Neplatné nebo duplicitní ID v ${store}.`
        );
      }

      ids.add(item.id);

      if (store === 'projects') {
        if (
          typeof item.name !== 'string' ||
          typeof item.short !== 'string' ||
          typeof item.color !== 'string'
        ) {
          throw new Error('Neplatný záznam projektu.');
        }
      } else if (
        typeof item.projectId !== 'string' ||
        !item.projectId
      ) {
        throw new Error(
          `Záznam v ${store} nemá platné projectId.`
        );
      }

      if (
        store === 'pages' &&
        (
          typeof item.name !== 'string' ||
          typeof item.kind !== 'string' ||
          typeof item.content !== 'string'
        )
      ) {
        throw new Error('Neplatný záznam stránky.');
      }

      if (
        store === 'tasks' &&
        (
          typeof item.title !== 'string' ||
          !['todo', 'doing', 'done'].includes(item.status) ||
          !['low', 'medium', 'high'].includes(item.priority)
        )
      ) {
        throw new Error('Neplatný záznam úkolu.');
      }
    }
  }

  return backup.data;
}

// Načtení a ověření souboru JSON.
export async function parseBackupFile(file) {
  if (!file) {
    throw new Error('Nebyl vybrán soubor.');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error(
      'Soubor je příliš velký. Limit je 10 MB.'
    );
  }

  let backup;

  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error('Soubor neobsahuje platný JSON.');
  }

  validateBackup(backup);

  return backup;
}

// Import bez mazání a přepisování existujících dat.
// Vše proběhne v jedné IndexedDB transakci.
export async function importBackup(backup) {
  const source = validateBackup(backup);
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORES, 'readwrite');

    const result = {
      added: {
        projects: 0,
        pages: 0,
        tasks: 0
      },
      skipped: {
        projects: 0,
        pages: 0,
        tasks: 0
      }
    };

    // Nejdříve načteme existující klíče.
    // Nové záznamy přidáme pouze tehdy,
    // pokud jejich ID v databázi ještě není.
    for (const name of STORES) {
      const store = tx.objectStore(name);

      for (const item of source[name]) {
        const request = store.add(item);

        request.onsuccess = () => {
          result.added[name]++;
        };

        request.onerror = event => {
          if (
            request.error?.name === 'ConstraintError'
          ) {
            // Duplicitní ID přeskočíme.
            event.preventDefault();
            event.stopPropagation();
            result.skipped[name]++;
          }
        };
      }
    }

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };

    tx.onerror = () => {
      // Chyba přeruší celou transakci.
    };

    tx.onabort = () => {
      db.close();

      reject(tx.error || new Error(
        'Import selhal. Databázová transakce byla vrácena.'
      ));
    };
  });
}
