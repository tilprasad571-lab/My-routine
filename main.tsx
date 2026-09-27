import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
}

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('RootErrorBoundary caught error:', error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
          <div className="max-w-md w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-sm">
            <img
              src="/mero-routine-logo.svg"
              alt="Mero Routine"
              referrerPolicy="no-referrer"
              className="w-16 h-16 rounded-2xl object-contain mx-auto mb-3 select-none"
            />
            <h2 className="text-lg font-bold mb-2">Mero Routine</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Refreshing application state...
            </p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
              className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

if ('serviceWorker' in navigator) {
  const registerSw = () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          (
            window as unknown as {
              __meroSwUpdateReg?: ServiceWorkerRegistration;
            }
          ).__meroSwUpdateReg = reg;
          window.dispatchEvent(new CustomEvent('mero-pwa-update-available'));
        }

        reg.addEventListener('updatefound', () => {
          const installingWorker = reg.installing;
          if (!installingWorker) return;
          installingWorker.addEventListener('statechange', () => {
            if (
              installingWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              (
                window as unknown as {
                  __meroSwUpdateReg?: ServiceWorkerRegistration;
                }
              ).__meroSwUpdateReg = reg;
              window.dispatchEvent(
                new CustomEvent('mero-pwa-update-available')
              );
            }
          });
        });

        reg.update().catch(() => {});
        if (reg.active) {
          reg.active.postMessage({ type: 'CHECK_ALARMS_NOW' });
        }
      })
      .catch(() => {});
  };

  registerSw();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>
);
