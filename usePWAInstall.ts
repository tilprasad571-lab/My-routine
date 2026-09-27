import { usePWAInstall as useSharedPWAInstall, BeforeInstallPromptEvent } from './pwaUtils';

export type { BeforeInstallPromptEvent };

export function usePWAInstall() {
  const {
    canPromptNative,
    supportsNativeInstall,
    isInstalled,
    isIOS,
    triggerInstall,
  } = useSharedPWAInstall();

  return {
    isInstallable: canPromptNative,
    supportsNativeInstall,
    isInstalled,
    isIOS,
    install: triggerInstall,
  };
}

