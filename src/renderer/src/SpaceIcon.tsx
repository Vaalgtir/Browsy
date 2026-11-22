import type { ReactNode } from 'react'

/** Icônes des Spaces (16×16, trait 1.5px). Mêmes noms que les icônes d'Arc importées. */
const PATHS: Record<string, ReactNode> = {
  star: <path d="m8 2.2 1.8 3.7 4 .6-2.9 2.8.7 4L8 11.4l-3.6 1.9.7-4L2.2 6.5l4-.6z" />,
  heart: <path d="M8 13.5S2.5 10.2 2.5 6.2A2.9 2.9 0 0 1 8 4.6a2.9 2.9 0 0 1 5.5 1.6c0 4-5.5 7.3-5.5 7.3z" />,
  bolt: <path d="M9 1.8 3.5 9h4L7 14.2 12.5 7h-4z" />,
  folder: <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.4 1.5h5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />,
  code: <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />,
  terminal: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="m4.8 6.3 2 1.7-2 1.7M8.5 10h2.7" />
    </>
  ),
  briefcase: (
    <>
      <rect x="2" y="5" width="12" height="8" rx="1.5" />
      <path d="M5.8 5V3.8A1 1 0 0 1 6.8 2.8h2.4a1 1 0 0 1 1 1V5M2 8.5h12" />
    </>
  ),
  book: <path d="M3 3.2A1.2 1.2 0 0 1 4.2 2H13v10.5H4.2A1.2 1.2 0 0 0 3 13.7zM3 13.7A1.2 1.2 0 0 0 4.2 15H13M6 5h4.5" />,
  planet: (
    <>
      <circle cx="8" cy="8" r="3.8" />
      <path d="M2.8 10.8c-1.2.9-1.6 1.7-1.2 2.2.8 1.1 5-.6 9-3.6s6.5-6.2 5.7-7.3c-.4-.5-1.3-.4-2.5.1" />
    </>
  ),
  pizza: (
    <>
      <path d="M3.2 2.6 13.4 7.2 3.2 13.4z" />
      <path d="M5 3.4v9" />
      <circle cx="7.6" cy="6.8" r=".8" />
      <circle cx="8.8" cy="9.4" r=".8" />
    </>
  ),
  receipt: <path d="M3.5 2h9v12l-1.5-1-1.5 1-1.5-1-1.5 1-1.5-1-1.5 1zM5.8 5.5h4.4M5.8 8h4.4M5.8 10.5H8" />,
  music: (
    <>
      <path d="M6 12V3.5l7-1.5V10.5" />
      <circle cx="4.5" cy="12" r="1.7" />
      <circle cx="11.5" cy="10.5" r="1.7" />
    </>
  ),
  camera: (
    <>
      <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.7l1-1.5h3.6l1 1.5h1.7A1.5 1.5 0 0 1 14 5.5v6A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
      <circle cx="8" cy="8.5" r="2.4" />
    </>
  ),
  palette: (
    <>
      <path d="M8 2a6 6 0 0 0 0 12c1 0 1.3-.7 1-1.5-.4-.9.2-1.8 1.2-1.8H12a2 2 0 0 0 2-2A6.3 6.3 0 0 0 8 2z" />
      <circle cx="5.2" cy="7.2" r=".7" />
      <circle cx="7.6" cy="4.8" r=".7" />
      <circle cx="10.6" cy="5.6" r=".7" />
    </>
  ),
  gamepad: (
    <>
      <path d="M4.5 4.5h7a3 3 0 0 1 3 3.3l-.3 2.7a1.8 1.8 0 0 1-3.1 1L10 10.4H6l-1.1 1.1a1.8 1.8 0 0 1-3.1-1l-.3-2.7a3 3 0 0 1 3-3.3z" />
      <path d="M5 6.8v2M4 7.8h2M10.5 7.3h.01M11.8 8.5h.01" />
    </>
  ),
  cart: (
    <>
      <path d="M1.8 2.5h1.7l1.6 7.5h7.2l1.4-5.2H4.3" />
      <circle cx="6" cy="12.8" r="1" />
      <circle cx="11.5" cy="12.8" r="1" />
    </>
  ),
  house: <path d="M2.5 7.2 8 2.5l5.5 4.7V13a1 1 0 0 1-1 1H10V10H6v4H3.5a1 1 0 0 1-1-1z" />,
  leaf: <path d="M3 13c0-6 3.5-10 10-10 0 6.5-4 10-10 10zM3 13l5.5-5.5" />,
  flame: <path d="M8 14c-2.6 0-4.5-1.8-4.5-4.3C3.5 6.5 7 5 7 1.8c2.5 1.5 5.5 4.3 5.5 7.9C12.5 12.2 10.6 14 8 14zm0 0c-1.2 0-2-.9-2-2 0-1.5 2-2.3 2-3.8 1 .8 2 1.9 2 3.8 0 1.1-.8 2-2 2z" />,
  moon: <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </>
  ),
  graduation: <path d="M1.5 6 8 3l6.5 3L8 9zM4.5 7.5v3.2C5.5 11.6 6.7 12 8 12s2.5-.4 3.5-1.3V7.5M14.5 6v4" />,
  chart: <path d="M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="5.8" />
      <path d="M2.2 8h11.6M8 2.2c1.7 1.6 2.4 3.6 2.4 5.8s-.7 4.2-2.4 5.8C6.3 12.2 5.6 10.2 5.6 8S6.3 3.8 8 2.2" />
    </>
  ),
}

export function SpaceIcon({ icon, name, size = 16 }: { icon: string; name?: string; size?: number }) {
  if (icon.startsWith('icon:')) {
    const path = PATHS[icon.slice(5)] ?? PATHS.star
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className="space-icon"
      >
        {path}
      </svg>
    )
  }
  if (icon) {
    return (
      <span className="space-icon emoji" style={{ fontSize: size - 2, width: size, height: size }} aria-hidden>
        {icon}
      </span>
    )
  }
  return (
    <span className="space-icon letter" style={{ width: size, height: size, fontSize: size * 0.7 }} aria-hidden>
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}

export const ICON_NAMES = Object.keys(PATHS)
