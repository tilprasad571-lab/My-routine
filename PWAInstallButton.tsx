import React, { useState } from 'react';
import { Download, CheckCircle2, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../utils/usePWAInstall';
import { Language } from '../types';

interface PWAInstallButtonProps {
  lang: Language;
  variant?: 'menu' | 'settings' | 'compact';
  onActionComplete?: () => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  lang,
  variant = 'menu',
  onActionComplete,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const handleInstallClick = async () => {
    const result = await install();
    if (result === 'accepted') {
      onActionComplete?.();
      return;
    }
    if (result === 'dismissed') {
      return;
    }
    setShowGuide(true);
  };

  if (isInstalled) {
    if (variant === 'settings') {
      return (
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              {lang === 'ne' ? 'एप इन्स्टल स्थिति' : 'App Installation'}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'ne'
                ? 'मेरो रुटिन स्ट्यान्डअलोन एपको रूपमा इन्स्टल भइसकेको छ।'
                : 'Mero Routine is installed as a standalone app.'}
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-xs font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>{lang === 'ne' ? 'इन्स्टल भइसक्यो' : 'Installed'}</span>
          </span>
        </div>
      );
    }
    return null;
  }

  const labelText =
    lang === 'ne'
      ? 'एप इन्स्टल / होम स्क्रिनमा राख्नुहोस्'
      : 'Install App / Add to Home Screen';

  const shortLabelText =
    lang === 'ne' ? 'एप इन्स्टल' : 'Install App';

  return (
    <>
      {variant === 'settings' ? (
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 block">
              {labelText}
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              {lang === 'ne'
                ? 'ब्राउजर बिना सिधै एपको रूपमा खोल्न होम स्क्रिनमा राख्नुहोस्।'
                : 'Install Mero Routine on your device to open in standalone fullscreen mode.'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleInstallClick}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{shortLabelText}</span>
          </button>
        </div>
      ) : variant === 'compact' ? (
        <button
          type="button"
          onClick={handleInstallClick}
          className="h-8 sm:h-9 px-2.5 sm:px-3 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-[11px] sm:text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0"
          title={labelText}
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden sm:inline whitespace-nowrap">
            {shortLabelText}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full min-h-[42px] px-3.5 py-2 rounded-xl text-xs font-semibold bg-teal-50 dark:bg-teal-950/40 text-teal-800 dark:text-teal-300 border border-teal-200/80 dark:border-teal-800/70 hover:bg-teal-100/80 dark:hover:bg-teal-900/50 flex items-center gap-2.5 transition-colors"
        >
          <Download className="w-4 h-4 shrink-0 text-teal-700 dark:text-teal-400" />
          <span className="truncate">{labelText}</span>
        </button>
      )}

      {showGuide && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white p-6 shadow-2xl space-y-4">
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
                    {lang === 'ne'
                      ? 'मेरो रुटिन एप इन्स्टल गर्नुहोस्'
                      : 'Install Mero Routine'}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lang === 'ne'
                      ? 'होम स्क्रिनबाट सिधै एप खोल्नुहोस्'
                      : 'Add to Home Screen for standalone app mode'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[34px] min-w-[34px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-teal-600" />
                  <span>
                    {lang === 'ne'
                      ? 'iPhone / iPad (Safari) मा इन्स्टल गर्ने तरिका:'
                      : 'How to install on iPhone / iPad (Safari):'}
                  </span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    {lang === 'ne' ? (
                      <>
                        Safari को तल रहेको <strong>Share (⬆️)</strong> बटनमा थिच्नुहोस्।
                      </>
                    ) : (
                      <>
                        Tap the <strong>Share (⬆️)</strong> button in Safari’s toolbar.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'ne' ? (
                      <>
                        तल स्क्रोल गरेर{' '}
                        <strong>Add to Home Screen (होम स्क्रिनमा थप्नुहोस्)</strong> छान्नुहोस्।
                      </>
                    ) : (
                      <>
                        Scroll down and tap <strong>Add to Home Screen</strong>.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'ne' ? (
                      <>
                        माथि दायाँमा <strong>Add</strong> थिच्नुहोस्।
                      </>
                    ) : (
                      <>
                        Tap <strong>Add</strong> in the top-right corner.
                      </>
                    )}
                  </li>
                </ol>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                <p className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4 text-teal-600" />
                  <span>
                    {lang === 'ne'
                      ? 'मोबाइल वा कम्प्युटरमा इन्स्टल गर्ने तरिका:'
                      : 'How to install on Android / Desktop:'}
                  </span>
                </p>
                <ol className="list-decimal list-inside space-y-1.5">
                  <li>
                    {lang === 'ne' ? (
                      <>
                        ब्राउजरको माथि दायाँ रहेको मेनु <strong>(⋮)</strong> वा एड्रेस बारको{' '}
                        <strong>Install</strong> आइकनमा थिच्नुहोस्।
                      </>
                    ) : (
                      <>
                        Open the browser menu <strong>(⋮)</strong> or click the{' '}
                        <strong>Install</strong> icon in the address bar.
                      </>
                    )}
                  </li>
                  <li>
                    {lang === 'ne' ? (
                      <>
                        <strong>Install App</strong> वा{' '}
                        <strong>Add to Home screen</strong> छान्नुहोस्।
                      </>
                    ) : (
                      <>
                        Select <strong>Install App</strong> or{' '}
                        <strong>Add to Home screen</strong>.
                      </>
                    )}
                  </li>
                </ol>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[42px] rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors"
            >
              {lang === 'ne' ? 'बुझेँ (OK)' : 'Got It'}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
