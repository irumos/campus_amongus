import { Skull } from 'lucide-react';
import type { PlayerRole } from '../shared/gameData';

interface RoleIconProps {
  className?: string;
}

/**
 * Distinct Crewmate visor-helmet emblem (crisp cyan/ice visor silhouette).
 */
export function CrewmateRoleIcon({ className = 'w-4 h-4' }: RoleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`${className} animate-role-crew`}
    >
      {/* Backpack */}
      <rect
        x="3.5"
        y="9"
        width="3.2"
        height="8.5"
        rx="1.6"
        fill="currentColor"
        fillOpacity="0.65"
      />
      {/* Crewmate suit silhouette */}
      <path
        d="M7 9.2C7 5.78 9.69 3 13 3C16.31 3 19 5.78 19 9.2V18.8C19 19.9 18.1 20.8 17 20.8H15.6C14.77 20.8 14.1 20.13 14.1 19.3V18.1H11.9V19.3C11.9 20.13 11.23 20.8 10.4 20.8H9C7.9 20.8 7 19.9 7 18.8V9.2Z"
        fill="currentColor"
      />
      {/* Glowing curved visor */}
      <rect
        x="10.2"
        y="6.4"
        width="9.4"
        height="5.2"
        rx="2.6"
        fill="#67e8f9"
        stroke="#083344"
        strokeWidth="1.1"
      />
      {/* Visor specular glint */}
      <path
        d="M12.2 8.1H16.8"
        stroke="#ecfeff"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Distinct Impostor predator-visor emblem (angular crimson silhouette with razor visor & fangs).
 */
export function ImpostorRoleIcon({ className = 'w-4 h-4' }: RoleIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`${className} animate-role-impostor`}
    >
      {/* Sharp menacing crest / hood */}
      <path
        d="M12 2.2L19.5 6.4V13.8C19.5 17.7 16.3 20.6 12 22C7.7 20.6 4.5 17.7 4.5 13.8V6.4L12 2.2Z"
        fill="currentColor"
      />
      {/* Angular crimson predator visor */}
      <path
        d="M7.2 9.4L12 11.2L16.8 9.4L16.2 12.6L12 13.8L7.8 12.6L7.2 9.4Z"
        fill="#fda4af"
        stroke="#4c0519"
        strokeWidth="0.9"
        strokeLinejoin="round"
      />
      {/* Twin fang / blade chevrons */}
      <path
        d="M9.1 15.6L10.4 18.1L11.5 16.2L12.5 16.2L13.6 18.1L14.9 15.6"
        stroke="#fff1f2"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PlayerRoleAvatarProps {
  badgeNumber: string;
  hex: string;
  role: PlayerRole;
  isDead?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Candidate-colored tactical player avatar with a dynamic corner role emblem
 * distinguishing Impostors, Crewmates, and Eliminated operatives at a glance.
 */
export function PlayerRoleAvatar({
  badgeNumber,
  hex,
  role,
  isDead = false,
  size = 'md',
}: PlayerRoleAvatarProps) {
  const isImpostor = role === 'impostor';

  const outerSize =
    size === 'lg'
      ? 'w-11 h-11 text-xs rounded-xl'
      : size === 'sm'
      ? 'w-8 h-8 text-[10px] rounded-full'
      : 'w-9 h-9 text-[11px] rounded-full';

  const pipSize =
    size === 'lg'
      ? 'w-5 h-5 -right-1 -bottom-1'
      : 'w-[18px] h-[18px] -right-1 -bottom-1';

  const iconSize = size === 'lg' ? 'w-3.5 h-3.5' : 'w-3 h-3';

  return (
    <div className="relative shrink-0">
      <div
        className={`${outerSize} flex items-center justify-center font-mono font-extrabold text-white tabular-nums transition-all ${
          !isDead && isImpostor ? 'animate-role-impostor-ring' : ''
        }`}
        style={
          isDead
            ? {
                backgroundColor: 'rgba(139, 92, 246, 0.22)',
                border: '1.5px solid #8b5cf6',
              }
            : isImpostor
            ? {
                backgroundColor: `${hex}38`,
                border: '2px solid #f43f5e',
                boxShadow: '0 0 14px rgba(244, 63, 94, 0.45)',
              }
            : {
                backgroundColor: `${hex}30`,
                border: `2px solid ${hex}`,
                boxShadow: `0 0 12px ${hex}40`,
              }
        }
      >
        {isDead ? (
          <Skull className="w-4 h-4 text-violet-300" />
        ) : (
          `#${badgeNumber}`
        )}
      </div>

      {/* Dynamic corner role indicator badge */}
      <span
        title={
          isDead
            ? isImpostor
              ? 'Eliminated Impostor'
              : 'Eliminated Operative'
            : isImpostor
            ? 'Impostor'
            : 'Crewmate'
        }
        className={`absolute ${pipSize} rounded-full flex items-center justify-center border border-slate-950 shadow-md ${
          isImpostor
            ? 'bg-rose-600 text-rose-50 shadow-[0_0_10px_rgba(244,63,94,0.75)]'
            : isDead
            ? 'bg-violet-700 text-violet-100'
            : 'bg-slate-900 text-cyan-300 ring-1 ring-cyan-400/55'
        }`}
      >
        {isImpostor ? (
          <ImpostorRoleIcon className={iconSize} />
        ) : (
          <CrewmateRoleIcon className={iconSize} />
        )}
      </span>
    </div>
  );
}
