export type Language = 'en' | 'ne';
export type ThemeMode = 'light' | 'dark';
export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended';
export type BuiltInSoundId = 'default_1' | 'default_2' | 'default_3';
export type NotificationSoundId = BuiltInSoundId | 'custom';

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  isPro: boolean;
  proExpiry: string; // ISO date string or ''
  language: Language;
  theme: ThemeMode;
  notificationsEnabled: boolean;
  notificationSound?: NotificationSoundId;
  defaultNotificationSound?: BuiltInSoundId;
  customSoundName?: string;
  hasCustomSound?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RepeatType = 'today' | 'everyday' | 'weekdays' | 'custom';
export type ReminderOffset = 0 | 5 | 10 | 15;

export interface Routine {
  id: string;
  userId: string;
  title: string;
  time: string; // HH:MM (24-hour format e.g. "06:00")
  category: string;
  icon: string;
  reminderOffset: ReminderOffset;
  duration: number; // in minutes, 0 if optional/unspecified
  repeatType: RepeatType;
  customDays: number[]; // 0 (Sun) - 6 (Sat)
  targetDate: string; // YYYY-MM-DD (used when repeatType === 'today' or specific planned date)
  timezone?: string; // IANA timezone string e.g. "Asia/Kathmandu"
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export type RoutineStatus = 'done' | 'skipped' | 'snoozed' | 'missed';

export interface RoutineLog {
  id: string;
  userId: string;
  routineId: string;
  date: string; // YYYY-MM-DD
  status: RoutineStatus;
  snoozedUntil: string; // HH:MM or ''
  createdAt: string;
  updatedAt: string;
}

export interface Goal {
  id: string;
  userId: string;
  title: string;
  category: string;
  targetDays: number;
  completedDays: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  checkedDates: string[]; // YYYY-MM-DD list of checked-in days
  createdAt: string;
  updatedAt: string;
}

export interface TemplateItem {
  title: string;
  time: string;
  category: string;
  icon: string;
  duration: number;
  reminderOffset: ReminderOffset;
  repeatType: RepeatType;
  notes: string;
}

export interface RoutineTemplate {
  id: string;
  userId: string; // 'system' for built-in templates or user's uid
  name: string;
  nameNe?: string;
  description: string;
  descriptionNe?: string;
  items: TemplateItem[];
  createdAt: string;
}

export type ProRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ProUpgradeRequest {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  referenceId: string;
  paymentMethod: string;
  senderInfo: string;
  planType?: 'monthly' | 'yearly';
  amount: number; // Rs.99 / month or Rs.999 / year
  status: ProRequestStatus;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
}

export type AdPage = 'home' | 'planner' | 'reports' | 'profile';
export type AdPosition = 'top' | 'bottom';

export type AdPlacement =
  | 'home_top'
  | 'home_bottom'
  | 'planner_top'
  | 'planner_bottom'
  | 'reports_top'
  | 'reports_bottom'
  | 'profile_top'
  | 'profile_bottom';

export interface AdBanner {
  id: string;
  title: string;
  type: 'manual' | 'adsense';
  placement: AdPlacement;
  placements?: AdPlacement[];
  pages?: AdPage[];
  positions?: AdPosition[];
  imageUrl: string;
  targetUrl: string;
  adSenseSlot: string;
  active: boolean;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  priority: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineCategoryConfig {
  id: string;
  nameEn: string;
  nameNe: string;
  icon: string;
  suggestedTitleEn: string;
  suggestedTitleNe: string;
  defaultTime: string;
}

export type AppView =
  | 'home'
  | 'planner'
  | 'goals'
  | 'habits'
  | 'reports'
  | 'notifications'
  | 'ai-builder'
  | 'templates'
  | 'upgrade'
  | 'profile'
  | 'settings'
  | 'how-to-use'
  | 'about'
  | 'privacy'
  | 'terms'
  | 'contact'
  | 'admin';
