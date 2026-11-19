import { useEffect, useRef, useState } from 'react';

interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
  removeEventListener?: (type: 'release', listener: () => void) => void;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

export interface UseWakeLockResult {
  isSupported: boolean;
  isActive: boolean;
}

function getWakeLockApi(): WakeLockApi | null {
  try {
    if (typeof navigator === 'undefined') return null;
    const nav = navigator as unknown as { wakeLock?: WakeLockApi };
    if (nav.wakeLock && typeof nav.wakeLock.request === 'function') {
      return nav.wakeLock;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Acquires the browser Screen Wake Lock while `enabled` is true so players
 * moving between campus floors never have their screen auto-lock before
 * scanning a QR code. Automatically re-acquires on `visibilitychange` when
 * the tab/app returns to foreground, and fails silently on unsupported browsers.
 */
export function useWakeLock(enabled: boolean): UseWakeLockResult {
  const isSupported = Boolean(getWakeLockApi());
  const [isActive, setIsActive] = useState(false);
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);

  useEffect(() => {
    const wakeLockApi = getWakeLockApi();
    if (!enabled || !wakeLockApi) {
      const existing = sentinelRef.current;
      sentinelRef.current = null;
      if (existing) {
        try {
          void existing.release().catch(() => undefined);
        } catch {
          // ignore release errors on unsupported/restricted browsers
        }
      }
      setIsActive(false);
      return;
    }

    let cancelled = false;
    let currentReleaseHandler: (() => void) | null = null;

    const detachSentinel = () => {
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      if (currentReleaseHandler) {
        try {
          sentinel.removeEventListener?.('release', currentReleaseHandler);
        } catch {
          // ignore
        }
      }
      currentReleaseHandler = null;
      sentinelRef.current = null;
      try {
        void sentinel.release().catch(() => undefined);
      } catch {
        // ignore
      }
    };

    const requestLock = async () => {
      if (cancelled) return;
      if (
        typeof document !== 'undefined' &&
        document.visibilityState !== 'visible'
      ) {
        return;
      }
      if (sentinelRef.current && !sentinelRef.current.released) {
        setIsActive(true);
        return;
      }

      try {
        const sentinel = await wakeLockApi.request('screen');
        if (cancelled) {
          try {
            await sentinel.release();
          } catch {
            // ignore
          }
          return;
        }

        const handleRelease = () => {
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
          if (!cancelled) {
            setIsActive(false);
          }
        };

        currentReleaseHandler = handleRelease;
        sentinelRef.current = sentinel;
        try {
          sentinel.addEventListener?.('release', handleRelease);
        } catch {
          // ignore
        }
        setIsActive(true);
      } catch {
        // Silently ignore wake lock rejection (low battery, iframe policy, unsupported browser)
        if (!cancelled) {
          setIsActive(false);
        }
      }
    };

    const handleVisibilityChange = () => {
      if (cancelled) return;
      if (document.visibilityState === 'visible') {
        void requestLock();
      }
    };

    void requestLock();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      detachSentinel();
      setIsActive(false);
    };
  }, [enabled]);

  return { isSupported, isActive };
}
