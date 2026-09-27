import { useEffect, useState, useCallback, useRef } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
    __meroSwUpdateReg?: ServiceWorkerRegistration | null;
  }
  interface Navigator {
    getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string; url?: string }>>;
  }
}

export const PWA_INSTALLED_STORAGE_KEY = 'mero_routine_pwa_installed_v1';
export const CLIENT_APP_VERSION = '1.0.0';
export const PWA_APPLIED_BUILD_KEY = 'mero_routine_applied_build_v1';
export const PWA_JUST_UPDATED_SESSION_KEY = 'mero_routine_just_updated_ts_v1';

export function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const isStandaloneDisplay =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true ||
    (typeof document !== 'undefined' &&
      document.referrer.includes('android-app://'));

  if (isStandaloneDisplay) {
    try {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
    return true;
  }

  try {
    if (localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === 'true') {
      return true;
    }
  } catch {
    // Ignore storage errors
  }

  return false;
}

export function detectIsIOS(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  return (
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(() =>
      typeof window !== 'undefined' && window.__deferredPwaPrompt
        ? window.__deferredPwaPrompt
        : null
    );
  const [isInstalled, setIsInstalled] = useState<boolean>(() =>
    checkIsStandalone()
  );
  const [isIOS, setIsIOS] = useState<boolean>(() => detectIsIOS());
  const [supportsNativeInstall, setSupportsNativeInstall] = useState<boolean>(
    () =>
      typeof window !== 'undefined' &&
      ('onbeforeinstallprompt' in window || Boolean(window.__deferredPwaPrompt)) &&
      !detectIsIOS()
  );

  const markInstalledPersistently = useCallback(() => {
    window.__deferredPwaPrompt = null;
    setDeferredPrompt(null);
    setIsInstalled(true);
    try {
      localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    const standaloneNow = checkIsStandalone();
    setIsInstalled(standaloneNow);

    const ios = detectIsIOS();
    setIsIOS(ios);

    if (window.__deferredPwaPrompt) {
      setDeferredPrompt(window.__deferredPwaPrompt);
      setSupportsNativeInstall(true);
      if (!standaloneNow) {
        setIsInstalled(false);
      }
    } else {
      setSupportsNativeInstall('onbeforeinstallprompt' in window && !ios);
    }

    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.getInstalledRelatedApps === 'function'
    ) {
      navigator
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            markInstalledPersistently();
          }
        })
        .catch(() => {});
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      window.__deferredPwaPrompt = promptEvent;
      setDeferredPrompt(promptEvent);
      setSupportsNativeInstall(true);
      if (
        !window.matchMedia('(display-mode: standalone)').matches &&
        !window.matchMedia('(display-mode: minimal-ui)').matches &&
        (window.navigator as unknown as { standalone?: boolean }).standalone !==
          true
      ) {
        try {
          localStorage.removeItem(PWA_INSTALLED_STORAGE_KEY);
        } catch {
          // Ignore
        }
        setIsInstalled(false);
      }
    };

    const handlePromptReady = () => {
      if (window.__deferredPwaPrompt) {
        setDeferredPrompt(window.__deferredPwaPrompt);
        setSupportsNativeInstall(true);
        if (
          !window.matchMedia('(display-mode: standalone)').matches &&
          !window.matchMedia('(display-mode: minimal-ui)').matches &&
          (window.navigator as unknown as { standalone?: boolean }).standalone !==
            true
        ) {
          setIsInstalled(false);
        }
      }
    };

    const handleAppInstalled = () => {
      markInstalledPersistently();
    };

    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = (e: MediaQueryListEvent) => {
      if (e.matches) {
        markInstalledPersistently();
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('mero-pwa-prompt-ready', handlePromptReady);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('mero-pwa-installed', handleAppInstalled);
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayModeChange);
    }

    return () => {
      window.removeEventListener(
        'beforeinstallprompt',
        handleBeforeInstallPrompt
      );
      window.removeEventListener('mero-pwa-prompt-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('mero-pwa-installed', handleAppInstalled);
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, [markInstalledPersistently]);

  const triggerInstall = useCallback(async (): Promise<
    'accepted' | 'dismissed' | 'manual'
  > => {
    const runNativePrompt = async (
      promptEvent: BeforeInstallPromptEvent
    ): Promise<'accepted' | 'dismissed' | 'manual'> => {
      try {
        const promptResult = (await promptEvent.prompt()) as
          | { outcome?: 'accepted' | 'dismissed' }
          | undefined;
        const choice = promptEvent.userChoice
          ? await promptEvent.userChoice.catch(() => null)
          : null;
        window.__deferredPwaPrompt = null;
        setDeferredPrompt(null);
        const outcome = choice?.outcome || promptResult?.outcome;
        if (outcome === 'accepted') {
          markInstalledPersistently();
          return 'accepted';
        }
        return 'dismissed';
      } catch {
        window.__deferredPwaPrompt = null;
        setDeferredPrompt(null);
        return 'manual';
      }
    };

    const existingPrompt = deferredPrompt || window.__deferredPwaPrompt;
    if (existingPrompt) {
      return runNativePrompt(existingPrompt);
    }

    // On Android/Chrome where beforeinstallprompt is supported, wait briefly if the user's tap
    // itself is the engagement gesture that triggers Chrome to dispatch beforeinstallprompt
    if (
      typeof window !== 'undefined' &&
      'onbeforeinstallprompt' in window &&
      !detectIsIOS()
    ) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker
          .register('/sw.js', { scope: '/', updateViaCache: 'none' })
          .catch(() => {});
      }

      const latePrompt = await new Promise<BeforeInstallPromptEvent | null>(
        (resolve) => {
          if (window.__deferredPwaPrompt) {
            resolve(window.__deferredPwaPrompt);
            return;
          }
          let settled = false;
          const finish = (ev: BeforeInstallPromptEvent | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            window.removeEventListener('beforeinstallprompt', onBip);
            window.removeEventListener('mero-pwa-prompt-ready', onReady);
            resolve(ev);
          };
          const onBip = (e: Event) => {
            e.preventDefault();
            const bip = e as BeforeInstallPromptEvent;
            window.__deferredPwaPrompt = bip;
            setDeferredPrompt(bip);
            finish(bip);
          };
          const onReady = () => {
            if (window.__deferredPwaPrompt) {
              finish(window.__deferredPwaPrompt);
            }
          };
          const timer = setTimeout(
            () => finish(window.__deferredPwaPrompt || null),
            2400
          );
          window.addEventListener('beforeinstallprompt', onBip);
          window.addEventListener('mero-pwa-prompt-ready', onReady);
        }
      );

      if (latePrompt) {
        return runNativePrompt(latePrompt);
      }
    }

    return 'manual';
  }, [deferredPrompt, markInstalledPersistently]);

  const canPromptNative = Boolean(
    deferredPrompt || (typeof window !== 'undefined' && window.__deferredPwaPrompt)
  );

  return {
    canPromptNative,
    supportsNativeInstall,
    isInstalled,
    isIOS,
    triggerInstall,
  };
}

function wasRecentlyUpdated(): boolean {
  try {
    const raw = sessionStorage.getItem(PWA_JUST_UPDATED_SESSION_KEY);
    if (!raw) return false;
    const ts = Number(raw) || 0;
    if (Date.now() - ts < 15000) {
      return true;
    }
    sessionStorage.removeItem(PWA_JUST_UPDATED_SESSION_KEY);
  } catch {
    // Ignore storage errors
  }
  return false;
}

export function usePWAUpdate() {
  const [isUpdateAvailable, setIsUpdateAvailable] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const initialBuildIdRef = useRef<string | null>(null);
  const latestBuildIdRef = useRef<string | null>(null);
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const reloadingRef = useRef<boolean>(false);

  const checkForAppUpdate = useCallback(async () => {
    if (reloadingRef.current) return;

    let reg: ServiceWorkerRegistration | undefined;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          if (reg.waiting && navigator.serviceWorker.controller) {
            waitingWorkerRef.current = reg.waiting;
          }
        }
      } catch {
        // Ignore SW update check failure
      }
    }

    // Check server /api/app-version fingerprint for deployed updates
    try {
      const res = await fetch('/api/app-version', {
        method: 'GET',
        cache: 'no-store',
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
        },
      });
      if (!res.ok) return;
      const data = await res.json();
      const serverVersion =
        typeof data?.version === 'string' ? data.version.trim() : '';
      const serverBuildId =
        typeof data?.buildId === 'string' ? data.buildId.trim() : '';
      if (!serverBuildId) return;

      latestBuildIdRef.current = serverBuildId;

      let appliedBuild = '';
      try {
        appliedBuild = localStorage.getItem(PWA_APPLIED_BUILD_KEY) || '';
      } catch {
        // Ignore
      }

      if (!initialBuildIdRef.current) {
        initialBuildIdRef.current = serverBuildId;
        // If an installed V1 PWA loaded an older cached JS bundle while a newer version is deployed on the server
        if (
          serverVersion &&
          serverVersion !== CLIENT_APP_VERSION &&
          appliedBuild !== serverBuildId &&
          !wasRecentlyUpdated()
        ) {
          setIsUpdateAvailable(true);
          return;
        }

        // User is already running the latest version on initial load: record buildId and silently activate any waiting SW from the same version
        try {
          localStorage.setItem(PWA_APPLIED_BUILD_KEY, serverBuildId);
        } catch {
          // Ignore
        }
        if (reg?.waiting) {
          try {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch {
            // Ignore
          }
        }
        setIsUpdateAvailable(false);
        return;
      }

      // Subsequent check: only show update prompt if server buildId or version has changed from what is currently running
      const isNewBuild =
        serverBuildId !== initialBuildIdRef.current &&
        serverBuildId !== appliedBuild;
      const isNewVersion =
        Boolean(serverVersion && serverVersion !== CLIENT_APP_VERSION) &&
        serverBuildId !== appliedBuild;

      if ((isNewBuild || isNewVersion) && !wasRecentlyUpdated()) {
        setIsUpdateAvailable(true);
      } else {
        // Already on the latest build; if a worker is waiting for the same build, activate it silently
        if (reg?.waiting) {
          try {
            reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          } catch {
            // Ignore
          }
        }
        setIsUpdateAvailable(false);
      }
    } catch {
      // Network offline or unreachable; fail silently without disrupting user
    }
  }, []);

  const attachRegistrationListeners = useCallback(
    (reg: ServiceWorkerRegistration) => {
      try {
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorkerRef.current = reg.waiting;
          checkForAppUpdate();
        }

        const observeInstalling = (worker: ServiceWorker | null) => {
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (
              worker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              waitingWorkerRef.current = worker;
              checkForAppUpdate();
            }
          });
        };

        if (reg.installing) {
          observeInstalling(reg.installing);
        }

        reg.addEventListener('updatefound', () => {
          observeInstalling(reg.installing);
        });
      } catch {
        // Ignore service worker registration listener errors
      }
    },
    [checkForAppUpdate]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (window.__meroSwUpdateReg) {
      attachRegistrationListeners(window.__meroSwUpdateReg);
    }

    checkForAppUpdate();

    const handleCustomSwReady = () => {
      if (window.__meroSwUpdateReg) {
        attachRegistrationListeners(window.__meroSwUpdateReg);
      }
      checkForAppUpdate();
    };

    const handleSwMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'SW_UPDATE_AVAILABLE') {
        if (
          typeof data.version === 'string' &&
          data.version !== CLIENT_APP_VERSION &&
          !wasRecentlyUpdated()
        ) {
          setIsUpdateAvailable(true);
        } else {
          checkForAppUpdate();
        }
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkForAppUpdate();
      }
    };

    window.addEventListener('mero-pwa-update-available', handleCustomSwReady);
    window.addEventListener('focus', handleVisibilityOrFocus);
    window.addEventListener('online', checkForAppUpdate);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    if ('serviceWorker' in navigator) {
      try {
        navigator.serviceWorker.addEventListener('message', handleSwMessage);
      } catch {
        // Ignore
      }
    }

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        checkForAppUpdate();
      }
    }, 45000);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener(
        'mero-pwa-update-available',
        handleCustomSwReady
      );
      window.removeEventListener('focus', handleVisibilityOrFocus);
      window.removeEventListener('online', checkForAppUpdate);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      if ('serviceWorker' in navigator) {
        try {
          navigator.serviceWorker.removeEventListener(
            'message',
            handleSwMessage
          );
        } catch {
          // Ignore
        }
      }
    };
  }, [attachRegistrationListeners, checkForAppUpdate]);

  const applyUpdate = useCallback(async () => {
    if (reloadingRef.current) return;
    reloadingRef.current = true;
    setIsUpdating(true);
    setIsUpdateAvailable(false);

    try {
      sessionStorage.setItem(
        PWA_JUST_UPDATED_SESSION_KEY,
        String(Date.now())
      );
      if (latestBuildIdRef.current) {
        localStorage.setItem(PWA_APPLIED_BUILD_KEY, latestBuildIdRef.current);
      }
    } catch {
      // Ignore storage errors
    }

    const safeReload = () => {
      try {
        window.location.reload();
      } catch {
        window.location.href = window.location.href;
      }
    };

    // Fallback timeout ensures app always reloads cleanly even if SW controllerchange doesn't fire
    const fallbackTimer = setTimeout(safeReload, 1000);

    try {
      // Clear only static HTTP asset caches (never touch IndexedDB or localStorage user data)
      if (typeof caches !== 'undefined' && typeof caches.keys === 'function') {
        const cacheKeys = await caches.keys().catch(() => [] as string[]);
        await Promise.all(
          cacheKeys
            .filter((k) => k.startsWith('mero-routine-pwa-'))
            .map((k) => caches.delete(k).catch(() => false))
        );
      }

      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener(
          'controllerchange',
          () => {
            clearTimeout(fallbackTimer);
            safeReload();
          },
          { once: true }
        );

        const reg = await navigator.serviceWorker
          .getRegistration()
          .catch(() => undefined);

        const targetWorker =
          waitingWorkerRef.current || reg?.waiting || reg?.installing || null;

        if (targetWorker) {
          targetWorker.postMessage({ type: 'SKIP_WAITING' });
          return;
        }

        if (reg?.active) {
          reg.active.postMessage({ type: 'APPLY_SW_UPDATE' });
        }
      }
    } catch {
      // Handle any Service Worker update failure safely by falling back to clean reload
    }

    clearTimeout(fallbackTimer);
    safeReload();
  }, []);

  return {
    isUpdateAvailable,
    isUpdating,
    applyUpdate,
    checkForAppUpdate,
  };
}

