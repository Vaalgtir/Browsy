import type { SVGProps } from 'react'

/** Icônes 16×16, trait 1.5px, couleur héritée (currentColor). */
const base: SVGProps<SVGSVGElement> = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const IconBack = () => (
  <svg {...base}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
)

export const IconForward = () => (
  <svg {...base}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
)

export const IconReload = () => (
  <svg {...base}>
    <path d="M13 8a5 5 0 1 1-1.46-3.54" />
    <path d="M13 3v2.5h-2.5" />
  </svg>
)

export const IconPlus = () => (
  <svg {...base}>
    <path d="M8 3v10M3 8h10" />
  </svg>
)

export const IconClose = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12">
    <path d="M3 3l6 6M9 3l-6 6" />
  </svg>
)

export const IconChevron = ({ open }: { open: boolean }) => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12" className={open ? 'chevron open' : 'chevron'}>
    <path d="M4.5 3 7.5 6l-3 3" />
  </svg>
)

export const IconFolder = () => (
  <svg {...base}>
    <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
  </svg>
)

export const IconSpeaker = ({ muted }: { muted: boolean }) => (
  <svg {...base} width={14} height={14}>
    <path d="M3 6h2l3-2.5v9L5 10H3z" />
    {muted ? <path d="M11 6.5l3 3M14 6.5l-3 3" /> : <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.5 3.8a6 6 0 0 1 0 8.4" />}
  </svg>
)

export const IconDownload = () => (
  <svg {...base}>
    <path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" />
  </svg>
)

export const IconReturn = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12">
    <path d="M4 3 1.5 5.5 4 8M1.5 5.5h6A3 3 0 0 1 10.5 8.5v0" />
  </svg>
)

export const IconSearch = () => (
  <svg {...base}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="m10.5 10.5 3 3" />
  </svg>
)

export const IconGlobe = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M2.5 8h11M8 2.5c1.6 1.6 2.2 3.4 2.2 5.5S9.6 11.9 8 13.5C6.4 11.9 5.8 10.1 5.8 8S6.4 4.1 8 2.5" />
  </svg>
)

export const IconClock = () => (
  <svg {...base}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 5v3l2 1.5" />
  </svg>
)

export const IconTabs = () => (
  <svg {...base}>
    <rect x="2.5" y="4" width="11" height="9" rx="2" />
    <path d="M5 4V3.5A1 1 0 0 1 6 2.5h6.5a1 1 0 0 1 1 1V10" />
  </svg>
)

export const IconArrowUp = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12">
    <path d="M6 9.5v-7M3 5.5l3-3 3 3" />
  </svg>
)

export const IconArrowDown = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 12 12">
    <path d="M6 2.5v7M3 6.5l3 3 3-3" />
  </svg>
)

export const IconSidebar = () => (
  <svg {...base}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6.2 3v10" />
  </svg>
)

export const IconLink = () => (
  <svg {...base}>
    <path d="M7 9a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.6.6" />
    <path d="M9 7a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.6-.6" />
  </svg>
)

export const IconSliders = () => (
  <svg {...base}>
    <rect x="2" y="2" width="12" height="12" rx="3" />
    <path d="M5 6h6M5 10h6" />
    <circle cx="6.5" cy="6" r="1.1" fill="currentColor" />
    <circle cx="9.5" cy="10" r="1.1" fill="currentColor" />
  </svg>
)

export const IconLibrary = () => (
  <svg {...base}>
    <rect x="2" y="3" width="12" height="3.5" rx="1" />
    <path d="M3 6.5v5.5A1 1 0 0 0 4 13h8a1 1 0 0 0 1-1V6.5M6.5 9h3" />
  </svg>
)

export const IconMore = () => (
  <svg {...base}>
    <path d="M4 8h.01M8 8h.01M12 8h.01" strokeWidth={2.2} />
  </svg>
)

export const IconCode = () => (
  <svg {...base}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </svg>
)

export const IconLock = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 16 16">
    <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </svg>
)

export const IconWarning = () => (
  <svg {...base} width={12} height={12} viewBox="0 0 16 16">
    <path d="M8 2.5 14 13H2zM8 6.5v3M8 11.3h.01" />
  </svg>
)

export const IconCheck = () => (
  <svg {...base}>
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
)

export const IconPin = ({ filled }: { filled?: boolean }) => (
  <svg {...base} width={14} height={14}>
    <path d="M6 2.5h4l-.5 4 2 2v1h-7v-1l2-2zM8 9.5V14" fill={filled ? 'currentColor' : 'none'} />
  </svg>
)

export const IconTrash = () => (
  <svg {...base} width={14} height={14}>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </svg>
)

export const IconGear = () => (
  <svg {...base} width={14} height={14}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
  </svg>
)

export const IconSplit = () => (
  <svg {...base} width={14} height={14}>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M8 3v10" />
  </svg>
)

export const IconPuzzle = () => (
  <svg {...base}>
    <path d="M6.5 2.8a1.4 1.4 0 0 1 2.8 0V4h2.2a1 1 0 0 1 1 1v2.2h-1.2a1.4 1.4 0 0 0 0 2.8h1.2v2.2a1 1 0 0 1-1 1H9.3v-1.2a1.4 1.4 0 0 0-2.8 0V13.2H4.3a1 1 0 0 1-1-1V10h1.2a1.4 1.4 0 0 0 0-2.8H3.3V5a1 1 0 0 1 1-1h2.2z" />
  </svg>
)

export const IconPlay = () => (
  <svg {...base} width={14} height={14}>
    <path d="M5 3.5v9l7.5-4.5z" fill="currentColor" />
  </svg>
)

export const IconPause = () => (
  <svg {...base} width={14} height={14}>
    <path d="M5.5 3.5v9M10.5 3.5v9" strokeWidth={2} />
  </svg>
)

export const IconExpand = () => (
  <svg {...base} width={14} height={14}>
    <path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" />
  </svg>
)
