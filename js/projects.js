
import {
  countProjects,
  getAllProjects,
  saveProject,
  removeProject
} from './database.js';

const DEFAULTS = [
  {
    name: 'Lagermann WMS',
    description: 'Skladový systém · vývoj a testování',
    short: 'LGM',
    color: '#edc06c'
  },
  {
    name: 'InvoiceFlow',
    description: 'Automatizovaná fakturace z Excelu',
    short: 'INV',
    color: '#b5dec4'
  },
  {
    name: 'TimeMoney',
    description: 'Čas, zakázky a finance',
    short: 'TM',
    color: '#b1c3f4'
  },
  {
    name: 'Document Record AI',
    description: 'Dokumenty a protokoly z diktátu',
    short: 'DR',
    color: '#e9b8c7'
  },
  {
    name: 'Vine:too',
    description: 'E-shop vína a delikates',
    short: 'VINE',
    color: '#cbb7e7'
  }
];

export async function initializeProjects() {
  const key = 'projectnotes_initialized_v1';

  if (localStorage.getItem(key) === 'yes') return;

  if (await countProjects() === 0) {
    for (const [index, project] of DEFAULTS.entries()) {
      await saveProject({
        ...project,
        id: crypto.randomUUID(),
        createdAt: Date.now() + index
      });
    }
  }

  localStorage.setItem(key, 'yes');
}

export async function listProjects() {
  return (await getAllProjects())
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function validateProject(values) {
  const name = values.name.trim();
  const description = values.description.trim();
  const short = values.short.trim().toUpperCase();
  const color = values.color;

  if (!name) {
    throw new Error('Vyplň název projektu.');
  }

  if (!short || short.length > 6) {
    throw new Error('Zkratka musí mít 1 až 6 znaků.');
  }

  if (!/^#[\da-fA-F]{6}$/.test(color)) {
    throw new Error('Neplatná barva projektu.');
  }

  return { name, description, short, color };
}

export async function createProject(values) {
  const project = {
    ...validateProject(values),
    id: crypto.randomUUID(),
    createdAt: Date.now()
  };

  await saveProject(project);
  return project;
}

export async function updateProject(project, values) {
  const updated = {
    ...project,
    ...validateProject(values),
    updatedAt: Date.now()
  };

  await saveProject(updated);
  return updated;
}

export const deleteProject = id => removeProject(id);
