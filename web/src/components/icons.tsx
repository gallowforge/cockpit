// One icon family: a 16 grid, 1.5 stroke, round caps and joins.
import type { ComponentChildren } from 'preact'

function I({ size = 16, children, label }: { size?: number; children: ComponentChildren; label?: string }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      {children}
    </svg>
  )
}
type P = { size?: number }

export const IconOverview = ({ size }: P) => <I size={size}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></I>
export const IconServices = ({ size }: P) => <I size={size}><rect x="2.5" y="2.75" width="11" height="4.25" rx="1.2" /><rect x="2.5" y="9" width="11" height="4.25" rx="1.2" /><path d="M5 4.9h.01M5 11.1h.01" /></I>
export const IconBackups = ({ size }: P) => <I size={size}><ellipse cx="8" cy="4" rx="5" ry="1.9" /><path d="M3 4v8c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9V4" /><path d="M3 8c0 1.05 2.24 1.9 5 1.9s5-.85 5-1.9" /></I>
export const IconHistory = ({ size }: P) => <I size={size}><path d="M2.75 8a5.25 5.25 0 1 0 1.54-3.71" /><path d="M2.75 2.75V5h2.25" /><path d="M8 5.25V8l1.9 1.25" /></I>
export const IconJobs = ({ size }: P) => <I size={size}><rect x="2.5" y="3.25" width="11" height="10.25" rx="1.5" /><path d="M2.5 6.5h11M5.5 1.75v3M10.5 1.75v3" /><path d="M5.5 9.25h2" /></I>
export const IconSystem = ({ size }: P) => <I size={size}><rect x="3.75" y="3.75" width="8.5" height="8.5" rx="1.5" /><rect x="6.25" y="6.25" width="3.5" height="3.5" rx=".6" /><path d="M6 1.75v2M10 1.75v2M6 12.25v2M10 12.25v2M1.75 6h2M1.75 10h2M12.25 6h2M12.25 10h2" /></I>
export const IconChecklist = ({ size }: P) => <I size={size}><path d="M2.75 4.25l1.1 1.1 2-2.1" /><path d="M8 4.5h5.25" /><path d="M2.75 10.25l1.1 1.1 2-2.1" /><path d="M8 10.5h5.25" /></I>
export const IconSearch = ({ size }: P) => <I size={size}><circle cx="7.25" cy="7.25" r="4.5" /><path d="M10.6 10.6 13.5 13.5" /></I>
export const IconBack = ({ size }: P) => <I size={size}><path d="M9.75 3.5 5.25 8l4.5 4.5" /></I>
export const IconChevron = ({ size }: P) => <I size={size}><path d="M6.25 3.5 10.75 8l-4.5 4.5" /></I>
export const IconExternal = ({ size }: P) => <I size={size}><path d="M6.5 3.25H3.25v9.5h9.5V9.5" /><path d="M9.5 3.25h3.25V6.5M12.75 3.25 7.5 8.5" /></I>
export const IconLogout = ({ size }: P) => <I size={size}><path d="M9.5 3H4.25a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1H9.5" /><path d="M7 8h6.5M11 5.5 13.5 8 11 10.5" /></I>
export const IconInfo = ({ size }: P) => <I size={size}><circle cx="8" cy="8" r="5.75" /><path d="M8 7.25v3.5M8 5.25h.01" /></I>
export const IconClose = ({ size }: P) => <I size={size}><path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5" /></I>
export const IconAlert = ({ size }: P) => <I size={size}><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3.5M8 11h.01" /></I>
export const IconPulse = ({ size }: P) => <I size={size}><path d="M1.75 8.5h2.5l1.75-4.5 2.75 8.5 1.75-4h3.75" /></I>
export const IconHeart = ({ size }: P) => <I size={size}><path d="M8 13s-5.25-3-5.25-6.6A2.65 2.65 0 0 1 8 4.75a2.65 2.65 0 0 1 5.25 1.65C13.25 10 8 13 8 13z" /></I>
export const IconEyeOff = ({ size }: P) => <I size={size}><path d="M2 8s2.25-4.25 6-4.25S14 8 14 8s-2.25 4.25-6 4.25S2 8 2 8z" /><path d="M3 13 13 3" /></I>
export const IconClock = ({ size }: P) => <I size={size}><circle cx="8" cy="8" r="5.75" /><path d="M8 5v3l2 1.25" /></I>
export const IconCheck = ({ size }: P) => <I size={size}><path d="m3.5 8.5 2.9 2.9 6.1-6.65" /></I>
export const IconX = ({ size }: P) => <I size={size}><path d="m4.5 4.5 7 7M11.5 4.5l-7 7" /></I>
export const IconShield = ({ size }: P) => <I size={size}><path d="M8 2 3.25 3.9v3.6c0 2.9 2 5 4.75 6 2.75-1 4.75-3.1 4.75-6V3.9z" /><path d="m5.9 8 1.45 1.45L10.2 6.6" /></I>
export const IconMore = ({ size }: P) => <I size={size}><circle cx="3.75" cy="8" r=".9" /><circle cx="8" cy="8" r=".9" /><circle cx="12.25" cy="8" r=".9" /></I>
export const IconDrill = ({ size }: P) => <I size={size}><path d="M2.75 8a5.25 5.25 0 0 1 9.1-3.6" /><path d="M13.25 8a5.25 5.25 0 0 1-9.1 3.6" /><path d="M12.25 2v2.75H9.5M3.75 14v-2.75H6.5" /></I>

/** The mark: a V with the evening star above it, the first light of the
 *  night, glowing like the living things in the haze. The V stays fog white;
 *  state is shown by status marks, never by the logo. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg class="mark" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x=".75" y=".75" width="22.5" height="22.5" rx="6.5" fill="#0c1813" stroke="#2a4034" stroke-width="1.5" />
      <circle cx="12" cy="6.6" r="3.7" fill="#5fe1ea" opacity=".16" />
      <path d="M6.7 9.6 12 17.2l5.3-7.6" fill="none" stroke="#e4eee6" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="12" cy="6.6" r="1.65" fill="#8cecf2" />
    </svg>
  )
}
