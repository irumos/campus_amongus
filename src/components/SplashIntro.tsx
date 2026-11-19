import { useEffect, useState } from 'react';

export const SPLASH_SESSION_KEY = 'cairl_splash_intro_seen_v1';
const SPLASH_TOTAL_MS = 1600;

interface SplashIntroProps {
  onComplete: () => void;
}

export function shouldPlaySplashIntro(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(SPLASH_SESSION_KEY) === 'true') {
      return false;
    }
  } catch {
    // ignore storage access errors
  }
  const path = window.location.pathname.replace(/\/+$/, '');
  const mode = new URLSearchParams(window.location.search).get('mode');
  if (path === '/spectator' || mode === 'spectator' || path === '/print') {
    return false;
  }
  return true;
}

export function SplashIntro({ onComplete }: SplashIntroProps) {
  const [logoSrc, setLogoSrc] = useState('/logo.png');

  useEffect(() => {
    try {
      window.sessionStorage.setItem(SPLASH_SESSION_KEY, 'true');
    } catch {
      // ignore storage errors
    }

    const timer = window.setTimeout(() => {
      onComplete();
    }, SPLASH_TOTAL_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [onComplete]);

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 z-50 bg-[#050811] flex flex-col items-center justify-center overflow-hidden animate-splash-out select-none"
    >
      {/* Subtle centered cyan/emerald aura behind the emblem */}
      <div className="pointer-events-none absolute w-56 h-56 rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.18)_0%,rgba(16,185,129,0.06)_45%,transparent_72%)]" />

      {/* Reticle + Emblem Stage */}
      <div className="relative p-4 flex items-center justify-center">
        {/* Four Animated Cyan/Emerald QR Corner Brackets (snap inward from 12px offset during 0.3s–0.9s) */}
        <span className="animate-splash-bracket-tl pointer-events-none absolute top-0 left-0 w-5 h-5 border-t-2 border-l-2 border-cyan-400 rounded-tl-md shadow-[0_0_12px_rgba(34,211,238,0.65)]" />
        <span className="animate-splash-bracket-tr pointer-events-none absolute top-0 right-0 w-5 h-5 border-t-2 border-r-2 border-emerald-400 rounded-tr-md shadow-[0_0_12px_rgba(52,211,153,0.65)]" />
        <span className="animate-splash-bracket-bl pointer-events-none absolute bottom-0 left-0 w-5 h-5 border-b-2 border-l-2 border-emerald-400 rounded-bl-md shadow-[0_0_12px_rgba(52,211,153,0.65)]" />
        <span className="animate-splash-bracket-br pointer-events-none absolute bottom-0 right-0 w-5 h-5 border-b-2 border-r-2 border-cyan-400 rounded-br-md shadow-[0_0_12px_rgba(34,211,238,0.65)]" />

        {/* Emblem Container (0.0s–0.4s scale-90 opacity-0 -> scale-100 opacity-100) */}
        <div className="animate-splash-emblem relative w-28 h-28 rounded-2xl overflow-hidden shadow-[0_0_32px_rgba(6,182,212,0.28)]">
          <img
            src={logoSrc}
            alt="Campus Among Us Emblem"
            onError={() => {
              if (logoSrc !== '/assets/aistudio/image_bb01f9c4.png') {
                setLogoSrc('/assets/aistudio/image_bb01f9c4.png');
              }
            }}
            className="w-full h-full object-cover"
          />

          {/* Single Subtle Diagonal Light Sheen Sweeping Across the Visor (0.3s–0.9s) */}
          <span className="animate-splash-sheen pointer-events-none absolute -inset-y-6 left-0 w-10 bg-gradient-to-r from-transparent via-cyan-100/55 to-transparent blur-[1px]" />
        </div>
      </div>
    </div>
  );
}
