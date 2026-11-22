import type { UiApi } from '../../shared/ipc'

declare global {
  interface Window {
    browsy: UiApi
  }
  namespace React.JSX {
    interface IntrinsicElements {
      'browser-action-list': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string
        tab?: string
        alignment?: string
      }
    }
  }
}

export {}
