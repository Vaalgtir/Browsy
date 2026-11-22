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
