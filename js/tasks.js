
import {
  getTasks,
  saveTask,
  removeTask
} from './database.js';

export const PRIORITIES = {
  low: 'Nízká',
  medium: 'Střední',
  high: 'Vysoká'
};

export const STATUSES = {
  todo: 'K vyřízení',
  doing: 'Probíhá',
  done: 'Hotovo'
};

export async function listTasks(projectId) {
  const tasks = await getTasks(projectId);

  return tasks.sort(
    (a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0)
  );
}

function validated(values) {
  const title = values.title.trim();
  const description = values.description.trim();

  if (!title || title.length > 150) {
    throw new Error(
      'Název úkolu musí mít 1 až 150 znaků.'
    );
  }

  if (description.length > 2000) {
    throw new Error('Popis úkolu je příliš dlouhý.');
  }

  if (!(values.priority in PRIORITIES)) {
    throw new Error('Neplatná priorita.');
  }

  if (!(values.status in STATUSES)) {
    throw new Error('Neplatný stav.');
  }

  const dueDate = values.dueDate || '';

  if (
    dueDate &&
    !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)
  ) {
    throw new Error('Neplatný termín.');
  }

  return {
    title,
    description,
    priority: values.priority,
    status: values.status,
    dueDate
  };
}

export async function createTask(projectId, values) {
  const task = {
    id: crypto.randomUUID(),
    projectId,
    ...validated(values),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };

  await saveTask(task);

  return task;
}

export async function updateTask(task, values) {
  const updated = {
    ...task,
    ...validated(values),
    updatedAt: Date.now()
  };

  await saveTask(updated);

  return updated;
}

export async function setTaskStatus(task, status) {
  if (!(status in STATUSES)) {
    throw new Error('Neplatný stav úkolu.');
  }

  const updated = {
    ...task,
    status,
    updatedAt: Date.now()
  };

  await saveTask(updated);

  return updated;
}

export const deleteTask = id => removeTask(id);
