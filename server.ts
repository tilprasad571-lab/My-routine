import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import webpush from 'web-push';

dotenv.config();

const PORT = 3000;
const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const USER_SOUNDS_DIR = path.join(DATA_DIR, 'user_sounds');
const DB_FILE = path.join(DATA_DIR, 'mero_routine_db.json');
const VAPID_FILE = path.join(DATA_DIR, 'vapid_keys.json');
const PUSH_STATE_FILE = path.join(DATA_DIR, 'push_state.json');

interface StoredPushSubscriptionRecord {
  userId: string;
  endpoint: string;
  subscription: webpush.PushSubscription;
  timezone: string;
  timezoneOffsetMinutes: number;
  language: 'en' | 'ne';
  updatedAt: string;
}

interface PushStateSchema {
  subscriptions: StoredPushSubscriptionRecord[];
  userTimezones: Record<
    string,
    { timezone: string; timezoneOffsetMinutes: number; language: 'en' | 'ne' }
  >;
  firedKeys: string[];
}

function initVapidKeys(): { publicKey: string; privateKey: string } {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (fs.existsSync(VAPID_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(VAPID_FILE, 'utf-8'));
      if (parsed?.publicKey && parsed?.privateKey) {
        webpush.setVapidDetails(
          'mailto:roilaofficial571@gmail.com',
          parsed.publicKey,
          parsed.privateKey
        );
        return parsed;
      }
    }
    const generated = webpush.generateVAPIDKeys();
    fs.writeFileSync(VAPID_FILE, JSON.stringify(generated, null, 2), 'utf-8');
    webpush.setVapidDetails(
      'mailto:roilaofficial571@gmail.com',
      generated.publicKey,
      generated.privateKey
    );
    return generated;
  } catch (err) {
    console.error('Failed to initialize VAPID keys:', err);
    const fallback = webpush.generateVAPIDKeys();
    try {
      webpush.setVapidDetails(
        'mailto:roilaofficial571@gmail.com',
        fallback.publicKey,
        fallback.privateKey
      );
    } catch {
      // Ignore
    }
    return fallback;
  }
}

function loadPushState(): PushStateSchema {
  try {
    if (fs.existsSync(PUSH_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PUSH_STATE_FILE, 'utf-8'));
      return {
        subscriptions: Array.isArray(parsed?.subscriptions)
          ? parsed.subscriptions
          : [],
        userTimezones:
          parsed?.userTimezones && typeof parsed.userTimezones === 'object'
            ? parsed.userTimezones
            : {},
        firedKeys: Array.isArray(parsed?.firedKeys)
          ? parsed.firedKeys.slice(-800)
          : [],
      };
    }
  } catch {
    // Ignore
  }
  return { subscriptions: [], userTimezones: {}, firedKeys: [] };
}

const vapidKeys = initVapidKeys();
const pushState: PushStateSchema = loadPushState();
const pushFiredSet = new Set<string>(pushState.firedKeys);

function savePushState(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    pushState.firedKeys = Array.from(pushFiredSet).slice(-800);
    fs.writeFileSync(
      PUSH_STATE_FILE,
      JSON.stringify(pushState, null, 2),
      'utf-8'
    );
  } catch {
    // Ignore write error
  }
}

function markServerAlarmFired(dedupeKey: string): void {
  if (!dedupeKey) return;
  if (!pushFiredSet.has(dedupeKey)) {
    pushFiredSet.add(dedupeKey);
    savePushState();
  }
}

function getLocalClockInTimezone(
  timezone: string,
  fallbackOffsetMinutes: number = -345 // Default Nepal UTC+5:45 (-345 mins)
): {
  dateStr: string;
  dayOfWeek: number;
  hours: number;
  minutes: number;
  seconds: number;
  totalMinutes: number;
  totalSeconds: number;
} {
  const now = new Date();
  try {
    if (timezone && timezone !== 'Local Timezone') {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const getPart = (type: string) =>
        parts.find((p) => p.type === type)?.value || '00';
      const y = Number(getPart('year'));
      const m = Number(getPart('month'));
      const d = Number(getPart('day'));
      let hh = Number(getPart('hour'));
      if (hh === 24) hh = 0;
      const mm = Number(getPart('minute'));
      const ss = Number(getPart('second'));
      const dateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(
        2,
        '0'
      )}-${String(d).padStart(2, '0')}`;
      const dayOfWeek = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return {
        dateStr,
        dayOfWeek,
        hours: hh,
        minutes: mm,
        seconds: ss,
        totalMinutes: hh * 60 + mm,
        totalSeconds: hh * 3600 + mm * 60 + ss,
      };
    }
  } catch {
    // Fallback to offset calculation below
  }

  const shifted = new Date(now.getTime() - fallbackOffsetMinutes * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  const hh = shifted.getUTCHours();
  const mm = shifted.getUTCMinutes();
  const ss = shifted.getUTCSeconds();
  const dateStr = `${String(y).padStart(4, '0')}-${String(m).padStart(
    2,
    '0'
  )}-${String(d).padStart(2, '0')}`;
  const dayOfWeek = shifted.getUTCDay();
  return {
    dateStr,
    dayOfWeek,
    hours: hh,
    minutes: mm,
    seconds: ss,
    totalMinutes: hh * 60 + mm,
    totalSeconds: hh * 3600 + mm * 60 + ss,
  };
}

function formatServerTime12h(time24: string, lang: 'en' | 'ne'): string {
  const [hStr, mStr] = (time24 || '06:00').split(':');
  const h = parseInt(hStr, 10) || 0;
  const m = (mStr || '00').padStart(2, '0');
  const isPm = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (lang === 'ne') {
    const period =
      h < 12 ? 'बिहान' : h < 17 ? 'दिउँसो' : h < 20 ? 'बेलुका' : 'राति';
    return `${period} ${h12}:${m}`;
  }
  return `${h12}:${m} ${isPm ? 'PM' : 'AM'}`;
}

function ensureDefaultBannerAssets() {
  try {
    if (!fs.existsSync(UPLOADS_DIR)) {
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    const proBannerPath = path.join(UPLOADS_DIR, 'mero_pro_banner.svg');
    if (!fs.existsSync(proBannerPath)) {
      const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" width="1200" height="280">
  <defs>
    <linearGradient id="bg1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="55%" stop-color="#134e4a"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="280" rx="24" fill="url(#bg1)"/>
  <circle cx="1080" cy="60" r="140" fill="#14b8a6" opacity="0.14"/>
  <circle cx="960" cy="240" r="110" fill="#2dd4bf" opacity="0.1"/>
  <rect x="48" y="42" width="168" height="34" rx="8" fill="#14b8a6" opacity="0.22"/>
  <text x="64" y="64" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#5eead4" letter-spacing="1.5">MERO ROUTINE PRO</text>
  <text x="48" y="126" font-family="system-ui, -apple-system, sans-serif" font-size="38" font-weight="800" fill="#ffffff">Plan Your Entire Week &amp; AI Schedule</text>
  <text x="48" y="168" font-family="system-ui, -apple-system, sans-serif" font-size="21" font-weight="500" fill="#cbd5e1">Unlock Full Week/Month Planner, Habit Streaks, Reports &amp; AI Builder — Ad-Free</text>
  <text x="48" y="218" font-family="monospace" font-size="22" font-weight="700" fill="#5eead4">Rs.99 / month   ·   Rs.999 / year</text>
  <rect x="910" y="106" width="236" height="68" rx="16" fill="#14b8a6"/>
  <text x="1028" y="148" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="21" font-weight="700" fill="#042f2e">Upgrade to Pro →</text>
</svg>`;
      fs.writeFileSync(proBannerPath, svg1, 'utf-8');
    }

    const habitsBannerPath = path.join(UPLOADS_DIR, 'himalayan_habits_banner.svg');
    if (!fs.existsSync(habitsBannerPath)) {
      const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 280" width="1200" height="280">
  <defs>
    <linearGradient id="bg2" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="50%" stop-color="#312e81"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="280" rx="24" fill="url(#bg2)"/>
  <circle cx="1050" cy="210" r="150" fill="#818cf8" opacity="0.14"/>
  <rect x="48" y="42" width="210" height="34" rx="8" fill="#818cf8" opacity="0.22"/>
  <text x="64" y="64" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" fill="#c7d2fe" letter-spacing="1.5">FEATURED PARTNER</text>
  <text x="48" y="126" font-family="system-ui, -apple-system, sans-serif" font-size="36" font-weight="800" fill="#ffffff">Himalayan Mindfulness &amp; Focus Mastery</text>
  <text x="48" y="168" font-family="system-ui, -apple-system, sans-serif" font-size="21" font-weight="500" fill="#e0e7ff">Build consistent morning meditation, study blocks, and deep work habits every day.</text>
  <text x="48" y="218" font-family="monospace" font-size="20" font-weight="600" fill="#a5b4fc">दिन योजना बनाऔँ, बानी सुधारौँ · Daily Consistency Guide</text>
  <rect x="910" y="106" width="236" height="68" rx="16" fill="#ffffff"/>
  <text x="1028" y="148" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="21" font-weight="700" fill="#1e1b4b">Explore Guide →</text>
</svg>`;
      fs.writeFileSync(habitsBannerPath, svg2, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to initialize default banner assets:', err);
  }
}

function persistBannerImage(rawInput: string): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('data:image/')) {
    const match = trimmed.match(/^data:image\/([a-zA-Z0-9+.-]+);base64,(.+)$/);
    if (match) {
      try {
        ensureDefaultBannerAssets();
        const rawSub = match[1].toLowerCase();
        const ext =
          rawSub === 'svg+xml'
            ? 'svg'
            : rawSub === 'jpeg'
            ? 'jpg'
            : ['png', 'jpg', 'webp', 'gif', 'svg'].includes(rawSub)
            ? rawSub
            : 'png';
        const buf = Buffer.from(match[2], 'base64');
        const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12);
        const filename = `banner_${hash}.${ext}`;
        const filePath = path.join(UPLOADS_DIR, filename);
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, buf);
        }
        return `/uploads/${filename}`;
      } catch (err) {
        console.error('Failed to persist base64 banner image:', err);
        return trimmed.slice(0, 2_000_000);
      }
    }
    return trimmed.slice(0, 2_000_000);
  }
  return trimmed.slice(0, 2000);
}

ensureDefaultBannerAssets();

const BOOTSTRAPPED_ADMIN_EMAILS = new Set([
  'til.prasad571@gmail.com',
  'tech4u571@gmail.com',
]);

const CONFIGURED_ADMIN_EMAIL = 'til.prasad571@gmail.com';
const ENV_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const DEFAULT_ADMIN_SALT = '660e3745318480a710f4155966f09f89';
const DEFAULT_ADMIN_HASH =
  '1247488a556a92f9df9d655f68808ff92b1e3962e08ef6dc943568cb120714f41d2e84cb71b2dc3678807119069bc7df778e0425ff2d5cc511e61326a8b7ca9d';
const DEFAULT_PRO_DEMO_SALT = '58ccbd917675acf82012aa9f6e54011f';
const DEFAULT_PRO_DEMO_HASH =
  'fa0d69b9d7645bebf287a534cd88472b18c40e76de3c540ecd6af6837a6457873f2bb4fc38839038e7be555fb8e2b270cfcc584df5a4cf91f597d4ae4f9cf3eb';
const DEFAULT_FREE_DEMO_SALT = '6d3ab62a8dba4c725ea60931e6449fa5';
const DEFAULT_FREE_DEMO_HASH =
  '7a50df6da19616f5651c4f652b0016a8891e81299dd17f2751095d69f8ad61eaf0646486097d081776a6134f3db0640bbe29e660c1cd57fe87de1eac366b83c9';

export type StoredBuiltInSoundId = 'default_1' | 'default_2' | 'default_3';
export type StoredNotificationSoundId = StoredBuiltInSoundId | 'custom';

const VALID_BUILTIN_SOUNDS: StoredBuiltInSoundId[] = [
  'default_1',
  'default_2',
  'default_3',
];
const VALID_NOTIFICATION_SOUNDS: StoredNotificationSoundId[] = [
  'default_1',
  'default_2',
  'default_3',
  'custom',
];

function getSafeUserSoundPath(uid: string): string {
  if (!fs.existsSync(USER_SOUNDS_DIR)) {
    fs.mkdirSync(USER_SOUNDS_DIR, { recursive: true });
  }
  const safeUid = String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(USER_SOUNDS_DIR, `sound_${safeUid}.json`);
}

function inferAudioMimeFromName(fileName: string): string {
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.oga')) return 'audio/ogg';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.aac')) return 'audio/aac';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.flac')) return 'audio/flac';
  return 'audio/mpeg';
}

function normalizeAudioDataUrl(rawInput: string, fileName: string = ''): string {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed) return '';
  const match = trimmed.match(
    /^data:([a-zA-Z0-9+./-]*)(?:;[^;,]+)*;base64,([A-Za-z0-9+/=\s]+)$/
  );
  if (!match) return '';
  let mime = (match[1] || '').toLowerCase();
  if (mime === 'application/ogg') mime = 'audio/ogg';
  if (mime === 'video/webm') mime = 'audio/webm';
  if (mime === 'video/mp4') mime = 'audio/mp4';
  if (!mime || mime === 'application/octet-stream') {
    mime = inferAudioMimeFromName(fileName);
  }
  if (!mime.startsWith('audio/')) return '';
  const cleanBase64 = match[2].replace(/\s+/g, '');
  if (!cleanBase64 || cleanBase64.length > 14_000_000) return '';
  return `data:${mime};base64,${cleanBase64}`;
}

function loadUserCustomSound(
  uid: string
): { fileName: string; dataUrl: string } | null {
  try {
    const filePath = getSafeUserSoundPath(uid);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.uid === uid &&
      typeof parsed.dataUrl === 'string' &&
      parsed.dataUrl.startsWith('data:audio/')
    ) {
      return {
        fileName: String(parsed.fileName || 'Custom Sound').slice(0, 120),
        dataUrl: parsed.dataUrl,
      };
    }
  } catch (err) {
    console.error('Failed to read user custom sound:', err);
  }
  return null;
}

function saveUserCustomSound(
  uid: string,
  fileName: string,
  rawDataUrl: string
): { fileName: string; dataUrl: string } | null {
  try {
    const normalizedUrl = normalizeAudioDataUrl(rawDataUrl, fileName);
    if (!normalizedUrl) return null;
    const cleanName =
      String(fileName || 'Custom Sound')
        .trim()
        .slice(0, 120) || 'Custom Sound';
    const filePath = getSafeUserSoundPath(uid);
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        uid,
        fileName: cleanName,
        dataUrl: normalizedUrl,
        updatedAt: new Date().toISOString(),
      }),
      'utf-8'
    );
    return { fileName: cleanName, dataUrl: normalizedUrl };
  } catch (err) {
    console.error('Failed to save user custom sound:', err);
    return null;
  }
}

function deleteUserCustomSound(uid: string): void {
  try {
    const filePath = getSafeUserSoundPath(uid);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (err) {
    console.error('Failed to delete user custom sound:', err);
  }
}

export interface StoredUser {
  uid: string;
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended';
  isPro: boolean;
  proExpiry: string;
  language: 'en' | 'ne';
  theme: 'light' | 'dark';
  notificationsEnabled: boolean;
  notificationSound?: StoredNotificationSoundId;
  defaultNotificationSound?: StoredBuiltInSoundId;
  customSoundName?: string;
  hasCustomSound?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRoutine {
  id: string;
  userId: string;
  title: string;
  time: string;
  category: string;
  icon: string;
  reminderOffset: 0 | 5 | 10 | 15;
  duration: number;
  repeatType: 'today' | 'everyday' | 'weekdays' | 'custom';
  customDays: number[];
  targetDate: string;
  timezone?: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRoutineLog {
  id: string;
  userId: string;
  routineId: string;
  date: string;
  status: 'done' | 'skipped' | 'snoozed' | 'missed';
  snoozedUntil: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredGoal {
  id: string;
  userId: string;
  title: string;
  category: string;
  targetDays: number;
  completedDays: number;
  startDate: string;
  endDate: string;
  checkedDates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoredTemplate {
  id: string;
  userId: string;
  name: string;
  nameNe?: string;
  description: string;
  descriptionNe?: string;
  items: {
    title: string;
    time: string;
    category: string;
    icon: string;
    duration: number;
    reminderOffset: 0 | 5 | 10 | 15;
    repeatType: 'today' | 'everyday' | 'weekdays' | 'custom';
    notes: string;
  }[];
  createdAt: string;
}

export interface StoredProRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  referenceId: string;
  paymentMethod: string;
  senderInfo: string;
  planType?: 'monthly' | 'yearly';
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

export type StoredAdPage = 'home' | 'planner' | 'reports' | 'profile';
export type StoredAdPosition = 'top' | 'bottom';
export type StoredAdPlacement =
  | 'home_top'
  | 'home_bottom'
  | 'planner_top'
  | 'planner_bottom'
  | 'reports_top'
  | 'reports_bottom'
  | 'profile_top'
  | 'profile_bottom';

const VALID_AD_PAGES: StoredAdPage[] = ['home', 'planner', 'reports', 'profile'];
const VALID_AD_POSITIONS: StoredAdPosition[] = ['top', 'bottom'];
const VALID_AD_PLACEMENTS: StoredAdPlacement[] = [
  'home_top',
  'home_bottom',
  'planner_top',
  'planner_bottom',
  'reports_top',
  'reports_bottom',
  'profile_top',
  'profile_bottom',
];

export interface StoredAdBanner {
  id: string;
  title: string;
  type: 'manual' | 'adsense';
  placement: StoredAdPlacement;
  placements?: StoredAdPlacement[];
  pages?: StoredAdPage[];
  positions?: StoredAdPosition[];
  imageUrl: string;
  targetUrl: string;
  adSenseSlot: string;
  active: boolean;
  startDate: string;
  endDate: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCategory {
  id: string;
  nameEn: string;
  nameNe: string;
  icon: string;
  suggestedTitleEn: string;
  suggestedTitleNe: string;
  defaultTime: string;
}

interface DatabaseSchema {
  users: StoredUser[];
  sessions: Record<string, string>; // token -> uid
  routines: StoredRoutine[];
  routineLogs: StoredRoutineLog[];
  goals: StoredGoal[];
  templates: StoredTemplate[];
  proRequests: StoredProRequest[];
  ads: StoredAdBanner[];
  adsEnabledGlobal: boolean;
  categories: StoredCategory[];
}

function hashPassword(password: string, salt: string): string {
  return crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
}

function getTodayStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getPastDateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getFutureDateStr(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDefaultRoutinesForUser(userId: string, today: string): StoredRoutine[] {
  const nowIso = new Date().toISOString();
  const standardSchedule = [
    { title: 'Wake Up', time: '05:00', category: 'Morning', icon: '🌅', duration: 15, notes: 'Hydrate with a glass of warm water' },
    { title: 'Fresh Up', time: '05:15', category: 'Health', icon: '🚿', duration: 30, notes: 'Morning hygiene and stretching' },
    { title: 'Go to Gym', time: '06:00', category: 'Fitness', icon: '🏋️', duration: 60, notes: 'Strength training & cardio session' },
    { title: 'Return Home', time: '07:00', category: 'Home', icon: '🏠', duration: 30, notes: 'Cool down and shower' },
    { title: 'Breakfast', time: '07:30', category: 'Nutrition', icon: '🍳', duration: 30, notes: 'Healthy high-protein breakfast' },
    { title: 'Work', time: '08:00', category: 'Work', icon: '💼', duration: 300, notes: 'Deep focus blocks and priority tasks' },
    { title: 'Lunch', time: '13:00', category: 'Nutrition', icon: '🍛', duration: 45, notes: 'Balanced meal and short walk' },
    { title: 'Finish Work', time: '17:00', category: 'Home', icon: '🏠', duration: 60, notes: 'Wrap up tasks & plan tomorrow' },
    { title: 'Study', time: '18:00', category: 'Study', icon: '📚', duration: 90, notes: 'Skill building & reading' },
    { title: 'Dinner', time: '20:00', category: 'Nutrition', icon: '🍽️', duration: 45, notes: 'Light evening meal with family' },
    { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 420, notes: 'No screens 30 mins before bed' },
  ];

  return standardSchedule.map((item, idx) => ({
    id: `rt_${userId}_${idx + 1}`,
    userId,
    title: item.title,
    time: item.time,
    category: item.category,
    icon: item.icon,
    reminderOffset: 10,
    duration: item.duration,
    repeatType: 'everyday',
    customDays: [0, 1, 2, 3, 4, 5, 6],
    targetDate: today,
    notes: item.notes,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
}

function createInitialDatabase(): DatabaseSchema {
  const nowIso = new Date().toISOString();
  const today = getTodayStr();

  const adminSalt = DEFAULT_ADMIN_SALT;
  const adminHash = ENV_ADMIN_PASSWORD
    ? hashPassword(ENV_ADMIN_PASSWORD, adminSalt)
    : DEFAULT_ADMIN_HASH;

  const users: StoredUser[] = [
    {
      uid: 'usr_admin_1',
      name: 'Til Prasad (Admin)',
      email: CONFIGURED_ADMIN_EMAIL,
      salt: adminSalt,
      passwordHash: adminHash,
      role: 'admin',
      status: 'active',
      isPro: true,
      proExpiry: getFutureDateStr(3650),
      language: 'en',
      theme: 'light',
      notificationsEnabled: true,
      createdAt: getPastDateStr(30) + 'T08:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      uid: 'usr_pro_1',
      name: 'Aarav Sharma',
      email: 'pro@meroroutine.com',
      salt: DEFAULT_PRO_DEMO_SALT,
      passwordHash: DEFAULT_PRO_DEMO_HASH,
      role: 'user',
      status: 'active',
      isPro: true,
      proExpiry: getFutureDateStr(30),
      language: 'en',
      theme: 'light',
      notificationsEnabled: true,
      createdAt: getPastDateStr(15) + 'T08:00:00.000Z',
      updatedAt: nowIso,
    },
    {
      uid: 'usr_free_1',
      name: 'Pratiksha Thapa',
      email: 'free@meroroutine.com',
      salt: DEFAULT_FREE_DEMO_SALT,
      passwordHash: DEFAULT_FREE_DEMO_HASH,
      role: 'user',
      status: 'active',
      isPro: false,
      proExpiry: '',
      language: 'en',
      theme: 'light',
      notificationsEnabled: true,
      createdAt: getPastDateStr(5) + 'T08:00:00.000Z',
      updatedAt: nowIso,
    },
  ];

  const proRoutines = buildDefaultRoutinesForUser('usr_pro_1', today);
  const freeRoutines = buildDefaultRoutinesForUser('usr_free_1', today);
  const adminRoutines = buildDefaultRoutinesForUser('usr_admin_1', today);

  // Create realistic historical logs for usr_pro_1 and usr_free_1
  const routineLogs: StoredRoutineLog[] = [];
  // 8-day streak for Gym, 7-day streak for Sleep, 5-day streak for Study for usr_pro_1
  for (let daysAgo = 7; daysAgo >= 1; daysAgo--) {
    const dateStr = getPastDateStr(daysAgo);
    proRoutines.forEach((rt, index) => {
      let status: 'done' | 'skipped' | 'missed' = 'done';
      if (rt.title === 'Study' && daysAgo > 5) {
        status = 'skipped';
      } else if (index === 7 && daysAgo === 4) {
        status = 'missed';
      }
      routineLogs.push({
        id: `log_pro_${daysAgo}_${rt.id}`,
        userId: 'usr_pro_1',
        routineId: rt.id,
        date: dateStr,
        status,
        snoozedUntil: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    });
  }

  // Mark early morning tasks done for today so progress is immediately visible
  ['05:00', '05:15'].forEach((timeVal) => {
    const rtPro = proRoutines.find((r) => r.time === timeVal);
    if (rtPro) {
      routineLogs.push({
        id: `log_pro_today_${rtPro.id}`,
        userId: 'usr_pro_1',
        routineId: rtPro.id,
        date: today,
        status: 'done',
        snoozedUntil: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    const rtFree = freeRoutines.find((r) => r.time === timeVal);
    if (rtFree) {
      routineLogs.push({
        id: `log_free_today_${rtFree.id}`,
        userId: 'usr_free_1',
        routineId: rtFree.id,
        date: today,
        status: 'done',
        snoozedUntil: '',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  });

  const goals: StoredGoal[] = [
    {
      id: 'goal_1',
      userId: 'usr_pro_1',
      title: 'Wake up at 5 AM',
      category: 'Morning',
      targetDays: 30,
      completedDays: 8,
      startDate: getPastDateStr(7),
      endDate: getFutureDateStr(22),
      checkedDates: [
        getPastDateStr(7),
        getPastDateStr(6),
        getPastDateStr(5),
        getPastDateStr(4),
        getPastDateStr(3),
        getPastDateStr(2),
        getPastDateStr(1),
        today,
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'goal_2',
      userId: 'usr_pro_1',
      title: 'Daily Gym & Exercise',
      category: 'Fitness',
      targetDays: 21,
      completedDays: 7,
      startDate: getPastDateStr(7),
      endDate: getFutureDateStr(14),
      checkedDates: [
        getPastDateStr(7),
        getPastDateStr(6),
        getPastDateStr(5),
        getPastDateStr(4),
        getPastDateStr(3),
        getPastDateStr(2),
        getPastDateStr(1),
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'goal_3',
      userId: 'usr_pro_1',
      title: 'Focused Evening Study (90 mins)',
      category: 'Study',
      targetDays: 14,
      completedDays: 5,
      startDate: getPastDateStr(5),
      endDate: getFutureDateStr(9),
      checkedDates: [
        getPastDateStr(5),
        getPastDateStr(4),
        getPastDateStr(3),
        getPastDateStr(2),
        getPastDateStr(1),
      ],
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const templates: StoredTemplate[] = [
    {
      id: 'tpl_workday',
      userId: 'system',
      name: 'Workday Routine',
      nameNe: 'कार्यदिन तालिका',
      description: 'Structured 5 AM to 10 PM productive workday schedule.',
      descriptionNe: 'बिहान ५ देखि राति १० सम्मको व्यवस्थित कार्यदिन रुटिन।',
      items: [
        { title: 'Wake Up', time: '05:00', category: 'Morning', icon: '🌅', duration: 15, reminderOffset: 0, repeatType: 'weekdays', notes: 'Start the day fresh' },
        { title: 'Gym / Exercise', time: '06:00', category: 'Fitness', icon: '🏋️', duration: 60, reminderOffset: 10, repeatType: 'weekdays', notes: 'Morning workout' },
        { title: 'Breakfast', time: '07:30', category: 'Nutrition', icon: '🍳', duration: 30, reminderOffset: 5, repeatType: 'weekdays', notes: 'Healthy breakfast' },
        { title: 'Deep Work', time: '08:30', category: 'Work', icon: '💼', duration: 270, reminderOffset: 10, repeatType: 'weekdays', notes: 'Core focus tasks' },
        { title: 'Lunch Break', time: '13:00', category: 'Nutrition', icon: '🍛', duration: 45, reminderOffset: 5, repeatType: 'weekdays', notes: 'Nutritious lunch' },
        { title: 'Evening Study', time: '18:00', category: 'Study', icon: '📚', duration: 90, reminderOffset: 10, repeatType: 'weekdays', notes: 'Reading & learning' },
        { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 420, reminderOffset: 15, repeatType: 'weekdays', notes: 'Restful sleep' },
      ],
      createdAt: nowIso,
    },
    {
      id: 'tpl_weekend',
      userId: 'system',
      name: 'Weekend Recharge',
      nameNe: 'सप्ताहान्त आराम तालिका',
      description: 'Balanced weekend schedule for family, outdoor movement, and weekly review.',
      descriptionNe: 'परिवार, स्वास्थ्य र आगामी हप्ताको तयारीका लागि सन्तुलित तालिका।',
      items: [
        { title: 'Wake Up Naturally', time: '06:30', category: 'Morning', icon: '🌅', duration: 20, reminderOffset: 0, repeatType: 'today', notes: 'Slow morning hydration' },
        { title: 'Morning Walk & Yoga', time: '07:00', category: 'Fitness', icon: '🧘', duration: 60, reminderOffset: 10, repeatType: 'today', notes: 'Outdoor stretch' },
        { title: 'Family Breakfast', time: '08:30', category: 'Nutrition', icon: '🍳', duration: 45, reminderOffset: 5, repeatType: 'today', notes: 'Weekend breakfast' },
        { title: 'Personal Reading', time: '14:00', category: 'Study', icon: '📖', duration: 60, reminderOffset: 10, repeatType: 'today', notes: 'Read 20 pages' },
        { title: 'Weekly Planning', time: '19:00', category: 'Work', icon: '📝', duration: 45, reminderOffset: 10, repeatType: 'today', notes: 'Plan upcoming week in Mero Routine' },
        { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 480, reminderOffset: 15, repeatType: 'today', notes: 'Early rest for Monday' },
      ],
      createdAt: nowIso,
    },
    {
      id: 'tpl_gymday',
      userId: 'system',
      name: 'Gym & Fitness Day',
      nameNe: 'जिम र फिटनेस तालिका',
      description: 'High-energy routine centered around strength training, nutrition, and recovery.',
      descriptionNe: 'व्यायाम, पौष्टिक आहार र शारीरिक ऊर्जामा केन्द्रित तालिका।',
      items: [
        { title: 'Wake Up & Pre-Workout', time: '05:15', category: 'Morning', icon: '🌅', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Hydrate + banana' },
        { title: 'Heavy Gym Session', time: '06:00', category: 'Fitness', icon: '🏋️', duration: 75, reminderOffset: 10, repeatType: 'everyday', notes: 'Compound lifts & mobility' },
        { title: 'Post-Workout Protein Meal', time: '07:45', category: 'Nutrition', icon: '🍳', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Eggs, oats, fruit' },
        { title: 'Evening Mobility Walk', time: '17:30', category: 'Fitness', icon: '🚶', duration: 40, reminderOffset: 10, repeatType: 'everyday', notes: 'Active recovery steps' },
        { title: 'Recovery Sleep', time: '21:45', category: 'Rest', icon: '😴', duration: 450, reminderOffset: 15, repeatType: 'everyday', notes: '8 hours muscle recovery' },
      ],
      createdAt: nowIso,
    },
    {
      id: 'tpl_studyday',
      userId: 'system',
      name: 'Exam & Study Day',
      nameNe: 'अध्ययन विशेष तालिका',
      description: 'Deep-focus Pomodoro study blocks with regular mental recharge breaks.',
      descriptionNe: 'गहिरो अध्ययन र परीक्षा तयारीका लागि विशेष समयतालिका।',
      items: [
        { title: 'Wake Up & Meditation', time: '05:00', category: 'Morning', icon: '🧘', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Clear mind for study' },
        { title: 'Morning Study Block 1', time: '06:00', category: 'Study', icon: '📚', duration: 120, reminderOffset: 10, repeatType: 'everyday', notes: 'Hardest subject first' },
        { title: 'Breakfast & Rest', time: '08:00', category: 'Nutrition', icon: '🍳', duration: 45, reminderOffset: 5, repeatType: 'everyday', notes: 'Brain fuel' },
        { title: 'Core Study Block 2', time: '09:30', category: 'Study', icon: '📖', duration: 180, reminderOffset: 10, repeatType: 'everyday', notes: 'Practice problems & notes' },
        { title: 'Evening Revision', time: '18:00', category: 'Study', icon: '📝', duration: 90, reminderOffset: 10, repeatType: 'everyday', notes: 'Active recall & flashcards' },
        { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 420, reminderOffset: 15, repeatType: 'everyday', notes: 'Memory consolidation sleep' },
      ],
      createdAt: nowIso,
    },
  ];

  const proRequests: StoredProRequest[] = [
    {
      id: 'req_approved_1',
      userId: 'usr_pro_1',
      userEmail: 'pro@meroroutine.com',
      userName: 'Aarav Sharma',
      referenceId: 'MR-PRO-728491',
      paymentMethod: 'eSewa',
      senderInfo: '9841234567 (Txn: 0892341)',
      amount: 99,
      status: 'approved',
      adminNotes: 'Verified eSewa Rs.99 receipt. Activated 30 days Pro.',
      createdAt: getPastDateStr(14) + 'T10:15:00.000Z',
      updatedAt: getPastDateStr(14) + 'T10:30:00.000Z',
    },
  ];

  const ads: StoredAdBanner[] = [
    {
      id: 'ad_1',
      title: 'Upgrade to Mero Routine Pro — Rs.99 / month or Rs.999 / year for Full Week & AI Planner',
      type: 'manual',
      placement: 'home_top',
      imageUrl: '/uploads/mero_pro_banner.svg',
      targetUrl: '#upgrade',
      adSenseSlot: '',
      active: true,
      startDate: getPastDateStr(30),
      endDate: getFutureDateStr(180),
      priority: 10,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    {
      id: 'ad_2',
      title: 'Himalayan Mindfulness & Focus Course — Build Better Daily Habits',
      type: 'manual',
      placement: 'home_top',
      imageUrl: '/uploads/himalayan_habits_banner.svg',
      targetUrl: 'https://example.com/mindfulness-course',
      adSenseSlot: '',
      active: true,
      startDate: getPastDateStr(10),
      endDate: getFutureDateStr(180),
      priority: 8,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
  ];

  const categories: StoredCategory[] = [
    { id: 'cat_morning', nameEn: 'Morning', nameNe: 'बिहानी', icon: '🌅', suggestedTitleEn: 'Wake Up', suggestedTitleNe: 'उठ्ने समय', defaultTime: '05:00' },
    { id: 'cat_health', nameEn: 'Health', nameNe: 'स्वास्थ्य', icon: '🚿', suggestedTitleEn: 'Fresh Up', suggestedTitleNe: 'फ्रेस हुने', defaultTime: '05:15' },
    { id: 'cat_fitness', nameEn: 'Fitness', nameNe: 'व्यायाम', icon: '🏋️', suggestedTitleEn: 'Go to Gym', suggestedTitleNe: 'जिम जाने', defaultTime: '06:00' },
    { id: 'cat_home', nameEn: 'Home', nameNe: 'घर', icon: '🏠', suggestedTitleEn: 'Return Home', suggestedTitleNe: 'घर फर्कने', defaultTime: '07:00' },
    { id: 'cat_nutrition', nameEn: 'Nutrition', nameNe: 'खानपान', icon: '🍳', suggestedTitleEn: 'Breakfast', suggestedTitleNe: 'बिहानको खाजा', defaultTime: '07:30' },
    { id: 'cat_work', nameEn: 'Work', nameNe: 'काम', icon: '💼', suggestedTitleEn: 'Work', suggestedTitleNe: 'कार्यालय / काम', defaultTime: '08:00' },
    { id: 'cat_lunch', nameEn: 'Lunch', nameNe: 'दिउँसोको खाना', icon: '🍛', suggestedTitleEn: 'Lunch', suggestedTitleNe: 'दिउँसोको खाना', defaultTime: '13:00' },
    { id: 'cat_study', nameEn: 'Study', nameNe: 'अध्ययन', icon: '📚', suggestedTitleEn: 'Study', suggestedTitleNe: 'अध्ययन गर्ने', defaultTime: '18:00' },
    { id: 'cat_meditation', nameEn: 'Mindfulness', nameNe: 'ध्यान', icon: '🧘', suggestedTitleEn: 'Meditation', suggestedTitleNe: 'ध्यान र प्राणायाम', defaultTime: '05:30' },
    { id: 'cat_dinner', nameEn: 'Dinner', nameNe: 'बेलुकाको खाना', icon: '🍽️', suggestedTitleEn: 'Dinner', suggestedTitleNe: 'बेलुकाको खाना', defaultTime: '20:00' },
    { id: 'cat_rest', nameEn: 'Rest', nameNe: 'आराम / निद्रा', icon: '😴', suggestedTitleEn: 'Sleep', suggestedTitleNe: 'सुत्ने समय', defaultTime: '22:00' },
  ];

  return {
    users,
    sessions: {},
    routines: [...adminRoutines, ...proRoutines, ...freeRoutines],
    routineLogs,
    goals,
    templates,
    proRequests,
    ads,
    adsEnabledGlobal: true,
    categories,
  };
}

function ensureConfiguredAdminUser(db: DatabaseSchema): boolean {
  let mutated = false;
  const nowIso = new Date().toISOString();
  const today = getTodayStr();

  // Demote legacy demo admin@meroroutine.com if present so only real admins have access
  const legacyDemoAdmin = db.users.find(
    (u) => u.email.toLowerCase() === 'admin@meroroutine.com'
  );
  if (legacyDemoAdmin && legacyDemoAdmin.role === 'admin') {
    legacyDemoAdmin.role = 'user';
    mutated = true;
  }

  let adminUser = db.users.find(
    (u) => u.email.toLowerCase() === CONFIGURED_ADMIN_EMAIL
  );

  if (!adminUser) {
    const salt = DEFAULT_ADMIN_SALT;
    const passwordHash = ENV_ADMIN_PASSWORD
      ? hashPassword(ENV_ADMIN_PASSWORD, salt)
      : DEFAULT_ADMIN_HASH;
    adminUser = {
      uid: 'usr_admin_til',
      name: 'Til Prasad (Admin)',
      email: CONFIGURED_ADMIN_EMAIL,
      salt,
      passwordHash,
      role: 'admin',
      status: 'active',
      isPro: true,
      proExpiry: getFutureDateStr(3650),
      language: 'en',
      theme: 'light',
      notificationsEnabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    db.users.unshift(adminUser);
    const hasRoutines = db.routines.some((r) => r.userId === adminUser!.uid);
    if (!hasRoutines) {
      db.routines.push(...buildDefaultRoutinesForUser(adminUser.uid, today));
    }
    mutated = true;
  } else {
    const targetSalt = ENV_ADMIN_PASSWORD ? adminUser.salt : DEFAULT_ADMIN_SALT;
    const expectedHash = ENV_ADMIN_PASSWORD
      ? hashPassword(ENV_ADMIN_PASSWORD, targetSalt)
      : DEFAULT_ADMIN_HASH;
    if (
      adminUser.salt !== targetSalt ||
      adminUser.passwordHash !== expectedHash ||
      adminUser.role !== 'admin' ||
      adminUser.status !== 'active' ||
      !adminUser.isPro
    ) {
      adminUser.salt = targetSalt;
      adminUser.passwordHash = expectedHash;
      adminUser.role = 'admin';
      adminUser.status = 'active';
      adminUser.isPro = true;
      adminUser.proExpiry = getFutureDateStr(3650);
      adminUser.updatedAt = nowIso;
      mutated = true;
    }
  }

  for (const u of db.users) {
    if (BOOTSTRAPPED_ADMIN_EMAILS.has(u.email.toLowerCase())) {
      if (u.role !== 'admin' || u.status !== 'active' || !u.isPro) {
        u.role = 'admin';
        u.status = 'active';
        u.isPro = true;
        if (!u.proExpiry) u.proExpiry = getFutureDateStr(3650);
        u.updatedAt = nowIso;
        mutated = true;
      }
    }
  }

  if (typeof db.adsEnabledGlobal !== 'boolean') {
    db.adsEnabledGlobal = true;
    mutated = true;
  }

  const ad1 = db.ads?.find((a) => a.id === 'ad_1');
  if (
    ad1 &&
    ad1.title ===
      'Upgrade to Mero Routine Pro — Only Rs.99/month for Full Week & AI Planner'
  ) {
    ad1.title =
      'Upgrade to Mero Routine Pro — Rs.99 / month or Rs.999 / year for Full Week & AI Planner';
    mutated = true;
  }
  if (ad1 && !ad1.imageUrl) {
    ad1.imageUrl = '/uploads/mero_pro_banner.svg';
    ad1.placement = 'home_top';
    ad1.active = true;
    ad1.startDate = getPastDateStr(30);
    ad1.endDate = getFutureDateStr(180);
    db.adsEnabledGlobal = true;
    mutated = true;
  }

  const ad2 = db.ads?.find((a) => a.id === 'ad_2');
  if (ad2 && !ad2.imageUrl) {
    ad2.imageUrl = '/uploads/himalayan_habits_banner.svg';
    ad2.placement = 'home_top';
    ad2.type = 'manual';
    if (!ad2.targetUrl || ad2.targetUrl === '#upgrade') {
      ad2.targetUrl = 'https://example.com/mindfulness-course';
    }
    ad2.active = true;
    ad2.startDate = getPastDateStr(10);
    ad2.endDate = getFutureDateStr(180);
    mutated = true;
  }

  if (Array.isArray(db.ads)) {
    for (const adItem of db.ads) {
      if (!Array.isArray(adItem.placements)) {
        if (adItem.type === 'manual') {
          adItem.pages = ['home', 'planner', 'reports', 'profile'];
          adItem.positions = ['top', 'bottom'];
          adItem.placements = [...VALID_AD_PLACEMENTS];
        } else {
          const fallbackPlacement: StoredAdPlacement = VALID_AD_PLACEMENTS.includes(
            adItem.placement
          )
            ? adItem.placement
            : 'planner_bottom';
          adItem.placements = [fallbackPlacement];
        }
        mutated = true;
      }
    }
  }

  return mutated;
}

function loadDb(): DatabaseSchema {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initial = createInitialDatabase();
      ensureConfiguredAdminUser(initial);
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as DatabaseSchema;
    if (ensureConfiguredAdminUser(parsed)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    return parsed;
  } catch (err) {
    console.error('Error loading DB, initializing fresh DB:', err);
    return createInitialDatabase();
  }
}

let dbState: DatabaseSchema = loadDb();

function saveDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving DB:', err);
  }
}

function sanitizeUser(u: StoredUser) {
  // Check if Pro has expired
  const today = getTodayStr();
  let isPro = u.isPro;
  if (isPro && u.proExpiry && u.proExpiry < today && u.role !== 'admin') {
    isPro = false;
    u.isPro = false;
    saveDb();
  }
  const storedCustom = loadUserCustomSound(u.uid);
  const hasCustomSound = Boolean(storedCustom && storedCustom.dataUrl);
  const customSoundName = hasCustomSound
    ? u.customSoundName || storedCustom!.fileName || 'Custom Sound'
    : '';
  const defaultNotificationSound: StoredBuiltInSoundId =
    u.defaultNotificationSound &&
    VALID_BUILTIN_SOUNDS.includes(u.defaultNotificationSound)
      ? u.defaultNotificationSound
      : 'default_1';
  const rawSelected =
    u.notificationSound &&
    VALID_NOTIFICATION_SOUNDS.includes(u.notificationSound)
      ? u.notificationSound
      : defaultNotificationSound;
  const notificationSound: StoredNotificationSoundId =
    rawSelected === 'custom' && !hasCustomSound
      ? defaultNotificationSound
      : rawSelected;

  return {
    uid: u.uid,
    name: u.name,
    email: u.email,
    role: BOOTSTRAPPED_ADMIN_EMAILS.has(u.email.toLowerCase()) ? 'admin' : u.role,
    status: u.status,
    isPro: BOOTSTRAPPED_ADMIN_EMAILS.has(u.email.toLowerCase()) ? true : isPro,
    proExpiry: u.proExpiry,
    language: u.language,
    theme: u.theme,
    notificationsEnabled: u.notificationsEnabled,
    notificationSound,
    defaultNotificationSound,
    customSoundName,
    hasCustomSound,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

interface AuthedRequest extends Request {
  user?: StoredUser;
  token?: string;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing session token' });
  }
  const token = authHeader.slice(7).trim();
  const uid = dbState.sessions[token];
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  }
  const user = dbState.users.find((u) => u.uid === uid);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: User not found' });
  }
  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended by administrator' });
  }
  if (BOOTSTRAPPED_ADMIN_EMAILS.has(user.email.toLowerCase())) {
    user.role = 'admin';
    user.isPro = true;
  }
  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const isAdmin =
    req.user.role === 'admin' ||
    BOOTSTRAPPED_ADMIN_EMAILS.has(req.user.email.toLowerCase());
  if (!isAdmin) {
    return res.status(403).json({ error: 'Forbidden: Admin authorization required' });
  }
  next();
}

// Deterministic fallback parser for AI Routine Builder if API key is missing/unavailable
function fallbackParseRoutineFromText(promptText: string) {
  const items: {
    title: string;
    time: string;
    category: string;
    icon: string;
    duration: number;
    reminderOffset: 0 | 5 | 10 | 15;
    repeatType: 'everyday';
    notes: string;
  }[] = [];

  const pickMeta = (activity: string) => {
    const a = activity.toLowerCase();
    if (a.includes('wake') || a.includes('उठ')) return { category: 'Morning', icon: '🌅', duration: 15 };
    if (a.includes('fresh') || a.includes('shower') || a.includes('फ्रेस')) return { category: 'Health', icon: '🚿', duration: 25 };
    if (a.includes('gym') || a.includes('workout') || a.includes('exercise') || a.includes('जिम') || a.includes('व्यायाम'))
      return { category: 'Fitness', icon: '🏋️', duration: 60 };
    if (a.includes('meditat') || a.includes('yoga') || a.includes('ध्यान')) return { category: 'Mindfulness', icon: '🧘', duration: 30 };
    if (a.includes('breakfast') || a.includes('खाजा')) return { category: 'Nutrition', icon: '🍳', duration: 30 };
    if (a.includes('lunch') || a.includes('खाना')) return { category: 'Nutrition', icon: '🍛', duration: 45 };
    if (a.includes('dinner') || a.includes('बेलुका')) return { category: 'Nutrition', icon: '🍽️', duration: 45 };
    if (a.includes('work') || a.includes('office') || a.includes('काम')) return { category: 'Work', icon: '💼', duration: 240 };
    if (a.includes('study') || a.includes('read') || a.includes('अध्ययन') || a.includes('पढ'))
      return { category: 'Study', icon: '📚', duration: 90 };
    if (a.includes('sleep') || a.includes('bed') || a.includes('सुत्')) return { category: 'Rest', icon: '😴', duration: 420 };
    return { category: 'General', icon: '⏰', duration: 45 };
  };

  // Match segments with times like "wake up at 5 AM", "6:30 am gym", etc.
  const clauses = promptText
    .split(/[,.;\n]|(?:\band\b)|(?:\bर\b)/i)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const clause of clauses) {
    const timeMatch = clause.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|बजे)?/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const min = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const meridiem = (timeMatch[3] || '').toLowerCase();
      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
      if (!meridiem && hour >= 1 && hour <= 4) hour += 12; // e.g., "1 बजे खाजा"

      let cleanTitle = clause
        .replace(timeMatch[0], '')
        .replace(/^\b(i|at|in the|morning|evening|night|around|by|to|go to|the|म|बिहान|बेलुका|राति|दिउँसो)\b/gi, '')
        .replace(/\b(at|in the|morning|evening|night|around|by)\b$/gi, '')
        .trim();

      if (!cleanTitle) cleanTitle = 'Scheduled Activity';
      cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
      const meta = pickMeta(cleanTitle);
      const timeFormatted = `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;

      items.push({
        title: cleanTitle.slice(0, 80),
        time: timeFormatted,
        category: meta.category,
        icon: meta.icon,
        duration: meta.duration,
        reminderOffset: 10,
        repeatType: 'everyday',
        notes: 'Generated by AI Routine Builder',
      });
    }
  }

  if (items.length === 0) {
    return [
      { title: 'Wake Up & Hydrate', time: '05:00', category: 'Morning', icon: '🌅', duration: 15, reminderOffset: 5 as const, repeatType: 'everyday' as const, notes: 'Morning start' },
      { title: 'Go to Gym', time: '06:00', category: 'Fitness', icon: '🏋️', duration: 60, reminderOffset: 10 as const, repeatType: 'everyday' as const, notes: 'Exercise session' },
      { title: 'Healthy Breakfast', time: '07:30', category: 'Nutrition', icon: '🍳', duration: 30, reminderOffset: 5 as const, repeatType: 'everyday' as const, notes: 'Morning nutrition' },
      { title: 'Focused Work', time: '08:00', category: 'Work', icon: '💼', duration: 300, reminderOffset: 10 as const, repeatType: 'everyday' as const, notes: 'Primary work block' },
      { title: 'Lunch Break', time: '13:00', category: 'Nutrition', icon: '🍛', duration: 45, reminderOffset: 5 as const, repeatType: 'everyday' as const, notes: 'Midday meal' },
      { title: 'Evening Study', time: '18:00', category: 'Study', icon: '📚', duration: 90, reminderOffset: 10 as const, repeatType: 'everyday' as const, notes: 'Learning & growth' },
      { title: 'Dinner', time: '20:00', category: 'Nutrition', icon: '🍽️', duration: 45, reminderOffset: 5 as const, repeatType: 'everyday' as const, notes: 'Evening meal' },
      { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 420, reminderOffset: 15 as const, repeatType: 'everyday' as const, notes: 'Full night rest' },
    ];
  }

  return items.sort((a, b) => a.time.localeCompare(b.time));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));
  app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d' }));

  // ==================================================
  // 1. AUTHENTICATION ENDPOINTS
  // ==================================================

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { name, email, password, language, theme } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanName = String(name || '').trim().slice(0, 100);
    const rawPassword = String(password || '');

    if (!cleanName || !cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Please provide a valid name and email address.' });
    }
    if (rawPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = dbState.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (existing) {
      return res.status(409).json({ error: 'DUPLICATE_ACCOUNT' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(rawPassword, salt);
    const uid = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const isAdminEmail = BOOTSTRAPPED_ADMIN_EMAILS.has(cleanEmail);

    const newUser: StoredUser = {
      uid,
      name: cleanName,
      email: cleanEmail,
      salt,
      passwordHash,
      role: isAdminEmail ? 'admin' : 'user',
      status: 'active',
      isPro: isAdminEmail,
      proExpiry: isAdminEmail ? getFutureDateStr(3650) : '',
      language: language === 'ne' ? 'ne' : 'en',
      theme: theme === 'dark' ? 'dark' : 'light',
      notificationsEnabled: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    dbState.users.push(newUser);

    // Seed starter routine for the newly registered user
    const starterRoutines = buildDefaultRoutinesForUser(uid, getTodayStr());
    dbState.routines.push(...starterRoutines);

    const token = crypto.randomBytes(24).toString('hex');
    dbState.sessions[token] = uid;
    saveDb();

    return res.json({ user: sanitizeUser(newUser), token });
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password, language, theme } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    const user = dbState.users.find((u) => u.email.toLowerCase() === cleanEmail);
    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    }

    const computedHash = hashPassword(rawPassword, user.salt);
    if (computedHash !== user.passwordHash) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    }

    if (language === 'en' || language === 'ne') {
      user.language = language;
    }
    if (theme === 'light' || theme === 'dark') {
      user.theme = theme;
    }

    const token = crypto.randomBytes(24).toString('hex');
    dbState.sessions[token] = user.uid;
    saveDb();

    return res.json({ user: sanitizeUser(user), token });
  });

  app.post('/api/auth/demo', (req: Request, res: Response) => {
    const { tier, language, theme } = req.body || {};
    const targetEmail =
      tier === 'pro' ? 'pro@meroroutine.com' : 'free@meroroutine.com';
    const user = dbState.users.find(
      (u) => u.email.toLowerCase() === targetEmail
    );
    if (!user) {
      return res.status(404).json({ error: 'Demo account unavailable' });
    }
    if (user.status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    }
    if (language === 'en' || language === 'ne') {
      user.language = language;
    }
    if (theme === 'light' || theme === 'dark') {
      user.theme = theme;
    }
    const token = crypto.randomBytes(24).toString('hex');
    dbState.sessions[token] = user.uid;
    saveDb();

    return res.json({ user: sanitizeUser(user), token });
  });

  app.post('/api/auth/google', (req: Request, res: Response) => {
    const { uid, email, name, language, theme } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Invalid Google account email' });
    }

    let user = dbState.users.find((u) => u.email.toLowerCase() === cleanEmail);
    const nowIso = new Date().toISOString();
    const isAdminEmail = BOOTSTRAPPED_ADMIN_EMAILS.has(cleanEmail);

    if (!user) {
      const salt = crypto.randomBytes(16).toString('hex');
      const safeUid = String(uid || `usr_${crypto.randomBytes(6).toString('hex')}`).replace(/[^a-zA-Z0-9_-]/g, '_');
      user = {
        uid: safeUid,
        name: String(name || cleanEmail.split('@')[0]).slice(0, 100),
        email: cleanEmail,
        salt,
        passwordHash: hashPassword(crypto.randomBytes(16).toString('hex'), salt),
        role: isAdminEmail ? 'admin' : 'user',
        status: 'active',
        isPro: isAdminEmail,
        proExpiry: isAdminEmail ? getFutureDateStr(365) : '',
        language: language === 'ne' ? 'ne' : 'en',
        theme: theme === 'dark' ? 'dark' : 'light',
        notificationsEnabled: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      dbState.users.push(user);
      const starterRoutines = buildDefaultRoutinesForUser(user.uid, getTodayStr());
      dbState.routines.push(...starterRoutines);
    } else if (user.status === 'suspended') {
      return res.status(403).json({ error: 'ACCOUNT_SUSPENDED' });
    } else {
      if (language === 'en' || language === 'ne') {
        user.language = language;
      }
      if (theme === 'light' || theme === 'dark') {
        user.theme = theme;
      }
    }

    if (isAdminEmail) {
      user.role = 'admin';
      user.isPro = true;
    }

    const token = crypto.randomBytes(24).toString('hex');
    dbState.sessions[token] = user.uid;
    saveDb();

    return res.json({ user: sanitizeUser(user), token });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res: Response) => {
    return res.json({ user: sanitizeUser(req.user!) });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res: Response) => {
    if (req.token && dbState.sessions[req.token]) {
      delete dbState.sessions[req.token];
      saveDb();
    }
    return res.json({ ok: true });
  });

  app.put('/api/profile', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const {
      name,
      language,
      theme,
      notificationsEnabled,
      notificationSound,
      defaultNotificationSound,
    } = req.body || {};

    if (typeof name === 'string' && name.trim().length > 0) {
      user.name = name.trim().slice(0, 100);
    }
    if (language === 'en' || language === 'ne') {
      user.language = language;
    }
    if (theme === 'light' || theme === 'dark') {
      user.theme = theme;
    }
    if (typeof notificationsEnabled === 'boolean') {
      user.notificationsEnabled = notificationsEnabled;
    }
    if (
      typeof defaultNotificationSound === 'string' &&
      VALID_BUILTIN_SOUNDS.includes(defaultNotificationSound as StoredBuiltInSoundId)
    ) {
      user.defaultNotificationSound = defaultNotificationSound as StoredBuiltInSoundId;
    }
    if (
      typeof notificationSound === 'string' &&
      VALID_NOTIFICATION_SOUNDS.includes(
        notificationSound as StoredNotificationSoundId
      )
    ) {
      if (notificationSound === 'custom') {
        const existingCustom = loadUserCustomSound(user.uid);
        if (existingCustom) {
          user.notificationSound = 'custom';
          user.hasCustomSound = true;
          user.customSoundName = existingCustom.fileName;
        } else {
          user.notificationSound = user.defaultNotificationSound || 'default_1';
          user.hasCustomSound = false;
        }
      } else {
        user.notificationSound = notificationSound as StoredBuiltInSoundId;
        user.defaultNotificationSound = notificationSound as StoredBuiltInSoundId;
      }
    }
    user.updatedAt = new Date().toISOString();
    saveDb();

    return res.json({ user: sanitizeUser(user) });
  });

  app.get(
    '/api/profile/custom-sound',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const stored = loadUserCustomSound(user.uid);
      return res.json({
        hasCustomSound: Boolean(stored),
        fileName: stored?.fileName || '',
        dataUrl: stored?.dataUrl || '',
      });
    }
  );

  app.post(
    '/api/profile/custom-sound',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const { fileName, dataUrl, selectImmediately } = req.body || {};
      if (!dataUrl || typeof dataUrl !== 'string') {
        return res
          .status(400)
          .json({ error: 'Valid audio file data is required.' });
      }
      const saved = saveUserCustomSound(
        user.uid,
        String(fileName || 'Custom Sound'),
        dataUrl
      );
      if (!saved) {
        return res.status(400).json({
          error:
            'Invalid or unsupported audio format. Please select a valid audio file (MP3, WAV, OGG, M4A).',
        });
      }
      user.customSoundName = saved.fileName;
      user.hasCustomSound = true;
      if (!user.defaultNotificationSound) {
        user.defaultNotificationSound = 'default_1';
      }
      if (selectImmediately !== false) {
        user.notificationSound = 'custom';
      }
      user.updatedAt = new Date().toISOString();
      saveDb();

      return res.json({
        user: sanitizeUser(user),
        customSound: {
          fileName: saved.fileName,
          dataUrl: saved.dataUrl,
        },
      });
    }
  );

  app.delete(
    '/api/profile/custom-sound',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      deleteUserCustomSound(user.uid);
      user.hasCustomSound = false;
      user.customSoundName = '';
      if (user.notificationSound === 'custom') {
        user.notificationSound = user.defaultNotificationSound || 'default_1';
      }
      user.updatedAt = new Date().toISOString();
      saveDb();

      return res.json({
        user: sanitizeUser(user),
      });
    }
  );

  // ==================================================
  // 2. USER ROUTINES, LOGS, GOALS, TEMPLATES & PRO FLOW
  // ==================================================

  app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res: Response) => {
    const uid = req.user!.uid;
    const today = getTodayStr();

    const routines = dbState.routines
      .filter((r) => r.userId === uid)
      .sort((a, b) => a.time.localeCompare(b.time));

    const routineLogs = dbState.routineLogs.filter((l) => l.userId === uid);
    const goals = dbState.goals.filter((g) => g.userId === uid);
    const templates = dbState.templates.filter(
      (t) => t.userId === 'system' || t.userId === uid
    );
    const proRequests = dbState.proRequests
      .filter((pr) => pr.userId === uid)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const sanitizedUser = sanitizeUser(req.user!);
    const clientToday =
      typeof req.query.clientToday === 'string' &&
      /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(req.query.clientToday)
        ? req.query.clientToday
        : today;
    const nepalToday = new Date(Date.now() + (5 * 60 + 45) * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const candidateDates = [today, nepalToday, clientToday].sort();
    const earliestToday = candidateDates[0];
    const latestToday = candidateDates[candidateDates.length - 1];

    const activeAds =
      !sanitizedUser.isPro && dbState.adsEnabledGlobal !== false
        ? dbState.ads
            .filter(
              (ad) =>
                ad.active &&
                (!ad.startDate || ad.startDate <= latestToday) &&
                (!ad.endDate || ad.endDate >= earliestToday)
            )
            .sort((a, b) => b.priority - a.priority)
        : [];

    const userCustomSound = loadUserCustomSound(uid);

    return res.json({
      user: sanitizedUser,
      customSoundDataUrl: userCustomSound ? userCustomSound.dataUrl : '',
      routines,
      routineLogs,
      goals,
      templates,
      proRequests,
      ads: activeAds,
      categories: dbState.categories,
    });
  });

  app.post('/api/routines', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const {
      title,
      time,
      category,
      icon,
      reminderOffset,
      duration,
      repeatType,
      customDays,
      targetDate,
      clientToday,
      timezone,
      notes,
    } = req.body || {};

    const cleanTitle = String(title || '').trim().slice(0, 120);
    const cleanTime = String(time || '06:00').trim();
    if (!cleanTitle || !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(cleanTime)) {
      return res.status(400).json({ error: 'Valid activity name and time (HH:MM) are required.' });
    }

    const serverToday = getTodayStr();
    const effectiveToday =
      typeof clientToday === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(clientToday)
        ? clientToday
        : serverToday;
    const requestedDate =
      typeof targetDate === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(targetDate)
        ? targetDate
        : effectiveToday;

    // Enforce Free plan constraint using the user's local today date so local timezones (e.g. Nepal UTC+5:45) never fail
    if (!user.isPro && user.role !== 'admin' && requestedDate > effectiveToday && requestedDate > getFutureDateStr(1)) {
      return res.status(403).json({ error: 'PRO_REQUIRED_FUTURE_PLANNING' });
    }

    const nowIso = new Date().toISOString();
    const validOffsets = [0, 5, 10, 15];
    const parsedOffset = validOffsets.includes(Number(reminderOffset))
      ? (Number(reminderOffset) as 0 | 5 | 10 | 15)
      : 0;

    const validRepeats = ['today', 'everyday', 'weekdays', 'custom'];
    const parsedRepeat = validRepeats.includes(repeatType) ? repeatType : 'today';

    const newRoutine: StoredRoutine = {
      id: `rt_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.uid,
      title: cleanTitle,
      time: cleanTime.padStart(5, '0'),
      category: String(category || 'General').slice(0, 40),
      icon: String(icon || '⏰').slice(0, 20),
      reminderOffset: parsedOffset,
      duration: Math.max(0, Math.min(1440, Number(duration) || 0)),
      repeatType: parsedRepeat,
      customDays: Array.isArray(customDays)
        ? customDays.map(Number).filter((d) => d >= 0 && d <= 6)
        : [],
      targetDate: requestedDate,
      timezone: typeof timezone === 'string' ? timezone.slice(0, 60) : '',
      notes: String(notes || '').slice(0, 500),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    dbState.routines.push(newRoutine);
    saveDb();
    return res.json({ routine: newRoutine });
  });

  app.post('/api/routines/batch', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { items, mode, targetDate } = req.body || {};
    const today = getTodayStr();
    const dateToUse = String(targetDate || today).slice(0, 10);

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No routine items provided.' });
    }

    if (mode === 'replace') {
      dbState.routines = dbState.routines.filter((r) => r.userId !== user.uid);
      dbState.routineLogs = dbState.routineLogs.filter((l) => l.userId !== user.uid);
    }

    const nowIso = new Date().toISOString();
    const created: StoredRoutine[] = [];

    for (const item of items.slice(0, 30)) {
      const cleanTitle = String(item.title || '').trim().slice(0, 120);
      const cleanTime = String(item.time || '06:00').trim().padStart(5, '0');
      if (!cleanTitle) continue;

      const rt: StoredRoutine = {
        id: `rt_${crypto.randomBytes(6).toString('hex')}`,
        userId: user.uid,
        title: cleanTitle,
        time: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(cleanTime) ? cleanTime : '08:00',
        category: String(item.category || 'General').slice(0, 40),
        icon: String(item.icon || '⏰').slice(0, 20),
        reminderOffset: [0, 5, 10, 15].includes(Number(item.reminderOffset))
          ? (Number(item.reminderOffset) as 0 | 5 | 10 | 15)
          : 10,
        duration: Math.max(0, Math.min(1440, Number(item.duration) || 30)),
        repeatType: ['today', 'everyday', 'weekdays', 'custom'].includes(item.repeatType)
          ? item.repeatType
          : 'everyday',
        customDays: [0, 1, 2, 3, 4, 5, 6],
        targetDate: dateToUse,
        notes: String(item.notes || '').slice(0, 500),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      dbState.routines.push(rt);
      created.push(rt);
    }

    saveDb();
    const userRoutines = dbState.routines
      .filter((r) => r.userId === user.uid)
      .sort((a, b) => a.time.localeCompare(b.time));
    return res.json({ routines: userRoutines, createdCount: created.length });
  });

  app.put('/api/routines/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const routine = dbState.routines.find(
      (r) => r.id === req.params.id && r.userId === user.uid
    );
    if (!routine) {
      return res.status(404).json({ error: 'Routine not found' });
    }

    const {
      title,
      time,
      category,
      icon,
      reminderOffset,
      duration,
      repeatType,
      customDays,
      targetDate,
      timezone,
      notes,
    } = req.body || {};

    if (typeof title === 'string' && title.trim()) {
      routine.title = title.trim().slice(0, 120);
    }
    if (typeof time === 'string' && /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(time.trim())) {
      const nextTime = time.trim().padStart(5, '0');
      if (nextTime !== routine.time) {
        const today = getTodayStr();
        dbState.routineLogs = dbState.routineLogs.filter(
          (l) =>
            !(
              l.userId === user.uid &&
              l.routineId === routine.id &&
              l.date >= today &&
              (l.status === 'snoozed' || l.status === 'missed')
            )
        );
      }
      routine.time = nextTime;
    }
    if (typeof category === 'string' && category.trim()) {
      routine.category = category.trim().slice(0, 40);
    }
    if (typeof icon === 'string' && icon.trim()) {
      routine.icon = icon.trim().slice(0, 20);
    }
    if ([0, 5, 10, 15].includes(Number(reminderOffset))) {
      routine.reminderOffset = Number(reminderOffset) as 0 | 5 | 10 | 15;
    }
    if (duration !== undefined) {
      routine.duration = Math.max(0, Math.min(1440, Number(duration) || 0));
    }
    if (['today', 'everyday', 'weekdays', 'custom'].includes(repeatType)) {
      routine.repeatType = repeatType;
    }
    if (Array.isArray(customDays)) {
      routine.customDays = customDays.map(Number).filter((d) => d >= 0 && d <= 6);
    }
    if (typeof targetDate === 'string' && targetDate.length === 10) {
      routine.targetDate = targetDate;
    }
    if (typeof timezone === 'string') {
      routine.timezone = timezone.slice(0, 60);
    }
    if (typeof notes === 'string') {
      routine.notes = notes.slice(0, 500);
    }
    routine.updatedAt = new Date().toISOString();
    saveDb();

    return res.json({ routine });
  });

  app.delete('/api/routines/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const idx = dbState.routines.findIndex(
      (r) => r.id === req.params.id && r.userId === user.uid
    );
    if (idx === -1) {
      return res.status(404).json({ error: 'Routine not found' });
    }
    const removed = dbState.routines[idx];
    dbState.routines.splice(idx, 1);
    dbState.routineLogs = dbState.routineLogs.filter(
      (l) => !(l.userId === user.uid && l.routineId === removed.id)
    );
    saveDb();
    return res.json({ ok: true });
  });

  // Upsert routine status log (prevents duplicate completion records)
  app.post('/api/routine-logs', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { routineId, date, status, snoozedUntil } = req.body || {};

    const routine = dbState.routines.find(
      (r) => r.id === routineId && r.userId === user.uid
    );
    if (!routine) {
      return res.status(404).json({ error: 'Routine not found' });
    }

    const cleanDate = String(date || getTodayStr()).slice(0, 10);
    if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(cleanDate)) {
      return res.status(400).json({ error: 'Invalid date format' });
    }

    const validStatuses = ['done', 'skipped', 'snoozed', 'missed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const nowIso = new Date().toISOString();
    let existingLog = dbState.routineLogs.find(
      (l) =>
        l.userId === user.uid &&
        l.routineId === routineId &&
        l.date === cleanDate
    );

    if (existingLog) {
      existingLog.status = status;
      existingLog.snoozedUntil =
        status === 'snoozed' ? String(snoozedUntil || '').slice(0, 30) : '';
      existingLog.updatedAt = nowIso;
    } else {
      existingLog = {
        id: `log_${crypto.randomBytes(6).toString('hex')}`,
        userId: user.uid,
        routineId,
        date: cleanDate,
        status,
        snoozedUntil:
          status === 'snoozed' ? String(snoozedUntil || '').slice(0, 30) : '',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      dbState.routineLogs.push(existingLog);
    }

    saveDb();
    return res.json({ log: existingLog });
  });

  // ==================================================
  // 2B. WEB PUSH & PERSISTENT BACKGROUND ALARM ENDPOINTS
  // ==================================================

  app.get('/api/push/vapid-public-key', (_req: Request, res: Response) => {
    return res.json({ publicKey: vapidKeys.publicKey });
  });

  app.post(
    '/api/push/sync-timezone',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const { timezone, timezoneOffsetMinutes, language, firedKeys } =
        req.body || {};
      const cleanTz =
        typeof timezone === 'string' && timezone.trim()
          ? timezone.trim().slice(0, 60)
          : 'Asia/Kathmandu';
      const cleanOffset =
        typeof timezoneOffsetMinutes === 'number' &&
        !Number.isNaN(timezoneOffsetMinutes)
          ? timezoneOffsetMinutes
          : -345;
      const cleanLang = language === 'ne' ? 'ne' : user.language || 'en';

      pushState.userTimezones[user.uid] = {
        timezone: cleanTz,
        timezoneOffsetMinutes: cleanOffset,
        language: cleanLang,
      };

      // Update any user routines missing timezone
      let dbMutated = false;
      for (const rt of dbState.routines) {
        if (rt.userId === user.uid && !rt.timezone) {
          rt.timezone = cleanTz;
          dbMutated = true;
        }
      }
      if (dbMutated) saveDb();

      if (Array.isArray(firedKeys)) {
        for (const k of firedKeys.slice(-200)) {
          if (typeof k === 'string' && k) {
            pushFiredSet.add(k);
          }
        }
      }
      savePushState();
      return res.json({ ok: true });
    }
  );

  app.post(
    '/api/push/subscribe',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const { subscription, timezone, timezoneOffsetMinutes, language, firedKeys } =
        req.body || {};

      if (
        !subscription ||
        typeof subscription.endpoint !== 'string' ||
        !subscription.keys?.p256dh ||
        !subscription.keys?.auth
      ) {
        return res.status(400).json({ error: 'Invalid push subscription' });
      }

      const cleanTz =
        typeof timezone === 'string' && timezone.trim()
          ? timezone.trim().slice(0, 60)
          : 'Asia/Kathmandu';
      const cleanOffset =
        typeof timezoneOffsetMinutes === 'number' &&
        !Number.isNaN(timezoneOffsetMinutes)
          ? timezoneOffsetMinutes
          : -345;
      const cleanLang = language === 'ne' ? 'ne' : user.language || 'en';

      pushState.userTimezones[user.uid] = {
        timezone: cleanTz,
        timezoneOffsetMinutes: cleanOffset,
        language: cleanLang,
      };

      pushState.subscriptions = pushState.subscriptions.filter(
        (s) => s.endpoint !== subscription.endpoint
      );
      pushState.subscriptions.push({
        userId: user.uid,
        endpoint: subscription.endpoint,
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: String(subscription.keys.p256dh),
            auth: String(subscription.keys.auth),
          },
        },
        timezone: cleanTz,
        timezoneOffsetMinutes: cleanOffset,
        language: cleanLang,
        updatedAt: new Date().toISOString(),
      });

      if (Array.isArray(firedKeys)) {
        for (const k of firedKeys.slice(-200)) {
          if (typeof k === 'string' && k) {
            pushFiredSet.add(k);
          }
        }
      }
      savePushState();
      return res.json({ ok: true });
    }
  );

  app.post(
    '/api/push/mark-fired',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const { dedupeKey } = req.body || {};
      if (typeof dedupeKey === 'string' && dedupeKey.trim()) {
        markServerAlarmFired(dedupeKey.trim());
      }
      return res.json({ ok: true });
    }
  );

  app.post(
    '/api/push/test-alarm',
    requireAuth,
    (req: AuthedRequest, res: Response) => {
      const user = req.user!;
      const {
        delayMs,
        dedupeKey,
        title,
        body,
        routineTitle,
        routineTime,
        routineIcon,
      } = req.body || {};
      const waitMs = Math.max(0, Math.min(30000, Number(delayMs) || 0));
      const userSubs = pushState.subscriptions.filter(
        (s) => s.userId === user.uid
      );

      if (userSubs.length === 0) {
        return res.json({ ok: true, pushedCount: 0 });
      }

      const payloadObj = {
        dedupeKey:
          typeof dedupeKey === 'string' && dedupeKey.trim()
            ? dedupeKey.trim()
            : `test_alarm_${Date.now()}`,
        routineId: 'test_alarm',
        dateStr: getTodayStr(),
        routineTitle: routineTitle || 'Test Alarm',
        routineTime: routineTime || '06:00',
        routineIcon: routineIcon || '🔔',
        title: title || '🔔 Test Alarm — Mero Routine',
        body:
          body ||
          'Your Mero Routine background notification & alarm system is active!',
        soundId:
          user.notificationSound || user.defaultNotificationSound || 'default_1',
        defaultSoundId: user.defaultNotificationSound || 'default_1',
        isTest: true,
      };

      setTimeout(async () => {
        const deadEndpoints = new Set<string>();
        for (const subRecord of userSubs) {
          try {
            await webpush.sendNotification(
              subRecord.subscription,
              JSON.stringify(payloadObj),
              { TTL: 120, urgency: 'high' }
            );
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              deadEndpoints.add(subRecord.endpoint);
            }
          }
        }
        if (deadEndpoints.size > 0) {
          pushState.subscriptions = pushState.subscriptions.filter(
            (s) => !deadEndpoints.has(s.endpoint)
          );
          savePushState();
        }
      }, waitMs);

      return res.json({ ok: true, scheduledInMs: waitMs, subs: userSubs.length });
    }
  );

  // Server-side Local-Timezone Background Push Alarm Scheduler (ticks every 4 seconds)
  setInterval(async () => {
    if (pushState.subscriptions.length === 0) return;

    const subsByUser = new Map<string, StoredPushSubscriptionRecord[]>();
    for (const sub of pushState.subscriptions) {
      const list = subsByUser.get(sub.userId) || [];
      list.push(sub);
      subsByUser.set(sub.userId, list);
    }

    const deadEndpoints = new Set<string>();

    for (const [uid, userSubs] of subsByUser.entries()) {
      const user = dbState.users.find((u) => u.uid === uid);
      if (!user || !user.notificationsEnabled || user.status === 'suspended') {
        continue;
      }

      const tzMeta = pushState.userTimezones[uid] || {
        timezone: userSubs[0].timezone || 'Asia/Kathmandu',
        timezoneOffsetMinutes: userSubs[0].timezoneOffsetMinutes ?? -345,
        language: user.language || 'en',
      };

      const userRoutines = dbState.routines.filter((r) => r.userId === uid);
      if (userRoutines.length === 0) continue;

      const userLogs = dbState.routineLogs.filter((l) => l.userId === uid);

      for (const rt of userRoutines) {
        const effectiveTz = rt.timezone || tzMeta.timezone || 'Asia/Kathmandu';
        const clock = getLocalClockInTimezone(
          effectiveTz,
          tzMeta.timezoneOffsetMinutes
        );

        // Check if routine applies to local today date in user's timezone
        let appliesToday = false;
        if (rt.repeatType === 'today') {
          appliesToday = !rt.targetDate || rt.targetDate === clock.dateStr;
        } else if (rt.repeatType === 'everyday') {
          appliesToday = true;
        } else if (rt.repeatType === 'weekdays') {
          appliesToday = clock.dayOfWeek >= 1 && clock.dayOfWeek <= 5;
        } else if (rt.repeatType === 'custom') {
          appliesToday =
            Array.isArray(rt.customDays) &&
            rt.customDays.includes(clock.dayOfWeek);
        }

        if (!appliesToday) continue;

        const log = userLogs.find(
          (l) => l.routineId === rt.id && l.date === clock.dateStr
        );
        if (log && (log.status === 'done' || log.status === 'skipped')) {
          continue;
        }

        const lang = user.language || tzMeta.language || 'en';
        let dueDedupeKey = '';
        let dueTriggerTime24 = rt.time;
        let isSnoozedDue = false;
        let effectiveOffset = 0;

        if (log && log.status === 'snoozed' && log.snoozedUntil) {
          const [sh, sm] = log.snoozedUntil.split(':').map(Number);
          const snoozeTotalSeconds = ((sh || 0) * 60 + (sm || 0)) * 60;
          const snoozeKey = `${clock.dateStr}_${rt.id}_snooze_${log.snoozedUntil}`;
          // Wait 2 seconds so an open foreground client can fire first and mark-fired
          if (
            !pushFiredSet.has(snoozeKey) &&
            clock.totalSeconds >= snoozeTotalSeconds + 2 &&
            clock.totalSeconds <= snoozeTotalSeconds + 90
          ) {
            dueDedupeKey = snoozeKey;
            dueTriggerTime24 = log.snoozedUntil;
            isSnoozedDue = true;
          }
        } else {
          const [rh, rm] = (rt.time || '06:00').split(':').map(Number);
          const activityMinutes = (rh || 0) * 60 + (rm || 0);
          const offsetMins = Number(rt.reminderOffset) || 0;
          const advanceMinutes =
            ((activityMinutes - offsetMins) % 1440 + 1440) % 1440;
          const advanceSeconds = advanceMinutes * 60;
          const activitySeconds = activityMinutes * 60;
          const baseKey = `${clock.dateStr}_${rt.id}_${rt.time}_${offsetMins}`;

          if (!pushFiredSet.has(baseKey)) {
            if (
              clock.totalSeconds >= advanceSeconds + 2 &&
              clock.totalSeconds <= advanceSeconds + 90
            ) {
              dueDedupeKey = baseKey;
              dueTriggerTime24 = `${String(
                Math.floor(advanceMinutes / 60)
              ).padStart(2, '0')}:${String(advanceMinutes % 60).padStart(
                2,
                '0'
              )}`;
              effectiveOffset = offsetMins;
            } else if (
              offsetMins > 0 &&
              clock.totalSeconds >= activitySeconds + 2 &&
              clock.totalSeconds <= activitySeconds + 90
            ) {
              dueDedupeKey = baseKey;
              dueTriggerTime24 = rt.time;
              effectiveOffset = 0;
            }
          }
        }

        if (!dueDedupeKey) continue;

        // Mark fired before sending so we never send duplicates
        markServerAlarmFired(dueDedupeKey);

        const formattedActivity = formatServerTime12h(rt.time, lang);
        const formattedTrigger = formatServerTime12h(dueTriggerTime24, lang);
        let msg = '';
        if (isSnoozedDue) {
          msg =
            lang === 'ne'
              ? `🔔 ${rt.title} — सारिएको समय (${formattedTrigger}) भयो।`
              : `Snoozed reminder: It's ${formattedTrigger} — time for ${rt.title}.`;
        } else if (effectiveOffset > 0) {
          msg =
            lang === 'ne'
              ? `🔔 ${rt.title} ${effectiveOffset} मिनेटमा सुरु हुँदैछ (${formattedActivity})।`
              : `Upcoming in ${effectiveOffset} min: ${rt.title} at ${formattedActivity}.`;
        } else {
          msg =
            lang === 'ne'
              ? `🔔 ${rt.title} — समय: ${formattedActivity}। कार्य सुरु गर्ने समय भयो!`
              : `It’s ${formattedActivity}. Time for ${rt.title}!`;
        }

        const pushPayload = JSON.stringify({
          dedupeKey: dueDedupeKey,
          routineId: rt.id,
          dateStr: clock.dateStr,
          routineTitle: rt.title,
          routineTime: rt.time,
          routineIcon: rt.icon || '🔔',
          title: `🔔 ${rt.title} — Mero Routine`,
          body: msg,
          soundId:
            user.notificationSound ||
            user.defaultNotificationSound ||
            'default_1',
          defaultSoundId: user.defaultNotificationSound || 'default_1',
          isTest: false,
        });

        for (const subRecord of userSubs) {
          try {
            await webpush.sendNotification(
              subRecord.subscription,
              pushPayload,
              { TTL: 300, urgency: 'high' }
            );
          } catch (err: any) {
            if (err?.statusCode === 404 || err?.statusCode === 410) {
              deadEndpoints.add(subRecord.endpoint);
            }
          }
        }
      }
    }

    if (deadEndpoints.size > 0) {
      pushState.subscriptions = pushState.subscriptions.filter(
        (s) => !deadEndpoints.has(s.endpoint)
      );
      savePushState();
    }
  }, 4000);

  // Goals CRUD (Pro)
  app.post('/api/goals', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    if (!user.isPro && user.role !== 'admin') {
      return res.status(403).json({ error: 'PRO_REQUIRED' });
    }
    const { title, category, targetDays, startDate, endDate } = req.body || {};
    const cleanTitle = String(title || '').trim().slice(0, 120);
    if (!cleanTitle) {
      return res.status(400).json({ error: 'Goal name is required' });
    }

    const nowIso = new Date().toISOString();
    const parsedTarget = Math.max(1, Math.min(365, Number(targetDays) || 30));
    const start = String(startDate || getTodayStr()).slice(0, 10);
    const end = String(endDate || getFutureDateStr(parsedTarget)).slice(0, 10);

    const goal: StoredGoal = {
      id: `goal_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.uid,
      title: cleanTitle,
      category: String(category || 'Habit').slice(0, 40),
      targetDays: parsedTarget,
      completedDays: 0,
      startDate: start,
      endDate: end,
      checkedDates: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    dbState.goals.push(goal);
    saveDb();
    return res.json({ goal });
  });

  app.put('/api/goals/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const goal = dbState.goals.find(
      (g) => g.id === req.params.id && g.userId === user.uid
    );
    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const { title, category, targetDays, startDate, endDate, toggleDate } =
      req.body || {};

    if (typeof title === 'string' && title.trim()) {
      goal.title = title.trim().slice(0, 120);
    }
    if (typeof category === 'string' && category.trim()) {
      goal.category = category.trim().slice(0, 40);
    }
    if (targetDays !== undefined) {
      goal.targetDays = Math.max(1, Math.min(365, Number(targetDays) || 30));
    }
    if (typeof startDate === 'string' && startDate.length === 10) {
      goal.startDate = startDate;
    }
    if (typeof endDate === 'string' && endDate.length === 10) {
      goal.endDate = endDate;
    }
    if (typeof toggleDate === 'string' && toggleDate.length === 10) {
      if (goal.checkedDates.includes(toggleDate)) {
        goal.checkedDates = goal.checkedDates.filter((d) => d !== toggleDate);
      } else {
        goal.checkedDates.push(toggleDate);
      }
      goal.completedDays = goal.checkedDates.length;
    }

    goal.updatedAt = new Date().toISOString();
    saveDb();
    return res.json({ goal });
  });

  app.delete('/api/goals/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const idx = dbState.goals.findIndex(
      (g) => g.id === req.params.id && g.userId === user.uid
    );
    if (idx === -1) {
      return res.status(404).json({ error: 'Goal not found' });
    }
    dbState.goals.splice(idx, 1);
    saveDb();
    return res.json({ ok: true });
  });

  // Templates (Pro)
  app.post('/api/templates', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    if (!user.isPro && user.role !== 'admin') {
      return res.status(403).json({ error: 'PRO_REQUIRED' });
    }
    const { name, description, items } = req.body || {};
    const cleanName = String(name || '').trim().slice(0, 80);
    if (!cleanName || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Template name and routine items are required.' });
    }

    const tpl: StoredTemplate = {
      id: `tpl_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.uid,
      name: cleanName,
      description: String(description || 'Custom saved routine template').slice(0, 250),
      items: items.slice(0, 30).map((it: any) => ({
        title: String(it.title || 'Activity').slice(0, 120),
        time: String(it.time || '06:00').slice(0, 10),
        category: String(it.category || 'General').slice(0, 40),
        icon: String(it.icon || '⏰').slice(0, 20),
        duration: Number(it.duration) || 30,
        reminderOffset: ([0, 5, 10, 15].includes(Number(it.reminderOffset))
          ? Number(it.reminderOffset)
          : 10) as 0 | 5 | 10 | 15,
        repeatType: 'everyday',
        notes: String(it.notes || '').slice(0, 500),
      })),
      createdAt: new Date().toISOString(),
    };

    dbState.templates.push(tpl);
    saveDb();
    return res.json({ template: tpl });
  });

  app.delete('/api/templates/:id', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const idx = dbState.templates.findIndex(
      (t) => t.id === req.params.id && t.userId === user.uid
    );
    if (idx === -1) {
      return res.status(404).json({ error: 'Template not found or cannot delete preset' });
    }
    dbState.templates.splice(idx, 1);
    saveDb();
    return res.json({ ok: true });
  });

  // Manual Pro Upgrade Request (Rs.99 / month & Rs.999 / year V1 flow)
  app.post('/api/pro-requests', requireAuth, (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    const { referenceId, paymentMethod, senderInfo, planType, amount } = req.body || {};

    const cleanSender = String(senderInfo || '').trim().slice(0, 120);
    const cleanMethod = String(paymentMethod || 'eSewa').trim().slice(0, 40);
    const cleanRef = String(
      referenceId || `MR-PRO-${Math.floor(100000 + Math.random() * 900000)}`
    )
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 60);

    const resolvedPlan: 'monthly' | 'yearly' =
      planType === 'yearly' || Number(amount) === 999 ? 'yearly' : 'monthly';
    const resolvedAmount = resolvedPlan === 'yearly' ? 999 : 99;

    if (!cleanSender) {
      return res.status(400).json({ error: 'Please enter your sender phone number or transaction reference.' });
    }

    // Prevent duplicate pending requests from same user
    const existingPending = dbState.proRequests.find(
      (pr) => pr.userId === user.uid && pr.status === 'pending'
    );
    if (existingPending) {
      existingPending.paymentMethod = cleanMethod;
      existingPending.senderInfo = cleanSender;
      existingPending.planType = resolvedPlan;
      existingPending.amount = resolvedAmount;
      existingPending.updatedAt = new Date().toISOString();
      saveDb();
      return res.json({ request: existingPending });
    }

    const nowIso = new Date().toISOString();
    const newReq: StoredProRequest = {
      id: `req_${crypto.randomBytes(6).toString('hex')}`,
      userId: user.uid,
      userEmail: user.email,
      userName: user.name,
      referenceId: cleanRef,
      paymentMethod: cleanMethod,
      senderInfo: cleanSender,
      planType: resolvedPlan,
      amount: resolvedAmount,
      status: 'pending',
      adminNotes: '',
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    dbState.proRequests.push(newReq);
    saveDb();
    return res.json({ request: newReq });
  });

  // ==================================================
  // 3. SERVER-SIDE GEMINI AI ROUTINE BUILDER (PRO)
  // ==================================================

  app.post('/api/ai/generate-routine', requireAuth, async (req: AuthedRequest, res: Response) => {
    const user = req.user!;
    if (!user.isPro && user.role !== 'admin') {
      return res.status(403).json({ error: 'PRO_REQUIRED' });
    }

    const { prompt, language } = req.body || {};
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) {
      return res.status(400).json({ error: 'Please describe your daily routine.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      const parsed = fallbackParseRoutineFromText(cleanPrompt);
      return res.json({ items: parsed, source: 'smart-parser' });
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        contents: `Convert this user routine description into a complete, chronological daily schedule from morning to night.
User description: "${cleanPrompt}"
Preferred output language for titles/notes: ${language === 'ne' ? 'Nepali (नेपाली)' : 'English'}.
Ensure times use 24-hour HH:MM format (e.g., "05:00", "06:00", "13:00", "22:00") and choose an appropriate emoji icon for each activity.`,
        config: {
          systemInstruction:
            'You are the Mero Routine AI Routine Builder. Output a well-structured array of daily activities sorted chronologically from morning to night.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Short clear activity name',
                },
                time: {
                  type: Type.STRING,
                  description: '24-hour time in HH:MM format (e.g. 05:00, 18:30)',
                },
                category: {
                  type: Type.STRING,
                  description: 'Category name such as Morning, Fitness, Nutrition, Work, Study, Rest',
                },
                icon: {
                  type: Type.STRING,
                  description: 'Single emoji representing the activity (e.g. 🌅, 🏋️, 🍳, 💼, 📚, 😴)',
                },
                duration: {
                  type: Type.INTEGER,
                  description: 'Duration in minutes (e.g. 15, 30, 60)',
                },
                reminderOffset: {
                  type: Type.INTEGER,
                  description: 'Reminder offset in minutes: 0, 5, 10, or 15',
                },
                notes: {
                  type: Type.STRING,
                  description: 'Brief helpful note for this routine item',
                },
              },
              required: [
                'title',
                'time',
                'category',
                'icon',
                'duration',
                'reminderOffset',
                'notes',
              ],
            },
          },
        },
      });

      const rawText = response.text || '[]';
      const parsedItems = JSON.parse(rawText);
      if (Array.isArray(parsedItems) && parsedItems.length > 0) {
        const normalized = parsedItems.map((it: any) => ({
          title: String(it.title || 'Routine').slice(0, 120),
          time: /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(String(it.time || '').trim())
            ? String(it.time).trim().padStart(5, '0')
            : '08:00',
          category: String(it.category || 'General').slice(0, 40),
          icon: String(it.icon || '⏰').slice(0, 10),
          duration: Math.max(5, Math.min(600, Number(it.duration) || 30)),
          reminderOffset: ([0, 5, 10, 15].includes(Number(it.reminderOffset))
            ? Number(it.reminderOffset)
            : 10) as 0 | 5 | 10 | 15,
          repeatType: 'everyday' as const,
          notes: String(it.notes || '').slice(0, 200),
        }));
        normalized.sort((a, b) => a.time.localeCompare(b.time));
        return res.json({ items: normalized, source: 'gemini' });
      }
      return res.json({ items: fallbackParseRoutineFromText(cleanPrompt), source: 'smart-parser' });
    } catch (err) {
      console.error('Gemini routine generation error, using fallback parser:', err);
      const fallbackItems = fallbackParseRoutineFromText(cleanPrompt);
      return res.json({ items: fallbackItems, source: 'smart-parser' });
    }
  });

  // ==================================================
  // 4. SECURE ADMIN PANEL ENDPOINTS
  // ==================================================

  app.get('/api/admin/overview', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const today = getTodayStr();
    const totalUsers = dbState.users.length;
    const activeUsers = dbState.users.filter((u) => u.status === 'active').length;
    const proUsers = dbState.users.filter((u) => u.isPro).length;
    const freeUsers = totalUsers - proUsers;
    const routinesCreated = dbState.routines.length;

    const dauSet = new Set(
      dbState.routineLogs.filter((l) => l.date === today).map((l) => l.userId)
    );
    const dailyActiveUsers = Math.max(1, dauSet.size);

    const totalLogs = dbState.routineLogs.length;
    const doneLogs = dbState.routineLogs.filter((l) => l.status === 'done').length;
    const skippedLogs = dbState.routineLogs.filter((l) => l.status === 'skipped').length;
    const missedLogs = dbState.routineLogs.filter((l) => l.status === 'missed').length;
    const overallCompletionRate =
      totalLogs > 0 ? Math.round((doneLogs / totalLogs) * 100) : 0;

    // Revenue calculated strictly from verified approved Rs.99 requests
    const approvedRequests = dbState.proRequests.filter(
      (pr) => pr.status === 'approved'
    );
    const verifiedRevenueNpr = approvedRequests.reduce(
      (sum, pr) => sum + (pr.amount || 99),
      0
    );

    return res.json({
      stats: {
        totalUsers,
        activeUsers,
        freeUsers,
        proUsers,
        routinesCreated,
        dailyActiveUsers,
        totalLogs,
        doneLogs,
        skippedLogs,
        missedLogs,
        overallCompletionRate,
        proSubscriptionsCount: proUsers,
        verifiedRevenueNpr,
        approvedPaymentsCount: approvedRequests.length,
        pendingPaymentsCount: dbState.proRequests.filter(
          (pr) => pr.status === 'pending'
        ).length,
      },
      users: dbState.users.map(sanitizeUser),
      proRequests: [...dbState.proRequests].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt)
      ),
      ads: dbState.ads,
      adsEnabledGlobal: dbState.adsEnabledGlobal,
      categories: dbState.categories,
    });
  });

  app.put('/api/admin/users/:uid', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const target = dbState.users.find((u) => u.uid === req.params.uid);
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { status, isPro, proExpiry, role } = req.body || {};
    if (status === 'active' || status === 'suspended') {
      // Prevent suspending bootstrapped admin
      if (!BOOTSTRAPPED_ADMIN_EMAILS.has(target.email.toLowerCase())) {
        target.status = status;
      }
    }
    if (typeof isPro === 'boolean') {
      target.isPro = isPro;
      if (isPro && !proExpiry && !target.proExpiry) {
        target.proExpiry = getFutureDateStr(30);
      } else if (!isPro) {
        target.proExpiry = '';
      }
    }
    if (typeof proExpiry === 'string') {
      target.proExpiry = proExpiry.slice(0, 40);
    }
    if (role === 'user' || role === 'admin') {
      if (!BOOTSTRAPPED_ADMIN_EMAILS.has(target.email.toLowerCase())) {
        target.role = role;
      }
    }
    target.updatedAt = new Date().toISOString();
    saveDb();
    return res.json({ user: sanitizeUser(target) });
  });

  app.put('/api/admin/pro-requests/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const pr = dbState.proRequests.find((r) => r.id === req.params.id);
    if (!pr) {
      return res.status(404).json({ error: 'Pro request not found' });
    }

    const { status, adminNotes, proExpiry } = req.body || {};
    if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
      return res.status(400).json({ error: 'Invalid status' });
    }

    pr.status = status;
    if (typeof adminNotes === 'string') {
      pr.adminNotes = adminNotes.slice(0, 500);
    }
    pr.updatedAt = new Date().toISOString();

    const targetUser = dbState.users.find((u) => u.uid === pr.userId);
    if (targetUser) {
      if (status === 'approved') {
        targetUser.isPro = true;
        const durationDays =
          pr.amount === 999 || pr.planType === 'yearly' ? 365 : 30;
        targetUser.proExpiry =
          typeof proExpiry === 'string' && proExpiry.length >= 10
            ? proExpiry
            : getFutureDateStr(durationDays);
        targetUser.updatedAt = new Date().toISOString();
      } else if (status === 'rejected') {
        targetUser.isPro = false;
        targetUser.proExpiry = '';
        targetUser.updatedAt = new Date().toISOString();
      }
    }

    saveDb();
    return res.json({
      request: pr,
      user: targetUser ? sanitizeUser(targetUser) : null,
    });
  });

  app.post('/api/admin/ads/upload', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const { dataUrl } = req.body || {};
    if (!dataUrl || typeof dataUrl !== 'string') {
      return res.status(400).json({ error: 'Image data is required' });
    }
    const imageUrl = persistBannerImage(dataUrl);
    if (!imageUrl) {
      return res.status(400).json({ error: 'Invalid banner image format' });
    }
    return res.json({ imageUrl });
  });

  app.post('/api/admin/ads', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const {
      title,
      type,
      placement,
      placements,
      pages,
      positions,
      imageUrl,
      targetUrl,
      adSenseSlot,
      active,
      startDate,
      endDate,
      priority,
    } = req.body || {};

    const resolvedType = type === 'adsense' ? 'adsense' : 'manual';
    const cleanTitle = String(title || '').trim().slice(0, 120);
    const savedImageUrl = persistBannerImage(String(imageUrl || ''));
    const cleanSlot = String(adSenseSlot || '').trim().slice(0, 120);

    if (resolvedType === 'manual' && !savedImageUrl && !cleanTitle) {
      return res.status(400).json({ error: 'Please upload a banner image or enter a banner title.' });
    }
    if (resolvedType === 'adsense' && !cleanTitle && !cleanSlot) {
      return res.status(400).json({ error: 'AdSense slot ID or label is required.' });
    }

    const validPages: StoredAdPage[] = Array.isArray(pages)
      ? VALID_AD_PAGES.filter((pg) => pages.includes(pg))
      : ['home', 'planner', 'reports', 'profile'];
    const validPositions: StoredAdPosition[] = Array.isArray(positions)
      ? VALID_AD_POSITIONS.filter((ps) => positions.includes(ps))
      : ['top', 'bottom'];

    let resolvedPlacements: StoredAdPlacement[] = [];
    if (Array.isArray(placements)) {
      resolvedPlacements = VALID_AD_PLACEMENTS.filter((p) =>
        placements.includes(p)
      );
    } else if (Array.isArray(pages) || Array.isArray(positions)) {
      for (const pg of validPages) {
        for (const ps of validPositions) {
          resolvedPlacements.push(`${pg}_${ps}` as StoredAdPlacement);
        }
      }
    } else if (VALID_AD_PLACEMENTS.includes(placement)) {
      resolvedPlacements = [placement];
    } else {
      resolvedPlacements = [...VALID_AD_PLACEMENTS];
    }

    const primaryPlacement: StoredAdPlacement = VALID_AD_PLACEMENTS.includes(
      placement
    )
      ? placement
      : resolvedPlacements[0] || 'home_top';

    const nowIso = new Date().toISOString();
    const newAd: StoredAdBanner = {
      id: `ad_${crypto.randomBytes(5).toString('hex')}`,
      title: cleanTitle,
      type: resolvedType,
      placement: primaryPlacement,
      placements: resolvedPlacements,
      pages: validPages,
      positions: validPositions,
      imageUrl: savedImageUrl,
      targetUrl: String(targetUrl || '#upgrade').trim().slice(0, 1000),
      adSenseSlot: cleanSlot,
      active: Boolean(active ?? true),
      startDate: String(startDate || getTodayStr()).slice(0, 10),
      endDate: String(endDate || getFutureDateStr(180)).slice(0, 10),
      priority: Math.max(1, Math.min(100, Number(priority) || 10)),
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (newAd.active) {
      dbState.adsEnabledGlobal = true;
    }
    dbState.ads.push(newAd);
    saveDb();
    return res.json({ ad: newAd });
  });

  app.put('/api/admin/ads/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    if (req.params.id === 'global-toggle') {
      const nextGlobal = Boolean(req.body.adsEnabledGlobal);
      dbState.adsEnabledGlobal = nextGlobal;
      if (nextGlobal && dbState.ads.length > 0 && !dbState.ads.some((a) => a.active)) {
        dbState.ads.forEach((a) => {
          a.active = true;
        });
      }
      saveDb();
      return res.json({ adsEnabledGlobal: dbState.adsEnabledGlobal });
    }

    const ad = dbState.ads.find((a) => a.id === req.params.id);
    if (!ad) {
      return res.status(404).json({ error: 'Ad not found' });
    }

    const {
      title,
      type,
      placement,
      placements,
      pages,
      positions,
      imageUrl,
      targetUrl,
      adSenseSlot,
      active,
      startDate,
      endDate,
      priority,
    } = req.body || {};

    if (typeof title === 'string') ad.title = title.trim().slice(0, 120);
    if (type === 'manual' || type === 'adsense') ad.type = type;
    if (Array.isArray(pages)) {
      ad.pages = VALID_AD_PAGES.filter((pg) => pages.includes(pg));
    }
    if (Array.isArray(positions)) {
      ad.positions = VALID_AD_POSITIONS.filter((ps) => positions.includes(ps));
    }
    if (Array.isArray(placements)) {
      ad.placements = VALID_AD_PLACEMENTS.filter((p) => placements.includes(p));
      if (ad.placements.length > 0) {
        ad.placement = ad.placements[0];
      }
    } else if (Array.isArray(pages) || Array.isArray(positions)) {
      const nextPages = ad.pages || ['home', 'planner', 'reports', 'profile'];
      const nextPositions = ad.positions || ['top', 'bottom'];
      const computed: StoredAdPlacement[] = [];
      for (const pg of nextPages) {
        for (const ps of nextPositions) {
          computed.push(`${pg}_${ps}` as StoredAdPlacement);
        }
      }
      ad.placements = computed;
      if (computed.length > 0) {
        ad.placement = computed[0];
      }
    } else if (VALID_AD_PLACEMENTS.includes(placement)) {
      ad.placement = placement;
      ad.placements = [placement];
    }
    if (typeof imageUrl === 'string') ad.imageUrl = persistBannerImage(imageUrl);
    if (typeof targetUrl === 'string') ad.targetUrl = targetUrl.trim().slice(0, 1000);
    if (typeof adSenseSlot === 'string') ad.adSenseSlot = adSenseSlot.trim().slice(0, 120);
    if (typeof active === 'boolean') {
      ad.active = active;
      if (active) {
        dbState.adsEnabledGlobal = true;
      }
    }
    if (typeof startDate === 'string' && startDate.length === 10) ad.startDate = startDate;
    if (typeof endDate === 'string' && endDate.length === 10) ad.endDate = endDate;
    if (priority !== undefined) ad.priority = Math.max(1, Math.min(100, Number(priority) || 1));

    ad.updatedAt = new Date().toISOString();
    saveDb();
    return res.json({ ad });
  });

  app.delete('/api/admin/ads/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const idx = dbState.ads.findIndex((a) => a.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Ad not found' });
    }
    dbState.ads.splice(idx, 1);
    saveDb();
    return res.json({ ok: true });
  });

  app.post('/api/admin/categories', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const { nameEn, nameNe, icon, suggestedTitleEn, suggestedTitleNe, defaultTime } =
      req.body || {};
    if (!nameEn) {
      return res.status(400).json({ error: 'Category name is required' });
    }
    const newCat: StoredCategory = {
      id: `cat_${crypto.randomBytes(4).toString('hex')}`,
      nameEn: String(nameEn).slice(0, 40),
      nameNe: String(nameNe || nameEn).slice(0, 40),
      icon: String(icon || '✨').slice(0, 10),
      suggestedTitleEn: String(suggestedTitleEn || nameEn).slice(0, 80),
      suggestedTitleNe: String(suggestedTitleNe || nameNe || nameEn).slice(0, 80),
      defaultTime: String(defaultTime || '08:00').slice(0, 5),
    };
    dbState.categories.push(newCat);
    saveDb();
    return res.json({ category: newCat });
  });

  app.delete('/api/admin/categories/:id', requireAuth, requireAdmin, (req: AuthedRequest, res: Response) => {
    const idx = dbState.categories.findIndex((c) => c.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: 'Category not found' });
    }
    dbState.categories.splice(idx, 1);
    saveDb();
    return res.json({ ok: true });
  });

  // ==================================================
  // 5. VITE MIDDLEWARE / STATIC ASSETS & PWA VERSION
  // ==================================================

  app.get('/api/app-version', (_req: Request, res: Response) => {
    res.setHeader(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    try {
      const swPath = path.join(process.cwd(), 'public', 'sw.js');
      const pkgPath = path.join(process.cwd(), 'package.json');
      const indexHtmlPath = path.join(process.cwd(), 'index.html');
      const distIndexHtmlPath = path.join(process.cwd(), 'dist', 'index.html');

      const swContent = fs.existsSync(swPath)
        ? fs.readFileSync(swPath, 'utf-8')
        : '';
      const pkgContent = fs.existsSync(pkgPath)
        ? fs.readFileSync(pkgPath, 'utf-8')
        : '{}';
      const indexContent = fs.existsSync(indexHtmlPath)
        ? fs.readFileSync(indexHtmlPath, 'utf-8')
        : '';
      const distIndexContent = fs.existsSync(distIndexHtmlPath)
        ? fs.readFileSync(distIndexHtmlPath, 'utf-8')
        : '';

      let pkgVersion = '1.0.0';
      try {
        const parsedPkg = JSON.parse(pkgContent);
        if (parsedPkg && typeof parsedPkg.version === 'string' && parsedPkg.version !== '0.0.0') {
          pkgVersion = parsedPkg.version;
        }
      } catch {
        // Ignore
      }

      const swVerMatch = swContent.match(
        /SW_APP_VERSION\s*=\s*['"]([^'"]+)['"]/
      );
      const swVersion = swVerMatch ? swVerMatch[1] : pkgVersion;
      const appVersion = process.env.APP_VERSION || swVersion || pkgVersion;

      const buildHash = crypto
        .createHash('sha1')
        .update(`${appVersion}|${swContent}|${indexContent}|${distIndexContent}`)
        .digest('hex')
        .slice(0, 12);

      return res.json({
        version: appVersion,
        buildId: `${appVersion}-${buildHash}`,
      });
    } catch {
      return res.json({
        version: process.env.APP_VERSION || '1.0.0',
        buildId: process.env.APP_VERSION || '1.0.0',
      });
    }
  });

  app.get('/manifest.json', (_req, res) => {
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(process.cwd(), 'public', 'manifest.json'));
  });

  app.get('/sw.js', (_req, res) => {
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Service-Worker-Allowed', '/');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(process.cwd(), 'public', 'sw.js'));
  });

  if (process.env.NODE_ENV !== 'production') {
    let viteInstance: Awaited<ReturnType<typeof createViteServer>> | null = null;
    const viteReady = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    }).then(async (vite) => {
      viteInstance = vite;
      try {
        await Promise.all([
          vite.transformRequest('/src/index.css'),
          vite.transformRequest('/src/main.tsx'),
          vite.transformRequest('/src/App.tsx'),
        ]);
      } catch {
        // Ignore warmup warnings
      }
      return vite;
    });

    app.use(async (req, res, next) => {
      try {
        const vite = viteInstance || (await viteReady);
        return vite.middlewares(req, res, next);
      } catch (err) {
        return next(err);
      }
    });
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Mero Routine server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
