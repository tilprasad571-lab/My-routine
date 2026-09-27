import React, { useState, useEffect, useMemo } from 'react';
import {
  Routine,
  RoutineCategoryConfig,
  ReminderOffset,
  RepeatType,
  Language,
} from '../types';
import { t } from '../i18n/translations';
import {
  formatTime12h,
  timeToMinutes,
  minutesToTime24,
  getUserTimezone,
} from '../utils/dateUtils';
import { X, Clock, Bell, Repeat, FileText, Lock, AlertCircle } from 'lucide-react';

interface RoutineModalProps {
  isOpen: boolean;
  initialRoutine: Routine | null;
  selectedDate: string;
  todayStr: string;
  isPro: boolean;
  lang: Language;
  categories: RoutineCategoryConfig[];
  notifPermission?: NotificationPermission;
  onRequestNotificationPermission?: () => Promise<void>;
  onTestAlarm?: () => void;
  onClose: () => void;
  onSave: (data: {
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
    clientToday: string;
    timezone: string;
    notes: string;
  }) => Promise<void>;
  onOpenUpgrade: () => void;
}

export const RoutineModal: React.FC<RoutineModalProps> = ({
  isOpen,
  initialRoutine,
  selectedDate,
  todayStr,
  isPro,
  lang,
  categories,
  notifPermission = 'default',
  onRequestNotificationPermission,
  onTestAlarm,
  onClose,
  onSave,
  onOpenUpgrade,
}) => {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('06:00');
  const [category, setCategory] = useState('Fitness');
  const [icon, setIcon] = useState('🏋️');
  const [reminderOffset, setReminderOffset] = useState<ReminderOffset>(0);
  const [duration, setDuration] = useState<string>('30');
  const [repeatType, setRepeatType] = useState<RepeatType>('everyday');
  const [customDays, setCustomDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [targetDate, setTargetDate] = useState(selectedDate || todayStr);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const userTimezone = useMemo(() => getUserTimezone(), []);

  useEffect(() => {
    if (initialRoutine) {
      setTitle(initialRoutine.title);
      setTime(initialRoutine.time);
      setCategory(initialRoutine.category);
      setIcon(initialRoutine.icon);
      setReminderOffset(initialRoutine.reminderOffset ?? 0);
      setDuration(initialRoutine.duration ? String(initialRoutine.duration) : '');
      setRepeatType(initialRoutine.repeatType);
      setCustomDays(
        initialRoutine.customDays?.length
          ? initialRoutine.customDays
          : [1, 2, 3, 4, 5]
      );
      setTargetDate(initialRoutine.targetDate || selectedDate || todayStr);
      setNotes(initialRoutine.notes || '');
    } else {
      // Default to next upcoming minute + 5 mins so users testing reminders have a convenient time
      const now = new Date();
      const nextMins = now.getHours() * 60 + now.getMinutes() + 2;
      setTitle('');
      setTime(minutesToTime24(nextMins));
      setCategory('Fitness');
      setIcon('🏋️');
      setReminderOffset(0);
      setDuration('30');
      setRepeatType('everyday');
      setCustomDays([1, 2, 3, 4, 5]);
      setTargetDate(selectedDate || todayStr);
      setNotes('');
    }
    setError('');
  }, [initialRoutine, selectedDate, todayStr, isOpen, isPro]);

  if (!isOpen) return null;

  const parsedHour24 = parseInt((time || '06:00').split(':')[0] || '6', 10);
  const parsedMinStr = ((time || '06:00').split(':')[1] || '00').padStart(2, '0');
  const isPm = parsedHour24 >= 12;

  const handleSetMeridiem = (wantPm: boolean) => {
    if (wantPm && parsedHour24 < 12) {
      const nextH = String(parsedHour24 + 12).padStart(2, '0');
      setTime(`${nextH}:${parsedMinStr}`);
    } else if (!wantPm && parsedHour24 >= 12) {
      const nextH = String(parsedHour24 - 12).padStart(2, '0');
      setTime(`${nextH}:${parsedMinStr}`);
    }
  };

  const reminderTriggerTime24 = minutesToTime24(
    timeToMinutes(time) - (reminderOffset || 0)
  );

  const dayNames = [
    { idx: 0, label: t(lang, 'sun') },
    { idx: 1, label: t(lang, 'mon') },
    { idx: 2, label: t(lang, 'tue') },
    { idx: 3, label: t(lang, 'wed') },
    { idx: 4, label: t(lang, 'thu') },
    { idx: 5, label: t(lang, 'fri') },
    { idx: 6, label: t(lang, 'sat') },
  ];

  const toggleCustomDay = (dayIdx: number) => {
    setCustomDays((prev) =>
      prev.includes(dayIdx)
        ? prev.filter((d) => d !== dayIdx)
        : [...prev, dayIdx].sort()
    );
  };

  const handleCategorySelect = (cat: RoutineCategoryConfig) => {
    setCategory(cat.nameEn);
    setIcon(cat.icon);
    if (!title.trim()) {
      setTitle(lang === 'ne' ? cat.suggestedTitleNe : cat.suggestedTitleEn);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(
        lang === 'ne'
          ? 'कृपया गतिविधिको नाम लेख्नुहोस्।'
          : 'Please enter an activity name.'
      );
      return;
    }
    setSaving(true);
    setError('');
    try {
      // Request browser notification permission on routine save if not yet decided
      if (
        onRequestNotificationPermission &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'default'
      ) {
        await onRequestNotificationPermission();
      }

      await onSave({
        id: initialRoutine?.id,
        title: title.trim(),
        time: time.padStart(5, '0'),
        category,
        icon,
        reminderOffset,
        duration: duration ? Math.max(0, parseInt(duration, 10) || 0) : 0,
        repeatType,
        customDays: repeatType === 'custom' ? customDays : [0, 1, 2, 3, 4, 5, 6],
        targetDate: isPro ? targetDate : todayStr,
        clientToday: todayStr,
        timezone: userTimezone,
        notes: notes.trim(),
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not save routine.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-t-3xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 max-h-[92vh] flex flex-col overflow-hidden shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            {initialRoutine
              ? t(lang, 'editRoutineTitle')
              : t(lang, 'addRoutineTitle')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSubmit} className="overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {/* Category & Icon Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
              {t(lang, 'categoryLabel')}
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {categories.map((cat) => {
                const isSelected = category === cat.nameEn && icon === cat.icon;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => handleCategorySelect(cat)}
                    className={`min-h-[52px] p-2 rounded-xl border text-center flex flex-col items-center justify-center gap-1 transition-colors ${
                      isSelected
                        ? 'border-teal-600 bg-teal-50/80 dark:bg-teal-950/60 text-teal-900 dark:text-teal-200'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className="text-lg leading-none">{cat.icon}</span>
                    <span className="text-[11px] font-medium truncate w-full">
                      {lang === 'ne' ? cat.nameNe : cat.nameEn}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Activity Name */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t(lang, 'activityNameLabel')} *
            </label>
            <div className="flex items-center gap-2">
              <span className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl shrink-0">
                {icon}
              </span>
              <input
                type="text"
                required
                maxLength={120}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t(lang, 'activityNamePlaceholder')}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {/* Time (with explicit AM/PM toggle & local time preview) & Duration Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  {t(lang, 'timeLabel')} *
                </span>
              </label>
              <div className="flex items-center gap-1.5">
                <input
                  type="time"
                  required
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="flex-1 h-11 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
                />
                <div className="flex rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden shrink-0">
                  <button
                    type="button"
                    onClick={() => handleSetMeridiem(false)}
                    className={`h-11 px-2.5 text-xs font-mono font-bold transition-colors ${
                      !isPm
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    AM
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetMeridiem(true)}
                    className={`h-11 px-2.5 text-xs font-mono font-bold transition-colors ${
                      isPm
                        ? 'bg-teal-700 text-white'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    PM
                  </button>
                </div>
              </div>
              <p className="text-[11px] font-mono text-teal-700 dark:text-teal-400 mt-1">
                {formatTime12h(time, lang)} ({time}) · {userTimezone}
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t(lang, 'durationLabel')}
              </label>
              <input
                type="number"
                min={0}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="30"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>
          </div>

          {/* Reminder Time */}
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                <span className="inline-flex items-center gap-1">
                  <Bell className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                  {t(lang, 'reminderLabel')}
                </span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-teal-700 dark:text-teal-400">
                  🔔 {formatTime12h(reminderTriggerTime24, lang)}
                </span>
                {onTestAlarm && (
                  <button
                    type="button"
                    onClick={onTestAlarm}
                    className="px-2 py-0.5 rounded-lg border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/50 text-[11px] font-semibold text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60 transition-colors"
                  >
                    {t(lang, 'testNotificationBtn')}
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {(
                [
                  { val: 0, label: t(lang, 'reminderAtTime') },
                  { val: 5, label: t(lang, 'reminder5Min') },
                  { val: 10, label: t(lang, 'reminder10Min') },
                  { val: 15, label: t(lang, 'reminder15Min') },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => {
                    setReminderOffset(opt.val);
                    if (
                      onRequestNotificationPermission &&
                      typeof Notification !== 'undefined' &&
                      Notification.permission === 'default'
                    ) {
                      onRequestNotificationPermission();
                    }
                  }}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    reminderOffset === opt.val
                      ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {notifPermission === 'denied' && (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-800 dark:text-amber-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {lang === 'ne'
                    ? 'ब्राउजर सूचना अनुमति रोकिएको छ (Blocked)। ब्राउजरको ठेगाना बार (Address Bar) को आइकनमा थिचेर Notifications → Allow गर्नुहोस्। इन-एप अलर्ट र अलार्म घण्टी भने चालू रहनेछ।'
                    : 'Browser notifications are currently Blocked. To enable OS popups, click the site settings icon in your browser address bar and set Notifications to "Allow". In-app alarm & sound will still trigger.'}
                </span>
              </div>
            )}
          </div>

          {/* Repeat Schedule */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              <span className="inline-flex items-center gap-1">
                <Repeat className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                {t(lang, 'repeatLabel')}
              </span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { val: 'today', label: t(lang, 'repeatToday'), proOnly: false },
                  { val: 'everyday', label: t(lang, 'repeatEveryday'), proOnly: false },
                  { val: 'weekdays', label: t(lang, 'repeatWeekdays'), proOnly: true },
                  { val: 'custom', label: t(lang, 'repeatCustom'), proOnly: true },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => {
                    if (opt.proOnly && !isPro) {
                      onOpenUpgrade();
                      return;
                    }
                    setRepeatType(opt.val);
                  }}
                  className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-medium border flex items-center justify-between transition-colors ${
                    repeatType === opt.val
                      ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="truncate">{opt.label}</span>
                  {opt.proOnly && !isPro && (
                    <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0 ml-1" />
                  )}
                </button>
              ))}
            </div>

            {repeatType === 'custom' && (
              <div className="mt-2.5 flex items-center justify-between gap-1">
                {dayNames.map((d) => {
                  const active = customDays.includes(d.idx);
                  return (
                    <button
                      key={d.idx}
                      type="button"
                      onClick={() => toggleCustomDay(d.idx)}
                      className={`min-h-[40px] flex-1 rounded-lg text-xs font-medium border transition-colors ${
                        active
                          ? 'bg-teal-600 text-white border-teal-600'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              <span className="inline-flex items-center gap-1">
                <FileText className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                {t(lang, 'notesLabel')}
              </span>
            </label>
            <textarea
              rows={2}
              maxLength={500}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t(lang, 'notesPlaceholder')}
              className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
          </div>

          {/* Footer Buttons */}
          <div className="pt-2 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? '...' : t(lang, 'save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
