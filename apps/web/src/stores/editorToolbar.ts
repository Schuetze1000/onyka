import { create } from 'zustand'

type Platform = 'desktop' | 'mobile'
const STORAGE_KEY = 'onyka-editor-toolbar-collapsed'

function loadPreference(): Record<Platform, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
    return { desktop: saved?.desktop === true, mobile: saved?.mobile === true }
  } catch {
    return { desktop: false, mobile: false }
  }
}

export const useEditorToolbarStore = create<{
  collapsed: Record<Platform, boolean>
  setCollapsed: (platform: Platform, collapsed: boolean) => void
}>((set, get) => ({
  collapsed: loadPreference(),
  setCollapsed: (platform, value) => {
    const collapsed = { ...get().collapsed, [platform]: value }
    set({ collapsed })
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed)) } catch { /* Keep the session preference. */ }
  },
}))
