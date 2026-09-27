import {
  Routine,
  RoutineLog,
  Language,
  UserProfile,
  NotificationSoundId,
  BuiltInSoundId,
} from '../types';
import {
  ScheduledReminderOccurrence,
  formatTime12h,
  getAllUpcomingReminderOccurrences,
  getUserTimezone,
} from './dateUtils';

export const ALARM_DB_NAME = 'mero-routine-alarms-v1';
export const ALARM_DB_VERSION = 1;
export const STORE_SCHEDULED = 'scheduled_alarms';
export const STORE_FIRED = 'fired_alarms';
export const STORE_META = 'alarm_meta';

export const FIRED_REMINDERS_STORAGE_KEY = 'mero_routine_fired_reminders_v1';
export const ACKNOWLEDGED_UI_ALARMS_KEY = 'mero_routine_ack_ui_alarms_v1';

export interface PersistedScheduledAlarm {
  dedupeKey: string;
  routineId: string;
  routineTitle: string;
  routineIcon: string;
  routineTime: string;
  routineCategory: string;
  routineNotes: string;
  repeatType: string;
  customDays: number[];
  reminderOffset: number;
  dateStr: string;
  triggerTimestampMs: number;
  activityTimestampMs: number;
  triggerTime24: string;
  isSnoozed: boolean;
  effectiveOffsetMinutes: number;
  timezone: string;
  title: string;
  body: string;
  soundId: NotificationSoundId;
  defaultSoundId: BuiltInSoundId;
  updatedAtMs: number;
}

export interface AlarmMetaSettings {
  userId: string;
  authToken: string;
  notificationsEnabled: boolean;
  language: Language;
  timezone: string;
  timezoneOffsetMinutes: number;
  notificationSound: NotificationSoundId;
  defaultNotificationSound: BuiltInSoundId;
  updatedAtMs: number;
}

export function buildReminderMessage(
  occ: ScheduledReminderOccurrence,
  lang: Language
): { title: string; body: string; formattedTriggerTime: string } {
  const rt = occ.routine;
  const formattedActivityTime = formatTime12h(rt.time, lang);
  const formattedTriggerTime = formatTime12h(occ.triggerTime24, lang);

  const title = `🔔 ${rt.title} — Mero Routine`;
  let body = '';

  if (occ.isSnoozed) {
    body =
      lang === 'ne'
        ? `🔔 ${rt.title} — सारिएको समय (${formattedTriggerTime}) भयो।`
        : `Snoozed reminder: It's ${formattedTriggerTime} — time for ${rt.title}.`;
  } else if (occ.effectiveOffsetMinutes > 0) {
    body =
      lang === 'ne'
        ? `🔔 ${rt.title} ${occ.effectiveOffsetMinutes} मिनेटमा सुरु हुँदैछ (${formattedActivityTime})।`
        : `Upcoming in ${occ.effectiveOffsetMinutes} min: ${rt.title} at ${formattedActivityTime}.`;
  } else {
    body =
      lang === 'ne'
        ? `🔔 ${rt.title} — समय: ${formattedActivityTime}। कार्य सुरु गर्ने समय भयो!`
        : `It’s ${formattedActivityTime}. Time for ${rt.title}!`;
  }

  return { title, body, formattedTriggerTime };
}

function openAlarmIdb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(ALARM_DB_NAME, ALARM_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SCHEDULED)) {
          db.createObjectStore(STORE_SCHEDULED, { keyPath: 'dedupeKey' });
        }
        if (!db.objectStoreNames.contains(STORE_FIRED)) {
          db.createObjectStore(STORE_FIRED, { keyPath: 'dedupeKey' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function loadFiredReminderKeysFromLocalStorage(): Set<string> {
  try {
    const raw = localStorage.getItem(FIRED_REMINDERS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.slice(-400));
    }
  } catch {
    // Ignore
  }
  return new Set();
}

export function saveFiredReminderKeysToLocalStorage(keys: Set<string>): void {
  try {
    const arr = Array.from(keys).slice(-400);
    localStorage.setItem(FIRED_REMINDERS_STORAGE_KEY, JSON.stringify(arr));
  } catch {
    // Ignore
  }
}

export function loadAcknowledgedUiAlarms(): Set<string> {
  try {
    const raw = localStorage.getItem(ACKNOWLEDGED_UI_ALARMS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.slice(-200));
    }
  } catch {
    // Ignore
  }
  return new Set();
}

export function markAlarmAcknowledgedInUi(dedupeKey: string): void {
  try {
    const set = loadAcknowledgedUiAlarms();
    set.add(dedupeKey);
    localStorage.setItem(
      ACKNOWLEDGED_UI_ALARMS_KEY,
      JSON.stringify(Array.from(set).slice(-200))
    );
  } catch {
    // Ignore
  }
}

export async function loadFiredKeysFromIdb(): Promise<
  Array<{ dedupeKey: string; firedAtMs: number }>
> {
  const db = await openAlarmIdb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_FIRED, 'readonly');
      const store = tx.objectStore(STORE_FIRED);
      const req = store.getAll();
      req.onsuccess = () => {
        resolve(Array.isArray(req.result) ? req.result : []);
      };
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function syncFiredKeysWithIdb(
  memorySet: Set<string>
): Promise<Set<string>> {
  const idbRecords = await loadFiredKeysFromIdb();
  let changed = false;
  for (const rec of idbRecords) {
    if (rec && typeof rec.dedupeKey === 'string' && !memorySet.has(rec.dedupeKey)) {
      memorySet.add(rec.dedupeKey);
      changed = true;
    }
  }
  if (changed) {
    saveFiredReminderKeysToLocalStorage(memorySet);
  }
  return memorySet;
}

export async function markAlarmFiredEverywhere(
  dedupeKey: string,
  memorySet: Set<string>,
  token: string | null
): Promise<void> {
  memorySet.add(dedupeKey);
  saveFiredReminderKeysToLocalStorage(memorySet);

  const db = await openAlarmIdb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_FIRED, 'readwrite');
        tx.objectStore(STORE_FIRED).put({
          dedupeKey,
          firedAtMs: Date.now(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore
    }
  }

  postMessageToServiceWorker({
    type: 'MARK_ALARM_FIRED',
    dedupeKey,
  });

  if (token) {
    fetch('/api/push/mark-fired', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ dedupeKey }),
    }).catch(() => {});
  }
}

export function postMessageToServiceWorker(message: Record<string, unknown>): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(message);
    }
    navigator.serviceWorker.ready
      .then((reg) => {
        if (reg.active && reg.active !== navigator.serviceWorker.controller) {
          reg.active.postMessage(message);
        }
      })
      .catch(() => {});
  } catch {
    // Ignore
  }
}

export async function syncAlarmsToPersistentStorage(params: {
  routines: Routine[];
  routineLogs: RoutineLog[];
  firedKeys: Set<string>;
  user: UserProfile | null;
  lang: Language;
  token: string | null;
}): Promise<PersistedScheduledAlarm[]> {
  const { routines, routineLogs, firedKeys, user, lang, token } = params;
  const timezone = getUserTimezone();
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();

  if (!user || !user.notificationsEnabled) {
    const db = await openAlarmIdb();
    if (db) {
      try {
        await new Promise<void>((resolve) => {
          const tx = db.transaction([STORE_SCHEDULED, STORE_META], 'readwrite');
          tx.objectStore(STORE_SCHEDULED).clear();
          if (user) {
            tx.objectStore(STORE_META).put({
              key: 'userSettings',
              value: {
                userId: user.uid,
                authToken: token || '',
                notificationsEnabled: false,
                language: lang,
                timezone,
                timezoneOffsetMinutes,
                notificationSound:
                  user.notificationSound ||
                  user.defaultNotificationSound ||
                  'default_1',
                defaultNotificationSound:
                  user.defaultNotificationSound || 'default_1',
                updatedAtMs: Date.now(),
              } satisfies AlarmMetaSettings,
            });
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        });
      } catch {
        // Ignore
      }
    }
    postMessageToServiceWorker({
      type: 'SYNC_ALARMS',
      payload: {
        alarms: [],
        settings: {
          notificationsEnabled: false,
          language: lang,
          timezone,
          timezoneOffsetMinutes,
        },
        firedKeys: Array.from(firedKeys).slice(-300),
      },
    });
    return [];
  }

  const upcomingOccs = getAllUpcomingReminderOccurrences(
    routines,
    routineLogs,
    firedKeys,
    new Date(),
    7
  );

  const activeSound: NotificationSoundId =
    user.notificationSound || user.defaultNotificationSound || 'default_1';
  const defaultSound: BuiltInSoundId =
    user.defaultNotificationSound || 'default_1';

  const persistedAlarms: PersistedScheduledAlarm[] = upcomingOccs.map((occ) => {
    const { title, body } = buildReminderMessage(occ, lang);
    return {
      dedupeKey: occ.dedupeKey,
      routineId: occ.routine.id,
      routineTitle: occ.routine.title,
      routineIcon: occ.routine.icon,
      routineTime: occ.routine.time,
      routineCategory: occ.routine.category,
      routineNotes: occ.routine.notes || '',
      repeatType: occ.routine.repeatType,
      customDays: occ.routine.customDays || [],
      reminderOffset: occ.routine.reminderOffset || 0,
      dateStr: occ.dateStr,
      triggerTimestampMs: occ.triggerDate.getTime(),
      activityTimestampMs: occ.activityDate.getTime(),
      triggerTime24: occ.triggerTime24,
      isSnoozed: occ.isSnoozed,
      effectiveOffsetMinutes: occ.effectiveOffsetMinutes,
      timezone: occ.routine.timezone || timezone,
      title,
      body,
      soundId: activeSound,
      defaultSoundId: defaultSound,
      updatedAtMs: Date.now(),
    };
  });

  const settings: AlarmMetaSettings = {
    userId: user.uid,
    authToken: token || '',
    notificationsEnabled: user.notificationsEnabled,
    language: lang,
    timezone,
    timezoneOffsetMinutes,
    notificationSound: activeSound,
    defaultNotificationSound: defaultSound,
    updatedAtMs: Date.now(),
  };

  const db = await openAlarmIdb();
  if (db) {
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(
          [STORE_SCHEDULED, STORE_META, STORE_FIRED],
          'readwrite'
        );
        const schedStore = tx.objectStore(STORE_SCHEDULED);
        schedStore.clear();
        for (const item of persistedAlarms) {
          schedStore.put(item);
        }
        tx.objectStore(STORE_META).put({
          key: 'userSettings',
          value: settings,
        });
        const firedStore = tx.objectStore(STORE_FIRED);
        const recentKeys = Array.from(firedKeys).slice(-250);
        for (const k of recentKeys) {
          firedStore.put({ dedupeKey: k, firedAtMs: Date.now() });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // Ignore IDB write error
    }
  }

  postMessageToServiceWorker({
    type: 'SYNC_ALARMS',
    payload: {
      alarms: persistedAlarms,
      settings,
      firedKeys: Array.from(firedKeys).slice(-300),
    },
  });

  // Register Periodic Background Sync & Background Sync if supported by browser/PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(async (reg) => {
        const anyReg = reg as unknown as {
          periodicSync?: {
            register: (
              tag: string,
              options: { minInterval: number }
            ) => Promise<void>;
          };
          sync?: {
            register: (tag: string) => Promise<void>;
          };
        };
        if (anyReg.periodicSync && typeof anyReg.periodicSync.register === 'function') {
          try {
            await anyReg.periodicSync.register('mero-routine-alarm-check', {
              minInterval: 60 * 1000,
            });
          } catch {
            // Ignore if permission not granted for periodicSync
          }
        }
        if (anyReg.sync && typeof anyReg.sync.register === 'function') {
          try {
            await anyReg.sync.register('mero-routine-alarm-sync');
          } catch {
            // Ignore
          }
        }
      })
      .catch(() => {});
  }

  return persistedAlarms;
}

export async function showAlarmNotificationViaSwOrBrowser(params: {
  title: string;
  body: string;
  dedupeKey: string;
  routineId: string;
  dateStr: string;
  routineTitle: string;
  routineTime: string;
  routineIcon: string;
  renotify?: boolean;
}): Promise<boolean> {
  if (
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted'
  ) {
    return false;
  }

  const notifData = {
    dedupeKey: params.dedupeKey,
    routineId: params.routineId,
    dateStr: params.dateStr,
    routineTitle: params.routineTitle,
    routineTime: params.routineTime,
    routineIcon: params.routineIcon,
    body: params.body,
  };

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(params.title, {
          body: params.body,
          icon: '/pwa-192x192.png',
          badge: '/favicon-32x32.png',
          tag: params.dedupeKey,
          renotify: Boolean(params.renotify),
          requireInteraction: true,
          vibrate: [300, 150, 300, 150, 400],
          data: notifData,
          actions: [
            { action: 'done', title: '✓ Mark Done' },
            { action: 'snooze', title: '⏰ Snooze 10m' },
          ],
        } as NotificationOptions);
        return true;
      }
    } catch {
      // Fallback to standard Notification constructor below
    }
  }

  try {
    const n = new Notification(params.title, {
      body: params.body,
      icon: '/pwa-192x192.png',
      badge: '/favicon-32x32.png',
      tag: params.dedupeKey,
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function dismissSwNotification(dedupeKeyOrRoutineId: string): void {
  postMessageToServiceWorker({
    type: 'DISMISS_NOTIFICATION',
    key: dedupeKeyOrRoutineId,
  });
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function syncWebPushSubscription(params: {
  token: string | null;
  notificationsEnabled: boolean;
  lang: Language;
  firedKeys: Set<string>;
}): Promise<'push-active' | 'sw-local' | 'disabled'> {
  const { token, notificationsEnabled, lang, firedKeys } = params;
  if (!token) return 'disabled';

  const timezone = getUserTimezone();
  const timezoneOffsetMinutes = new Date().getTimezoneOffset();

  // Always sync user's local timezone and fired keys to backend
  fetch('/api/push/sync-timezone', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      timezone,
      timezoneOffsetMinutes,
      language: lang,
      notificationsEnabled,
      firedKeys: Array.from(firedKeys).slice(-200),
    }),
  }).catch(() => {});

  if (
    !notificationsEnabled ||
    typeof Notification === 'undefined' ||
    Notification.permission !== 'granted' ||
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return 'sw-local';
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    if (!('pushManager' in reg) || !reg.pushManager) {
      return 'sw-local';
    }

    const keyRes = await fetch('/api/push/vapid-public-key');
    if (!keyRes.ok) return 'sw-local';
    const { publicKey } = await keyRes.json();
    if (!publicKey) return 'sw-local';

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const convertedKey = urlBase64ToUint8Array(publicKey);
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey as unknown as BufferSource,
      });
    }

    if (sub) {
      const subRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          subscription: sub.toJSON(),
          timezone,
          timezoneOffsetMinutes,
          language: lang,
          firedKeys: Array.from(firedKeys).slice(-200),
        }),
      });
      if (subRes.ok) {
        return 'push-active';
      }
    }
  } catch {
    // Browser or environment doesn't allow PushManager subscription (e.g. iframe / incognito)
  }

  return 'sw-local';
}

/**
 * Creates a dedicated background Web Worker timer that ticks every 1000ms
 * without main-thread background tab throttling.
 */
export function createBackgroundAlarmWorker(onTick: () => void): {
  terminate: () => void;
} {
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined') {
    const fallbackInterval = setInterval(onTick, 1000);
    return {
      terminate: () => clearInterval(fallbackInterval),
    };
  }

  try {
    const workerCode = `
      let timer = setInterval(() => {
        self.postMessage({ type: 'TICK', now: Date.now() });
      }, 1000);
      self.onmessage = (e) => {
        if (e.data === 'STOP') {
          clearInterval(timer);
        } else if (e.data === 'PING') {
          self.postMessage({ type: 'TICK', now: Date.now() });
        }
      };
    `;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    worker.onmessage = () => {
      onTick();
    };
    return {
      terminate: () => {
        try {
          worker.postMessage('STOP');
          worker.terminate();
          URL.revokeObjectURL(url);
        } catch {
          // Ignore
        }
      },
    };
  } catch {
    const fallbackInterval = setInterval(onTick, 1000);
    return {
      terminate: () => clearInterval(fallbackInterval),
    };
  }
}
