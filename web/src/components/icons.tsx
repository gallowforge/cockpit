// Small stroke icons (24-unit grid, 1.75 stroke), drawn for Cockpit.
import type { JSX } from 'preact'
import { useMemo } from 'preact/hooks'

type P = { size?: number; class?: string }

const Svg = ({ size = 18, class: cls, children }: P & { children: JSX.Element | JSX.Element[] }) => (
  <svg
    class={cls}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const IconOverview = (p: P) => (
  <Svg {...p}>
    <path d="M4 13a8 8 0 0 1 16 0" />
    <path d="M12 13l4-4" />
    <circle cx="12" cy="13" r="1.4" />
    <path d="M4 17h16" />
  </Svg>
)
export const IconServices = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="6.5" rx="2" />
    <rect x="3.5" y="13.5" width="17" height="6.5" rx="2" />
    <path d="M7.5 7.25h.01M7.5 16.75h.01" />
    <path d="M11.5 7.25h5M11.5 16.75h5" />
  </Svg>
)
export const IconBackups = (p: P) => (
  <Svg {...p}>
    <path d="M4 7.5h16v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <path d="M3 4.5h18v3H3z" />
    <path d="M9.5 12.5l2 2 3.5-3.5" />
  </Svg>
)
export const IconAlerts = (p: P) => (
  <Svg {...p}>
    <path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 1.5h-15z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </Svg>
)
export const IconTimers = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9v4l2.5 2" />
    <path d="M9.5 2.75h5" />
  </Svg>
)
export const IconDrift = (p: P) => (
  <Svg {...p}>
    <circle cx="6.5" cy="6" r="2.25" />
    <circle cx="17.5" cy="18" r="2.25" />
    <path d="M6.5 8.25v4.25a3 3 0 0 0 3 3h3" />
    <path d="M17.5 15.75V11.5a3 3 0 0 0-3-3h-3" />
    <path d="M14 13.5l-1.5 2 1.5 2M10 6.5l1.5 2-1.5 2" />
  </Svg>
)
export const IconRunbooks = (p: P) => (
  <Svg {...p}>
    <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
    <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    <path d="M9 7.5h6M9 11h4" />
  </Svg>
)
export const IconExternal = (p: P) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Svg>
)
export const IconArrow = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)
export const IconBook = IconRunbooks
export const IconLock = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Svg>
)
export const IconLogout = (p: P) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 16l-4-4 4-4M6 12h10" />
  </Svg>
)
export const IconHeart = (p: P) => (
  <Svg {...p}>
    <path d="M3 12h4l2-5 3.5 10 2.5-7 1.5 2H21" />
  </Svg>
)
export const IconShield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
)
export const IconChip = (p: P) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9.5 2.5v3M14.5 2.5v3M9.5 18.5v3M14.5 18.5v3M2.5 9.5h3M2.5 14.5h3M18.5 9.5h3M18.5 14.5h3" />
  </Svg>
)
export const IconWrench = (p: P) => (
  <Svg {...p}>
    <path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L13 16.8l-2.3 2.4a2 2 0 0 1-2.9-2.8L10.2 14l6.4-6.4" />
    <path d="M14.5 5.5l2-2" />
  </Svg>
)

let markSeq = 0

/** The Cockpit mark: an attitude indicator. Each instance gets its own ids,
 * so a hidden copy (the desktop rail on a phone) cannot blank a visible one. */
export const Mark = ({ size = 28, bank = -12 }: { size?: number; bank?: number }) => {
  const id = useMemo(() => `mk${++markSeq}`, [])
  const horizon = { transform: `rotate(${bank}deg)`, transformOrigin: '16px 16px', transition: 'transform 1.2s cubic-bezier(.3,.7,.3,1)' }
  return (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#0a1a2a" />
        <stop offset="1" stop-color="#2a5d86" />
      </linearGradient>
      <clipPath id={`${id}-clip`}>
        <circle cx="16" cy="16" r="11" />
      </clipPath>
    </defs>
    <circle cx="16" cy="16" r="14.5" fill="#05080c" stroke="#ffffff" stroke-opacity=".22" />
    <g clip-path={`url(#${id}-clip)`}>
      <g style={horizon}>
        <rect x="-8" y="-8" width="48" height="25.5" fill={`url(#${id}-sky)`} />
        <rect x="-8" y="17.5" width="48" height="24" fill="#16110c" />
        <path d="M-8 17.5h48" stroke="#e8efe6" stroke-width=".8" />
      </g>
    </g>
    <path d="M9.5 16.5h4.5l2 2 2-2h4.5" fill="none" stroke="#ffb22e" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  )
}
