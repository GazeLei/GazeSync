import type { ZoomController } from './index.js'
export function attachBrowserControls(
  element: HTMLElement,
  controller: ZoomController,
  options?: { onChange?: () => void; onLifecycle?: (reason: string) => void },
): { dispose(): void }
