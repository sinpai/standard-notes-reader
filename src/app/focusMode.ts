import type { Shortcut } from '../bridge/ComponentBridge'

/**
 * Standard Notes uses ⌘ for its shortcuts only in its macOS apps (web and desktop), and Ctrl
 * everywhere else, iPad included. `platform` is the name Standard Notes registers the editor with.
 */
export function usesCommandKey(platform: string | undefined): boolean {
  if (platform === undefined) {
    return /Mac/.test(navigator.platform)
  }
  return platform === 'mac-web' || platform === 'mac-desktop'
}

/** Standard Notes' focus mode shortcut: ⌘⇧F, or Ctrl+Shift+F. */
export function focusModeShortcut(platform: string | undefined): Shortcut {
  const command = usesCommandKey(platform)
  return { key: 'F', code: 'KeyF', metaKey: command, ctrlKey: !command, shiftKey: true }
}

export function focusModeShortcutLabel(platform: string | undefined): string {
  return usesCommandKey(platform) ? '⌘⇧F' : 'Ctrl+Shift+F'
}

/**
 * Focus mode only changes anything on screens at least 768 px wide. Phones already show a note
 * full screen, so they get no button; tablets do.
 */
export function focusModeAvailable(platform: string | undefined, screen: { width: number; height: number }): boolean {
  const mobile = platform === 'ios' || platform === 'android'
  return !mobile || Math.max(screen.width, screen.height) >= 1024
}
