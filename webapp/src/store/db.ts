// Store: IndexedDB persistence (plan section 9).
// One object store 'tasks', keyed by taskId. Every runner operation writes the
// full snapshot atomically (single put), so a crash can only lose the very
// operation in flight, never corrupt state.

import type { RunnerState } from '../runner/runner';
import { resumePosition } from '../runner/runner';
import type { StjTask } from '../loader/types';

const DB_NAME = 'solder-assistant';
const DB_VERSION = 2;
const STORE = 'tasks';
const SETTINGS_STORE = 'settings';

/** App settings (M4): TTS rate 0.7-1.2 (default 0.9), batch threshold
 * (default 4, null = batch off). Persisted once per browser in its own store. */
export interface AppSettings {
  rate: number;
  batchThreshold: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = { rate: 0.9, batchThreshold: 4 };

/** Clamp/coerce arbitrary (old/corrupt) values into a valid AppSettings. */
export function normalizeSettings(raw: unknown): AppSettings {
  const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rate = typeof o['rate'] === 'number' && Number.isFinite(o['rate']) ? o['rate'] : DEFAULT_SETTINGS.rate;
  const th = o['batchThreshold'];
  return {
    rate: Math.min(1.2, Math.max(0.7, Math.round(rate * 100) / 100)),
    batchThreshold: th === null ? null : typeof th === 'number' && Number.isInteger(th) && th >= 2 && th <= 12 ? th : DEFAULT_SETTINGS.batchThreshold,
  };
}

/** Orientation calibration (plan section 7), persisted per task so a second
 * session skips the calibration step. M3 sets deg only; flip arrives with the
 * M4 face-turn flow (default 'lr'). Incremental record fields only. */
export interface CalibInfo {
  deg: number;
  flip: 'lr' | 'tb';
  at: number;
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
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // a PWA update may request a higher version while this page is open in
      // another tab; release the connection so the upgrade is never blocked
      db.onversionchange = () => {
        db.close();
        if (dbPromise) {
          dbPromise = null;
        }
      };
      resolve(db);
    };
    req.onblocked = () => reject(new Error('indexedDB upgrade blocked by another open page'));
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

/** Reset welding progress (keep the imported task); the 报菜名 pick order is
 * cleared too so a deliberate fresh start re-opens the menu. Calibration is
 * kept (the board on the desk does not move). */
export async function resetRun(taskId: string): Promise<void> {
  await enqueue(async () => {
    const rec = await getTask(taskId);
    if (!rec) return;
    rec.run = null;
    delete rec.pickOrder;
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

/** Persist the 报菜名 pick order for a task. */
export async function persistPickOrder(taskId: string, pickOrder: string[]): Promise<void> {
  await enqueue(async () => {
    const rec = await getTask(taskId);
    if (!rec) return;
    rec.pickOrder = pickOrder;
    await putTask(rec);
  });
}

// ---- app settings (own store, single record id 'app') ----

function settingsTx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(SETTINGS_STORE, mode).objectStore(SETTINGS_STORE);
}

export async function getSettings(): Promise<AppSettings> {
  const db = await openDb();
  const rec = await asPromise(
    settingsTx(db, 'readonly').get('app') as IDBRequest<unknown | undefined>,
  );
  return normalizeSettings(rec);
}

export async function saveSettings(s: AppSettings): Promise<void> {
  const db = await openDb();
  await asPromise(settingsTx(db, 'readwrite').put({ id: 'app', ...s }));
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
