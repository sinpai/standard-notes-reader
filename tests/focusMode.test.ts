import { describe, expect, it } from 'vitest'
import {
  focusModeAvailable,
  focusModeShortcut,
  focusModeShortcutLabel,
  usesCommandKey,
} from '../src/app/focusMode'

describe('focus mode shortcut', () => {
  it('uses ⌘ in the macOS apps and Ctrl everywhere else, like Standard Notes', () => {
    expect(usesCommandKey('mac-desktop')).toBe(true)
    expect(usesCommandKey('mac-web')).toBe(true)
    for (const platform of ['windows-desktop', 'windows-web', 'linux-desktop', 'linux-web', 'ios', 'android']) {
      expect(usesCommandKey(platform)).toBe(false)
    }
  })

  it('is ⌘⇧F or Ctrl+Shift+F', () => {
    expect(focusModeShortcut('mac-desktop')).toEqual({ key: 'F', code: 'KeyF', metaKey: true, ctrlKey: false, shiftKey: true })
    expect(focusModeShortcut('windows-desktop')).toEqual({ key: 'F', code: 'KeyF', metaKey: false, ctrlKey: true, shiftKey: true })
    expect(focusModeShortcutLabel('mac-web')).toBe('⌘⇧F')
    expect(focusModeShortcutLabel('linux-desktop')).toBe('Ctrl+Shift+F')
  })
})

describe('focusModeAvailable', () => {
  it('leaves the button out on phones, where focus mode has no effect', () => {
    expect(focusModeAvailable('ios', { width: 390, height: 844 })).toBe(false)
    expect(focusModeAvailable('android', { width: 412, height: 915 })).toBe(false)
  })

  it('offers it on tablets and computers', () => {
    expect(focusModeAvailable('ios', { width: 820, height: 1180 })).toBe(true)
    expect(focusModeAvailable('mac-desktop', { width: 1512, height: 982 })).toBe(true)
    expect(focusModeAvailable('windows-web', { width: 800, height: 600 })).toBe(true)
  })
})
