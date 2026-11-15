// Small inline stroke icons (24px grid, currentColor) for compact icon buttons.

import type { ReactNode } from 'react';

const PATHS = {
  collapse: <path d="M15 18l-6-6 6-6" />,
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  play: <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />,
  pause: (
    <>
      <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />,
  volume: <path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12" />,
  mute: <path d="M4 9v6h4l5 4V5L8 9H4zM17 9.5l5 5M22 9.5l-5 5" />,
  robot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 8V4.5M9.5 13h0M14.5 13h0M9.5 16.5h5" />
      <circle cx="12" cy="4" r="1" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" />,
  upload: <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3a2 2 0 002 2h10a2 2 0 002-2v-3" />,
  market: (
    <>
      <path d="M4 9.5L5.5 4h13L20 9.5M4 9.5h16M4 9.5a2.67 2.67 0 005.33 0 2.67 2.67 0 005.34 0 2.67 2.67 0 005.33 0" />
      <path d="M5.5 12v8h13v-8M10 20v-4.5h4V20" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V5.5l10-2V16" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="16.5" cy="16" r="2.5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
