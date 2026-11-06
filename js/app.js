
import {
  initializeProjects,
  listProjects,
  createProject,
  updateProject
} from './projects.js';

import {
  savePage,
  removeProjectWithPages
} from './database.js';

import {
  listPages,
  initializePages,
  createPage,
  renamePage,
  deletePage
} from './pages.js';

import {
  listTasks,
  createTask,
  updateTask,
  setTaskStatus,
  deleteTask,
  PRIORITIES,
  STATUSES
} from './tasks.js';

import {
  exportBackup,
  parseBackupFile,
  importBackup
} from './backup.js';

import {
  loadSearchIndex,
  searchEntries
} from './search.js';

const $ = id => document.getElementById(id);

let projects = [];
let pages = [];
let tasks = [];

let selectedId = null;
let selectedPageId = null;
let editedId = null;
let editedTaskId = null;

let dirty = false;
let saveTimer = null;
let writeQueue = Promise.resolve();
let currentSave = null;
let loading = false;

let searchIndex = [];
let searchGeneration = 0;

const activeProject = () =>
  projects.find(p => p.id === selectedId) ?? null;

const activePage = () =>
  pages.find(p => p.id === selectedPageId) ?? null;

function setStatus(message) {
  $('saveStatus').textContent = message;
}

function reportError(error) {
  console.error('ProjectNotes:', error);
  alert(error?.message ?? 'Došlo k chybě.');
}

// ========================================
// AUTOMATICKÉ UKLÁDÁNÍ POZNÁMEK
// ========================================

async function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = null;

  if (!dirty) {
    await writeQueue;
    return;
  }

  const page = activePage();

  if (!page || page.kind === 'tasks') {
    return;
  }

  const content = $('noteEditor').value;

  const snapshot = {
    ...page,
    content,
    updatedAt: Date.now()
  };

  dirty = false;
  setStatus('Ukládání…');

  const pending = writeQueue
    .catch(() => {})
    .then(() => savePage(snapshot));

  writeQueue = pending;
  currentSave = pending;

  try {
    await pending;

    page.content = content;
    page.updatedAt = snapshot.updatedAt;

    if (selectedPageId === page.id && !dirty) {
      setStatus('Uloženo');
    }
  } catch (error) {
    dirty = true;
    setStatus('Chyba ukládání');
    throw error;
  } finally {
    if (currentSave === pending) {
      currentSave = null;
    }
  }
}

function scheduleSave() {
  dirty = true;
  setStatus('Neuložené změny…');

  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    saveDraft().catch(error => {
      console.error('Automatické uložení:', error);
      setStatus('Chyba ukládání – použij Uložit');
    });
  }, 700);
}

// ========================================
// ZOBRAZENÍ PROJEKTŮ
// ========================================

function renderProjects() {
  $('projectCount').textContent = projects.length;
  $('projectList').replaceChildren();
  $('colorTabs').replaceChildren();

  for (const project of projects) {
    const side = document.createElement('button');
    side.type = 'button';

    side.className =
      `project-link ${
        project.id === selectedId ? 'active' : ''
      }`;

    const dot = document.createElement('span');
    dot.className = 'project-dot';
    dot.style.backgroundColor = project.color;

    const name = document.createElement('span');
    name.textContent = project.name;

    const chevron = document.createElement('span');
    chevron.textContent =
      project.id === selectedId ? '›' : '';

    side.append(dot, name, chevron);

    side.addEventListener('click', () => {
      selectProject(project.id).catch(reportError);
    });

    $('projectList').append(side);

    const tab = document.createElement('button');
    tab.type = 'button';

    tab.className =
      `color-tab ${
        project.id === selectedId ? 'active' : ''
      }`;

    tab.style.backgroundColor = project.color;
    tab.textContent = project.short;
    tab.title = `Otevřít projekt ${project.name}`;
    tab.setAttribute('aria-label', tab.title);

    tab.addEventListener('click', () => {
      selectProject(project.id).catch(reportError);
    });

    $('colorTabs').append(tab);
  }
}

function renderHeader() {
  const project = activeProject();

  $('editProjectBtn').hidden = !project;
  $('addPageBtn').hidden = !project;

  $('projectEyebrow').textContent = project
    ? `PROJEKTOVÝ ZÁPISNÍK / ${project.short}`
    : 'PROJEKTOVÝ ZÁPISNÍK';

  $('projectTitle').textContent =
    project?.name ?? 'Žádný projekt';

  $('projectDescription').textContent =
    project?.description ?? 'Klikni na + Nový projekt.';
}

// ========================================
// ZÁLOŽKY STRÁNEK
// ========================================

function renderTabs() {
  $('pageTabs').replaceChildren();

  for (const page of pages) {
    const button = document.createElement('button');
    button.type = 'button';

    button.className =
      `page-tab ${
        page.id === selectedPageId ? 'active' : ''
      }`;

    button.textContent = page.name;
    button.title = page.name;

    button.addEventListener('click', async () => {
      if (loading || selectedPageId === page.id) return;

      loading = true;

      try {
        await saveDraft();

        selectedPageId = page.id;

        renderTabs();
        await renderContent();
      } catch (error) {
        reportError(error);
      } finally {
        loading = false;
      }
    });

    $('pageTabs').append(button);
  }
}

// ========================================
// ZOBRAZENÍ OBSAHU STRÁNKY
// ========================================

async function renderContent() {
  const page = activePage();
  const project = activeProject();

  $('pageTitle').textContent =
    page?.name ?? 'Žádná stránka';

  $('pageFooter').textContent =
    page && project
      ? `${project.short} · ${page.name}`
      : '';

  $('pageInfo').textContent =
    page?.kind === 'tasks'
      ? 'Správa úkolů · PN-06'
      : 'Automatické ukládání · PN-06';

  $('pageContent').hidden =
    !page || page.kind === 'tasks';

  $('taskContent').hidden =
    !page || page.kind !== 'tasks';

  if (!page) return;

  if (page.kind === 'tasks') {
    await refreshTasks();
  } else {
    $('noteEditor').value = page.content ?? '';
    setStatus('Všechny změny uloženy');
  }
}

// ========================================
// PŘEPÍNÁNÍ PROJEKTŮ
// ========================================

async function selectProject(id) {
  if (loading) return;

  loading = true;

  try {
    await saveDraft();

    const project = projects.find(p => p.id === id);
    if (!project) return;

    const loaded = await initializePages(project);

    selectedId = id;
    pages = loaded;
    selectedPageId = pages[0]?.id ?? null;

    $('taskFilter').value = 'all';

    renderProjects();
    renderHeader();
    renderTabs();

    await renderContent();
  } finally {
    loading = false;
  }
}

async function reloadProjects(preferredId = selectedId) {
  projects = await listProjects();

  const id = projects.some(p => p.id === preferredId)
    ? preferredId
    : (projects[0]?.id ?? null);

  if (id) {
    await selectProject(id);
  } else {
    selectedId = null;
    selectedPageId = null;
    pages = [];
    tasks = [];

    renderProjects();
    renderHeader();
    renderTabs();
    await renderContent();
  }
}

// ========================================
// SPRÁVA PROJEKTŮ
// ========================================

function openProjectDialog(project = null) {
  editedId = project?.id ?? null;

  $('dialogTitle').textContent =
    project ? 'Upravit projekt' : 'Nový projekt';

  $('projectName').value = project?.name ?? '';
  $('projectDesc').value = project?.description ?? '';
  $('projectShort').value = project?.short ?? '';
  $('projectColor').value =
    project?.color ?? '#edc06c';

  $('deleteProjectBtn').hidden = !project;
  $('formError').hidden = true;

  $('projectDialog').showModal();
}

$('newProjectBtn').addEventListener('click', () => {
  openProjectDialog();
});

$('editProjectBtn').addEventListener('click', () => {
  const project = activeProject();
  if (project) openProjectDialog(project);
});

$('closeDialogBtn').addEventListener('click', () => {
  $('projectDialog').close();
});

$('cancelDialogBtn').addEventListener('click', () => {
  $('projectDialog').close();
});

$('projectForm').addEventListener('submit', async event => {
  event.preventDefault();

  try {
    await saveDraft();

    const values = {
      name: $('projectName').value,
      description: $('projectDesc').value,
      short: $('projectShort').value,
      color: $('projectColor').value
    };

    const existing =
      projects.find(p => p.id === editedId);

    const saved = existing
      ? await updateProject(existing, values)
      : await createProject(values);

    $('projectDialog').close();
    await reloadProjects(saved.id);
  } catch (error) {
    $('formError').textContent = error.message;
    $('formError').hidden = false;
  }
});

$('deleteProjectBtn').addEventListener('click', async () => {
  const project =
    projects.find(item => item.id === editedId);

  if (!project) return;

  if (!confirm(
    `Smazat projekt „${project.name}“ včetně všech stránek a úkolů?`
  )) return;

  try {
    await saveDraft();
    await removeProjectWithPages(project.id);

    $('projectDialog').close();

    selectedId = null;
    selectedPageId = null;

    await reloadProjects(null);
  } catch (error) {
    reportError(error);
  }
});

// ========================================
// SPRÁVA STRÁNEK
// ========================================

function openPageDialog() {
  $('newPageName').value = '';
  $('pageFormError').hidden = true;

  $('pageDialog').showModal();
  $('newPageName').focus();
}

$('addPageBtn').addEventListener('click', openPageDialog);

$('closePageDialogBtn').addEventListener('click', () => {
  $('pageDialog').close();
});

$('cancelPageDialogBtn').addEventListener('click', () => {
  $('pageDialog').close();
});

$('pageForm').addEventListener('submit', async event => {
  event.preventDefault();

  try {
    await saveDraft();

    const project = activeProject();
    if (!project) return;

    const page = await createPage(
      project.id,
      $('newPageName').value
    );

    pages = await listPages(project.id);
    selectedPageId = page.id;

    $('pageDialog').close();

    renderTabs();
    await renderContent();
    $('noteEditor').focus();
  } catch (error) {
    $('pageFormError').textContent = error.message;
    $('pageFormError').hidden = false;
  }
});

$('renamePageBtn').addEventListener('click', async () => {
  const page = activePage();
  if (!page) return;

  const name = prompt(
    'Nový název stránky:',
    page.name
  );

  if (name === null) return;

  try {
    await saveDraft();

    Object.assign(
      page,
      await renamePage(page, name)
    );

    renderTabs();
    await renderContent();
  } catch (error) {
    reportError(error);
  }
});

$('deletePageBtn').addEventListener('click', async () => {
  const page = activePage();

  if (!page || !confirm(
    `Smazat stránku „${page.name}“ včetně obsahu?`
  )) return;

  try {
    await saveDraft();
    await deletePage(page.id);

    pages = await listPages(selectedId);
    selectedPageId = pages[0]?.id ?? null;

    renderTabs();
    await renderContent();
  } catch (error) {
    reportError(error);
  }
});

// ========================================
// TEXTOVÝ EDITOR
// ========================================

$('noteEditor').addEventListener('input', scheduleSave);

$('savePageBtn').addEventListener('click', () => {
  saveDraft().catch(reportError);
});

$('noteEditor').addEventListener('blur', () => {
  if (dirty) {
    saveDraft().catch(error => {
      console.error('Uložení po opuštění editoru:', error);
      setStatus('Chyba ukládání');
    });
  }
});

window.addEventListener('beforeunload', event => {
  if (dirty || currentSave) {
    event.preventDefault();
    event.returnValue = '';
  }
});

// ========================================
// SPRÁVA ÚKOLŮ
// ========================================

async function refreshTasks() {
  const project = activeProject();

  tasks = project
    ? await listTasks(project.id)
    : [];

  renderTasks();
}

function renderTasks() {
  const filter = $('taskFilter').value;

  const visible = tasks.filter(task =>
    filter === 'all' ||
    (
      filter === 'active'
        ? task.status !== 'done'
        : task.status === 'done'
    )
  );

  const done = tasks.filter(
    task => task.status === 'done'
  ).length;

  $('taskSummary').textContent =
    `${tasks.length} úkolů · ` +
    `${tasks.length - done} aktivních · ` +
    `${done} hotových`;

  $('taskList').replaceChildren();

  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'task-empty';

    empty.textContent = filter === 'all'
      ? 'Zatím tu nejsou žádné úkoly. Klikni na + Nový úkol.'
      : 'Tomuto filtru neodpovídají žádné úkoly.';

    $('taskList').append(empty);
    return;
  }

  for (const task of visible) {
    const card = document.createElement('article');

    card.className =
      `task-card ${task.status === 'done' ? 'done' : ''}`;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = task.status === 'done';

    checkbox.setAttribute(
      'aria-label',
      `Dokončeno: ${task.title}`
    );

    checkbox.addEventListener('change', async () => {
      checkbox.disabled = true;

      try {
        await setTaskStatus(
          task,
          checkbox.checked ? 'done' : 'todo'
        );

        await refreshTasks();
      } catch (error) {
        checkbox.checked = !checkbox.checked;
        checkbox.disabled = false;
        reportError(error);
      }
    });

    const main = document.createElement('div');
    main.className = 'task-main';

    const title = document.createElement('div');
    title.className = 'task-title';
    title.textContent = task.title;
    main.append(title);

    if (task.description) {
      const description = document.createElement('p');

      description.className = 'task-description';
      description.textContent = task.description;

      main.append(description);
    }

    const meta = document.createElement('div');
    meta.className = 'task-meta';

    const status = document.createElement('span');
    status.className = 'task-chip';
    status.textContent = STATUSES[task.status];
    meta.append(status);

    const priority = document.createElement('span');
    priority.className =
      `task-chip ${task.priority}`;

    priority.textContent =
      `Priorita: ${PRIORITIES[task.priority]}`;

    meta.append(priority);

    if (task.dueDate) {
      const due = document.createElement('span');
      const today = new Date();

      const localDate =
        `${today.getFullYear()}-` +
        `${String(today.getMonth() + 1).padStart(2, '0')}-` +
        `${String(today.getDate()).padStart(2, '0')}`;

      due.className =
        `task-chip ${
          task.status !== 'done' &&
          task.dueDate < localDate
            ? 'overdue'
            : ''
        }`;

      const [year, month, day] =
        task.dueDate.split('-');

      due.textContent =
        `Termín: ${day}.${month}.${year}`;

      meta.append(due);
    }

    main.append(meta);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'task-edit';
    edit.textContent = 'Upravit';

    edit.addEventListener('click', () => {
      openTaskDialog(task);
    });

    card.append(checkbox, main, edit);
    $('taskList').append(card);
  }
}

function openTaskDialog(task = null) {
  if (!activeProject()) return;

  editedTaskId = task?.id ?? null;

  $('taskDialogTitle').textContent =
    task ? 'Upravit úkol' : 'Nový úkol';

  $('taskName').value = task?.title ?? '';
  $('taskDescription').value = task?.description ?? '';
  $('taskPriority').value = task?.priority ?? 'medium';
  $('taskStatus').value = task?.status ?? 'todo';
  $('taskDueDate').value = task?.dueDate ?? '';

  $('deleteTaskBtn').hidden = !task;
  $('taskFormError').hidden = true;

  $('taskDialog').showModal();
  $('taskName').focus();
}

$('newTaskBtn').addEventListener('click', () => {
  openTaskDialog();
});

$('taskFilter').addEventListener('change', renderTasks);

$('closeTaskDialogBtn').addEventListener('click', () => {
  $('taskDialog').close();
});

$('cancelTaskDialogBtn').addEventListener('click', () => {
  $('taskDialog').close();
});

$('taskForm').addEventListener('submit', async event => {
  event.preventDefault();

  const project = activeProject();
  if (!project) return;

  const values = {
    title: $('taskName').value,
    description: $('taskDescription').value,
    priority: $('taskPriority').value,
    status: $('taskStatus').value,
    dueDate: $('taskDueDate').value
  };

  try {
    const existing =
      tasks.find(t => t.id === editedTaskId);

    if (existing) {
      await updateTask(existing, values);
    } else {
      await createTask(project.id, values);
    }

    $('taskDialog').close();
    await refreshTasks();
  } catch (error) {
    $('taskFormError').textContent = error.message;
    $('taskFormError').hidden = false;
  }
});

$('deleteTaskBtn').addEventListener('click', async () => {
  const task =
    tasks.find(t => t.id === editedTaskId);

  if (!task || !confirm(
    `Opravdu smazat úkol „${task.title}“?`
  )) return;

  try {
    await deleteTask(task.id);
    $('taskDialog').close();
    await refreshTasks();
  } catch (error) {
    $('taskFormError').textContent = error.message;
    $('taskFormError').hidden = false;
  }
});

// ========================================
// PN-05 – ZÁLOHOVÁNÍ A OBNOVA
// ========================================

$('exportBackupBtn').addEventListener('click', async () => {
  const button = $('exportBackupBtn');
  button.disabled = true;

  try {
    await saveDraft();

    const summary = await exportBackup();

    alert(
      'Záloha byla připravena ke stažení.\n\n' +
      `Projekty: ${summary.projects}\n` +
      `Stránky: ${summary.pages}\n` +
      `Úkoly: ${summary.tasks}\n\n` +
      'Zkontroluj Stažené soubory.'
    );
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
  }
});

$('importBackupBtn').addEventListener('click', async () => {
  try {
    await saveDraft();

    const input = $('backupFileInput');
    input.value = '';
    input.click();
  } catch (error) {
    reportError(error);
  }
});

$('backupFileInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;

  const button = $('importBackupBtn');
  button.disabled = true;

  try {
    const backup = await parseBackupFile(file);
    const data = backup.data;

    const confirmed = confirm(
      'Obnovit data ze zálohy?\n\n' +
      `Projekty: ${data.projects.length}\n` +
      `Stránky: ${data.pages.length}\n` +
      `Úkoly: ${data.tasks.length}\n\n` +
      'Existující záznamy nebudou přepsány ani smazány.'
    );

    if (!confirmed) return;

    await saveDraft();

    const result = await importBackup(backup);

    alert(
      'Import dokončen.\n\n' +
      'Přidáno:\n' +
      `Projekty: ${result.added.projects}\n` +
      `Stránky: ${result.added.pages}\n` +
      `Úkoly: ${result.added.tasks}\n\n` +
      'Přeskočeno:\n' +
      `Projekty: ${result.skipped.projects}\n` +
      `Stránky: ${result.skipped.pages}\n` +
      `Úkoly: ${result.skipped.tasks}`
    );

    window.location.reload();
  } catch (error) {
    reportError(error);
  } finally {
    button.disabled = false;
    event.target.value = '';
  }
});

// ========================================
// PN-06 – GLOBÁLNÍ VYHLEDÁVÁNÍ
// ========================================

const searchDialog = $('searchDialog');
const searchInput = $('globalSearchInput');
const searchResults = $('searchResults');

function renderSearchResults() {
  const query = searchInput.value.trim();
  searchResults.replaceChildren();

  if (!query) {
    $('searchInfo').textContent =
      'Zadej hledaný text.';
    return;
  }

  const results = searchEntries(searchIndex, query);
  const visible = results.slice(0, 100);

  $('searchInfo').textContent =
    `${results.length} nalezených výsledků` +
    (results.length > 100 ? ' · zobrazeno prvních 100' : '');

  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'search-empty';
    empty.textContent = 'Nenalezen žádný odpovídající záznam.';
    searchResults.append(empty);
    return;
  }

  const typeNames = {
    project: 'Projekt',
    page: 'Stránka',
    task: 'Úkol'
  };

  for (const result of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-result';

    const heading = document.createElement('strong');
    heading.textContent = result.title;

    const location = document.createElement('span');
    location.className = 'search-result-location';

    location.textContent =
      `${typeNames[result.type]} · ${result.projectName}`;

    button.append(heading, location);

    if (result.excerpt) {
      const excerpt = document.createElement('span');
      excerpt.className = 'search-result-excerpt';
      excerpt.textContent = result.excerpt;
      button.append(excerpt);
    }

    button.addEventListener('click', async () => {
      button.disabled = true;

      try {
        await openSearchResult(result);
      } catch (error) {
        reportError(error);
        button.disabled = false;
      }
    });

    searchResults.append(button);
  }
}

async function openSearchDialog() {
  // Není vhodné otevírat druhý dialog přes rozpracovaný formulář.
  if (
    loading ||
    document.querySelector('dialog[open]')
  ) return;

  try {
    await saveDraft();
  } catch (error) {
    reportError(error);
    return;
  }

  const generation = ++searchGeneration;

  searchInput.value = '';
  searchIndex = [];
  searchResults.replaceChildren();

  $('searchInfo').textContent = 'Načítání záznamů…';

  searchDialog.showModal();
  searchInput.focus();

  try {
    const entries = await loadSearchIndex();

    if (
      generation !== searchGeneration ||
      !searchDialog.open
    ) return;

    searchIndex = entries;
    renderSearchResults();
  } catch (error) {
    $('searchInfo').textContent =
      'Nepodařilo se načíst vyhledávání.';

    console.error('Chyba vyhledávání:', error);
  }
}

function closeSearchDialog() {
  ++searchGeneration;

  if (searchDialog.open) {
    searchDialog.close();
  }
}

async function openSearchResult(result) {
  // Před navigací ukládáme případný rozepsaný text.
  await saveDraft();

  const projectExists = projects.some(
    project => project.id === result.projectId
  );

  if (!projectExists) {
    throw new Error('Projekt již neexistuje.');
  }

  if (loading) return;

  // Zavřeme hledání a otevřeme odpovídající projekt.
  closeSearchDialog();
  await selectProject(result.projectId);

  if (result.type === 'project') return;

  if (result.type === 'page') {
    const page = pages.find(item => item.id === result.id);

    if (!page) {
      throw new Error('Stránka již neexistuje.');
    }

    selectedPageId = page.id;

    renderTabs();
    await renderContent();

    if (page.kind !== 'tasks') {
      $('noteEditor').focus();
    }

    return;
  }

  if (result.type === 'task') {
    const taskPage = pages.find(
      page => page.kind === 'tasks'
    );

    if (!taskPage) {
      throw new Error('Stránka Úkoly nebyla nalezena.');
    }

    selectedPageId = taskPage.id;
    $('taskFilter').value = 'all';

    renderTabs();
    await renderContent();

    const task = tasks.find(item => item.id === result.id);

    if (!task) {
      throw new Error('Úkol již neexistuje.');
    }

    openTaskDialog(task);
  }
}

$('openSearchBtn').addEventListener('click', () => {
  openSearchDialog().catch(reportError);
});

$('closeSearchBtn').addEventListener('click', () => {
  closeSearchDialog();
});

searchDialog.addEventListener('close', () => {
  ++searchGeneration;
});

searchInput.addEventListener('input', () => {
  renderSearchResults();
});

// Klávesová zkratka Ctrl + K (Windows/Linux)
// nebo Cmd + K (Mac).
document.addEventListener('keydown', event => {
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 'k'
  ) {
    event.preventDefault();
    openSearchDialog().catch(reportError);
  }
});

// ========================================
// START APLIKACE
// ========================================

try {
  await initializeProjects();
  await reloadProjects();
} catch (error) {
  console.error('ProjectNotes – inicializace:', error);

  $('projectTitle').textContent =
    'Nepodařilo se načíst zápisník';

  $('projectDescription').textContent =
    'Zkontroluj konzoli F12 a úložiště IndexedDB.';
}
