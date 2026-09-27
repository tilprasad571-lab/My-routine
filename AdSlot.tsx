import React, { useState, useEffect, useMemo } from 'react';
import { AdBanner, AdPage, AdPlacement, AdPosition, Language } from '../types';
import { t } from '../i18n/translations';
import { getLocalTodayDate } from '../utils/dateUtils';
import {
  ExternalLink,
  Sparkles,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';

interface AdSlotProps {
  ads: AdBanner[];
  placement: AdPlacement;
  isPro: boolean;
  lang: Language;
  onUpgradeClick: () => void;
}

function resolveBannerHref(rawUrl: string): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '#upgrade';
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:')
  ) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export const AdSlot: React.FC<AdSlotProps> = ({
  ads,
  placement,
  isPro,
  lang,
  onUpgradeClick,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const today = getLocalTodayDate();

  const matchingAds = useMemo(() => {
    if (isPro || !Array.isArray(ads)) return [];
    const nowMs = Date.now();
    const utcToday = new Date(nowMs).toISOString().slice(0, 10);
    const nepalToday = new Date(nowMs + (5 * 60 + 45) * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const candidateDates = [today, utcToday, nepalToday].sort();
    const earliestToday = candidateDates[0];
    const latestToday = candidateDates[candidateDates.length - 1];

    return ads
      .filter((a) => {
        if (!a || !a.active) return false;
        if (a.startDate && a.startDate > latestToday) return false;
        if (a.endDate && a.endDate < earliestToday) return false;

        if (Array.isArray(a.placements)) {
          return a.placements.includes(placement);
        }

        if (Array.isArray(a.pages) && Array.isArray(a.positions)) {
          const [slotPage, slotPos] = placement.split('_') as [
            AdPage,
            AdPosition
          ];
          return a.pages.includes(slotPage) && a.positions.includes(slotPos);
        }

        return a.placement === placement;
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }, [ads, isPro, placement, today]);

  useEffect(() => {
    if (matchingAds.length <= 1 || isPaused) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % matchingAds.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [matchingAds.length, isPaused]);

  // Pro users remain ad-free; never show empty ad containers when no active ad exists
  if (isPro || matchingAds.length === 0) return null;

  const safeIndex = currentIndex % matchingAds.length;
  const currentAd = matchingAds[safeIndex];
  const resolvedUrl = resolveBannerHref(currentAd.targetUrl);
  const isInternalUpgrade = resolvedUrl === '#upgrade';

  const handleBannerClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isInternalUpgrade) {
      e.preventDefault();
      onUpgradeClick();
    }
  };

  // Manual Banner Ad with uploaded image (supports single banner or multi-banner slideshow)
  if (currentAd.type === 'manual' && currentAd.imageUrl) {
    return (
      <div
        className="my-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-2xs transition-colors"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        onTouchStart={() => setIsPaused(true)}
        onTouchEnd={() => setIsPaused(false)}
      >
        {/* Top Header Bar: Sponsored Label + Slideshow Controls */}
        <div className="px-3.5 py-1.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-950/50 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
            <span>{t(lang, 'sponsoredLabel')}</span>
            {matchingAds.length > 1 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[10px]">
                  {safeIndex + 1} / {matchingAds.length}
                </span>
              </>
            )}
          </div>

          {matchingAds.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex(
                    (prev) => (prev - 1 + matchingAds.length) % matchingAds.length
                  )
                }
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                aria-label="Previous banner"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setCurrentIndex((prev) => (prev + 1) % matchingAds.length)
                }
                className="w-6 h-6 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                aria-label="Next banner"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Clickable Banner Slide (Shows one banner at a time, opens its configured Target URL) */}
        <a
          key={currentAd.id}
          href={resolvedUrl}
          target={isInternalUpgrade ? undefined : '_blank'}
          rel={isInternalUpgrade ? undefined : 'noopener noreferrer'}
          onClick={handleBannerClick}
          className="block group focus:outline-none"
        >
          <div className="block w-full bg-slate-900/5 dark:bg-slate-950/60 overflow-hidden p-1.5 sm:p-2">
            <img
              src={currentAd.imageUrl}
              alt={currentAd.title || 'Sponsored Banner'}
              className="w-full min-h-[60px] max-h-[200px] sm:max-h-[240px] h-auto object-contain mx-auto block rounded-xl transition-opacity duration-300"
            />
          </div>

          <div className="px-3.5 py-2.5 flex items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800/80">
            <p className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
              {currentAd.title ||
                (isInternalUpgrade
                  ? t(lang, 'navUpgrade')
                  : resolvedUrl.replace(/^https?:\/\//, ''))}
            </p>
            <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400 group-hover:underline whitespace-nowrap">
              {isInternalUpgrade ? (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{t(lang, 'navUpgrade')}</span>
                </>
              ) : (
                <>
                  <span>{lang === 'ne' ? 'खोल्नुहोस्' : 'Open Link'}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </>
              )}
            </span>
          </div>
        </a>

        {/* Pagination Dots for Multi-Banner Slideshow */}
        {matchingAds.length > 1 && (
          <div className="px-3.5 pb-2.5 flex items-center justify-center gap-1.5">
            {matchingAds.map((adItem, idx) => (
              <button
                key={adItem.id}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                aria-label={`Show banner ${idx + 1}`}
                className={`h-1.5 rounded-full transition-all ${
                  idx === safeIndex
                    ? 'w-5 bg-teal-600 dark:bg-teal-400'
                    : 'w-1.5 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400'
                }`}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Fallback for AdSense or text-only ad placements
  return (
    <div
      className="my-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100/70 dark:bg-slate-900/60 px-4 py-3 flex items-center justify-between gap-3"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span>{t(lang, 'sponsoredLabel')}</span>
          <span aria-hidden="true">·</span>
          <span>
            {currentAd.type === 'adsense'
              ? `AdSense (${currentAd.adSenseSlot || 'Auto'})`
              : 'Mero Routine Partner'}
          </span>
          {matchingAds.length > 1 && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[10px]">
                {safeIndex + 1}/{matchingAds.length}
              </span>
            </>
          )}
        </div>
        {currentAd.title && (
          <p className="text-xs font-medium text-slate-800 dark:text-slate-200 mt-0.5 truncate">
            {currentAd.title}
          </p>
        )}
      </div>

      {isInternalUpgrade ? (
        <button
          type="button"
          onClick={onUpgradeClick}
          className="shrink-0 min-h-[36px] px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>{t(lang, 'navUpgrade')}</span>
        </button>
      ) : (
        <a
          href={resolvedUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 min-h-[36px] px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium flex items-center gap-1.5 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
        >
          <span>{lang === 'ne' ? 'थप जान्नुहोस्' : 'Learn More'}</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      )}
    </div>
  );
};
