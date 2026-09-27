import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

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
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

// Sanitization helpers matching firebase-blueprint.json volumetric constraints
export const sanitizeId = (id: string): string =>
  id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);

export const truncateStr = (val: string, max: number): string =>
  (val || '').trim().slice(0, max);

// Ensure parent /users/{uid} profile document exists in Cloud Firestore
export async function ensureUserProfileInFirestore(options?: {
  name?: string;
  language?: 'en' | 'ne';
  theme?: 'light' | 'dark';
  notificationsEnabled?: boolean;
}): Promise<boolean> {
  if (
    !auth.currentUser ||
    !auth.currentUser.emailVerified ||
    !auth.currentUser.email
  ) {
    return false;
  }
  const safeUid = sanitizeId(auth.currentUser.uid);
  const path = `users/${safeUid}`;
  const userRef = doc(db, 'users', safeUid);
  const isAuthAdmin =
    auth.currentUser.email === 'tech4u571@gmail.com' ||
    auth.currentUser.email === 'til.prasad571@gmail.com';

  try {
    const existingSnap = await getDoc(userRef);
    if (existingSnap.exists()) {
      return true;
    }
    await setDoc(userRef, {
      uid: safeUid,
      name:
        truncateStr(
          options?.name ||
            auth.currentUser.displayName ||
            auth.currentUser.email.split('@')[0],
          100
        ) || 'User',
      email: truncateStr(auth.currentUser.email, 150),
      role: isAuthAdmin ? 'admin' : 'user',
      status: 'active',
      isPro: isAuthAdmin,
      proExpiry: '',
      language: options?.language === 'ne' ? 'ne' : 'en',
      theme: options?.theme === 'dark' ? 'dark' : 'light',
      notificationsEnabled: options?.notificationsEnabled ?? true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return true;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// Sync helper for verified Firebase users to mirror data into Cloud Firestore
export async function syncRoutineToFirestore(routine: {
  id: string;
  userId: string;
  title: string;
  time: string;
  category: string;
  icon: string;
  reminderOffset: number;
  duration: number;
  repeatType: string;
  customDays: number[];
  targetDate: string;
  notes: string;
}) {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const currentUid = sanitizeId(auth.currentUser.uid);
  if (currentUid !== sanitizeId(routine.userId)) return;

  // Ensure /users/{currentUid} exists before creating/updating /routines/{safeId}
  await ensureUserProfileInFirestore();

  const safeId = sanitizeId(routine.id);
  const path = `routines/${safeId}`;
  const routineRef = doc(db, 'routines', safeId);

  const rawTime = truncateStr(routine.time, 10);
  const validTime = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(rawTime)
    ? rawTime
    : '06:00';
  const numericOffset = Number(routine.reminderOffset);
  const validOffset = [0, 5, 10, 15].includes(numericOffset)
    ? numericOffset
    : 0;
  const validDuration = Math.max(
    0,
    Math.min(1440, Math.round(Number(routine.duration) || 0))
  );
  const validRepeatType = ['today', 'everyday', 'weekdays', 'custom'].includes(
    routine.repeatType
  )
    ? routine.repeatType
    : 'today';
  const validCustomDays = Array.isArray(routine.customDays)
    ? routine.customDays
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        .slice(0, 7)
    : [];

  const baseFields = {
    title: truncateStr(routine.title, 120) || 'Routine',
    time: validTime,
    category: truncateStr(routine.category, 40) || 'General',
    icon: truncateStr(routine.icon, 20) || 'clock',
    reminderOffset: validOffset,
    duration: validDuration,
    repeatType: validRepeatType,
    customDays: validCustomDays,
    targetDate: truncateStr(routine.targetDate, 20),
    notes: truncateStr(routine.notes, 500),
    updatedAt: serverTimestamp(),
  };

  try {
    const existing = await getDoc(routineRef);
    if (existing.exists()) {
      await updateDoc(routineRef, baseFields);
    } else {
      await setDoc(routineRef, {
        userId: currentUid,
        ...baseFields,
        createdAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeRoutineFromFirestore(
  routineId: string,
  userId?: string
) {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  if (userId && sanitizeId(auth.currentUser.uid) !== sanitizeId(userId)) return;
  const safeId = sanitizeId(routineId);
  const path = `routines/${safeId}`;
  const routineRef = doc(db, 'routines', safeId);
  try {
    const existing = await getDoc(routineRef);
    if (!existing.exists()) return;
    await deleteDoc(routineRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateUserProfileInFirestore(
  userId: string,
  updates: {
    name: string;
    language: 'en' | 'ne';
    theme: 'light' | 'dark';
    notificationsEnabled: boolean;
  }
) {
  if (!auth.currentUser || !auth.currentUser.emailVerified) return;
  const safeId = sanitizeId(userId);
  if (sanitizeId(auth.currentUser.uid) !== safeId) return;
  const path = `users/${safeId}`;
  const userRef = doc(db, 'users', safeId);
  try {
    const existing = await getDoc(userRef);
    if (!existing.exists()) {
      await ensureUserProfileInFirestore(updates);
      return;
    }
    await updateDoc(userRef, {
      name: truncateStr(updates.name, 100) || 'User',
      language: updates.language === 'ne' ? 'ne' : 'en',
      theme: updates.theme === 'dark' ? 'dark' : 'light',
      notificationsEnabled: Boolean(updates.notificationsEnabled),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}
