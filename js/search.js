
import {
  getAllProjects,
  getPages,
  getTasks
} from './database.js';

// Porovnávání bez rozdílu velikosti písmen
// a české diakritiky.
function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ');
}

// Vytvoření vyhledávacího indexu z IndexedDB.
// Index je pouze v paměti; databázi nemění.
export async function loadSearchIndex() {
  const projects = await getAllProjects();

  const details = await Promise.all(
    projects.map(async project => {
      const [pages, tasks] = await Promise.all([
        getPages(project.id),
        getTasks(project.id)
      ]);

      return { project, pages, tasks };
    })
  );

  const entries = [];

  for (const { project, pages, tasks } of details) {
    entries.push({
      type: 'project',
      projectId: project.id,
      id: project.id,
      projectName: project.name,
      title: project.name,
      text: project.description ?? '',
      searchText: [
        project.name,
        project.short,
        project.description
      ].join(' ')
    });

    for (const page of pages) {
      entries.push({
        type: 'page',
        projectId: project.id,
        id: page.id,
        projectName: project.name,
        title: page.name,
        text: page.content ?? '',
        searchText: [
          page.name,
          page.content
        ].join(' ')
      });
    }

    for (const task of tasks) {
      entries.push({
        type: 'task',
        projectId: project.id,
        id: task.id,
        projectName: project.name,
        title: task.title,
        text: task.description ?? '',
        searchText: [
          task.title,
          task.description
        ].join(' ')
      });
    }
  }

  return entries;
}

function createExcerpt(text, query) {
  const source = String(text ?? '').trim();

  if (!source) return '';

  const normalized = normalize(source);
  const index = normalized.indexOf(normalize(query));
  const start = index < 0 ? 0 : Math.max(0, index - 55);
  const end = Math.min(source.length, start + 170);

  return (
    (start > 0 ? '…' : '') +
    source.slice(start, end).replace(/\s+/g, ' ') +
    (end < source.length ? '…' : '')
  );
}

// Vyhledávání nad připraveným indexem.
export function searchEntries(entries, query) {
  const terms = normalize(query)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!terms.length) return [];

  const results = [];

  for (const entry of entries) {
    const haystack = normalize(entry.searchText);

    if (!terms.every(term => haystack.includes(term))) {
      continue;
    }

    const titleMatch = terms.every(term =>
      normalize(entry.title).includes(term)
    );

    results.push({
      ...entry,
      excerpt: createExcerpt(
        entry.text || entry.searchText,
        terms[0]
      ),
      score: titleMatch ? 2 : 1
    });
  }

  return results.sort(
    (a, b) =>
      b.score - a.score ||
      a.projectName.localeCompare(b.projectName, 'cs')
  );
}
