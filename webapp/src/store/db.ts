// Store: IndexedDB persistence (plan section 9).
// One object store 'tasks', keyed by taskId. Every runner operation writes the
// full snapshot atomically (single put), so a crash can only lose the very
// operation in flight, never corrupt state.

import type { RunnerState } from '../runner/runner';
import { resumePosition } from '../runner/runner';
import type { StjTask } from '../loader/types';

const DB_NAME = 'solder-assistant';
const DB_VERSION = 1;
const STORE = 'tasks';

/** Orientation calibration (plan section 7), persisted per task so a second
 * session skips the calibration step. M3 sets deg only; flip arrives with the
 * M4 face-turn flow (default 'lr'). Incremental record fields only. */
export interface CalibInfo {
  deg: number;
  flip: 'lr' | 'tb';
  at: number;
}

/** App settings (M4): TTS rate 0.7-1.2 (default 0.9), batch threshold
 * (default 4, null = batch off). */
export interface TaskSettings {
  rate: number;
  batchThreshold: number | null;
}

export interface TaskRecord {
  taskId: string;
  name: string;
  builtin: boolean;
  task: StjTask; // validated STJ (original JSON round-trips through export)
  run: RunnerSnapshot | null;
  calib?: CalibInfo;
  /** M4: user pick order from the menu screen (报菜名点选序), as gids;
   * absent -> fall back to task.group_order_default. */
  pickOrder?: string[];
  settings?: TaskSettings;
  savedAt: number;
}

export interface RunnerSnapshot {
  statuses: Record<number, 'pending' | 'done' | 'skipped'>;
  pointer: number;
  startedAt: number | null;
  finishedAt: number | null;
  updatedAt: number;
  /** 1-based display/resume position (pointer advanced to the first pending). */
  resumeAt: number;
}

export function snapshotOf(state: RunnerState): RunnerSnapshot {
  return {
    statuses: state.statuses,
    pointer: state.pointer,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    updatedAt: Date.now(),
    resumeAt: resumePosition(state),
  };
}

export function stateOf(snap: RunnerSnapshot, order: number[]): RunnerState {
  return {
    order,
    statuses: snap.statuses,
    pointer: snap.pointer,
    startedAt: snap.startedAt,
    finishedAt: snap.finishedAt,
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'taskId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
  return dbPromise;
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function asPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

export async function listTasks(): Promise<TaskRecord[]> {
  const db = await openDb();
  const all = await asPromise(tx(db, 'readonly').getAll() as IDBRequest<TaskRecord[]>);
  return all.sort((a, b) => a.savedAt - b.savedAt);
}

export async function getTask(taskId: string): Promise<TaskRecord | undefined> {
  const db = await openDb();
  return asPromise(tx(db, 'readonly').get(taskId) as IDBRequest<TaskRecord | undefined>);
}

export async function putTask(record: TaskRecord): Promise<void> {
  const db = await openDb();
  await asPromise(tx(db, 'readwrite').put(record));
}

export async function deleteTask(taskId: string): Promise<void> {
  const db = await openDb();
  await asPromise(tx(db, 'readwrite').delete(taskId));
}

/** Reset welding progress (keep the imported task). */
export async function resetRun(taskId: string): Promise<void> {
  await enqueue(async () => {
    const rec = await getTask(taskId);
    if (!rec) return;
    rec.run = null;
    await putTask(rec);
  });
}

/** Persist the runner snapshot atomically after each operation. */
export async function persistRun(taskId: string, state: RunnerState): Promise<void> {
  await enqueue(async () => {
    const rec = await getTask(taskId);
    if (!rec) return;
    rec.run = snapshotOf(state);
    await putTask(rec);
  });
}

/** Persist the orientation calibration for a task. */
export async function persistCalib(taskId: string, calib: CalibInfo): Promise<void> {
  await enqueue(async () => {
    const rec = await getTask(taskId);
    if (!rec) return;
    rec.calib = calib;
    await putTask(rec);
  });
}

/** Serialize read-modify-write cycles: locking the calibration fires while the
 * first start dispatch persists its snapshot; two interleaved get->put pairs
 * clobber each other (last writer wins with a stale record), so every
 * read-modify-write runs on one queue. */
let writeChain: Promise<void> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = writeChain.then(job);
  writeChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
