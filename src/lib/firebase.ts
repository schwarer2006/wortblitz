import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  doc,
  getDocFromServer,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';

export interface ExternalFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
  firestoreDatabaseId?: string;
}

const PLAYER_ID_STORAGE_KEY = 'wortblitz_device_uid_v1';

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;

export function getOrCreatePlayerId(): string {
  try {
    const existing = localStorage.getItem(PLAYER_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) {
      return existing;
    }
    const randomPart =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
    const nextId = `p_${randomPart.slice(0, 28)}`;
    localStorage.setItem(PLAYER_ID_STORAGE_KEY, nextId);
    return nextId;
  } catch {
    return `p_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function hasPlaceholderValue(val: unknown): boolean {
  if (typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (!trimmed) return true;
  return /DEIN|DEINE|YOUR_|PLACEHOLDER|EXAMPLE|CHANGE_ME|XXXX/i.test(trimmed);
}

export type FirebaseInitResult =
  | { ok: true; db: Firestore }
  | { ok: false; reason: 'MISSING_OR_INVALID' | 'PLACEHOLDER'; message: string };

export async function initFirebaseFromConfig(): Promise<FirebaseInitResult> {
  if (dbInstance) {
    return { ok: true, db: dbInstance };
  }

  try {
    const response = await fetch('./firebase-config.json', { cache: 'no-store' });
    if (!response.ok) {
      return {
        ok: false,
        reason: 'MISSING_OR_INVALID',
        message: `firebase-config.json konnte nicht geladen werden (HTTP ${response.status}).`,
      };
    }

    const config = (await response.json()) as Partial<ExternalFirebaseConfig>;

    if (
      hasPlaceholderValue(config.apiKey) ||
      hasPlaceholderValue(config.authDomain) ||
      hasPlaceholderValue(config.projectId) ||
      hasPlaceholderValue(config.appId)
    ) {
      return {
        ok: false,
        reason: 'PLACEHOLDER',
        message:
          'In ./firebase-config.json stehen noch Platzhalter-Werte. Bitte trage dort deine echten Firebase-Projektdaten ein.',
      };
    }

    appInstance = initializeApp({
      apiKey: config.apiKey,
      authDomain: config.authDomain,
      projectId: config.projectId,
      storageBucket: config.storageBucket,
      messagingSenderId: config.messagingSenderId,
      appId: config.appId,
    });

    const databaseId =
      typeof config.firestoreDatabaseId === 'string' &&
      config.firestoreDatabaseId.trim().length > 0
        ? config.firestoreDatabaseId.trim()
        : undefined;

    dbInstance = databaseId
      ? getFirestore(appInstance, databaseId)
      : getFirestore(appInstance);

    try {
      await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    } catch {
      // Initial connection ping may fail on empty/offline document; ignore if non-fatal
    }

    return { ok: true, db: dbInstance };
  } catch (err) {
    return {
      ok: false,
      reason: 'MISSING_OR_INVALID',
      message:
        err instanceof Error
          ? `Fehler beim Laden von ./firebase-config.json: ${err.message}`
          : 'Unbekannter Fehler beim Laden von ./firebase-config.json.',
    };
  }
}

export function getDb(): Firestore {
  if (!dbInstance) {
    throw new Error('Firestore wurde noch nicht initialisiert.');
  }
  return dbInstance;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(errInfo.error);
}
