import React, { useState, useMemo } from 'react';
import {
  Routine,
  RoutineLog,
  Goal,
  RoutineTemplate,
  ProUpgradeRequest,
  TemplateItem,
  Language,
  AdBanner,
} from '../types';
import { t } from '../i18n/translations';
import {
  addDaysToDateStr,
  formatTime12h,
  getDaySummary,
  getWeekDatesMondayToSunday,
  getMonthDates,
  calculateRoutineStreaks,
} from '../utils/dateUtils';
import { AdSlot } from './AdSlot';
import {
  Lock,
  Crown,
  Calendar,
  Plus,
  Check,
  Sparkles,
  Flame,
  Target,
  Trash2,
  Edit3,
  ChevronLeft,
  ChevronRight,
  Copy,
  CheckCircle2,
  Clock,
  ArrowLeft,
} from 'lucide-react';

// Reusable Pro Lock Card
export const ProLockBanner: React.FC<{
  lang: Language;
  featureTitle: string;
  onUpgrade: () => void;
}> = ({ lang, featureTitle, onUpgrade }) => (
  <div className="p-6 rounded-2xl border border-amber-200/80 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 text-center space-y-3 my-4">
    <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto">
      <Lock className="w-6 h-6" />
    </div>
    <h3 className="text-base font-bold text-slate-900 dark:text-white">
      {featureTitle} — {t(lang, 'proFeatureLocked')}
    </h3>
    <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">
      {t(lang, 'upgradeToUnlock')}
    </p>
    <button
      type="button"
      onClick={onUpgrade}
      className="min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors"
    >
      <Crown className="w-4 h-4 shrink-0" />
      <span>{t(lang, 'navUpgrade')} — Rs.99 / month · Rs.999 / year</span>
    </button>
  </div>
);

// ==================================================
// 7. PLANNER VIEW (Today, Tomorrow, Full Week, Full Month)
// ==================================================
export const PlannerView: React.FC<{
  routines: Routine[];
  logs: RoutineLog[];
  todayStr: string;
  currentMinutes: number;
  isPro: boolean;
  lang: Language;
  ads: AdBanner[];
  onAddRoutineForDate: (dateStr: string) => void;
  onEditRoutine: (rt: Routine) => void;
  onDeleteRoutine: (id: string) => void;
  onStatusChange: (
    routineId: string,
    dateStr: string,
    status: 'done' | 'skipped' | 'snoozed',
    snoozedUntil?: string
  ) => void;
  onUpgrade: () => void;
}> = ({
  routines,
  logs,
  todayStr,
  currentMinutes,
  isPro,
  lang,
  ads,
  onAddRoutineForDate,
  onEditRoutine,
  onDeleteRoutine,
  onStatusChange,
  onUpgrade,
}) => {
  const [mode, setMode] = useState<'today' | 'tomorrow' | 'week' | 'month'>('today');
  const tomorrowStr = useMemo(() => addDaysToDateStr(todayStr, 1), [todayStr]);
  const [selectedWeekDate, setSelectedWeekDate] = useState(todayStr);

  // Month navigation
  const [monthCursor, setMonthCursor] = useState(() => {
    const [y, m] = todayStr.split('-').map(Number);
    return { year: y, month: m - 1 };
  });
  const [selectedMonthDate, setSelectedMonthDate] = useState(todayStr);

  const weekDates = useMemo(
    () => getWeekDatesMondayToSunday(todayStr),
    [todayStr]
  );

  const monthDates = useMemo(
    () => getMonthDates(monthCursor.year, monthCursor.month),
    [monthCursor]
  );

  const activeDateForList =
    mode === 'today'
      ? todayStr
      : mode === 'tomorrow'
      ? tomorrowStr
      : mode === 'week'
      ? selectedWeekDate
      : selectedMonthDate;

  const summary = useMemo(
    () =>
      getDaySummary(
        routines,
        logs,
        activeDateForList,
        todayStr,
        currentMinutes
      ),
    [routines, logs, activeDateForList, todayStr, currentMinutes]
  );

  const lockedMode = !isPro && mode !== 'today';

  const dayShortLabels = [
    t(lang, 'mon'),
    t(lang, 'tue'),
    t(lang, 'wed'),
    t(lang, 'thu'),
    t(lang, 'fri'),
    t(lang, 'sat'),
    t(lang, 'sun'),
  ];

  const monthName = new Date(
    monthCursor.year,
    monthCursor.month,
    1
  ).toLocaleString(lang === 'ne' ? 'ne-NP' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {t(lang, 'plannerTitle')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {activeDateForList} · {summary.planned} {t(lang, 'routinesScheduled')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!isPro && activeDateForList > todayStr) {
              onUpgrade();
              return;
            }
            onAddRoutineForDate(activeDateForList);
          }}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t(lang, 'addRoutine')}</span>
        </button>
      </div>

      <AdSlot
        ads={ads}
        placement="planner_top"
        isPro={isPro}
        lang={lang}
        onUpgradeClick={onUpgrade}
      />

      {/* Mode Switcher */}
      <div className="grid grid-cols-4 gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl">
        {(
          [
            { id: 'today', label: t(lang, 'todayTab'), pro: false },
            { id: 'tomorrow', label: t(lang, 'tomorrowTab'), pro: true },
            { id: 'week', label: t(lang, 'weekTab'), pro: true },
            { id: 'month', label: t(lang, 'monthTab'), pro: true },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setMode(tab.id)}
            className={`min-h-[40px] px-2 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
              mode === tab.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            <span className="truncate">{tab.label}</span>
            {tab.pro && !isPro && (
              <Lock className="w-3 h-3 text-amber-500 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {lockedMode ? (
        <ProLockBanner
          lang={lang}
          featureTitle={
            mode === 'tomorrow'
              ? t(lang, 'tomorrowTab')
              : mode === 'week'
              ? t(lang, 'weekTab')
              : t(lang, 'monthTab')
          }
          onUpgrade={onUpgrade}
        />
      ) : (
        <>
          {/* Week Horizontal Scroller (Monday - Sunday) */}
          {mode === 'week' && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {weekDates.map((dStr, idx) => {
                const daySummary = getDaySummary(
                  routines,
                  logs,
                  dStr,
                  todayStr,
                  currentMinutes
                );
                const isSelected = selectedWeekDate === dStr;
                const dayNum = dStr.slice(8, 10);
                return (
                  <button
                    key={dStr}
                    type="button"
                    onClick={() => setSelectedWeekDate(dStr)}
                    className={`min-w-[64px] min-h-[68px] p-2.5 rounded-2xl border flex flex-col items-center justify-center gap-1 shrink-0 transition-colors ${
                      isSelected
                        ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <span className="text-[11px] opacity-80">
                      {dayShortLabels[idx]}
                    </span>
                    <span className="text-sm font-bold font-mono tabular-nums">
                      {dayNum}
                    </span>
                    <span className="text-[10px] font-mono opacity-75">
                      {daySummary.completed}/{daySummary.planned}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Month Calendar Grid */}
          {mode === 'month' && (
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() =>
                    setMonthCursor((prev) =>
                      prev.month === 0
                        ? { year: prev.year - 1, month: 11 }
                        : { year: prev.year, month: prev.month - 1 }
                    )
                  }
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-bold text-slate-900 dark:text-white">
                  {monthName}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setMonthCursor((prev) =>
                      prev.month === 11
                        ? { year: prev.year + 1, month: 0 }
                        : { year: prev.year, month: prev.month + 1 }
                    )
                  }
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {monthDates.map((dStr) => {
                  const ds = getDaySummary(
                    routines,
                    logs,
                    dStr,
                    todayStr,
                    currentMinutes
                  );
                  const active = selectedMonthDate === dStr;
                  return (
                    <button
                      key={dStr}
                      type="button"
                      onClick={() => setSelectedMonthDate(dStr)}
                      className={`min-h-[48px] p-1.5 rounded-xl border flex flex-col items-center justify-center transition-colors ${
                        active
                          ? 'bg-slate-900 dark:bg-teal-600 text-white border-slate-900 dark:border-teal-600'
                          : dStr === todayStr
                          ? 'border-teal-600 text-teal-700 dark:text-teal-300 bg-teal-50/40 dark:bg-teal-950/30'
                          : 'border-slate-100 dark:border-slate-800/80 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="text-xs font-mono tabular-nums font-semibold">
                        {Number(dStr.slice(8, 10))}
                      </span>
                      <span className="text-[10px] font-mono opacity-75">
                        {ds.planned > 0 ? `${ds.completed}/${ds.planned}` : '·'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Routines List for Selected Date */}
          <div className="space-y-2.5">
            {summary.dayRoutines.length === 0 ? (
              <div className="p-8 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-center space-y-2">
                <Calendar className="w-8 h-8 text-slate-400 mx-auto" />
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  {t(lang, 'emptyTimelineTitle')}
                </p>
                <p className="text-xs text-slate-500">
                  {t(lang, 'emptyTimelineDesc')}
                </p>
              </div>
            ) : (
              summary.dayRoutines.map((rt) => {
                const log = logs.find(
                  (l) => l.routineId === rt.id && l.date === activeDateForList
                );
                const status = log?.status || 'upcoming';
                return (
                  <div
                    key={rt.id}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3">
                      <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg shrink-0">
                        {rt.icon}
                      </span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono tabular-nums font-semibold text-teal-700 dark:text-teal-400">
                            {formatTime12h(rt.time, lang)}
                          </span>
                          <span aria-hidden="true" className="text-slate-300">
                            ·
                          </span>
                          <span className="text-xs text-slate-500">
                            {rt.category}
                          </span>
                          {rt.duration > 0 && (
                            <>
                              <span aria-hidden="true" className="text-slate-300">
                                ·
                              </span>
                              <span className="text-xs font-mono text-slate-500">
                                {rt.duration} {t(lang, 'minutesShort')}
                              </span>
                            </>
                          )}
                        </div>
                        <h4
                          className={`text-sm font-semibold mt-0.5 ${
                            status === 'done'
                              ? 'line-through text-slate-400'
                              : 'text-slate-900 dark:text-white'
                          }`}
                        >
                          {rt.title}
                        </h4>
                        {rt.notes && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {rt.notes}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 self-end sm:self-center">
                      <button
                        type="button"
                        onClick={() =>
                          onStatusChange(rt.id, activeDateForList, 'done')
                        }
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          status === 'done'
                            ? 'bg-emerald-700 text-white border-emerald-700'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/40'
                        }`}
                      >
                        {t(lang, 'markDone')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onStatusChange(rt.id, activeDateForList, 'skipped')
                        }
                        className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          status === 'skipped'
                            ? 'bg-amber-600 text-white border-amber-600'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {t(lang, 'skip')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onEditRoutine(rt)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                        aria-label="Edit routine"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteRoutine(rt.id)}
                        className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-400 hover:text-red-600"
                        aria-label="Delete routine"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      <AdSlot
        ads={ads}
        placement="planner_bottom"
        isPro={isPro}
        lang={lang}
        onUpgradeClick={onUpgrade}
      />
    </div>
  );
};

// ==================================================
// 8. REPORTS VIEW (Today's Report Free; Weekly & Monthly Pro)
// ==================================================
export const ReportsView: React.FC<{
  routines: Routine[];
  logs: RoutineLog[];
  todayStr: string;
  currentMinutes: number;
  isPro: boolean;
  lang: Language;
  ads: AdBanner[];
  onUpgrade: () => void;
}> = ({
  routines,
  logs,
  todayStr,
  currentMinutes,
  isPro,
  lang,
  ads,
  onUpgrade,
}) => {
  const [tab, setTab] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const todaySummary = useMemo(
    () => getDaySummary(routines, logs, todayStr, todayStr, currentMinutes),
    [routines, logs, todayStr, currentMinutes]
  );

  // Weekly Report computed strictly from actual user activity
  const weeklyData = useMemo(() => {
    const weekDates = getWeekDatesMondayToSunday(todayStr);
    let totalPlanned = 0;
    let totalCompleted = 0;
    let totalMissed = 0;
    let totalSkipped = 0;
    let bestDay = { date: weekDates[0], pct: -1, completed: 0 };

    const daysBreakdown = weekDates.map((dStr) => {
      // Only count missed up to today
      const ds = getDaySummary(routines, logs, dStr, todayStr, currentMinutes);
      if (dStr <= todayStr) {
        totalPlanned += ds.planned;
        totalCompleted += ds.completed;
        totalMissed += ds.missed;
        totalSkipped += ds.skipped;
        if (ds.completionPct > bestDay.pct && ds.completed > 0) {
          bestDay = { date: dStr, pct: ds.completionPct, completed: ds.completed };
        }
      }
      return { date: dStr, ...ds };
    });

    const weeklyPct =
      totalPlanned > 0 ? Math.round((totalCompleted / totalPlanned) * 100) : 0;

    return {
      totalPlanned,
      totalCompleted,
      totalMissed,
      totalSkipped,
      weeklyPct,
      bestDay,
      daysBreakdown,
    };
  }, [routines, logs, todayStr, currentMinutes]);

  // Monthly Report computed strictly from actual user activity
  const monthlyData = useMemo(() => {
    const [y, m] = todayStr.split('-').map(Number);
    const monthDates = getMonthDates(y, m - 1);
    let planned = 0;
    let completed = 0;
    let missed = 0;
    let skipped = 0;

    const calendarDays = monthDates.map((dStr) => {
      const ds = getDaySummary(routines, logs, dStr, todayStr, currentMinutes);
      if (dStr <= todayStr) {
        planned += ds.planned;
        completed += ds.completed;
        missed += ds.missed;
        skipped += ds.skipped;
      }
      return { date: dStr, ...ds };
    });

    const completionPct =
      planned > 0 ? Math.round((completed / planned) * 100) : 0;
    const monthLabel = new Date(y, m - 1, 1).toLocaleString(
      lang === 'ne' ? 'ne-NP' : 'en-US',
      { month: 'long', year: 'numeric' }
    );

    return {
      monthLabel,
      planned,
      completed,
      missed,
      skipped,
      completionPct,
      calendarDays,
    };
  }, [routines, logs, todayStr, currentMinutes, lang]);

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">
        {t(lang, 'reportsTitle')}
      </h1>

      <AdSlot
        ads={ads}
        placement="reports_top"
        isPro={isPro}
        lang={lang}
        onUpgradeClick={onUpgrade}
      />

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 dark:bg-slate-900 rounded-xl">
        {(
          [
            { id: 'daily', label: t(lang, 'dailyReportTab'), pro: false },
            { id: 'weekly', label: t(lang, 'weeklyReportTab'), pro: true },
            { id: 'monthly', label: t(lang, 'monthlyReportTab'), pro: true },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`min-h-[40px] px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors ${
              tab === item.id
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <span className="truncate">{item.label}</span>
            {item.pro && !isPro && (
              <Lock className="w-3 h-3 text-amber-500 shrink-0" />
            )}
          </button>
        ))}
      </div>

      {/* DAILY REPORT (FREE) */}
      {tab === 'daily' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-500 block">
                {t(lang, 'plannedCount')}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1 block">
                {todaySummary.planned}
              </span>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-500 block">
                {t(lang, 'completedCount')}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-emerald-600 mt-1 block">
                {todaySummary.completed}
              </span>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-500 block">
                {t(lang, 'missedCount')}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-red-600 mt-1 block">
                {todaySummary.missed}
              </span>
            </div>
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-500 block">
                {t(lang, 'skippedCount')}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-amber-600 mt-1 block">
                {todaySummary.skipped}
              </span>
            </div>
            <div className="col-span-2 sm:col-span-1 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <span className="text-xs text-slate-500 block">
                {t(lang, 'completionPercent')}
              </span>
              <span className="text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400 mt-1 block">
                {todaySummary.completionPct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* WEEKLY REPORT (PRO) */}
      {tab === 'weekly' &&
        (!isPro ? (
          <ProLockBanner
            lang={lang}
            featureTitle={t(lang, 'weeklyReportTab')}
            onUpgrade={onUpgrade}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-xs text-slate-500 block">
                  {t(lang, 'completionPercent')}
                </span>
                <span className="text-2xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400 mt-1 block">
                  {weeklyData.weeklyPct}%
                </span>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-xs text-slate-500 block">
                  {t(lang, 'bestDayLabel')}
                </span>
                <span className="text-base font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-1 block">
                  {weeklyData.bestDay.pct >= 0
                    ? `${weeklyData.bestDay.date} (${weeklyData.bestDay.pct}%)`
                    : t(lang, 'noActivityYet')}
                </span>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-xs text-slate-500 block">
                  {t(lang, 'completedCount')}
                </span>
                <span className="text-2xl font-bold font-mono tabular-nums text-emerald-600 mt-1 block">
                  {weeklyData.totalCompleted}
                </span>
              </div>
              <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-xs text-slate-500 block">
                  {t(lang, 'missedCount')}
                </span>
                <span className="text-2xl font-bold font-mono tabular-nums text-red-600 mt-1 block">
                  {weeklyData.totalMissed}
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2.5">
              {weeklyData.daysBreakdown.map((d) => (
                <div
                  key={d.date}
                  className="flex items-center justify-between py-2 border-b last:border-b-0 border-slate-100 dark:border-slate-800 text-xs"
                >
                  <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                    {d.date}
                  </span>
                  <div className="flex items-center gap-3 font-mono tabular-nums">
                    <span className="text-emerald-600">
                      {d.completed} {t(lang, 'completedCount')}
                    </span>
                    <span>·</span>
                    <span className="text-red-600">
                      {d.missed} {t(lang, 'missedCount')}
                    </span>
                    <span>·</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {d.completionPct}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

      {/* MONTHLY REPORT (PRO) */}
      {tab === 'monthly' &&
        (!isPro ? (
          <ProLockBanner
            lang={lang}
            featureTitle={t(lang, 'monthlyReportTab')}
            onUpgrade={onUpgrade}
          />
        ) : (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <h3 className="text-base font-bold text-slate-900 dark:text-white mb-3">
                {monthlyData.monthLabel}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <div>
                  <span className="text-xs text-slate-500 block">
                    {t(lang, 'plannedCount')}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums">
                    {monthlyData.planned}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">
                    {t(lang, 'completedCount')}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-emerald-600">
                    {monthlyData.completed}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">
                    {t(lang, 'missedCount')}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-red-600">
                    {monthlyData.missed}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">
                    {t(lang, 'skippedCount')}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-amber-600">
                    {monthlyData.skipped}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-slate-500 block">
                    {t(lang, 'completionPercent')}
                  </span>
                  <span className="text-xl font-bold font-mono tabular-nums text-teal-700 dark:text-teal-400">
                    {monthlyData.completionPct}%
                  </span>
                </div>
              </div>
            </div>

            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
                {t(lang, 'calendarOverview')}
              </h4>
              <div className="grid grid-cols-7 gap-1.5">
                {monthlyData.calendarDays.map((cd) => (
                  <div
                    key={cd.date}
                    className={`p-2 rounded-xl border text-center ${
                      cd.completed > 0
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/30'
                        : 'border-slate-100 dark:border-slate-800'
                    }`}
                  >
                    <span className="text-xs font-mono font-semibold block">
                      {Number(cd.date.slice(8, 10))}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {cd.date <= todayStr ? `${cd.completionPct}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

      <AdSlot
        ads={ads}
        placement="reports_bottom"
        isPro={isPro}
        lang={lang}
        onUpgradeClick={onUpgrade}
      />
    </div>
  );
};

// ==================================================
// 9. HABITS & STREAKS VIEW (PRO)
// ==================================================
export const HabitsStreaksView: React.FC<{
  routines: Routine[];
  logs: RoutineLog[];
  todayStr: string;
  isPro: boolean;
  lang: Language;
  onUpgrade: () => void;
}> = ({ routines, logs, todayStr, isPro, lang, onUpgrade }) => {
  const streakData = useMemo(
    () => calculateRoutineStreaks(routines, logs, todayStr),
    [routines, logs, todayStr]
  );

  if (!isPro) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'habitsTitle')}
        </h1>
        <ProLockBanner
          lang={lang}
          featureTitle={t(lang, 'habitsTitle')}
          onUpgrade={onUpgrade}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">
        {t(lang, 'habitsTitle')}
      </h1>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center shrink-0">
            <Flame className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">
              {t(lang, 'currentStreak')}
            </span>
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {streakData.currentOverallStreak} {t(lang, 'daysUnit')}
            </span>
          </div>
        </div>

        <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-teal-100 dark:bg-teal-950/60 text-teal-700 dark:text-teal-400 flex items-center justify-center shrink-0">
            <Crown className="w-6 h-6" />
          </div>
          <div>
            <span className="text-xs text-slate-500 block">
              {t(lang, 'bestStreak')}
            </span>
            <span className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white">
              {streakData.bestOverallStreak} {t(lang, 'daysUnit')}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-2.5">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {t(lang, 'habitCompletion')}
        </h2>
        {streakData.habitStreaks.map((hs) => (
          <div
            key={hs.routine.id}
            className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-lg">
                {hs.routine.icon}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {hs.routine.title}
                </p>
                <p className="text-xs text-slate-500 font-mono">
                  {formatTime12h(hs.routine.time, lang)} · {t(lang, 'bestStreak')}:{' '}
                  {hs.bestStreak} {t(lang, 'daysUnit')}
                </p>
              </div>
            </div>

            <div className="text-right font-mono tabular-nums">
              <span className="text-sm font-bold text-teal-700 dark:text-teal-400">
                {hs.currentStreak} {t(lang, 'dayStreak')}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==================================================
// 10. GOALS VIEW (PRO)
// ==================================================
export const GoalsView: React.FC<{
  goals: Goal[];
  todayStr: string;
  isPro: boolean;
  lang: Language;
  onCreateGoal: (data: {
    title: string;
    category: string;
    targetDays: number;
    startDate: string;
    endDate: string;
  }) => Promise<void>;
  onToggleGoalCheckIn: (goalId: string, dateStr: string) => Promise<void>;
  onDeleteGoal: (goalId: string) => Promise<void>;
  onUpgrade: () => void;
}> = ({
  goals,
  todayStr,
  isPro,
  lang,
  onCreateGoal,
  onToggleGoalCheckIn,
  onDeleteGoal,
  onUpgrade,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Morning');
  const [targetDays, setTargetDays] = useState('30');
  const [startDate, setStartDate] = useState(todayStr);
  const [endDate, setEndDate] = useState(() => addDaysToDateStr(todayStr, 30));

  if (!isPro) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'goalsTitle')}
        </h1>
        <ProLockBanner
          lang={lang}
          featureTitle={t(lang, 'goalsTitle')}
          onUpgrade={onUpgrade}
        />
      </div>
    );
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    await onCreateGoal({
      title: title.trim(),
      category,
      targetDays: Math.max(1, parseInt(targetDays, 10) || 30),
      startDate,
      endDate,
    });
    setTitle('');
    setShowForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'goalsTitle')}
        </h1>
        <button
          type="button"
          onClick={() => setShowForm(!showForm)}
          className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <Target className="w-4 h-4" />
          <span>{t(lang, 'addGoalBtn')}</span>
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleAdd}
          className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">
                {t(lang, 'goalNameLabel')}
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Wake up at 5 AM, Meditation"
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">
                {t(lang, 'targetDaysLabel')}
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={targetDays}
                onChange={(e) => {
                  setTargetDays(e.target.value);
                  const d = parseInt(e.target.value, 10) || 30;
                  setEndDate(addDaysToDateStr(startDate, d));
                }}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">
                {t(lang, 'startDateLabel')}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300 block mb-1">
                {t(lang, 'endDateLabel')}
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="min-h-[40px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              type="submit"
              className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 text-white text-xs font-medium"
            >
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        {goals.map((g) => {
          const pct = Math.min(
            100,
            Math.round((g.completedDays / Math.max(1, g.targetDays)) * 100)
          );
          const checkedToday = g.checkedDates?.includes(todayStr);
          return (
            <div
              key={g.id}
              className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    {g.title}
                  </h3>
                  <p className="text-xs text-slate-500 font-mono mt-0.5">
                    {g.startDate} → {g.endDate} · {g.completedDays}/{g.targetDays}{' '}
                    {t(lang, 'daysUnit')}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleGoalCheckIn(g.id, todayStr)}
                    className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors ${
                      checkedToday
                        ? 'bg-emerald-700 text-white'
                        : 'border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>
                      {checkedToday
                        ? t(lang, 'checkedInToday')
                        : t(lang, 'checkInToday')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteGoal(g.id)}
                    className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600"
                    aria-label="Delete goal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs font-mono mb-1">
                  <span className="text-slate-500">{t(lang, 'goalProgress')}</span>
                  <span className="font-semibold text-teal-700 dark:text-teal-400">
                    {pct}%
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-600 rounded-full transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ==================================================
// 11. AI ROUTINE BUILDER VIEW (PRO)
// ==================================================
export const AiRoutineBuilderView: React.FC<{
  token: string;
  isPro: boolean;
  lang: Language;
  onApplyGeneratedRoutines: (
    items: TemplateItem[],
    mode: 'merge' | 'replace'
  ) => Promise<void>;
  onUpgrade: () => void;
}> = ({ token, isPro, lang, onApplyGeneratedRoutines, onUpgrade }) => {
  const [prompt, setPrompt] = useState(
    lang === 'ne'
      ? 'म बिहान ५ बजे उठ्छु, ६ बजे जिम जान्छु, ८ बजे काम गर्छु, बेलुका ६ बजे अध्ययन गर्छु र राति १० बजे सुत्छु।'
      : 'I wake up at 5 AM, go to the gym at 6 AM, work at 8 AM, study at 6 PM and sleep at 10 PM.'
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedItems, setGeneratedItems] = useState<TemplateItem[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  if (!isPro) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'aiBuilderTitle')}
        </h1>
        <ProLockBanner
          lang={lang}
          featureTitle={t(lang, 'aiBuilderTitle')}
          onUpgrade={onUpgrade}
        />
      </div>
    );
  }

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ai/generate-routine', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ prompt, language: lang }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Failed to generate routine');
      }
      const data = await res.json();
      setGeneratedItems(data.items || []);
    } catch (err: any) {
      setError(err?.message || 'Error generating routine.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateGeneratedItem = (
    idx: number,
    field: keyof TemplateItem,
    value: string | number
  ) => {
    setGeneratedItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it))
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'aiBuilderTitle')}
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {t(lang, 'aiBuilderDesc')}
        </p>
      </div>

      <form
        onSubmit={handleGenerate}
        className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
      >
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(lang, 'aiPromptPlaceholder')}
          className="w-full p-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-600"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="min-h-[44px] px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Sparkles className="w-4 h-4" />
          <span>
            {loading
              ? t(lang, 'generatingRoutine')
              : t(lang, 'generateRoutineBtn')}
          </span>
        </button>
      </form>

      {generatedItems.length > 0 && (
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t(lang, 'generatedPreviewTitle')} ({generatedItems.length})
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setEditingIndex(editingIndex === null ? 0 : null)
                }
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                {t(lang, 'edit')}
              </button>
              <button
                type="button"
                onClick={() => setGeneratedItems([])}
                className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-medium text-slate-600"
              >
                {t(lang, 'cancel')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(true)}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
              >
                {t(lang, 'applyRoutineBtn')}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {generatedItems.map((item, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                {editingIndex !== null ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
                    <input
                      type="time"
                      value={item.time}
                      onChange={(e) =>
                        handleUpdateGeneratedItem(idx, 'time', e.target.value)
                      }
                      className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs font-mono"
                    />
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) =>
                        handleUpdateGeneratedItem(idx, 'title', e.target.value)
                      }
                      className="h-9 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-xs sm:col-span-2"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{item.icon}</span>
                    <div>
                      <span className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-400">
                        {formatTime12h(item.time, lang)}
                      </span>
                      <span className="mx-2 text-slate-300">·</span>
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </span>
                      {item.notes && (
                        <p className="text-xs text-slate-500">{item.notes}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal so existing routines are NEVER overwritten without confirmation */}
      {confirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t(lang, 'confirmApplyTitle')}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300">
              {t(lang, 'confirmApplyMessage')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={async () => {
                  await onApplyGeneratedRoutines(generatedItems, 'merge');
                  setConfirmModalOpen(false);
                  setGeneratedItems([]);
                }}
                className="min-h-[44px] w-full px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold"
              >
                {t(lang, 'mergeWithExisting')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onApplyGeneratedRoutines(generatedItems, 'replace');
                  setConfirmModalOpen(false);
                  setGeneratedItems([]);
                }}
                className="min-h-[44px] w-full px-4 py-2 rounded-xl border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold"
              >
                {t(lang, 'replaceExisting')}
              </button>
              <button
                type="button"
                onClick={() => setConfirmModalOpen(false)}
                className="min-h-[40px] w-full px-4 py-2 rounded-xl text-xs text-slate-500"
              >
                {t(lang, 'cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================================================
// 12. ROUTINE TEMPLATES VIEW (PRO)
// ==================================================
export const RoutineTemplatesView: React.FC<{
  templates: RoutineTemplate[];
  currentRoutines: Routine[];
  isPro: boolean;
  lang: Language;
  onSaveTemplate: (name: string, description: string) => Promise<void>;
  onApplyTemplate: (
    items: TemplateItem[],
    mode: 'merge' | 'replace'
  ) => Promise<void>;
  onDeleteTemplate: (id: string) => Promise<void>;
  onUpgrade: () => void;
}> = ({
  templates,
  currentRoutines,
  isPro,
  lang,
  onSaveTemplate,
  onApplyTemplate,
  onDeleteTemplate,
  onUpgrade,
}) => {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [showSaveModal, setShowSaveModal] = useState(false);

  if (!isPro) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'templatesTitle')}
        </h1>
        <ProLockBanner
          lang={lang}
          featureTitle={t(lang, 'templatesTitle')}
          onUpgrade={onUpgrade}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">
          {t(lang, 'templatesTitle')}
        </h1>
        {currentRoutines.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSaveModal(!showSaveModal)}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" />
            <span>{t(lang, 'saveCurrentAsTemplate')}</span>
          </button>
        )}
      </div>

      {showSaveModal && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            await onSaveTemplate(name.trim(), desc.trim());
            setName('');
            setDesc('');
            setShowSaveModal(false);
          }}
          className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
        >
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t(lang, 'templateNameLabel')}
            className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs"
          />
          <input
            type="text"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder={t(lang, 'templateDescLabel')}
            className="w-full h-10 px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white text-xs"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowSaveModal(false)}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs"
            >
              {t(lang, 'cancel')}
            </button>
            <button
              type="submit"
              className="min-h-[38px] px-4 py-1.5 rounded-xl bg-teal-700 text-white text-xs font-medium"
            >
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {lang === 'ne' && tpl.nameNe ? tpl.nameNe : tpl.name}
                </h3>
                <span className="text-xs text-slate-500">
                  {tpl.userId === 'system'
                    ? t(lang, 'builtInTemplate')
                    : t(lang, 'customTemplate')}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                {lang === 'ne' && tpl.descriptionNe
                  ? tpl.descriptionNe
                  : tpl.description}
              </p>
              <div className="space-y-1 pt-1">
                {tpl.items.slice(0, 5).map((it, i) => (
                  <div
                    key={i}
                    className="text-xs text-slate-700 dark:text-slate-300 flex items-center gap-2"
                  >
                    <span className="font-mono text-teal-700 dark:text-teal-400">
                      {formatTime12h(it.time, lang)}
                    </span>
                    <span>·</span>
                    <span>
                      {it.icon} {it.title}
                    </span>
                  </div>
                ))}
                {tpl.items.length > 5 && (
                  <p className="text-[11px] text-slate-400">
                    +{tpl.items.length - 5} more activities
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onApplyTemplate(tpl.items, 'replace')}
                className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-900 dark:bg-teal-600 text-white text-xs font-medium"
              >
                {t(lang, 'applyTemplateBtn')}
              </button>
              {tpl.userId !== 'system' && (
                <button
                  type="button"
                  onClick={() => onDeleteTemplate(tpl.id)}
                  className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600"
                  aria-label="Delete template"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ==================================================
// 18. UPGRADE TO PRO VIEW (Rs.99 / month & Rs.999 / year Manual Flow)
// ==================================================
export const UpgradeProView: React.FC<{
  isPro: boolean;
  proExpiry: string;
  proRequests: ProUpgradeRequest[];
  lang: Language;
  onSubmitProRequest: (data: {
    referenceId: string;
    paymentMethod: string;
    senderInfo: string;
    planType: 'monthly' | 'yearly';
    amount: number;
  }) => Promise<void>;
  onBack: () => void;
}> = ({
  isPro,
  proExpiry,
  proRequests,
  lang,
  onSubmitProRequest,
  onBack,
}) => {
  const [referenceId] = useState(
    () => `MR-PRO-${Math.floor(100000 + Math.random() * 900000)}`
  );
  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'yearly'>('monthly');
  const [paymentMethod, setPaymentMethod] = useState('eSewa');
  const [senderInfo, setSenderInfo] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState('');

  const latestRequest = proRequests[0] || null;
  const selectedAmount = selectedPlan === 'yearly' ? 999 : 99;
  const selectedPlanLabel =
    selectedPlan === 'yearly' ? 'Rs.999 / year' : 'Rs.99 / month';

  const handleCopyRef = () => {
    navigator.clipboard?.writeText(referenceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderInfo.trim()) return;
    setSubmitting(true);
    try {
      await onSubmitProRequest({
        referenceId,
        paymentMethod,
        senderInfo: senderInfo.trim(),
        planType: selectedPlan,
        amount: selectedAmount,
      });
      setMsg(
        lang === 'ne'
          ? `तपाईँको प्रो प्रमाणीकरण अनुरोध (${selectedPlanLabel}) सुरक्षित गरियो। एडमिन स्वीकृति पछि प्रो सक्रिय हुनेछ।`
          : `Your Pro verification request (${selectedPlanLabel}) has been saved. Pro activates once approved by Admin.`
      );
      setSenderInfo('');
    } finally {
      setSubmitting(false);
    }
  };

  const proBenefits =
    lang === 'ne'
      ? [
          'भोलिको योजना (Tomorrow Planning)',
          'पूरा हप्ता र महिनाको योजनाकार (Week & Month Planner)',
          'दैनिक, साप्ताहिक र मासिक प्रतिवेदन (Reports)',
          'बानी र निरन्तरता ट्र्याकिङ (Habit & Streak Tracking)',
          'उन्नत दोहोरिने सम्झनाहरू (Advanced Recurring Reminders)',
          'रुटिन टेम्प्लेट र असीमित लक्ष्यहरू (Templates & Goals)',
          'AI रुटिन निर्माणकर्ता (AI Routine Builder)',
          'क्लाउड सिंक र शून्य विज्ञापन (Cloud Sync & No Ads)',
        ]
      : [
          'Tomorrow Planning & Future Scheduling',
          'Full Week Planner (Monday–Sunday) & Full Month Calendar',
          'Detailed Daily, Weekly & Monthly Progress Reports',
          'Habit Consistency & Streak Tracking',
          'Advanced Recurring Reminders (Weekdays & Custom Days)',
          'Multiple Routine Templates & Unlimited Personal Goals',
          'AI Routine Builder (Natural Language to Schedule)',
          'Cloud Sync/Backup & 100% Ad-Free Experience',
        ];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t(lang, 'back')}</span>
        </button>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {t(lang, 'upgradeTitle')}
          </h1>
          <p className="text-xs font-mono font-semibold text-teal-700 dark:text-teal-400">
            {t(lang, 'upgradePrice')}
          </p>
        </div>
      </div>

      {/* Active Pro Banner */}
      {isPro && (
        <div className="p-5 rounded-2xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/40 flex items-center gap-3.5">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-emerald-950 dark:text-emerald-200">
              {t(lang, 'requestApprovedTitle')}
            </h3>
            <p className="text-xs text-emerald-800 dark:text-emerald-300 font-mono">
              {t(lang, 'proExpiresOn')} {proExpiry || 'Active'}
            </p>
          </div>
        </div>
      )}

      {/* Pending Request Status */}
      {!isPro && latestRequest && latestRequest.status === 'pending' && (
        <div className="p-5 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 space-y-1.5">
          <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold text-sm">
            <Clock className="w-4 h-4" />
            <span>{t(lang, 'requestPendingTitle')}</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t(lang, 'requestPendingDesc')}
          </p>
          <p className="text-xs font-mono text-slate-700 dark:text-slate-300">
            Reference ID: {latestRequest.referenceId} · Method:{' '}
            {latestRequest.paymentMethod} · Plan:{' '}
            {latestRequest.amount === 999 ? 'Rs.999 / year' : 'Rs.99 / month'}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-400 pt-1">
            Payment Verification Support:{' '}
            <span className="font-mono font-medium">roilaofficial571@gmail.com</span>{' '}
            · eSewa/Khalti: <span className="font-mono font-medium">9748711951</span>
          </p>
        </div>
      )}

      {/* Monthly & Yearly Pricing Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <button
          type="button"
          onClick={() => setSelectedPlan('monthly')}
          className={`p-5 rounded-2xl border text-left transition-all ${
            selectedPlan === 'monthly'
              ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-600/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {lang === 'ne' ? 'मासिक योजना (Monthly)' : 'Monthly Plan'}
            </span>
            {selectedPlan === 'monthly' && (
              <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            )}
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
            Rs.99 / month
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {lang === 'ne'
              ? '३० दिनको पूर्ण प्रो सुविधा (रु. ९९ / महिना)'
              : 'Full Pro access billed monthly (30 days)'}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setSelectedPlan('yearly')}
          className={`p-5 rounded-2xl border text-left transition-all ${
            selectedPlan === 'yearly'
              ? 'border-teal-600 bg-teal-50/40 dark:bg-teal-950/30 ring-2 ring-teal-600/20'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
              {lang === 'ne' ? 'वार्षिक योजना (Yearly)' : 'Yearly Plan'}
            </span>
            {selectedPlan === 'yearly' && (
              <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400" />
            )}
          </div>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 dark:text-white mt-2">
            Rs.999 / year
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {lang === 'ne'
              ? '३६५ दिनको पूर्ण प्रो सुविधा (रु. ९९९ / वर्ष)'
              : 'Full year of Pro access (365 days)'}
          </p>
        </button>
      </div>

      {/* Plan Comparison & Benefits */}
      <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t(lang, 'proPlanTitle')}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {t(lang, 'upgradeSubtitle')}
            </p>
          </div>
          <div className="text-right font-mono tabular-nums shrink-0">
            <span className="text-sm font-bold text-teal-700 dark:text-teal-400 block">
              Rs.99 / month
            </span>
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 block">
              Rs.999 / year
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {proBenefits.map((b, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200">
              <Check className="w-4 h-4 text-teal-600 shrink-0 mt-0.5" />
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Manual Payment & Verification Request Form */}
      {!isPro && (
        <form
          onSubmit={handleSubmit}
          className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {t(lang, 'paymentInstructionsTitle')}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {t(lang, 'paymentInstructionsDesc')}
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs space-y-1.5 font-mono">
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              eSewa / Khalti: 9748711951
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              Contact email: roilaofficial571@gmail.com
            </p>
            <p className="text-slate-600 dark:text-slate-300">
              Pricing: Rs.99 / month · Rs.999 / year
            </p>
            <p className="text-teal-700 dark:text-teal-400 font-semibold">
              Selected Plan: {selectedPlanLabel} · Remarks: Include your Reference ID below
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
              {t(lang, 'referenceIdLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={referenceId}
                className="flex-1 h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-white text-sm font-mono font-semibold"
              />
              <button
                type="button"
                onClick={handleCopyRef}
                className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                {t(lang, 'paymentMethodLabel')}
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
              >
                <option value="eSewa">eSewa Wallet (9748711951)</option>
                <option value="Khalti">Khalti Wallet (9748711951)</option>
                <option value="Bank Transfer">Bank / Fonepay Transfer</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 block mb-1">
                {t(lang, 'senderInfoLabel')} *
              </label>
              <input
                type="text"
                required
                value={senderInfo}
                onChange={(e) => setSenderInfo(e.target.value)}
                placeholder="e.g., 9841XXXXXX / Txn ID"
                className="w-full h-11 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
              />
            </div>
          </div>

          {msg && (
            <div className="p-3 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 text-xs text-teal-800 dark:text-teal-200">
              {msg}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="min-h-[48px] w-full px-5 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {submitting ? '...' : t(lang, 'submitPaymentRequestBtn')}
          </button>
        </form>
      )}
    </div>
  );
};
