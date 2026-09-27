import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import {
  auth,
  db,
  googleProvider,
  syncRoutineToFirestore,
  removeRoutineFromFirestore,
  updateUserProfileInFirestore,
  sanitizeId,
  truncateStr,
} from './firebase';
import {
  UserProfile,
  Routine,
  RoutineLog,
  Goal,
  RoutineTemplate,
  ProUpgradeRequest,
  AdBanner,
  RoutineCategoryConfig,
  AppView,
  Language,
  ThemeMode,
  ReminderOffset,
  RepeatType,
  TemplateItem,
  BuiltInSoundId,
  NotificationSoundId,
} from './types';
import { t } from './i18n/translations';
import {
  playBuiltInSound,
  playReminderSound,
  stopActiveSound,
  setupGlobalAudioUnlock,
  unlockAudioContext,
} from './utils/soundUtils';
import { usePWAInstall, usePWAUpdate } from './utils/pwaUtils';
import {
  loadFiredReminderKeysFromLocalStorage,
  saveFiredReminderKeysToLocalStorage,
  syncFiredKeysWithIdb,
  markAlarmFiredEverywhere,
  syncAlarmsToPersistentStorage,
  showAlarmNotificationViaSwOrBrowser,
  dismissSwNotification,
  syncWebPushSubscription,
  createBackgroundAlarmWorker,
  postMessageToServiceWorker,
  buildReminderMessage,
  markAlarmAcknowledgedInUi,
  loadAcknowledgedUiAlarms,
} from './utils/alarmScheduler';
import {
  getLocalTodayDate,
  getUserTimezone,
  formatTime12h,
  timeToMinutes,
  minutesToTime24,
  getDaySummary,
  getEffectiveRoutineStatus,
  calculateRoutineStreaks,
  getNextReminderOccurrence,
  ScheduledReminderOccurrence,
} from './utils/dateUtils';
import { RoutineModal } from './components/RoutineModal';
import { AdSlot } from './components/AdSlot';
import { AdminPanelView } from './components/AdminPanelView';
import {
  PlannerView,
  ReportsView,
  HabitsStreaksView,
  GoalsView,
  AiRoutineBuilderView,
  RoutineTemplatesView,
  UpgradeProView,
} from './components/ProViews';
import {
  Bell,
  Menu,
  X,
  Plus,
  Check,
  Clock,
  SkipForward,
  Edit3,
  Trash2,
  Home,
  Calendar,
  BarChart2,
  User,
  Target,
  Flame,
  Sparkles,
  LayoutTemplate,
  Crown,
  Settings,
  Info,
  Shield,
  FileText,
  LogOut,
  ShieldCheck,
  Sun,
  Moon,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Upload,
  Download,
} from 'lucide-react';

const TOKEN_STORAGE_KEY = 'mero_routine_session_token';
const LANG_STORAGE_KEY = 'mero_routine_lang';
const THEME_STORAGE_KEY = 'mero_routine_theme';
const CACHED_USER_KEY = 'mero_routine_cached_user_v1';

function loadCachedUser(): UserProfile | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.uid === 'string') {
      return parsed as UserProfile;
    }
  } catch {
    // Ignore
  }
  return null;
}

function loadCachedRoutines(uid?: string): Routine[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`mero_routine_cached_routines_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCachedLogs(uid?: string): RoutineLog[] {
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(`mero_routine_cached_logs_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadCachedCustomSound(uid?: string): string {
  if (!uid) return '';
  try {
    return localStorage.getItem(`mero_routine_cached_sound_${uid}`) || '';
  } catch {
    return '';
  }
}

const VALID_VIEWS: AppView[] = [
  'home',
  'planner',
  'goals',
  'habits',
  'reports',
  'notifications',
  'ai-builder',
  'templates',
  'upgrade',
  'profile',
  'settings',
  'how-to-use',
  'about',
  'privacy',
  'terms',
  'contact',
  'admin',
];

export default function App() {
  // Language & Theme state
  const [lang, setLang] = useState<Language>(() => {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    return saved === 'ne' ? 'ne' : 'en';
  });
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'dark' ? 'dark' : 'light';
  });

  // Session & User Data (Immediately restore from local cache on startup so pending reminders work before network finishes)
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [user, setUser] = useState<UserProfile | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY) ? loadCachedUser() : null
  );
  const [bootstrapping, setBootstrapping] = useState<boolean>(
    () => !Boolean(localStorage.getItem(TOKEN_STORAGE_KEY) && loadCachedUser())
  );

  // Domain state (Immediately hydrated from persistent local storage for instant reminder restoration on app/device start)
  const [routines, setRoutines] = useState<Routine[]>(() => {
    const u = localStorage.getItem(TOKEN_STORAGE_KEY) ? loadCachedUser() : null;
    return loadCachedRoutines(u?.uid);
  });
  const [routineLogs, setRoutineLogs] = useState<RoutineLog[]>(() => {
    const u = localStorage.getItem(TOKEN_STORAGE_KEY) ? loadCachedUser() : null;
    return loadCachedLogs(u?.uid);
  });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [templates, setTemplates] = useState<RoutineTemplate[]>([]);
  const [proRequests, setProRequests] = useState<ProUpgradeRequest[]>([]);
  const [ads, setAds] = useState<AdBanner[]>([]);
  const [categories, setCategories] = useState<RoutineCategoryConfig[]>([]);

  // Navigation & UI state
  const [currentView, setCurrentView] = useState<AppView>(() => {
    const hash = window.location.hash.replace('#', '') as AppView;
    if (VALID_VIEWS.includes(hash)) return hash;
    const pathView = window.location.pathname.replace(
      /^\/+|\/+$/g,
      ''
    ) as AppView;
    if (VALID_VIEWS.includes(pathView)) return pathView;
    return 'home';
  });
  const [menuOpen, setMenuOpen] = useState(false);

  // Live clock
  const [now, setNow] = useState(() => new Date());
  const todayStr = useMemo(() => getLocalTodayDate(), [now]);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Add/Edit Routine Modal state
  const [routineModalOpen, setRoutineModalOpen] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [modalTargetDate, setModalTargetDate] = useState<string>(todayStr);

  // Active Reminder Notification state
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [activeReminderAlert, setActiveReminderAlert] = useState<{
    routine: Routine;
    message: string;
    triggeredAtStr: string;
    dedupeKey?: string;
  } | null>(null);
  const notifiedKeysRef = useRef<Set<string>>(
    loadFiredReminderKeysFromLocalStorage()
  );
  const [swReady, setSwReady] = useState<boolean>(false);
  const [pushSyncStatus, setPushSyncStatus] = useState<
    'push-active' | 'sw-local' | 'disabled'
  >('sw-local');
  const [testAlarmFeedback, setTestAlarmFeedback] = useState<string>('');

  // Auth form state
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirmPassword, setAuthConfirmPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);

  // Profile & Notification Sound state
  const [profileName, setProfileName] = useState(() => loadCachedUser()?.name || '');
  const [profileFeedback, setProfileFeedback] = useState('');
  const [customSoundDataUrl, setCustomSoundDataUrl] = useState<string>(() => {
    const u = localStorage.getItem(TOKEN_STORAGE_KEY) ? loadCachedUser() : null;
    return loadCachedCustomSound(u?.uid);
  });
  const [customSoundUploading, setCustomSoundUploading] = useState<boolean>(false);
  const [soundFeedback, setSoundFeedback] = useState<string>('');

  // PWA Install / Add to Home Screen & Future-Ready Update state
  const {
    canPromptNative,
    supportsNativeInstall,
    isInstalled: isPwaInstalled,
    isIOS: isIosDevice,
    triggerInstall: triggerPwaInstall,
  } = usePWAInstall();
  const {
    isUpdateAvailable: isPwaUpdateAvailable,
    isUpdating: isPwaUpdating,
    applyUpdate: handleApplyPwaUpdate,
  } = usePWAUpdate();
  const [installGuideOpen, setInstallGuideOpen] = useState(false);
  const [showInlineInstallSteps, setShowInlineInstallSteps] = useState(false);
  const [publicInfoModal, setPublicInfoModal] = useState<
    'how-to-use' | 'privacy' | 'terms' | 'about' | 'contact' | null
  >(null);

  const renderInfoSectionContent = (
    section: 'how-to-use' | 'privacy' | 'terms' | 'about' | 'contact'
  ) => {
    if (section === 'how-to-use') {
      return (
        <div className="space-y-3.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            {lang === 'ne'
              ? 'मेरो रुटिन प्रयोग गरेर आफ्नो दैनिक तालिका सजिलै व्यवस्थित गर्ने चरणहरू:'
              : 'Follow these simple steps to plan your day, get timely alarms, and track your habits in Mero Routine:'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                1. {lang === 'ne' ? 'दैनिक रुटिन थप्नुहोस्' : 'Add Your Daily Routines'}
              </p>
              <p>
                {lang === 'ne'
                  ? 'होम पेज वा योजनाकारमा "+ रुटिन थप्नुहोस्" थिचेर समय, आइकन र दोहोरिने बार छान्नुहोस्।'
                  : 'Tap "+ Add Routine" on Home or Planner to set your activity name, time, category icon, and repeat schedule.'}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                2. {lang === 'ne' ? 'सम्झना र अलार्म साउन्ड' : 'Set Reminders & Alarm Sound'}
              </p>
              <p>
                {lang === 'ne'
                  ? 'Notifications वा Settings मा गएर सूचना अनुमति सक्रिय गर्नुहोस् र मनपर्ने अलार्म साउन्ड छान्नुहोस्।'
                  : 'Enable notifications and choose or upload your preferred alarm sound in Notifications or Settings.'}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                3. {lang === 'ne' ? 'प्रगति र निरन्तरता ट्र्याक गर्नुहोस्' : 'Track Progress & Streaks'}
              </p>
              <p>
                {lang === 'ne'
                  ? 'काम पूरा भएपछि Done, १० मिनेट पछि सार्न Snooze वा छोड्न Skip थिच्नुहोस् र दैनिक प्रगति हेर्नुहोस्।'
                  : 'Mark activities as Done, Snooze 10m, or Skip throughout the day to build your completion rate and habit streaks.'}
              </p>
            </div>
            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
              <p className="font-semibold text-slate-900 dark:text-white">
                4. {lang === 'ne' ? 'मोबाइल वा कम्प्युटरमा इन्स्टल गर्नुहोस्' : 'Install as Standalone App'}
              </p>
              <p>
                {lang === 'ne'
                  ? '"Install App / Add to Home Screen" प्रयोग गरी बिना ब्राउजर एपको रूपमा चलाउनुहोस्।'
                  : 'Use "Install App / Add to Home Screen" in the menu or Settings for fast standalone access and reliable background reminders.'}
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (section === 'about') {
      return (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <div className="flex items-center gap-3 pb-1">
            <img
              src="/mero-routine-logo.svg"
              alt="Mero Routine"
              referrerPolicy="no-referrer"
              className="w-14 h-14 rounded-2xl object-contain shrink-0 select-none"
            />
            <div>
              <p className="font-bold text-slate-900 dark:text-white">
                Mero Routine (मेरो रुटिन)
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t(lang, 'tagline')} · {t(lang, 'poweredByRoila')}
              </p>
            </div>
          </div>
          <p>
            {lang === 'ne'
              ? 'मेरो रुटिन तपाईँको बिहानदेखि रातिसम्मको दैनिक तालिका व्यवस्थित गर्न, समयमै सम्झना पाउन र असल बानी निर्माण गर्न तयार गरिएको एप हो।'
              : 'Mero Routine helps you structure your daily activities from morning to night, receive timely reminders, track daily completion, and build lasting personal habits.'}
          </p>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1 text-xs">
            <p className="font-semibold text-slate-900 dark:text-white">
              {lang === 'ne'
                ? 'सम्पर्क तथा सहयोग (Contact & Support)'
                : 'Contact & Help Support'}
            </p>
            <p className="font-mono break-all">Email: roilaofficial571@gmail.com</p>
            <p className="font-mono">eSewa / Khalti / Contact: 9748711951</p>
          </div>
        </div>
      );
    }

    if (section === 'privacy') {
      return (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            {lang === 'ne'
              ? 'तपाईँको व्यक्तिगत रुटिन, लक्ष्य र प्रगति विवरण पूर्ण रूपमा गोप्य र सुरक्षित राखिन्छ। कुनै पनि प्रयोगकर्ताको डाटा अर्को प्रयोगकर्तालाई देखाइँदैन।'
              : 'Your routines, completion logs, goals, and personal profile are strictly isolated to your authenticated account. Private user data is never exposed to other users.'}
          </p>
          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
            <p className="font-semibold text-slate-900 dark:text-white">
              {lang === 'ne' ? 'डाटा सुरक्षा र भण्डारण' : 'Data Protection & Local Sync'}
            </p>
            <p>
              {lang === 'ne'
                ? 'तपाईँका सम्झना र समयतालिका तपाईँको खातामा सुरक्षित हुन्छन् र समयमै अलार्म बजाउन डिभाइसको स्थानीय स्टोरेजमा सिंक गरिन्छन्।'
                : 'Your schedules and preferences are securely stored for your account and cached locally on your device solely to deliver reliable offline access and timely local-timezone reminders.'}
            </p>
          </div>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all">
            Privacy & Support Contact: roilaofficial571@gmail.com
          </p>
        </div>
      );
    }

    if (section === 'terms') {
      return (
        <div className="space-y-3 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            {lang === 'ne'
              ? 'मेरो रुटिन V1 सेवाका सर्तहरू: निःशुल्क योजनामा आजको रुटिन र आधारभूत प्रगति उपलब्ध छ। प्रो योजना (Rs.99 / month वा Rs.999 / year) मा साप्ताहिक/मासिक योजनाकार, AI रुटिन र विस्तृत प्रतिवेदन उपलब्ध छ।'
              : 'Mero Routine V1 Terms & Conditions: The Free plan includes daily routine management, reminders, and basic progress tracking. The Pro subscription (Rs.99 / month or Rs.999 / year) unlocks weekly/monthly planning, AI routine generation, habit streaks, unlimited goals, and ad-free usage.'}
          </p>
          <p className="text-xs font-mono text-slate-500 dark:text-slate-400 break-all">
            Support & Billing Contact: roilaofficial571@gmail.com · eSewa/Khalti: 9748711951
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        <p>
          {lang === 'ne'
            ? 'मेरो रुटिन सम्बन्धी कुनै जिज्ञासा, प्राविधिक सहयोग वा प्रो खाता प्रमाणीकरणका लागि तलको माध्यमबाट सम्पर्क गर्नुहोस्:'
            : 'Need help with Mero Routine, technical support, feedback, or Pro membership verification? Reach out to our team directly:'}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <p className="font-semibold text-slate-900 dark:text-white">
              {lang === 'ne' ? 'इमेल सहयोग (Email Support)' : 'Email Support'}
            </p>
            <a
              href="mailto:roilaofficial571@gmail.com"
              className="font-mono text-teal-700 dark:text-teal-400 hover:underline break-all block"
            >
              roilaofficial571@gmail.com
            </a>
          </div>
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1">
            <p className="font-semibold text-slate-900 dark:text-white">
              {lang === 'ne' ? 'फोन / eSewa / Khalti' : 'Phone / WhatsApp / Billing'}
            </p>
            <a
              href="tel:9748711951"
              className="font-mono text-teal-700 dark:text-teal-400 hover:underline block"
            >
              9748711951
            </a>
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (canPromptNative || isPwaInstalled) {
      setShowInlineInstallSteps(false);
      setInstallGuideOpen(false);
    }
  }, [canPromptNative, isPwaInstalled]);

  const handleInstallAppClick = useCallback(async () => {
    const result = await triggerPwaInstall();
    if (result === 'accepted') {
      setMenuOpen(false);
      setShowInlineInstallSteps(false);
      setInstallGuideOpen(false);
    } else if (result === 'dismissed') {
      setMenuOpen(false);
      setShowInlineInstallSteps(false);
      setInstallGuideOpen(false);
    } else if (result === 'manual') {
      setMenuOpen(false);
      setShowInlineInstallSteps(true);
      setInstallGuideOpen(true);
    }
  }, [triggerPwaInstall]);

  const renderTopInstallPromptCard = () => {
    // State 1: Not installed -> show "Install Mero Routine" + "Install App"
    if (!isPwaInstalled) {
      const showManualInstructions =
        !supportsNativeInstall || isIosDevice || showInlineInstallSteps;

      return (
        <section
          aria-label="Install Mero Routine"
          className="w-full p-4 rounded-2xl border border-teal-200 dark:border-teal-800/80 bg-white dark:bg-slate-900 shadow-xs space-y-2.5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/mero-routine-logo.svg"
                alt="Mero Routine"
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-2xl object-contain shrink-0 select-none"
              />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {t(lang, 'installGuideTitle')}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-snug mt-0.5">
                  {t(lang, 'installPromptExplanation')}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleInstallAppClick}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 shadow-xs transition-colors"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span>{t(lang, 'installAppBtn')}</span>
            </button>
          </div>

          {showManualInstructions && !canPromptNative && (
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center justify-between gap-2">
              <span>
                {isIosDevice
                  ? t(lang, 'manualInstallIosHint')
                  : t(lang, 'manualInstallOtherHint')}
              </span>
              <button
                type="button"
                onClick={() => setInstallGuideOpen(true)}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline shrink-0"
              >
                {t(lang, 'addToHomeScreenBtn')}
              </button>
            </div>
          )}
        </section>
      );
    }

    // State 2: Installed + new version available -> show "New version available" + "Update Now"
    if (isPwaUpdateAvailable) {
      return (
        <section
          role="status"
          aria-live="polite"
          aria-label="New version available"
          className="w-full p-4 rounded-2xl border border-teal-200 dark:border-teal-800/80 bg-white dark:bg-slate-900 shadow-xs"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <img
                src="/mero-routine-logo.svg"
                alt="Mero Routine"
                referrerPolicy="no-referrer"
                className="w-11 h-11 rounded-2xl object-contain shrink-0 select-none"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-teal-600 dark:bg-teal-400 shrink-0" />
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {t(lang, 'pwaUpdateAvailableMsg')}
                  </h2>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleApplyPwaUpdate}
              disabled={isPwaUpdating}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 shadow-xs transition-colors disabled:opacity-60"
            >
              <span>{isPwaUpdating ? '...' : t(lang, 'pwaUpdateNowBtn')}</span>
            </button>
          </div>
        </section>
      );
    }

    // State 3: Installed + already latest version -> hide the card completely
    return null;
  };

  const renderInstallGuideModal = () => {
    if (!installGuideOpen) return null;
    return (
      <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 shadow-2xl space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <img
                src="/mero-routine-logo.svg"
                alt="Mero Routine"
                referrerPolicy="no-referrer"
                className="w-12 h-12 rounded-2xl object-contain shrink-0 select-none"
              />
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t(lang, 'installGuideTitle')}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mero Routine · Standalone App
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInstallGuideOpen(false)}
              className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white"
              aria-label="Close install guide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {t(lang, 'installGuideSubtitle')}
          </p>

          <div className="space-y-2.5 text-xs">
            {isIosDevice ? (
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <p className="font-semibold text-slate-900 dark:text-white">
                  iPhone / iPad (Safari)
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  1. Tap the <strong>Share</strong> button in the Safari toolbar.
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  3. Tap <strong>Add</strong> to launch Mero Routine as a full-screen app.
                </p>
              </div>
            ) : (
              <>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Android / Mobile Browser
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    1. Tap the browser menu (<strong>⋮</strong>) in the top corner.
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    2. Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                  </p>
                </div>
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Desktop (Chrome / Edge)
                  </p>
                  <p className="text-slate-600 dark:text-slate-300">
                    Click the <strong>Install Mero Routine</strong> icon in the address bar or browser menu to open in a standalone window.
                  </p>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setInstallGuideOpen(false)}
            className="w-full min-h-[42px] rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
          >
            {t(lang, 'cancel')}
          </button>
        </div>
      </div>
    );
  };

  // Apply dark mode class to html element
  useEffect(() => {
    const rootEl = document.documentElement;
    if (theme === 'dark') {
      rootEl.classList.add('dark');
    } else {
      rootEl.classList.remove('dark');
    }
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  }, [lang]);

  // Sync URL hash for deep-link / refresh persistence
  const navigateTo = useCallback((view: AppView) => {
    setCurrentView(view);
    window.location.hash = view;
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace('#', '') as AppView;
      if (VALID_VIEWS.includes(hash)) {
        setCurrentView(hash);
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Tick live clock every 5 seconds for accurate countdowns & status updates
  useEffect(() => {
    const syncNotifPerm = () => {
      if (typeof Notification !== 'undefined') {
        setNotifPermission(Notification.permission);
      }
    };
    const timer = setInterval(() => {
      setNow(new Date());
      syncNotifPerm();
    }, 5000);
    window.addEventListener('focus', syncNotifPerm);

    let permStatus: PermissionStatus | null = null;
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then((status) => {
          permStatus = status;
          status.onchange = () => syncNotifPerm();
        })
        .catch(() => {});
    }

    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', syncNotifPerm);
      if (permStatus) {
        permStatus.onchange = null;
      }
    };
  }, []);

  // Fetch user bootstrap data with automatic retry on transient connection hiccups
  const fetchBootstrapData = useCallback(async (sessionToken: string) => {
    const localToday = getLocalTodayDate();
    const url = `/api/bootstrap?clientToday=${encodeURIComponent(localToday)}`;
    let res: Response | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        break;
      } catch {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
    }

    try {
      if (!res) {
        return;
      }
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(CACHED_USER_KEY);
          setToken(null);
          setUser(null);
        }
        return;
      }
      const data = await res.json();
      const fetchedSound =
        typeof data.customSoundDataUrl === 'string'
          ? data.customSoundDataUrl
          : '';
      setCustomSoundDataUrl(fetchedSound);

      const savedLocalLang = localStorage.getItem(LANG_STORAGE_KEY);
      const effectiveLang: Language =
        savedLocalLang === 'en' || savedLocalLang === 'ne'
          ? savedLocalLang
          : data.user.language === 'ne'
          ? 'ne'
          : 'en';
      setLang(effectiveLang);

      const savedLocalTheme = localStorage.getItem(THEME_STORAGE_KEY);
      const effectiveTheme: ThemeMode =
        savedLocalTheme === 'dark' || savedLocalTheme === 'light'
          ? savedLocalTheme
          : data.user.theme === 'dark'
          ? 'dark'
          : 'light';
      setTheme(effectiveTheme);

      if (
        data.user.language !== effectiveLang ||
        data.user.theme !== effectiveTheme
      ) {
        fetch('/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            language: effectiveLang,
            theme: effectiveTheme,
          }),
        }).catch(() => {});
      }

      const syncedUser: UserProfile = {
        ...data.user,
        language: effectiveLang,
        theme: effectiveTheme,
      };
      setUser(syncedUser);
      setProfileName(syncedUser.name);

      const loadedRoutines: Routine[] = data.routines || [];
      const loadedLogs: RoutineLog[] = data.routineLogs || [];
      setRoutines(loadedRoutines);
      setRoutineLogs(loadedLogs);
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(syncedUser));
        localStorage.setItem(
          `mero_routine_cached_routines_${data.user.uid}`,
          JSON.stringify(loadedRoutines)
        );
        localStorage.setItem(
          `mero_routine_cached_logs_${data.user.uid}`,
          JSON.stringify(loadedLogs)
        );
        if (fetchedSound) {
          localStorage.setItem(
            `mero_routine_cached_sound_${data.user.uid}`,
            fetchedSound
          );
        } else {
          localStorage.removeItem(`mero_routine_cached_sound_${data.user.uid}`);
        }
      } catch {
        // Ignore storage quota errors
      }
      setGoals(data.goals || []);
      setTemplates(data.templates || []);
      setProRequests(data.proRequests || []);
      setAds(data.ads || []);
      setCategories(data.categories || []);
    } catch {
      // Ignore transient bootstrap parse errors
    } finally {
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    if (token) {
      fetchBootstrapData(token);
    } else {
      setAds([]);
      setCustomSoundDataUrl('');
      setBootstrapping(false);
    }
  }, [token, fetchBootstrapData]);

  useEffect(() => {
    if (!token) return;
    if (currentView === 'home') {
      fetchBootstrapData(token);
    }
    const onFocusRefresh = () => {
      if (document.visibilityState === 'visible') {
        fetchBootstrapData(token);
      }
    };
    window.addEventListener('focus', onFocusRefresh);
    document.addEventListener('visibilitychange', onFocusRefresh);
    return () => {
      window.removeEventListener('focus', onFocusRefresh);
      document.removeEventListener('visibilitychange', onFocusRefresh);
    };
  }, [token, currentView, fetchBootstrapData]);

  // Unlock Web Audio on first user interaction so background alarm chimes can play
  useEffect(() => {
    setupGlobalAudioUnlock();
    syncFiredKeysWithIdb(notifiedKeysRef.current).catch(() => {});
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then(() => setSwReady(true))
        .catch(() => {});
    }
  }, []);

  const playSelectedReminderSound = useCallback(
    (options?: { loop?: boolean; maxDurationMs?: number }) => {
      const activeSound: NotificationSoundId =
        user?.notificationSound || user?.defaultNotificationSound || 'default_1';
      const fallbackDefault: BuiltInSoundId =
        user?.defaultNotificationSound || 'default_1';
      playReminderSound({
        soundId: activeSound,
        defaultSoundId: fallbackDefault,
        customSoundDataUrl,
        loop: options?.loop ?? false,
        maxDurationMs: options?.maxDurationMs ?? 25000,
      });
    },
    [user?.notificationSound, user?.defaultNotificationSound, customSoundDataUrl]
  );

  // Trigger a reminder notification (Service Worker / Browser Notification + Looping Alarm Sound + In-App Alarm Modal)
  const triggerRoutineReminder = useCallback(
    (occ: ScheduledReminderOccurrence, skipOsNotification: boolean = false) => {
      if (notifiedKeysRef.current.has(occ.dedupeKey)) return;
      notifiedKeysRef.current.add(occ.dedupeKey);
      markAlarmFiredEverywhere(
        occ.dedupeKey,
        notifiedKeysRef.current,
        token
      ).catch(() => {});

      const rt = occ.routine;
      const { title, body, formattedTriggerTime } = buildReminderMessage(
        occ,
        lang
      );

      setActiveReminderAlert({
        routine: rt,
        message: body,
        triggeredAtStr: formattedTriggerTime,
        dedupeKey: occ.dedupeKey,
      });
      playSelectedReminderSound({ loop: true, maxDurationMs: 25000 });
      setNow(new Date());

      if (!skipOsNotification) {
        showAlarmNotificationViaSwOrBrowser({
          title,
          body,
          dedupeKey: occ.dedupeKey,
          routineId: rt.id,
          dateStr: occ.dateStr,
          routineTitle: rt.title,
          routineTime: rt.time,
          routineIcon: rt.icon,
          renotify: false,
        }).catch(() => {});
      }
    },
    [lang, playSelectedReminderSound, token]
  );

  // Sync persistent schedule to IndexedDB + Service Worker + Web Push whenever routines, logs, or settings change
  useEffect(() => {
    if (!user) return;
    syncAlarmsToPersistentStorage({
      routines,
      routineLogs,
      firedKeys: notifiedKeysRef.current,
      user,
      lang,
      token,
    }).catch(() => {});

    syncWebPushSubscription({
      token,
      notificationsEnabled: Boolean(user.notificationsEnabled),
      lang,
      firedKeys: notifiedKeysRef.current,
    })
      .then((status) => setPushSyncStatus(status))
      .catch(() => {});
  }, [
    user,
    routines,
    routineLogs,
    lang,
    token,
    notifPermission,
  ]);

  // Handle opening the app from a closed-app Service Worker notification URL (?alarmRoutineId=...)
  useEffect(() => {
    if (!user || routines.length === 0) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const alarmRoutineId = params.get('alarmRoutineId');
      const alarmKey = params.get('alarmKey') || '';
      if (alarmRoutineId) {
        const cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
        const foundRt = routines.find((r) => r.id === alarmRoutineId);
        if (foundRt) {
          if (alarmKey) {
            notifiedKeysRef.current.add(alarmKey);
            saveFiredReminderKeysToLocalStorage(notifiedKeysRef.current);
          }
          const formattedTime = formatTime12h(foundRt.time, lang);
          const msg =
            lang === 'ne'
              ? `🔔 ${foundRt.title} — समय: ${formattedTime}। कार्य सुरु गर्ने समय भयो!`
              : `It’s ${formattedTime}. Time for ${foundRt.title}!`;
          setActiveReminderAlert({
            routine: foundRt,
            message: msg,
            triggeredAtStr: formattedTime,
            dedupeKey: alarmKey || undefined,
          });
          playSelectedReminderSound({ loop: true, maxDurationMs: 25000 });
        }
      }
    } catch {
      // Ignore URL parse errors
    }
  }, [user, routines, lang, playSelectedReminderSound]);

  // Listen for Service Worker alarm events (when SW or Web Push fires an alarm in background, or user clicks notification actions)
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (
        (data.type === 'SW_ALARM_FIRED' ||
          data.type === 'SW_NOTIFICATION_CLICKED') &&
        data.alarm
      ) {
        const alarm = data.alarm;
        const dedupeKey = String(alarm.dedupeKey || '');
        if (dedupeKey && !alarm.isTest) {
          notifiedKeysRef.current.add(dedupeKey);
          saveFiredReminderKeysToLocalStorage(notifiedKeysRef.current);
        }

        const matchedRoutine =
          routines.find((r) => r.id === alarm.routineId) ||
          ({
            id: alarm.routineId || 'sample',
            userId: user?.uid || '',
            title: alarm.routineTitle || 'Routine Reminder',
            time: alarm.routineTime || '06:00',
            category: 'General',
            icon: alarm.routineIcon || '🔔',
            reminderOffset: 0,
            duration: 30,
            repeatType: 'today',
            customDays: [],
            targetDate: alarm.dateStr || todayStr,
            notes: '',
            createdAt: '',
            updatedAt: '',
          } as Routine);

        setActiveReminderAlert({
          routine: matchedRoutine,
          message:
            alarm.body ||
            `It's ${formatTime12h(matchedRoutine.time, lang)}. Time for ${
              matchedRoutine.title
            }!`,
          triggeredAtStr: formatTime12h(matchedRoutine.time, lang),
          dedupeKey: dedupeKey || undefined,
        });
        playSelectedReminderSound({ loop: true, maxDurationMs: 25000 });
        setNow(new Date());
      }

      if (data.type === 'SW_NOTIFICATION_ACTION' && data.alarm) {
        const alarm = data.alarm;
        const action = data.action === 'snooze' ? 'snoozed' : 'done';
        stopActiveSound();
        if (alarm.dedupeKey) {
          markAlarmAcknowledgedInUi(alarm.dedupeKey);
        }
        setActiveReminderAlert(null);
        if (
          alarm.routineId &&
          alarm.routineId !== 'sample' &&
          alarm.routineId !== 'test_alarm'
        ) {
          if (token) {
            fetchBootstrapData(token);
          }
          setRoutineLogs((prev) => {
            const targetDateStr = alarm.dateStr || todayStr;
            const filtered = prev.filter(
              (l) =>
                !(l.routineId === alarm.routineId && l.date === targetDateStr)
            );
            return [
              ...filtered,
              {
                id: `log_sw_${Date.now()}`,
                userId: user?.uid || '',
                routineId: alarm.routineId,
                date: targetDateStr,
                status: action,
                snoozedUntil:
                  action === 'snoozed'
                    ? minutesToTime24(currentMinutes + 10)
                    : '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ];
          });
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleSwMessage);
    };
  }, [
    routines,
    user?.uid,
    todayStr,
    lang,
    playSelectedReminderSound,
    token,
    fetchBootstrapData,
    currentMinutes,
  ]);

  // Precision Local Timezone Reminder Scheduler (Unthrottled Web Worker + exact setTimeout + visibility/focus/pageshow wakeup restoration)
  useEffect(() => {
    if (!user || !user.notificationsEnabled || routines.length === 0) return;

    let nextTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let isDisposed = false;

    const evaluateAndScheduleReminders = async () => {
      if (isDisposed) return;
      if (nextTimeoutId) {
        clearTimeout(nextTimeoutId);
        nextTimeoutId = null;
      }

      // First merge any keys fired by the Service Worker in IndexedDB to prevent duplicate notifications
      await syncFiredKeysWithIdb(notifiedKeysRef.current);
      if (isDisposed) return;

      const nowDt = new Date();
      const nowMs = nowDt.getTime();
      let earliestFutureMs = Infinity;
      let earliestFutureOcc: ScheduledReminderOccurrence | null = null;

      for (const rt of routines) {
        const occ = getNextReminderOccurrence(
          rt,
          routineLogs,
          notifiedKeysRef.current,
          nowDt
        );
        if (!occ) continue;

        const triggerMs = occ.triggerDate.getTime();
        // If trigger time has arrived (within the valid trigger / 30-min startup restoration window), fire immediately!
        if (triggerMs <= nowMs && nowMs - triggerMs <= 30 * 60 * 1000) {
          triggerRoutineReminder(occ, false);
          // Re-calculate next occurrence for repeating routines after firing
          const nextOcc = getNextReminderOccurrence(
            rt,
            routineLogs,
            notifiedKeysRef.current,
            new Date(nowMs + 1000)
          );
          if (nextOcc && nextOcc.triggerDate.getTime() > nowMs) {
            if (nextOcc.triggerDate.getTime() < earliestFutureMs) {
              earliestFutureMs = nextOcc.triggerDate.getTime();
              earliestFutureOcc = nextOcc;
            }
          }
        } else if (triggerMs > nowMs) {
          if (triggerMs < earliestFutureMs) {
            earliestFutureMs = triggerMs;
            earliestFutureOcc = occ;
          }
        }
      }

      // Schedule an exact timeout for the nearest upcoming reminder
      if (earliestFutureOcc && earliestFutureMs < Infinity && !isDisposed) {
        const delayMs = Math.min(
          2147483647,
          Math.max(100, earliestFutureMs - Date.now() + 50)
        );
        nextTimeoutId = setTimeout(() => {
          evaluateAndScheduleReminders();
        }, delayMs);
      }
    };

    evaluateAndScheduleReminders();

    // Dedicated background Web Worker ticks every 1s without main-thread tab throttling
    const workerHandle = createBackgroundAlarmWorker(() => {
      evaluateAndScheduleReminders();
    });

    const onVisibilityOrWakeup = () => {
      if (document.visibilityState === 'visible') {
        postMessageToServiceWorker({ type: 'CHECK_ALARMS_NOW' });
        evaluateAndScheduleReminders();
      }
    };
    window.addEventListener('focus', onVisibilityOrWakeup);
    window.addEventListener('pageshow', onVisibilityOrWakeup);
    window.addEventListener('online', onVisibilityOrWakeup);
    document.addEventListener('visibilitychange', onVisibilityOrWakeup);

    return () => {
      isDisposed = true;
      if (nextTimeoutId) clearTimeout(nextTimeoutId);
      workerHandle.terminate();
      window.removeEventListener('focus', onVisibilityOrWakeup);
      window.removeEventListener('pageshow', onVisibilityOrWakeup);
      window.removeEventListener('online', onVisibilityOrWakeup);
      document.removeEventListener('visibilitychange', onVisibilityOrWakeup);
    };
  }, [user, routines, routineLogs, triggerRoutineReminder]);

  // ==================================================
  // AUTH HANDLERS
  // ==================================================

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');

    if (authMode === 'register') {
      if (authPassword.length < 6) {
        setAuthError(t(lang, 'authErrorPasswordLength'));
        return;
      }
      if (authPassword !== authConfirmPassword) {
        setAuthError(t(lang, 'authErrorPasswordMatch'));
        return;
      }
    }

    setAuthSubmitting(true);
    try {
      const endpoint =
        authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authName.trim(),
          email: authEmail.trim(),
          password: authPassword,
          language: lang,
          theme,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'DUPLICATE_ACCOUNT') {
          setAuthError(t(lang, 'authErrorDuplicate'));
        } else if (data.error === 'ACCOUNT_SUSPENDED') {
          setAuthError(t(lang, 'authErrorSuspended'));
        } else {
          setAuthError(t(lang, 'authErrorInvalid'));
        }
        return;
      }

      setCustomSoundDataUrl('');
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
      } catch {
        // Ignore
      }
      setToken(data.token);
      setUser(data.user);
      setProfileName(data.user?.name || '');
      setAuthPassword('');
      setAuthConfirmPassword('');
      if (data.user?.role === 'admin' && window.location.hash === '#admin') {
        navigateTo('admin');
      }
    } catch {
      setAuthError(t(lang, 'authErrorInvalid'));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleQuickDemoLogin = async (tier: 'free' | 'pro') => {
    setAuthError('');
    setAuthSubmitting(true);
    try {
      const res = await fetch('/api/auth/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, language: lang, theme }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Demo login failed');
        return;
      }
      setCustomSoundDataUrl('');
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
      } catch {
        // Ignore
      }
      setToken(data.token);
      setUser(data.user);
      setProfileName(data.user?.name || '');
      navigateTo('home');
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const fbUser = cred.user;

      // Sync to Firestore /users/{uid} if verified
      if (fbUser.emailVerified && fbUser.email) {
        const safeUid = sanitizeId(fbUser.uid);
        const isAuthAdmin =
          fbUser.email === 'tech4u571@gmail.com' ||
          fbUser.email === 'til.prasad571@gmail.com';
        try {
          const userRef = doc(db, 'users', safeUid);
          const existingSnap = await getDoc(userRef);
          if (existingSnap.exists()) {
            await updateDoc(userRef, {
              name: truncateStr(fbUser.displayName || fbUser.email.split('@')[0], 100),
              language: lang,
              theme,
              notificationsEnabled: true,
              updatedAt: serverTimestamp(),
            });
          } else {
            await setDoc(userRef, {
              uid: safeUid,
              name: truncateStr(fbUser.displayName || fbUser.email.split('@')[0], 100),
              email: truncateStr(fbUser.email, 150),
              role: isAuthAdmin ? 'admin' : 'user',
              status: 'active',
              isPro: isAuthAdmin,
              proExpiry: '',
              language: lang,
              theme,
              notificationsEnabled: true,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch {
          // Ignore if profile sync is skipped
        }
      }

      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: fbUser.uid,
          email: fbUser.email,
          name: fbUser.displayName || fbUser.email?.split('@')[0],
          language: lang,
          theme,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'Google sign-in failed');
        return;
      }
      localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
      } catch {
        // Ignore
      }
      setToken(data.token);
      setUser(data.user);
      setProfileName(data.user?.name || '');
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        setAuthError(
          lang === 'ne'
            ? 'Google साइन-इन रद्द भयो वा इमेल/पासवर्ड प्रयोग गर्नुहोस्।'
            : 'Google Sign-In popup closed. You can also sign in with Email & Password.'
        );
      }
    }
  };

  const handleLogout = async () => {
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    try {
      await auth.signOut();
    } catch {
      // Ignore
    }
    stopActiveSound();
    setActiveReminderAlert(null);
    syncAlarmsToPersistentStorage({
      routines: [],
      routineLogs: [],
      firedKeys: notifiedKeysRef.current,
      user: null,
      lang,
      token: null,
    }).catch(() => {});
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(CACHED_USER_KEY);
    setToken(null);
    setUser(null);
    setProfileName('');
    setRoutines([]);
    setRoutineLogs([]);
    setGoals([]);
    setTemplates([]);
    setProRequests([]);
    setAds([]);
    setCustomSoundDataUrl('');
    setMenuOpen(false);
    navigateTo('home');
  };

  // ==================================================
  // ROUTINE & STATUS MUTATIONS
  // ==================================================

  const handleSaveRoutine = async (payload: {
    id?: string;
    title: string;
    time: string;
    category: string;
    icon: string;
    reminderOffset: ReminderOffset;
    duration: number;
    repeatType: RepeatType;
    customDays: number[];
    targetDate: string;
    clientToday?: string;
    timezone?: string;
    notes: string;
  }) => {
    if (!token || !user) return;
    const isEdit = Boolean(payload.id);
    const url = isEdit ? `/api/routines/${payload.id}` : '/api/routines';
    const method = isEdit ? 'PUT' : 'POST';

    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...payload,
        clientToday: payload.clientToday || todayStr,
        timezone: payload.timezone || getUserTimezone(),
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      if (data.error === 'PRO_REQUIRED_FUTURE_PLANNING') {
        navigateTo('upgrade');
      }
      throw new Error(data.error || 'Failed to save routine');
    }

    const savedRoutine: Routine = data.routine;
    setRoutines((prev) => {
      const filtered = prev.filter((r) => r.id !== savedRoutine.id);
      const updated = [...filtered, savedRoutine].sort((a, b) =>
        a.time.localeCompare(b.time)
      );
      try {
        localStorage.setItem(
          `mero_routine_cached_routines_${user.uid}`,
          JSON.stringify(updated)
        );
      } catch {
        // Ignore
      }
      return updated;
    });

    if (isEdit) {
      setRoutineLogs((prev) => {
        const nextLogs = prev.filter(
          (l) =>
            !(
              l.routineId === savedRoutine.id &&
              l.date >= todayStr &&
              (l.status === 'snoozed' || l.status === 'missed')
            )
        );
        try {
          localStorage.setItem(
            `mero_routine_cached_logs_${user.uid}`,
            JSON.stringify(nextLogs)
          );
        } catch {
          // Ignore
        }
        return nextLogs;
      });
    }

    // Ensure user notifications are enabled when they save a routine
    if (!user.notificationsEnabled) {
      handleUpdatePreferences({ notificationsEnabled: true });
    }

    // Mirror to Firestore if signed in via Firebase
    syncRoutineToFirestore(savedRoutine).catch(() => {});
  };

  const handleDeleteRoutine = async (routineId: string) => {
    if (!token) return;
    const res = await fetch(`/api/routines/${routineId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      setRoutines((prev) => {
        const updated = prev.filter((r) => r.id !== routineId);
        if (user?.uid) {
          try {
            localStorage.setItem(
              `mero_routine_cached_routines_${user.uid}`,
              JSON.stringify(updated)
            );
          } catch {
            // Ignore
          }
        }
        return updated;
      });
      setRoutineLogs((prev) => {
        const updatedLogs = prev.filter((l) => l.routineId !== routineId);
        if (user?.uid) {
          try {
            localStorage.setItem(
              `mero_routine_cached_logs_${user.uid}`,
              JSON.stringify(updatedLogs)
            );
          } catch {
            // Ignore
          }
        }
        return updatedLogs;
      });
      dismissSwNotification(routineId);
      if (
        activeReminderAlert &&
        activeReminderAlert.routine.id === routineId
      ) {
        stopActiveSound();
        setActiveReminderAlert(null);
      }
      removeRoutineFromFirestore(routineId, user?.uid).catch(() => {});
    }
  };

  const handleStatusChange = async (
    routineId: string,
    dateStr: string,
    status: 'done' | 'skipped' | 'snoozed',
    snoozedUntil?: string
  ) => {
    if (
      routineId === 'test_alarm' ||
      routineId === 'sample' ||
      (activeReminderAlert &&
        activeReminderAlert.routine.id === routineId &&
        activeReminderAlert.dedupeKey?.includes('test_alarm'))
    ) {
      if (activeReminderAlert?.dedupeKey) {
        markAlarmAcknowledgedInUi(activeReminderAlert.dedupeKey);
        dismissSwNotification(activeReminderAlert.dedupeKey);
      }
      dismissSwNotification(routineId);
      stopActiveSound();
      setActiveReminderAlert(null);
      return;
    }
    if (!token) return;
    const computedSnooze =
      status === 'snoozed'
        ? snoozedUntil || minutesToTime24(currentMinutes + 10)
        : '';

    const res = await fetch('/api/routine-logs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        routineId,
        date: dateStr,
        status,
        snoozedUntil: computedSnooze,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      const updatedLog: RoutineLog = data.log;
      setRoutineLogs((prev) => {
        const withoutOld = prev.filter(
          (l) => !(l.routineId === routineId && l.date === dateStr)
        );
        const nextLogs = [...withoutOld, updatedLog];
        if (user?.uid) {
          try {
            localStorage.setItem(
              `mero_routine_cached_logs_${user.uid}`,
              JSON.stringify(nextLogs)
            );
          } catch {
            // Ignore
          }
        }
        return nextLogs;
      });
      dismissSwNotification(routineId);
      if (
        activeReminderAlert &&
        activeReminderAlert.routine.id === routineId
      ) {
        if (activeReminderAlert.dedupeKey) {
          markAlarmAcknowledgedInUi(activeReminderAlert.dedupeKey);
          dismissSwNotification(activeReminderAlert.dedupeKey);
        }
        stopActiveSound();
        setActiveReminderAlert(null);
      }
    }
  };

  const handleBatchApplyRoutines = async (
    items: TemplateItem[],
    mode: 'merge' | 'replace'
  ) => {
    if (!token) return;
    const res = await fetch('/api/routines/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ items, mode, targetDate: todayStr }),
    });
    if (res.ok) {
      const data = await res.json();
      const nextRoutines: Routine[] = data.routines || [];
      setRoutines(nextRoutines);
      if (mode === 'replace') {
        setRoutineLogs([]);
      }
      if (user?.uid) {
        try {
          localStorage.setItem(
            `mero_routine_cached_routines_${user.uid}`,
            JSON.stringify(nextRoutines)
          );
          if (mode === 'replace') {
            localStorage.setItem(
              `mero_routine_cached_logs_${user.uid}`,
              JSON.stringify([])
            );
          }
        } catch {
          // Ignore
        }
      }
      if (user && !user.notificationsEnabled) {
        handleUpdatePreferences({ notificationsEnabled: true });
      }
      navigateTo('home');
    }
  };

  const handleLoadSampleSchedule = async () => {
    const sampleItems: TemplateItem[] = [
      { title: 'Wake Up', time: '05:00', category: 'Morning', icon: '🌅', duration: 15, reminderOffset: 5, repeatType: 'everyday', notes: 'Start day fresh' },
      { title: 'Fresh Up', time: '05:15', category: 'Health', icon: '🚿', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Morning hygiene' },
      { title: 'Go to Gym', time: '06:00', category: 'Fitness', icon: '🏋️', duration: 60, reminderOffset: 10, repeatType: 'everyday', notes: 'Morning workout' },
      { title: 'Return Home', time: '07:00', category: 'Home', icon: '🏠', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Cool down' },
      { title: 'Breakfast', time: '07:30', category: 'Nutrition', icon: '🍳', duration: 30, reminderOffset: 5, repeatType: 'everyday', notes: 'Healthy breakfast' },
      { title: 'Work', time: '08:00', category: 'Work', icon: '💼', duration: 300, reminderOffset: 10, repeatType: 'everyday', notes: 'Focus tasks' },
      { title: 'Lunch', time: '13:00', category: 'Nutrition', icon: '🍛', duration: 45, reminderOffset: 5, repeatType: 'everyday', notes: 'Midday meal' },
      { title: 'Finish Work', time: '17:00', category: 'Home', icon: '🏠', duration: 60, reminderOffset: 10, repeatType: 'everyday', notes: 'Wrap up work' },
      { title: 'Study', time: '18:00', category: 'Study', icon: '📚', duration: 90, reminderOffset: 10, repeatType: 'everyday', notes: 'Evening study' },
      { title: 'Dinner', time: '20:00', category: 'Nutrition', icon: '🍽️', duration: 45, reminderOffset: 5, repeatType: 'everyday', notes: 'Light dinner' },
      { title: 'Sleep', time: '22:00', category: 'Rest', icon: '😴', duration: 420, reminderOffset: 15, repeatType: 'everyday', notes: 'Restful sleep' },
    ];
    await handleBatchApplyRoutines(sampleItems, 'replace');
  };

  // Profile & Preferences Save
  const handleUpdatePreferences = async (
    updates: Partial<{
      name: string;
      language: Language;
      theme: ThemeMode;
      notificationsEnabled: boolean;
      notificationSound: NotificationSoundId;
      defaultNotificationSound: BuiltInSoundId;
    }>
  ) => {
    if (updates.language) {
      setLang(updates.language);
      localStorage.setItem(LANG_STORAGE_KEY, updates.language);
    }
    if (updates.theme) {
      setTheme(updates.theme);
      localStorage.setItem(THEME_STORAGE_KEY, updates.theme);
    }
    if (!token || !user) return;

    const merged = {
      name: updates.name ?? user.name,
      language: updates.language ?? lang,
      theme: updates.theme ?? theme,
      notificationsEnabled:
        updates.notificationsEnabled ?? user.notificationsEnabled,
      notificationSound:
        updates.notificationSound ?? user.notificationSound ?? 'default_1',
      defaultNotificationSound:
        updates.defaultNotificationSound ??
        user.defaultNotificationSound ??
        'default_1',
    };

    const optimisticUser: UserProfile = {
      ...user,
      ...merged,
    };
    setUser(optimisticUser);
    try {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(optimisticUser));
    } catch {
      // Ignore
    }

    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(merged),
    });
    if (res.ok) {
      const data = await res.json();
      setUser(data.user);
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
      } catch {
        // Ignore
      }
      setProfileFeedback(t(merged.language, 'profileSavedMsg'));
      setTimeout(() => setProfileFeedback(''), 2500);
      updateUserProfileInFirestore(user.uid, {
        name: merged.name,
        language: merged.language,
        theme: merged.theme,
        notificationsEnabled: merged.notificationsEnabled,
      }).catch(() => {});
    }
  };

  const handleUploadCustomSoundFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !token || !user) return;

    if (file.size > 10 * 1024 * 1024) {
      setSoundFeedback(
        lang === 'ne'
          ? 'अडियो फाइल १० MB भन्दा सानो हुनुपर्छ।'
          : 'Please select an audio file smaller than 10 MB.'
      );
      setTimeout(() => setSoundFeedback(''), 3500);
      return;
    }

    setCustomSoundUploading(true);
    setSoundFeedback('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read audio file'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/profile/custom-sound', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          fileName: file.name,
          dataUrl,
          selectImmediately: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSoundFeedback(
          data.error ||
            (lang === 'ne'
              ? 'अडियो फाइल अपलोड गर्न सकिएन।'
              : 'Could not upload audio file.')
        );
        setTimeout(() => setSoundFeedback(''), 3500);
        return;
      }

      setUser(data.user);
      if (data.customSound?.dataUrl) {
        setCustomSoundDataUrl(data.customSound.dataUrl);
      }
      try {
        localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
        if (data.customSound?.dataUrl && data.user?.uid) {
          localStorage.setItem(
            `mero_routine_cached_sound_${data.user.uid}`,
            data.customSound.dataUrl
          );
        }
      } catch {
        // Ignore storage quota errors
      }
      setSoundFeedback(t(lang, 'customSoundSavedMsg'));
      setTimeout(() => setSoundFeedback(''), 3000);
    } catch {
      setSoundFeedback(
        lang === 'ne'
          ? 'अडियो फाइल पढ्न सकिएन।'
          : 'Failed to load selected audio file.'
      );
      setTimeout(() => setSoundFeedback(''), 3500);
    } finally {
      setCustomSoundUploading(false);
    }
  };

  const handleRemoveCustomSound = async () => {
    if (!token || !user) return;
    stopActiveSound();
    try {
      const res = await fetch('/api/profile/custom-sound', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setCustomSoundDataUrl('');
        try {
          localStorage.setItem(CACHED_USER_KEY, JSON.stringify(data.user));
          localStorage.removeItem(`mero_routine_cached_sound_${user.uid}`);
        } catch {
          // Ignore
        }
        setSoundFeedback(t(lang, 'customSoundRemovedMsg'));
        setTimeout(() => setSoundFeedback(''), 3000);
      }
    } catch {
      // Ignore
    }
  };

  const handleRequestNotificationPermission = async () => {
    unlockAudioContext();
    if (typeof Notification === 'undefined') {
      if (isIosDevice && !isPwaInstalled) {
        setInstallGuideOpen(true);
      }
      return;
    }
    try {
      const result = await Notification.requestPermission();
      setNotifPermission(result);
      if (result === 'granted' && user) {
        if (!user.notificationsEnabled) {
          handleUpdatePreferences({ notificationsEnabled: true });
        }
        syncWebPushSubscription({
          token,
          notificationsEnabled: true,
          lang,
          firedKeys: notifiedKeysRef.current,
        })
          .then((status) => setPushSyncStatus(status))
          .catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

  const handleTriggerTestAlarm = useCallback(async () => {
    unlockAudioContext();
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      try {
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
      } catch {
        // Ignore
      }
    }

    const sample: Routine =
      routines[0] ||
      ({
        id: 'test_alarm',
        userId: user?.uid || '',
        title: 'Go to Gym',
        time: '06:00',
        category: 'Fitness',
        icon: '🏋️',
        reminderOffset: 0,
        duration: 30,
        repeatType: 'everyday',
        customDays: [0, 1, 2, 3, 4, 5, 6],
        targetDate: todayStr,
        notes: '',
        createdAt: '',
        updatedAt: '',
      } as Routine);

    const formattedNow = formatTime12h(
      minutesToTime24(new Date().getHours() * 60 + new Date().getMinutes()),
      lang
    );
    const testMsg =
      lang === 'ne'
        ? `🔔 ${sample.title} — यो परीक्षण अलार्म हो (${formatTime12h(
            sample.time,
            lang
          )})। तपाईँको रोजेको अलार्म साउन्ड र सूचना सक्रिय छ!`
        : `Test Alarm: It’s ${formatTime12h(sample.time, lang)} — time for ${
            sample.title
          }! Your selected alarm sound and notifications are working.`;
    const testDedupeKey = `test_alarm_${Date.now()}`;

    setActiveReminderAlert({
      routine: sample,
      message: testMsg,
      triggeredAtStr: formattedNow,
      dedupeKey: testDedupeKey,
    });
    playSelectedReminderSound({ loop: true, maxDurationMs: 20000 });

    await showAlarmNotificationViaSwOrBrowser({
      title: `🔔 ${sample.title} — Test Alarm`,
      body: testMsg,
      dedupeKey: testDedupeKey,
      routineId: sample.id,
      dateStr: todayStr,
      routineTitle: sample.title,
      routineTime: sample.time,
      routineIcon: sample.icon,
      renotify: true,
    });
  }, [
    routines,
    user?.uid,
    todayStr,
    lang,
    playSelectedReminderSound,
  ]);

  const handleTriggerBackgroundTestAlarm = useCallback(async () => {
    unlockAudioContext();
    if (
      typeof Notification !== 'undefined' &&
      Notification.permission === 'default'
    ) {
      try {
        const perm = await Notification.requestPermission();
        setNotifPermission(perm);
      } catch {
        // Ignore
      }
    }

    const sample: Routine =
      routines[0] ||
      ({
        id: 'test_alarm',
        userId: user?.uid || '',
        title: 'Go to Gym',
        time: '06:00',
        category: 'Fitness',
        icon: '🏋️',
        reminderOffset: 0,
        duration: 30,
        repeatType: 'everyday',
        customDays: [0, 1, 2, 3, 4, 5, 6],
        targetDate: todayStr,
        notes: '',
        createdAt: '',
        updatedAt: '',
      } as Routine);

    const testMsg =
      lang === 'ne'
        ? `🔔 ${sample.title} — ब्याकग्राउन्ड परीक्षण अलार्म सफल भयो!`
        : `Background Test Alarm: ${sample.title} (${formatTime12h(
            sample.time,
            lang
          )}) triggered while in background!`;
    const testDedupeKey = `bg_test_alarm_${Date.now()}`;

    setTestAlarmFeedback(t(lang, 'testBgAlarmScheduledMsg'));
    setTimeout(() => setTestAlarmFeedback(''), 6500);

    // 1. Schedule in Service Worker via waitUntil keep-alive
    postMessageToServiceWorker({
      type: 'SCHEDULE_DELAYED_ALARM',
      delayMs: 5000,
      isTest: true,
      alarm: {
        dedupeKey: testDedupeKey,
        routineId: sample.id,
        dateStr: todayStr,
        routineTitle: sample.title,
        routineTime: sample.time,
        routineIcon: sample.icon,
        title: `🔔 ${sample.title} — Background Test Alarm`,
        body: testMsg,
        soundId:
          user?.notificationSound ||
          user?.defaultNotificationSound ||
          'default_1',
        defaultSoundId: user?.defaultNotificationSound || 'default_1',
        isTest: true,
      },
    });

    // 2. Also schedule via Server Web Push (for closed-tab / OS wake-up)
    if (token) {
      fetch('/api/push/test-alarm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          delayMs: 5000,
          dedupeKey: testDedupeKey,
          routineTitle: sample.title,
          routineTime: sample.time,
          routineIcon: sample.icon,
          title: `🔔 ${sample.title} — Background Test Alarm`,
          body: testMsg,
        }),
      }).catch(() => {});
    }

    // 3. Fallback local timeout if SW isn't controlling the page yet
    setTimeout(() => {
      setActiveReminderAlert((prev) => {
        if (prev && prev.dedupeKey === testDedupeKey) return prev;
        playSelectedReminderSound({ loop: true, maxDurationMs: 20000 });
        return {
          routine: sample,
          message: testMsg,
          triggeredAtStr: formatTime12h(
            minutesToTime24(
              new Date().getHours() * 60 + new Date().getMinutes()
            ),
            lang
          ),
          dedupeKey: testDedupeKey,
        };
      });
    }, 5200);
  }, [
    routines,
    user?.uid,
    user?.notificationSound,
    user?.defaultNotificationSound,
    todayStr,
    lang,
    token,
    playSelectedReminderSound,
  ]);

  const renderNotificationSoundSettings = (radioGroupName: string) => {
    if (!user) return null;
    const activeSound: NotificationSoundId =
      user.notificationSound || user.defaultNotificationSound || 'default_1';
    const fallbackBuiltIn: BuiltInSoundId =
      user.defaultNotificationSound || 'default_1';

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200 block">
              {t(lang, 'notificationSoundSetting')}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'ne'
                ? 'आफ्नो मनपर्ने डिफल्ट वा कस्टम रिमाइन्डर साउन्ड छान्नुहोस् र परीक्षण गर्नुहोस्।'
                : 'Select your preferred built-in or custom reminder sound and preview before selecting.'}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => playSelectedReminderSound({ loop: false })}
              className="min-h-[36px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold flex items-center gap-1.5"
            >
              <Volume2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>{t(lang, 'previewSoundBtn')}</span>
            </button>
            <button
              type="button"
              onClick={handleTriggerTestAlarm}
              className="min-h-[36px] px-3 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{t(lang, 'testNotificationBtn')}</span>
            </button>
          </div>
        </div>

        {soundFeedback && (
          <div className="p-2.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200">
            {soundFeedback}
          </div>
        )}

        <div className="space-y-2">
          {(
            [
              {
                id: 'default_1' as BuiltInSoundId,
                label: t(lang, 'defaultSound1Label'),
              },
              {
                id: 'default_2' as BuiltInSoundId,
                label: t(lang, 'defaultSound2Label'),
              },
              {
                id: 'default_3' as BuiltInSoundId,
                label: t(lang, 'defaultSound3Label'),
              },
            ] as const
          ).map((snd) => {
            const isSelected = activeSound === snd.id;
            const isFallbackDefault = fallbackBuiltIn === snd.id;
            return (
              <div
                key={snd.id}
                className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-2 transition-colors ${
                  isSelected
                    ? 'border-teal-600 dark:border-teal-500 bg-teal-50/50 dark:bg-teal-950/30'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60'
                }`}
              >
                <label className="flex items-center gap-2.5 cursor-pointer min-w-0 flex-1">
                  <input
                    type="radio"
                    name={radioGroupName}
                    checked={isSelected}
                    onChange={() =>
                      handleUpdatePreferences({
                        notificationSound: snd.id,
                        defaultNotificationSound: snd.id,
                      })
                    }
                    className="w-4 h-4 accent-teal-700 shrink-0"
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-slate-900 dark:text-white block truncate">
                      {snd.label}
                    </span>
                    {activeSound === 'custom' && isFallbackDefault && (
                      <span className="text-[10px] text-teal-700 dark:text-teal-400 font-mono">
                        {lang === 'ne'
                          ? 'फलब्याक डिफल्ट साउन्ड'
                          : 'Selected fallback built-in sound'}
                      </span>
                    )}
                  </div>
                </label>

                <button
                  type="button"
                  onClick={() => playBuiltInSound(snd.id)}
                  className="min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1 shrink-0"
                >
                  <Volume2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  <span>{t(lang, 'previewSoundBtn')}</span>
                </button>
              </div>
            );
          })}

          {/* Custom Sound Option + Upload Custom Sound */}
          <div
            className={`p-3 rounded-xl border space-y-2.5 transition-colors ${
              activeSound === 'custom' &&
              user.hasCustomSound &&
              customSoundDataUrl
                ? 'border-teal-600 dark:border-teal-500 bg-teal-50/50 dark:bg-teal-950/30'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/60'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                className={`flex items-center gap-2.5 min-w-0 flex-1 ${
                  user.hasCustomSound && customSoundDataUrl
                    ? 'cursor-pointer'
                    : 'cursor-not-allowed opacity-75'
                }`}
              >
                <input
                  type="radio"
                  name={radioGroupName}
                  disabled={!user.hasCustomSound || !customSoundDataUrl}
                  checked={
                    activeSound === 'custom' &&
                    Boolean(user.hasCustomSound && customSoundDataUrl)
                  }
                  onChange={() => {
                    if (user.hasCustomSound && customSoundDataUrl) {
                      handleUpdatePreferences({
                        notificationSound: 'custom',
                      });
                    }
                  }}
                  className="w-4 h-4 accent-teal-700 shrink-0"
                />
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white block">
                    {t(lang, 'customSoundLabel')}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 block truncate font-mono">
                    {user.hasCustomSound && customSoundDataUrl
                      ? `🎵 ${user.customSoundName || 'Custom Audio'}`
                      : lang === 'ne'
                      ? 'कुनै कस्टम अडियो अपलोड गरिएको छैन'
                      : 'No custom audio file uploaded'}
                  </span>
                </div>
              </label>

              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                {user.hasCustomSound && customSoundDataUrl && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        playReminderSound({
                          soundId: 'custom',
                          defaultSoundId: fallbackBuiltIn,
                          customSoundDataUrl,
                        })
                      }
                      className="min-h-[32px] px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      <span>{t(lang, 'previewSoundBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveCustomSound}
                      className="min-h-[32px] px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium text-red-600 dark:text-red-400"
                    >
                      {t(lang, 'removeCustomSoundBtn')}
                    </button>
                  </>
                )}

                <label className="min-h-[32px] px-3 py-1 rounded-lg bg-slate-900 dark:bg-teal-700 hover:bg-slate-800 dark:hover:bg-teal-600 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {customSoundUploading
                      ? '...'
                      : t(lang, 'uploadCustomSoundBtn')}
                  </span>
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.webm"
                    onChange={handleUploadCustomSoundFile}
                    disabled={customSoundUploading}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ==================================================
  // COMPUTED DASHBOARD STATE
  // ==================================================

  const isPro = Boolean(user?.isPro || user?.role === 'admin');
  const isAdmin = Boolean(user?.role === 'admin');

  const todaySummary = useMemo(
    () => getDaySummary(routines, routineLogs, todayStr, todayStr, currentMinutes),
    [routines, routineLogs, todayStr, currentMinutes]
  );

  // Next Upcoming Routine on Today's Timeline
  const nextRoutineInfo = useMemo(() => {
    for (const rt of todaySummary.dayRoutines) {
      const eff = getEffectiveRoutineStatus(
        rt,
        todayStr,
        routineLogs,
        todayStr,
        currentMinutes
      );
      if (eff.status === 'upcoming' || eff.status === 'snoozed') {
        const targetMins =
          eff.status === 'snoozed' && eff.snoozedUntil
            ? timeToMinutes(eff.snoozedUntil)
            : timeToMinutes(rt.time);
        const diff = targetMins - currentMinutes;
        return { routine: rt, diffMinutes: diff, status: eff.status };
      }
    }
    return null;
  }, [todaySummary.dayRoutines, routineLogs, todayStr, currentMinutes]);

  const streakSummary = useMemo(
    () => calculateRoutineStreaks(routines, routineLogs, todayStr),
    [routines, routineLogs, todayStr]
  );

  const greetingText = useMemo(() => {
    const h = now.getHours();
    if (h < 12) return t(lang, 'goodMorning');
    if (h < 17) return t(lang, 'goodAfternoon');
    return t(lang, 'goodEvening');
  }, [now, lang]);

  const formattedCurrentTime = useMemo(() => {
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return formatTime12h(`${hh}:${mm}`, lang);
  }, [now, lang]);

  // ==================================================
  // LOADING SCREEN
  // ==================================================

  if (bootstrapping) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <img
            src="/mero-routine-logo.svg"
            alt={t(lang, 'appName')}
            referrerPolicy="no-referrer"
            className="w-20 h-20 sm:w-24 sm:h-24 rounded-3xl object-contain mx-auto drop-shadow-sm select-none"
          />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t(lang, 'appName')}
          </p>
        </div>
      </div>
    );
  }

  // ==================================================
  // AUTH SCREEN (LOGIN / REGISTER)
  // ==================================================

  if (!user || !token) {
    return (
      <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col justify-between p-4 sm:p-8">
        {/* Top Bar with Brand & Language Selector */}
        <header className="max-w-md w-full mx-auto flex items-center justify-between gap-2 py-2 overflow-hidden">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <img
              src="/mero-routine-logo.svg"
              alt={t(lang, 'appName')}
              referrerPolicy="no-referrer"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-contain shrink-0 select-none"
            />
            <span className="font-brand font-bold text-base sm:text-lg tracking-tight whitespace-nowrap truncate">
              {t(lang, 'appName')}
            </span>
          </div>

          <div
            role="group"
            aria-label={t(lang, 'languageSetting')}
            className="inline-flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0"
          >
            <button
              type="button"
              onClick={() => setLang('en')}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                lang === 'en'
                  ? 'bg-teal-700 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => setLang('ne')}
              className={`h-8 px-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                lang === 'ne'
                  ? 'bg-teal-700 text-white font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              नेपाली
            </button>
          </div>
        </header>

        {/* Main Auth Card */}
        <main className="max-w-md w-full mx-auto my-6 space-y-5">
          {renderTopInstallPromptCard()}

          <div className="text-center space-y-1.5">
            <img
              src="/mero-routine-logo.svg"
              alt={t(lang, 'appName')}
              referrerPolicy="no-referrer"
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-contain mx-auto mb-2 drop-shadow-xs select-none"
            />
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {t(lang, 'appName')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t(lang, 'tagline')}
            </p>
          </div>

          <div className="p-6 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {authMode === 'login'
                ? t(lang, 'loginTitle')
                : t(lang, 'registerTitle')}
            </h2>

            {authError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleAuthSubmit} className="space-y-3.5">
              {authMode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t(lang, 'fullNameLabel')} *
                  </label>
                  <input
                    type="text"
                    required
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="Aarav Sharma"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t(lang, 'emailLabel')} *
                </label>
                <input
                  type="email"
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {t(lang, 'passwordLabel')} *
                </label>
                <input
                  type="password"
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
              </div>

              {authMode === 'register' && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t(lang, 'confirmPasswordLabel')} *
                  </label>
                  <input
                    type="password"
                    required
                    value={authConfirmPassword}
                    onChange={(e) => setAuthConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={authSubmitting}
                className="min-h-[46px] w-full rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {authSubmitting
                  ? '...'
                  : authMode === 'login'
                  ? t(lang, 'signInBtn')
                  : t(lang, 'registerBtn')}
              </button>
            </form>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white dark:bg-slate-900 text-slate-400">
                  or
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleGoogleLogin}
              className="min-h-[44px] w-full rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-2 transition-colors"
            >
              <span>{t(lang, 'continueWithGoogle')}</span>
            </button>

            <div className="text-center text-xs text-slate-500 pt-1">
              <span>
                {authMode === 'login'
                  ? t(lang, 'noAccountPrompt')
                  : t(lang, 'haveAccountPrompt')}{' '}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === 'login' ? 'register' : 'login');
                  setAuthError('');
                }}
                className="font-semibold text-teal-700 dark:text-teal-400 hover:underline"
              >
                {authMode === 'login'
                  ? t(lang, 'switchToRegister')
                  : t(lang, 'switchToLogin')}
              </button>
            </div>
          </div>

          {/* Quick Demo Account Switcher for Immediate User Testing (No Admin Bypass) */}
          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 space-y-2.5">
            <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 text-center">
              {t(lang, 'demoAccountsTitle')}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => handleQuickDemoLogin('free')}
                className="min-h-[40px] px-2 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                {t(lang, 'demoFreeUser')}
              </button>
              <button
                type="button"
                onClick={() => handleQuickDemoLogin('pro')}
                className="min-h-[40px] px-2 py-1.5 rounded-xl border border-teal-200 dark:border-teal-900 text-teal-800 dark:text-teal-300 hover:bg-teal-50 dark:hover:bg-teal-950/40 text-xs font-medium"
              >
                {t(lang, 'demoProUser')}
              </button>
            </div>
          </div>
        </main>

        <footer
          aria-label="App footer"
          className="w-full max-w-2xl mx-auto pt-4 pb-2 border-t border-slate-200/80 dark:border-slate-800/80 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3 overflow-hidden"
        >
          {!isPwaInstalled && (
            <div>
              <button
                type="button"
                onClick={handleInstallAppClick}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <Download className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {t(lang, 'installAppBtn')} / {t(lang, 'addToHomeScreenBtn')}
                </span>
              </button>
            </div>
          )}

          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-2"
          >
            {(
              [
                { id: 'how-to-use', label: t(lang, 'footerHowToUse') },
                { id: 'privacy', label: t(lang, 'footerPrivacyPolicy') },
                { id: 'terms', label: t(lang, 'footerTermsConditions') },
                { id: 'about', label: t(lang, 'footerAbout') },
                { id: 'contact', label: t(lang, 'footerContactSupport') },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPublicInfoModal(item.id)}
                className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-teal-700 dark:hover:text-teal-400 hover:underline transition-colors"
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[11px] text-slate-500 dark:text-slate-400 px-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {t(lang, 'poweredByRoila')}
            </span>
            <span className="hidden sm:inline text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span>
              © {new Date().getFullYear()} {t(lang, 'appName')}
            </span>
          </div>
        </footer>
        {publicInfoModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {publicInfoModal === 'how-to-use'
                    ? t(lang, 'howToUseTitle')
                    : publicInfoModal === 'privacy'
                    ? t(lang, 'privacyTitle')
                    : publicInfoModal === 'terms'
                    ? t(lang, 'termsTitle')
                    : publicInfoModal === 'about'
                    ? t(lang, 'aboutTitle')
                    : t(lang, 'contactSupportTitle')}
                </h3>
                <button
                  type="button"
                  onClick={() => setPublicInfoModal(null)}
                  className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white"
                  aria-label="Close modal"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {renderInfoSectionContent(publicInfoModal)}
            </div>
          </div>
        )}
        {renderInstallGuideModal()}
      </div>
    );
  }

  // ==================================================
  // MENU ITEMS DEFINITION
  // ==================================================

  const menuItems: {
    id: AppView;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    proBadge?: boolean;
  }[] = [
    { id: 'home', label: t(lang, 'navHome'), icon: Home },
    { id: 'planner', label: t(lang, 'navPlanner'), icon: Calendar },
    { id: 'goals', label: t(lang, 'navGoals'), icon: Target, proBadge: !isPro },
    { id: 'habits', label: t(lang, 'navHabits'), icon: Flame, proBadge: !isPro },
    { id: 'reports', label: t(lang, 'navReports'), icon: BarChart2 },
    { id: 'notifications', label: t(lang, 'navNotifications'), icon: Bell },
    {
      id: 'ai-builder',
      label: t(lang, 'navAiRoutine'),
      icon: Sparkles,
      proBadge: !isPro,
    },
    {
      id: 'templates',
      label: t(lang, 'navTemplates'),
      icon: LayoutTemplate,
      proBadge: !isPro,
    },
    { id: 'upgrade', label: t(lang, 'navUpgrade'), icon: Crown },
    { id: 'profile', label: t(lang, 'navProfile'), icon: User },
    { id: 'settings', label: t(lang, 'navSettings'), icon: Settings },
    { id: 'about', label: t(lang, 'navAbout'), icon: Info },
    { id: 'privacy', label: t(lang, 'navPrivacy'), icon: Shield },
    { id: 'terms', label: t(lang, 'navTerms'), icon: FileText },
  ];

  // Admin Panel is ONLY visible to authenticated admins
  if (isAdmin) {
    menuItems.push({
      id: 'admin',
      label: t(lang, 'navAdmin'),
      icon: ShieldCheck,
    });
  }

  // ==================================================
  // AUTHENTICATED APPLICATION SHELL
  // ==================================================

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Sticky Top Header (Clean & Compact Mobile-First Responsive Layout) */}
      <header className="sticky top-0 z-30 h-14 w-full max-w-full bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-3 sm:px-4 lg:px-8 flex items-center justify-between gap-2 overflow-hidden">
        {/* Left: Brand & Greeting */}
        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigateTo('home')}
            className="flex items-center gap-1.5 sm:gap-2 text-left min-w-0"
          >
            <img
              src="/mero-routine-logo.svg"
              alt={t(lang, 'appName')}
              referrerPolicy="no-referrer"
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl object-contain shrink-0 select-none"
            />
            <span className="font-brand font-bold text-sm sm:text-base tracking-tight text-slate-900 dark:text-white whitespace-nowrap truncate">
              {t(lang, 'appName')}
            </span>
          </button>

          <span className="hidden md:inline text-slate-300 dark:text-slate-700 shrink-0">
            ·
          </span>
          <span className="hidden md:inline text-xs text-slate-600 dark:text-slate-400 truncate">
            {greetingText}, {user.name.split(' ')[0]} ·{' '}
            <span className="font-mono tabular-nums font-semibold text-slate-800 dark:text-slate-200">
              {formattedCurrentTime}
            </span>
          </span>
        </div>

        {/* Right: Language Selector, Notification Icon, Hamburger Menu Icon */}
        <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
          <div
            role="group"
            aria-label={t(lang, 'languageSetting')}
            className="inline-flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/80 dark:bg-slate-800/80 shrink-0"
          >
            <button
              type="button"
              onClick={() => handleUpdatePreferences({ language: 'en' })}
              className={`h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                lang === 'en'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              English
            </button>
            <button
              type="button"
              onClick={() => handleUpdatePreferences({ language: 'ne' })}
              className={`h-7 sm:h-8 px-2 sm:px-2.5 rounded-lg text-[11px] sm:text-xs font-medium transition-colors whitespace-nowrap ${
                lang === 'ne'
                  ? 'bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-400 font-semibold shadow-2xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              नेपाली
            </button>
          </div>

          <button
            type="button"
            onClick={() => navigateTo('notifications')}
            className="relative h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label={t(lang, 'navNotifications')}
          >
            <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
            {todaySummary.upcoming > 0 && (
              <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-teal-600" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="h-9 w-9 sm:h-10 sm:w-10 flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
            aria-label="Open menu"
          >
            <Menu className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </header>

      {/* Active In-App Reminder Notification Banner */}
      {activeReminderAlert && (
        <div className="bg-slate-900 dark:bg-teal-950 text-white px-4 py-3 border-b border-slate-800">
          <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">{activeReminderAlert.routine.icon}</span>
              <div>
                <p className="text-xs font-semibold">
                  🔔 {activeReminderAlert.routine.title}
                </p>
                <p className="text-xs text-slate-300">
                  {activeReminderAlert.message}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'done'
                  )
                }
                className="min-h-[36px] px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold"
              >
                {t(lang, 'markDone')}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'snoozed'
                  )
                }
                className="min-h-[36px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium"
              >
                {t(lang, 'snooze10m')}
              </button>
              <button
                type="button"
                onClick={() =>
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'skipped'
                  )
                }
                className="min-h-[36px] px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium"
              >
                {t(lang, 'skip')}
              </button>
              <button
                type="button"
                onClick={() => {
                  stopActiveSound();
                  setActiveReminderAlert(null);
                }}
                className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white"
                aria-label="Dismiss reminder"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Layout Container (Desktop Sidebar + Mobile-First Viewport) */}
      <div className="flex-1 max-w-6xl w-full mx-auto flex gap-6 px-4 lg:px-8 pt-5 pb-24 lg:pb-12">
        {/* Desktop Persistent Sidebar Navigation */}
        <aside className="hidden lg:flex flex-col w-60 shrink-0 space-y-1">
          {menuItems.map((item) => {
            const IconComp = item.icon;
            const active = currentView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => navigateTo(item.id)}
                className={`min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-medium flex items-center justify-between transition-colors ${
                  active
                    ? 'bg-slate-900 dark:bg-teal-600 text-white font-semibold'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <IconComp className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.proBadge && (
                  <span className="text-[10px] font-mono opacity-75">PRO</span>
                )}
              </button>
            );
          })}

          {/* Desktop Sidebar Theme Selector & Logout */}
          <div className="pt-3 mt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
            {!isPwaInstalled && (
              <button
                type="button"
                onClick={handleInstallAppClick}
                className="w-full min-h-[40px] px-3.5 py-2 rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/70 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 hover:bg-teal-100/80 dark:hover:bg-teal-950/70 text-xs font-semibold flex items-center gap-2.5 transition-colors"
              >
                <Download className="w-4 h-4 shrink-0" />
                <span className="truncate">{t(lang, 'installAppBtn')}</span>
              </button>
            )}
            <div className="px-2 py-1.5 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {t(lang, 'themeSetting')}
              </span>
              <div className="inline-flex items-center p-0.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => handleUpdatePreferences({ theme: 'light' })}
                  className={`h-7 px-2 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors ${
                    theme === 'light'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Sun className="w-3 h-3 text-amber-500" />
                  <span>Light</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdatePreferences({ theme: 'dark' })}
                  className={`h-7 px-2 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors ${
                    theme === 'dark'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-500 dark:text-slate-400'
                  }`}
                >
                  <Moon className="w-3 h-3 text-teal-500" />
                  <span>Dark</span>
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              className="w-full min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2.5 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>{t(lang, 'logout')}</span>
            </button>
          </div>
        </aside>

        {/* Main Viewport Content */}
        <main className="flex-1 min-w-0 flex flex-col justify-between">
          <div className="flex-1 min-w-0 space-y-5">
          {renderTopInstallPromptCard()}
          {/* ==================================================
              VIEW: HOME DASHBOARD
              ================================================== */}
          {currentView === 'home' && (
            <div className="space-y-6">
              {/* Mobile Greeting & Current Time Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-mono text-teal-700 dark:text-teal-400 font-semibold">
                    {todayStr} · {formattedCurrentTime}
                  </p>
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5">
                    {greetingText}, {user.name.split(' ')[0]}
                  </h1>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingRoutine(null);
                    setModalTargetDate(todayStr);
                    setRoutineModalOpen(true);
                  }}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xs transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{t(lang, 'addRoutine')}</span>
                </button>
              </div>

              <AdSlot
                ads={ads}
                placement="home_top"
                isPro={isPro}
                lang={lang}
                onUpgradeClick={() => navigateTo('upgrade')}
              />

              {/* SECTION A: TODAY'S PROGRESS */}
              <section
                aria-label={t(lang, 'todaysProgress')}
                className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t(lang, 'todaysProgress')}
                  </h2>
                  <span className="text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                    {todaySummary.completionPct}%
                  </span>
                </div>

                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-600 rounded-full transition-all duration-200"
                    style={{ width: `${todaySummary.completionPct}%` }}
                  />
                </div>

                <div className="grid grid-cols-3 gap-3 pt-1">
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'completedTasks')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums text-emerald-600">
                      {todaySummary.completed}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'upcomingTasks')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums text-slate-900 dark:text-white">
                      {todaySummary.upcoming}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'missedTasks')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums text-red-600">
                      {todaySummary.missed}
                    </span>
                  </div>
                </div>
              </section>

              {/* SECTION B: NEXT ROUTINE FOCAL ANCHOR CARD */}
              <section aria-label={t(lang, 'nextRoutine')}>
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t(lang, 'nextRoutine')}
                  </h2>
                </div>

                {nextRoutineInfo ? (
                  <div className="p-5 rounded-2xl bg-slate-900 dark:bg-slate-900 border border-slate-800 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-slate-800 flex items-center justify-center text-3xl shrink-0">
                        {nextRoutineInfo.routine.icon}
                      </div>
                      <div className="space-y-1">
                        <p className="text-lg font-bold font-mono tabular-nums text-teal-400">
                          {formatTime12h(nextRoutineInfo.routine.time, lang)}
                        </p>
                        <h3 className="text-lg font-bold text-white">
                          {nextRoutineInfo.routine.title}
                        </h3>
                        <p className="text-xs text-slate-300 font-mono">
                          {nextRoutineInfo.diffMinutes > 0
                            ? `${t(lang, 'startsIn')} ${
                                nextRoutineInfo.diffMinutes >= 60
                                  ? `${Math.floor(nextRoutineInfo.diffMinutes / 60)} ${t(
                                      lang,
                                      'hoursShort'
                                    )} ${nextRoutineInfo.diffMinutes % 60} ${t(
                                      lang,
                                      'minutesShort'
                                    )}`
                                  : `${nextRoutineInfo.diffMinutes} ${t(
                                      lang,
                                      'minutesShort'
                                    )}`
                              }`
                            : t(lang, 'inProgressNow')}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(
                            nextRoutineInfo.routine.id,
                            todayStr,
                            'done'
                          )
                        }
                        className="min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        <span>{t(lang, 'markDone')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleStatusChange(
                            nextRoutineInfo.routine.id,
                            todayStr,
                            'snoozed'
                          )
                        }
                        className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
                      >
                        {t(lang, 'snooze')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {t(lang, 'allCaughtUp')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {t(lang, 'allCaughtUpSub')}
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* SECTION C: TODAY'S TIMELINE */}
              <section aria-label={t(lang, 'todaysTimeline')} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {t(lang, 'todaysTimeline')} ({todaySummary.planned})
                  </h2>
                </div>

                {todaySummary.dayRoutines.length === 0 ? (
                  <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-3">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {t(lang, 'emptyTimelineTitle')}
                    </p>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      {t(lang, 'emptyTimelineDesc')}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRoutine(null);
                          setModalTargetDate(todayStr);
                          setRoutineModalOpen(true);
                        }}
                        className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-semibold"
                      >
                        {t(lang, 'addRoutine')}
                      </button>
                      <button
                        type="button"
                        onClick={handleLoadSampleSchedule}
                        className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium"
                      >
                        {t(lang, 'loadSampleRoutine')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {todaySummary.dayRoutines.map((rt) => {
                      const eff = getEffectiveRoutineStatus(
                        rt,
                        todayStr,
                        routineLogs,
                        todayStr,
                        currentMinutes
                      );
                      const statusLabel =
                        eff.status === 'done'
                          ? t(lang, 'statusDone')
                          : eff.status === 'skipped'
                          ? t(lang, 'statusSkipped')
                          : eff.status === 'snoozed'
                          ? `${t(lang, 'statusSnoozed')} ${formatTime12h(
                              eff.snoozedUntil,
                              lang
                            )}`
                          : eff.status === 'missed'
                          ? t(lang, 'statusMissed')
                          : t(lang, 'statusUpcoming');

                      return (
                        <div
                          key={rt.id}
                          className={`p-4 rounded-2xl border transition-colors ${
                            eff.status === 'done'
                              ? 'border-emerald-200/70 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/10'
                              : eff.status === 'missed'
                              ? 'border-red-200/70 dark:border-red-900/40 bg-white dark:bg-slate-900'
                              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            {/* Left: Time, Icon, Title, Unboxed Metadata */}
                            <div className="flex items-start gap-3.5 min-w-0">
                              <span className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl shrink-0">
                                {rt.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="font-mono tabular-nums font-bold text-teal-700 dark:text-teal-400">
                                    {formatTime12h(rt.time, lang)}
                                  </span>
                                  <span aria-hidden="true" className="text-slate-300">
                                    —
                                  </span>
                                  <span
                                    className={`font-medium ${
                                      eff.status === 'done'
                                        ? 'text-emerald-700 dark:text-emerald-400'
                                        : eff.status === 'missed'
                                        ? 'text-red-600 dark:text-red-400'
                                        : eff.status === 'skipped'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-slate-500'
                                    }`}
                                  >
                                    {statusLabel}
                                  </span>
                                  {rt.duration > 0 && (
                                    <>
                                      <span
                                        aria-hidden="true"
                                        className="text-slate-300"
                                      >
                                        ·
                                      </span>
                                      <span className="font-mono text-slate-500">
                                        {rt.duration} {t(lang, 'minutesShort')}
                                      </span>
                                    </>
                                  )}
                                </div>

                                <h3
                                  className={`text-base font-semibold mt-0.5 truncate ${
                                    eff.status === 'done'
                                      ? 'line-through text-slate-400 dark:text-slate-500'
                                      : 'text-slate-900 dark:text-white'
                                  }`}
                                >
                                  {rt.title}
                                </h3>

                                {rt.notes && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                    {rt.notes}
                                  </p>
                                )}
                              </div>
                            </div>

                            {/* Right: Action Controls (Done, Skip, Snooze, Edit, Delete) */}
                            <div className="flex flex-wrap items-center gap-1.5 self-end sm:self-center shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(rt.id, todayStr, 'done')
                                }
                                className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1 border transition-colors ${
                                  eff.status === 'done'
                                    ? 'bg-emerald-700 text-white border-emerald-700'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                                }`}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>{t(lang, 'markDone')}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(rt.id, todayStr, 'snoozed')
                                }
                                className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 border transition-colors ${
                                  eff.status === 'snoozed'
                                    ? 'bg-teal-700 text-white border-teal-700'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                                title={t(lang, 'snooze10m')}
                              >
                                <Clock className="w-3.5 h-3.5" />
                                <span>{t(lang, 'snooze')}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleStatusChange(rt.id, todayStr, 'skipped')
                                }
                                className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1 border transition-colors ${
                                  eff.status === 'skipped'
                                    ? 'bg-amber-600 text-white border-amber-600'
                                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                }`}
                              >
                                <SkipForward className="w-3.5 h-3.5" />
                                <span>{t(lang, 'skip')}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  setEditingRoutine(rt);
                                  setModalTargetDate(todayStr);
                                  setRoutineModalOpen(true);
                                }}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                                aria-label={t(lang, 'edit')}
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteRoutine(rt.id)}
                                className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600"
                                aria-label={t(lang, 'delete')}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <AdSlot
                ads={ads}
                placement="home_bottom"
                isPro={isPro}
                lang={lang}
                onUpgradeClick={() => navigateTo('upgrade')}
              />
            </div>
          )}

          {/* VIEW: PLANNER */}
          {currentView === 'planner' && (
            <PlannerView
              routines={routines}
              logs={routineLogs}
              todayStr={todayStr}
              currentMinutes={currentMinutes}
              isPro={isPro}
              lang={lang}
              ads={ads}
              onAddRoutineForDate={(dStr) => {
                setEditingRoutine(null);
                setModalTargetDate(dStr);
                setRoutineModalOpen(true);
              }}
              onEditRoutine={(rt) => {
                setEditingRoutine(rt);
                setModalTargetDate(rt.targetDate || todayStr);
                setRoutineModalOpen(true);
              }}
              onDeleteRoutine={handleDeleteRoutine}
              onStatusChange={handleStatusChange}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: REPORTS */}
          {currentView === 'reports' && (
            <ReportsView
              routines={routines}
              logs={routineLogs}
              todayStr={todayStr}
              currentMinutes={currentMinutes}
              isPro={isPro}
              lang={lang}
              ads={ads}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: HABITS & STREAK */}
          {currentView === 'habits' && (
            <HabitsStreaksView
              routines={routines}
              logs={routineLogs}
              todayStr={todayStr}
              isPro={isPro}
              lang={lang}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: GOALS */}
          {currentView === 'goals' && (
            <GoalsView
              goals={goals}
              todayStr={todayStr}
              isPro={isPro}
              lang={lang}
              onCreateGoal={async (gData) => {
                const res = await fetch('/api/goals', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(gData),
                });
                if (res.ok) {
                  const data = await res.json();
                  setGoals((prev) => [...prev, data.goal]);
                }
              }}
              onToggleGoalCheckIn={async (goalId, dateStr) => {
                const res = await fetch(`/api/goals/${goalId}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ toggleDate: dateStr }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setGoals((prev) =>
                    prev.map((g) => (g.id === goalId ? data.goal : g))
                  );
                }
              }}
              onDeleteGoal={async (goalId) => {
                const res = await fetch(`/api/goals/${goalId}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  setGoals((prev) => prev.filter((g) => g.id !== goalId));
                }
              }}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: AI ROUTINE BUILDER */}
          {currentView === 'ai-builder' && (
            <AiRoutineBuilderView
              token={token}
              isPro={isPro}
              lang={lang}
              onApplyGeneratedRoutines={handleBatchApplyRoutines}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: TEMPLATES */}
          {currentView === 'templates' && (
            <RoutineTemplatesView
              templates={templates}
              currentRoutines={routines}
              isPro={isPro}
              lang={lang}
              onSaveTemplate={async (name, description) => {
                const items = routines.map((r) => ({
                  title: r.title,
                  time: r.time,
                  category: r.category,
                  icon: r.icon,
                  duration: r.duration,
                  reminderOffset: r.reminderOffset,
                  repeatType: r.repeatType,
                  notes: r.notes,
                }));
                const res = await fetch('/api/templates', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ name, description, items }),
                });
                if (res.ok) {
                  const data = await res.json();
                  setTemplates((prev) => [...prev, data.template]);
                }
              }}
              onApplyTemplate={handleBatchApplyRoutines}
              onDeleteTemplate={async (id) => {
                const res = await fetch(`/api/templates/${id}`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (res.ok) {
                  setTemplates((prev) => prev.filter((t) => t.id !== id));
                }
              }}
              onUpgrade={() => navigateTo('upgrade')}
            />
          )}

          {/* VIEW: NOTIFICATIONS */}
          {currentView === 'notifications' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                    {t(lang, 'notificationsTitle')}
                  </h1>
                  <p className="text-xs font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    Local Timezone: {getUserTimezone()} · {todayStr} · {formattedCurrentTime}
                  </p>
                </div>
              </div>

              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {t(lang, 'notificationPermissionStatus')}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          notifPermission === 'granted'
                            ? 'bg-emerald-500'
                            : notifPermission === 'denied'
                            ? 'bg-red-500'
                            : 'bg-amber-500'
                        }`}
                      />
                      <p className="text-sm font-bold text-slate-900 dark:text-white">
                        {notifPermission === 'granted'
                          ? t(lang, 'permissionGranted')
                          : notifPermission === 'denied'
                          ? t(lang, 'permissionDenied')
                          : t(lang, 'permissionDefault')}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(notifPermission !== 'granted' ||
                      !user.notificationsEnabled) && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (notifPermission !== 'granted') {
                            await handleRequestNotificationPermission();
                          } else if (!user.notificationsEnabled) {
                            handleUpdatePreferences({
                              notificationsEnabled: true,
                            });
                          }
                        }}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
                      >
                        {t(lang, 'enableNotificationsBtn')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleTriggerTestAlarm}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>{t(lang, 'testAlarmBtn')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleTriggerBackgroundTestAlarm}
                      className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5"
                    >
                      <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                      <span>{t(lang, 'testBgAlarmBtn')}</span>
                    </button>
                  </div>
                </div>

                {testAlarmFeedback && (
                  <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200 flex items-center gap-2">
                    <Bell className="w-4 h-4 shrink-0 text-teal-600 dark:text-teal-400" />
                    <span>{testAlarmFeedback}</span>
                  </div>
                )}

                {isIosDevice && !isPwaInstalled && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {lang === 'ne'
                        ? 'iPhone / iPad मा ब्याकग्राउन्ड अलार्म सूचनाको लागि पहिले Mero Routine लाई Home Screen मा Add गर्नुहोस्।'
                        : 'On iPhone / iPad, iOS requires adding Mero Routine to your Home Screen to enable background notifications.'}
                    </span>
                    <button
                      type="button"
                      onClick={handleInstallAppClick}
                      className="px-3 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-semibold"
                    >
                      {t(lang, 'addToHomeScreenBtn')}
                    </button>
                  </div>
                )}

                {notifPermission === 'denied' && (
                  <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-1.5">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>
                        {lang === 'ne'
                          ? 'ब्राउजर सूचना अनुमति कसरी अनब्लक (Enable) गर्ने:'
                          : 'How to unblock Browser / Device Notifications:'}
                      </span>
                    </p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300">
                      <li>
                        {lang === 'ne'
                          ? 'ब्राउजरको माथिल्लो ठेगाना बार (Address Bar) मा रहेको लक (🔒) वा सेटिङ आइकनमा क्लिक गर्नुहोस्।'
                          : 'Click the Lock (🔒) or Site Settings icon in your browser address bar.'}
                      </li>
                      <li>
                        {lang === 'ne'
                          ? '"Notifications" भेटाएर "Allow" छान्नुहोस् र पेज रिफ्रेस गर्नुहोस्।'
                          : 'Find "Notifications", change it from "Block" to "Allow", and refresh the page.'}
                      </li>
                    </ol>
                  </div>
                )}

                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {t(lang, 'notificationHonestNote')}
                </p>

                {/* Honest Platform & OS Background Alarm Status & Limitation Notice */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      <span>{t(lang, 'platformLimitationTitle')}</span>
                    </span>
                    <span className="font-mono text-[11px] text-teal-700 dark:text-teal-400">
                      {swReady ? 'SW + IndexedDB Active' : 'Local Timer Active'}
                      {pushSyncStatus === 'push-active' ? ' · Web Push Ready' : ''}
                      {isPwaInstalled ? ' · Installed PWA' : ''}
                    </span>
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {t(lang, 'platformLimitationBody')}
                  </p>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  {renderNotificationSoundSettings('notificationsViewSoundOption')}
                </div>
              </div>

              <div className="space-y-2.5">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t(lang, 'upcomingRemindersTitle')} ({routines.length})
                </h2>
                {routines.length === 0 ? (
                  <div className="p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center text-xs text-slate-500 dark:text-slate-400">
                    {t(lang, 'emptyTimelineTitle')}
                  </div>
                ) : (
                  routines.map((rt) => {
                    const nextOcc = getNextReminderOccurrence(
                      rt,
                      routineLogs,
                      notifiedKeysRef.current,
                      now
                    );
                    const diffMins = nextOcc
                      ? Math.max(
                          0,
                          Math.ceil(
                            (nextOcc.triggerDate.getTime() - now.getTime()) / 60000
                          )
                        )
                      : null;
                    return (
                      <div
                        key={rt.id}
                        className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg">
                            {rt.icon}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {rt.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                              Activity: {formatTime12h(rt.time, lang)} ({rt.time}) ·{' '}
                              {rt.reminderOffset === 0
                                ? t(lang, 'reminderAtTime')
                                : `${rt.reminderOffset} ${t(lang, 'minutesShort')} before`}
                            </p>
                            {nextOcc ? (
                              <p className="text-[11px] font-mono text-teal-700 dark:text-teal-400 mt-0.5">
                                Next Alert: {nextOcc.dateStr === todayStr ? 'Today' : nextOcc.dateStr} at{' '}
                                {formatTime12h(nextOcc.triggerTime24, lang)}
                                {diffMins !== null && diffMins <= 180
                                  ? ` (in ${diffMins} min)`
                                  : ''}
                              </p>
                            ) : (
                              <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                                Completed for scheduled date
                              </p>
                            )}
                          </div>
                        </div>
                        <Bell className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* VIEW: UPGRADE TO PRO */}
          {currentView === 'upgrade' && (
            <UpgradeProView
              isPro={isPro}
              proExpiry={user.proExpiry}
              proRequests={proRequests}
              lang={lang}
              onSubmitProRequest={async (reqData) => {
                const res = await fetch('/api/pro-requests', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify(reqData),
                });
                if (res.ok) {
                  const data = await res.json();
                  setProRequests((prev) => [
                    data.request,
                    ...prev.filter((r) => r.id !== data.request.id),
                  ]);
                }
              }}
              onBack={() => navigateTo('home')}
            />
          )}

          {/* VIEW: PROFILE & SETTINGS */}
          {(currentView === 'profile' || currentView === 'settings') && (
            <div className="space-y-6">
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                {currentView === 'profile'
                  ? t(lang, 'profileTitle')
                  : t(lang, 'settingsTitle')}
              </h1>

              {currentView === 'profile' && (
                <AdSlot
                  ads={ads}
                  placement="profile_top"
                  isPro={isPro}
                  lang={lang}
                  onUpgradeClick={() => navigateTo('upgrade')}
                />
              )}

              {/* Profile Card */}
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="w-14 h-14 rounded-2xl bg-teal-700 text-white flex items-center justify-center text-xl font-bold">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        {user.name}
                      </h2>
                      <p className="text-xs text-slate-500 font-mono">
                        {user.email}
                      </p>
                      <p className="text-xs font-medium text-teal-700 dark:text-teal-400 mt-0.5">
                        {isPro ? t(lang, 'planPro') : t(lang, 'planFree')}
                        {isPro && user.proExpiry
                          ? ` · ${t(lang, 'proExpiresOn')} ${user.proExpiry}`
                          : ''}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => navigateTo('admin')}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-teal-600 hover:bg-slate-800 dark:hover:bg-teal-500 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        <span>{t(lang, 'navAdmin')}</span>
                      </button>
                    )}
                    {!isPro && (
                      <button
                        type="button"
                        onClick={() => navigateTo('upgrade')}
                        className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5"
                      >
                        <Crown className="w-4 h-4" />
                        <span>{t(lang, 'navUpgrade')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Routine Statistics Summary */}
                <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'currentStreak')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums">
                      {streakSummary.currentOverallStreak} {t(lang, 'daysUnit')}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'plannedCount')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums">
                      {routines.length}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">
                      {t(lang, 'completionRate')}
                    </span>
                    <span className="text-lg font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                      {todaySummary.completionPct}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Preferences Form */}
              <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  {t(lang, 'settingsTitle')}
                </h3>

                {profileFeedback && (
                  <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200">
                    {profileFeedback}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {t(lang, 'fullNameLabel')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      className="flex-1 h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdatePreferences({ name: profileName.trim() })
                      }
                      className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-teal-600 text-white text-xs font-semibold"
                    >
                      {t(lang, 'saveProfileBtn')}
                    </button>
                  </div>
                </div>

                {/* Language Switcher */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t(lang, 'languageSetting')}
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => handleUpdatePreferences({ language: 'en' })}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium ${
                        lang === 'en'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500'
                      }`}
                    >
                      English
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePreferences({ language: 'ne' })}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium ${
                        lang === 'ne'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500'
                      }`}
                    >
                      नेपाली
                    </button>
                  </div>
                </div>

                {/* Theme Switcher */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t(lang, 'themeSetting')}
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                    <button
                      type="button"
                      onClick={() => handleUpdatePreferences({ theme: 'light' })}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium ${
                        theme === 'light'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500'
                      }`}
                    >
                      {t(lang, 'lightMode')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdatePreferences({ theme: 'dark' })}
                      className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-medium ${
                        theme === 'dark'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-500'
                      }`}
                    >
                      {t(lang, 'darkMode')}
                    </button>
                  </div>
                </div>

                {/* Notifications Toggle */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    {t(lang, 'notificationsSetting')}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const nextEnabled = !user.notificationsEnabled;
                      if (
                        nextEnabled &&
                        typeof Notification !== 'undefined' &&
                        Notification.permission === 'default'
                      ) {
                        await handleRequestNotificationPermission();
                      }
                      handleUpdatePreferences({
                        notificationsEnabled: nextEnabled,
                      });
                    }}
                    className={`min-h-[38px] px-4 py-1.5 rounded-xl text-xs font-medium ${
                      user.notificationsEnabled
                        ? 'bg-emerald-700 text-white'
                        : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {user.notificationsEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>

                {/* Notification Sound / Alarm Sound Setting */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                  {renderNotificationSoundSettings('settingsViewSoundOption')}
                </div>

                {/* PWA Install App / Add to Home Screen Setting */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Download className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      {t(lang, 'installAppLabel')}
                    </span>
                  </div>
                  {isPwaInstalled ? (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>{t(lang, 'appInstalledBadge')}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleInstallAppClick}
                      className="min-h-[38px] px-4 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {t(lang, 'installAppBtn')} / {t(lang, 'addToHomeScreenBtn')}
                      </span>
                    </button>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap justify-between items-center gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigateTo('privacy')}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      {t(lang, 'privacyTitle')}
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">·</span>
                    <button
                      type="button"
                      onClick={() => navigateTo('contact')}
                      className="text-xs text-slate-500 hover:underline"
                    >
                      {t(lang, 'footerContactSupport')}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="min-h-[40px] px-4 py-2 rounded-xl border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>{t(lang, 'logout')}</span>
                  </button>
                </div>
              </div>

              {currentView === 'profile' && (
                <AdSlot
                  ads={ads}
                  placement="profile_bottom"
                  isPro={isPro}
                  lang={lang}
                  onUpgradeClick={() => navigateTo('upgrade')}
                />
              )}
            </div>
          )}

          {/* VIEW: HOW TO USE / ABOUT / PRIVACY / TERMS / CONTACT */}
          {(currentView === 'how-to-use' ||
            currentView === 'about' ||
            currentView === 'privacy' ||
            currentView === 'terms' ||
            currentView === 'contact') && (
            <div className="p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  {currentView === 'how-to-use'
                    ? t(lang, 'howToUseTitle')
                    : currentView === 'about'
                    ? t(lang, 'aboutTitle')
                    : currentView === 'privacy'
                    ? t(lang, 'privacyTitle')
                    : currentView === 'terms'
                    ? t(lang, 'termsTitle')
                    : t(lang, 'contactSupportTitle')}
                </h1>
                <button
                  type="button"
                  onClick={() => navigateTo('home')}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t(lang, 'back')}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800">
                {(
                  [
                    { id: 'how-to-use', label: t(lang, 'footerHowToUse') },
                    { id: 'privacy', label: t(lang, 'footerPrivacyPolicy') },
                    { id: 'terms', label: t(lang, 'footerTermsConditions') },
                    { id: 'about', label: t(lang, 'footerAbout') },
                    { id: 'contact', label: t(lang, 'footerContactSupport') },
                  ] as const
                ).map((tab) => {
                  const active = currentView === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => navigateTo(tab.id)}
                      className={`min-h-[32px] px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                        active
                          ? 'bg-teal-700 text-white font-semibold'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              {renderInfoSectionContent(currentView)}
            </div>
          )}

          {/* VIEW: SECURE ADMIN PANEL */}
          {currentView === 'admin' &&
            (isAdmin ? (
              <AdminPanelView
                token={token}
                lang={lang}
                onUserDataChanged={() => fetchBootstrapData(token)}
                onSessionExpired={handleLogout}
              />
            ) : (
              <div className="p-8 rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-slate-900 text-center space-y-3">
                <p className="text-sm font-bold text-red-600 dark:text-red-400">
                  Access Denied — Administrator authorization required.
                </p>
                <button
                  type="button"
                  onClick={() => navigateTo('home')}
                  className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-teal-600 text-white text-xs"
                >
                  {t(lang, 'back')}
                </button>
              </div>
            ))}
          </div>

          {/* Clean App Footer Naturally at the Bottom of Main Pages */}
          <footer
            aria-label="App footer"
            className="mt-10 pt-6 pb-2 border-t border-slate-200/80 dark:border-slate-800/80 w-full max-w-full overflow-hidden"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
              <nav
                aria-label="Footer navigation"
                className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2"
              >
                {(
                  [
                    { id: 'how-to-use', label: t(lang, 'footerHowToUse') },
                    { id: 'privacy', label: t(lang, 'footerPrivacyPolicy') },
                    { id: 'terms', label: t(lang, 'footerTermsConditions') },
                    { id: 'about', label: t(lang, 'footerAbout') },
                    { id: 'contact', label: t(lang, 'footerContactSupport') },
                  ] as const
                ).map((link) => {
                  const isActive = currentView === link.id;
                  return (
                    <button
                      key={link.id}
                      type="button"
                      onClick={() => navigateTo(link.id)}
                      className={`text-xs transition-colors hover:text-teal-700 dark:hover:text-teal-400 hover:underline ${
                        isActive
                          ? 'font-semibold text-teal-700 dark:text-teal-400'
                          : 'font-medium text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {link.label}
                    </button>
                  );
                })}
              </nav>

              <div className="flex items-center justify-center sm:justify-end gap-2 shrink-0 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {t(lang, 'poweredByRoila')}
                </span>
              </div>
            </div>
          </footer>
        </main>
      </div>

      {/* Fixed Mobile Bottom Tab Bar (Thumb-Zone Navigation Anchor) */}
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 h-16 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center px-2"
      >
        {(
          [
            { id: 'home', label: t(lang, 'navHome'), icon: Home },
            { id: 'planner', label: t(lang, 'navPlanner'), icon: Calendar },
            { id: 'reports', label: t(lang, 'navReports'), icon: BarChart2 },
            { id: 'profile', label: t(lang, 'navProfile'), icon: User },
          ] as const
        ).map((tab) => {
          const IconComp = tab.icon;
          const active = currentView === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => navigateTo(tab.id)}
              className={`min-h-[48px] flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                active
                  ? 'text-teal-700 dark:text-teal-400 font-semibold'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              <IconComp className="w-5 h-5" />
              <span className="text-[10px] tracking-tight truncate max-w-[80px]">
                {tab.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Slide-Over Vertically Scrollable Hamburger Drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex justify-end">
          <div className="w-72 max-w-[85vw] bg-white dark:bg-slate-900 h-full border-l border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src="/mero-routine-logo.svg"
                  alt={t(lang, 'appName')}
                  referrerPolicy="no-referrer"
                  className="w-9 h-9 rounded-xl object-contain shrink-0 select-none"
                />
                <div className="min-w-0">
                  <p className="font-bold text-sm text-slate-900 dark:text-white truncate">
                    {user.name}
                  </p>
                  <p className="text-xs text-teal-700 dark:text-teal-400 font-medium truncate">
                    {isPro ? t(lang, 'planPro') : t(lang, 'planFree')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Menu List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {menuItems.map((item) => {
                const IconComp = item.icon;
                const active = currentView === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigateTo(item.id)}
                    className={`w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors ${
                      active
                        ? 'bg-slate-900 dark:bg-teal-600 text-white font-semibold'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-3 truncate">
                      <IconComp className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.proBadge && (
                      <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400">
                        PRO
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Drawer Footer: Install App, Theme Selector & Logout */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-2.5">
              {!isPwaInstalled && (
                <button
                  type="button"
                  onClick={handleInstallAppClick}
                  className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-teal-200 dark:border-teal-900 bg-teal-50/70 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 hover:bg-teal-100/80 dark:hover:bg-teal-950/70 text-xs font-semibold flex items-center gap-3 transition-colors"
                >
                  <Download className="w-4 h-4 shrink-0" />
                  <span className="truncate">
                    {t(lang, 'installAppBtn')} / {t(lang, 'addToHomeScreenBtn')}
                  </span>
                </button>
              )}
              <div className="px-2 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  {t(lang, 'themeSetting')}
                </span>
                <div className="inline-flex items-center p-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => handleUpdatePreferences({ theme: 'light' })}
                    className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                      theme === 'light'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Sun className="w-3.5 h-3.5 text-amber-500" />
                    <span>Light</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleUpdatePreferences({ theme: 'dark' })}
                    className={`h-7 px-2.5 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
                      theme === 'dark'
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Moon className="w-3.5 h-3.5 text-teal-500" />
                    <span>Dark</span>
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleLogout}
                className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-3"
              >
                <LogOut className="w-4 h-4" />
                <span>{t(lang, 'logout')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Routine Reminder Alarm Modal (Visible & Audible even when OS popups are blocked) */}
      {activeReminderAlert && (
        <div className="fixed inset-0 z-60 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl border border-teal-500/40 bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 shadow-2xl space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-2xl bg-teal-600/15 dark:bg-teal-500/20 text-3xl flex items-center justify-center shrink-0">
                  {activeReminderAlert.routine.icon}
                </div>
                <div>
                  <span className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-400">
                    🔔 {formatTime12h(activeReminderAlert.routine.time, lang)}
                  </span>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    {activeReminderAlert.routine.title}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (activeReminderAlert.dedupeKey) {
                    markAlarmAcknowledgedInUi(activeReminderAlert.dedupeKey);
                    dismissSwNotification(activeReminderAlert.dedupeKey);
                  }
                  dismissSwNotification(activeReminderAlert.routine.id);
                  stopActiveSound();
                  setActiveReminderAlert(null);
                }}
                className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white"
                aria-label="Close reminder"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {activeReminderAlert.message}
            </p>

            <button
              type="button"
              onClick={() => stopActiveSound()}
              className="w-full min-h-[38px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1.5"
            >
              <Volume2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
              <span>{t(lang, 'stopAlarmBtn')}</span>
            </button>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (
                    activeReminderAlert.routine.id === 'test_alarm' ||
                    activeReminderAlert.routine.id === 'sample'
                  ) {
                    stopActiveSound();
                    setActiveReminderAlert(null);
                    return;
                  }
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'done'
                  );
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Check className="w-4 h-4" />
                <span>{t(lang, 'markDone')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    activeReminderAlert.routine.id === 'test_alarm' ||
                    activeReminderAlert.routine.id === 'sample'
                  ) {
                    stopActiveSound();
                    setActiveReminderAlert(null);
                    return;
                  }
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'snoozed'
                  );
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <Clock className="w-4 h-4" />
                <span>{t(lang, 'snooze10m')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    activeReminderAlert.routine.id === 'test_alarm' ||
                    activeReminderAlert.routine.id === 'sample'
                  ) {
                    stopActiveSound();
                    setActiveReminderAlert(null);
                    return;
                  }
                  handleStatusChange(
                    activeReminderAlert.routine.id,
                    todayStr,
                    'skipped'
                  );
                }}
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5"
              >
                <SkipForward className="w-4 h-4" />
                <span>{t(lang, 'skip')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Routine Modal */}
      <RoutineModal
        isOpen={routineModalOpen}
        initialRoutine={editingRoutine}
        selectedDate={modalTargetDate}
        todayStr={todayStr}
        isPro={isPro}
        lang={lang}
        categories={categories}
        notifPermission={notifPermission}
        onRequestNotificationPermission={handleRequestNotificationPermission}
        onTestAlarm={handleTriggerTestAlarm}
        onClose={() => setRoutineModalOpen(false)}
        onSave={handleSaveRoutine}
        onOpenUpgrade={() => {
          setRoutineModalOpen(false);
          navigateTo('upgrade');
        }}
      />

      {/* PWA Install / Add to Home Screen Guide Modal */}
      {renderInstallGuideModal()}
    </div>
  );
}
