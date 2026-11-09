// Line icons on a 24 grid, 1.7 stroke, round caps: one family for the whole app.
import type { ComponentChildren } from 'preact'
import type { Level } from '../types'

function I({ size = 20, children, label }: { size?: number; children: ComponentChildren; label?: string }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      {children}
    </svg>
  )
}
type P = { size?: number }

export const IconNow = ({ size }: P) => <I size={size}><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v8.5h11V10" /><path d="M10 18.5v-4h4v4" /></I>
export const IconServices = ({ size }: P) => <I size={size}><rect x="4" y="4.5" width="16" height="6" rx="2" /><rect x="4" y="13.5" width="16" height="6" rx="2" /><path d="M7.5 7.5h.01M7.5 16.5h.01" /></I>
export const IconBackups = ({ size }: P) => <I size={size}><path d="M12 3.8 5 6.6v5.1c0 4.2 3 7.2 7 8.5 4-1.3 7-4.3 7-8.5V6.6z" /><path d="m9 12 2.1 2.1L15.2 10" /></I>
export const IconHistory = ({ size }: P) => <I size={size}><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v3.2h3.2" /><path d="M12 8.2V12l2.6 1.7" /></I>
export const IconSystem = ({ size }: P) => <I size={size}><rect x="6" y="6" width="12" height="12" rx="2.5" /><rect x="9.5" y="9.5" width="5" height="5" rx="1" /><path d="M9 3.5V6M15 3.5V6M9 18v2.5M15 18v2.5M3.5 9H6M3.5 15H6M18 9h2.5M18 15h2.5" /></I>
export const IconChecklist = ({ size }: P) => <I size={size}><path d="m5 7 1.6 1.6L9.5 5.6" /><path d="M12.5 7.2H19" /><path d="m5 15 1.6 1.6 2.9-3" /><path d="M12.5 15.2H19" /></I>
export const IconSearch = ({ size }: P) => <I size={size}><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></I>
export const IconBack = ({ size }: P) => <I size={size}><path d="M14.5 5.5 8 12l6.5 6.5" /></I>
export const IconChevron = ({ size }: P) => <I size={size}><path d="m9.5 5.5 6.5 6.5-6.5 6.5" /></I>
export const IconExternal = ({ size }: P) => <I size={size}><path d="M8 16 16 8" /><path d="M9.5 8H16v6.5" /></I>
export const IconLogout = ({ size }: P) => <I size={size}><path d="M14 4.5H7.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H14" /><path d="M11 12h9M17 8.5l3.5 3.5-3.5 3.5" /></I>
export const IconInfo = ({ size }: P) => <I size={size}><circle cx="12" cy="12" r="8" /><path d="M12 11v5M12 8h.01" /></I>
export const IconClose = ({ size }: P) => <I size={size}><path d="m6.5 6.5 11 11M17.5 6.5l-11 11" /></I>

const LIGHT: Record<string, string> = { calm: '#9fb9ff', attn: '#ffb35c', down: '#ff6a5c', blind: '#8f9bb3' }

/** The mark: a pane of glass lit from behind at one corner. The light takes
 *  the colour of the house's state. */
export function Mark({ size = 28, level = 'ok' }: { size?: number; level?: Level }) {
  const light = level === 'crit' ? LIGHT.down : level === 'warn' ? LIGHT.attn : level === 'unknown' ? LIGHT.blind : LIGHT.calm
  const id = `mk-${size}-${level}`
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="0.28" cy="0.26" r="0.85">
          <stop offset="0" stop-color={light} stop-opacity="0.95" />
          <stop offset="0.38" stop-color={light} stop-opacity="0.28" />
          <stop offset="1" stop-color={light} stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="4" y="4" width="40" height="40" rx="12" fill="#0e131c" />
      <rect x="4" y="4" width="40" height="40" rx="12" fill={`url(#${id})`} />
      <rect x="4.75" y="4.75" width="38.5" height="38.5" rx="11.25" fill="none" stroke="rgba(255,255,255,0.16)" stroke-width="1.5" />
      <circle cx="17" cy="16.5" r="3.4" fill="#f4f6fa" />
    </svg>
  )
}
