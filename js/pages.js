
import {
  getPages,
  savePage,
  removePage,
  saveProject
} from './database.js';

const DEFAULT_PAGES = [
  { name: 'Úkoly', kind: 'tasks' },
  { name: 'Poznámky', kind: 'notes' },
  { name: 'Testování', kind: 'tests' },
  { name: 'E-maily', kind: 'emails' }
];

// ========================================
// NAČTENÍ STRÁNEK
// ========================================


export async function listPages(projectId) {
  const pages = await getPages(projectId);

  // Jednotné pořadí základních záložek
  const pageOrder = {
    tasks: 1,
    notes: 2,
    emails: 3,
    tests: 4
  };

  return pages.sort((a, b) => {
    const orderA = pageOrder[a.kind] ?? 100;
    const orderB = pageOrder[b.kind] ?? 100;

    // Nejdříve seřadíme základní záložky
    if (orderA !== orderB) {
      return orderA - orderB;
    }

    // Vlastní stránky ponecháme podle data vytvoření
    return (a.createdAt ?? 0) - (b.createdAt ?? 0);
  });
}


// ========================================
// VYTVOŘENÍ NOVÉ STRÁNKY
// ========================================

export async function createPage(
  projectId,
  name,
  kind = 'custom'
) {
  const title = name.trim();

  if (!title || title.length > 80) {
    throw new Error(
      'Název stránky musí mít 1 až 80 znaků.'
    );
  }

  const page = {
    id: crypto.randomUUID(),
    projectId,
    name: title,
    kind,
    content: '',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await savePage(page);
  return page;
}

// ========================================
// PN-04A – OBNOVENÍ STARÝCH POZNÁMEK
// ========================================

async function recoverLegacyTaskNotes(projectId) {
  const pages = await listPages(projectId);

  const existingIds = new Set(
    pages.map(page => page.id)
  );

  for (const page of pages) {

    // Zajímá nás pouze původní stránka Úkoly.
    if (page.kind !== 'tasks') continue;

    // Prázdné stránky nepřevádíme.
    if (
      typeof page.content !== 'string' ||
      !page.content.trim()
    ) continue;

    // Stabilní ID zabrání opakovanému vytváření
    // stejné obnovené stránky.
    const recoveredId = `legacy-tasks-${page.id}`;

    if (existingIds.has(recoveredId)) {
      continue;
    }

    // Vytvoříme samostatnou stránku s kopií textu.
    const recoveredPage = {
      id: recoveredId,
      projectId,
      name: 'Původní poznámky – Úkoly',
      kind: 'custom',
      content: page.content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      recoveredFrom: page.id
    };

    await savePage(recoveredPage);

    existingIds.add(recoveredId);

    console.info(
      'ProjectNotes: Původní poznámka obnovena:',
      recoveredPage.name
    );
  }

  return listPages(projectId);
}

// ========================================
// INICIALIZACE STRÁNEK PROJEKTU
// ========================================

export async function initializePages(project) {
  if (!project.pagesInitialized) {
    const existing = await listPages(project.id);

    if (existing.length === 0) {
      for (const item of DEFAULT_PAGES) {
        await createPage(
          project.id,
          item.name,
          item.kind
        );
      }
    }

    await saveProject({
      ...project,
      pagesInitialized: true
    });
  }

  // PN-04A:
  // Při otevření projektu zkontrolujeme,
  // zda na starých stránkách Úkoly
  // nezůstal skrytý text.
  return recoverLegacyTaskNotes(project.id);
}

// ========================================
// PŘEJMENOVÁNÍ STRÁNKY
// ========================================

export async function renamePage(page, newName) {
  const name = newName.trim();

  if (!name || name.length > 80) {
    throw new Error('Neplatný název stránky.');
  }

  const updated = {
    ...page,
    name,
    updatedAt: Date.now()
  };

  await savePage(updated);
  return updated;
}

// ========================================
// SMAZÁNÍ STRÁNKY
// ========================================

export async function deletePage(pageId) {
  await removePage(pageId);
}
