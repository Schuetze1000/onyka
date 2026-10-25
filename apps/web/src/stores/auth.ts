import { create } from 'zustand'
import type { User } from '@onyka/shared'
import { authApi, ApiException, type RateLimitInfo, type Auth2FARequiredResponse, resetRefreshState, invalidateSessionRequests } from '@/services/api'
import { setLanguage } from '@/i18n'
import { useThemeStore, setAuthenticatedState } from './theme'
import { useNotesStore, resetNoteCache } from './notes'
import { useFoldersStore } from './folders'
import { useTagsStore } from './tags'
import { useSparksStore } from './sparks'
import { useSharesStore } from './shares'
import { useStatsStore } from './stats'
import { useRecapsStore } from './recaps'
import { useCommentsStore } from './comments'
import { usePagesStore } from './pages'
import { useSettingsStore } from './settings'
import { resetSocket } from '@/hooks/useSocket'

/** Resets all user-scoped stores on logout to prevent data leaking between sessions. */
function clearAllUserStores() {
  invalidateSessionRequests()
  resetNoteCache()
  useNotesStore.setState({ notes: [], currentNote: null, searchResults: [], isSearching: false, selectedNoteIds: [], isLoading: false, error: null })
  useFoldersStore.setState({ folders: [], isLoading: false, error: null })
  useTagsStore.setState({ tags: [], isLoading: false, error: null })
  useSparksStore.setState({ pinned: [], temporary: [], permanent: [], stats: null, isLoading: false, error: null, isDrawerOpen: false })
  useSharesStore.setState({ sharedWithMe: [], sharedFolders: [], sharedLoadError: false, myShares: [], sharedFolderIds: new Set(), isLoadingSharedWithMe: false, isLoadingMyShares: false })
  useCommentsStore.setState({ commentsByNote: {}, countsByNote: {}, isLoading: false, isSubmitting: false, error: null, expandedNoteId: null, replyingTo: null, editingId: null })
  usePagesStore.setState({ pagesByNote: {}, pageLocks: {}, activePageByNote: {}, isLoading: false, isSaving: false, error: null })
  useSettingsStore.setState({ settings: null, isLoading: false, error: null })

  useStatsStore.setState({
    overview: null,
    periodStats: null,
    selectedPeriod: 'week',
    isLoading: false,
    error: null,
    trackingEnabled: true,
    trackingLoaded: false,
  })
  localStorage.removeItem('onyka-stats')

  useRecapsStore.setState({
    pendingRecap: null,
    history: [],
    isLoading: false,
    error: null,
    hasChecked: false,
    lastDismissedId: null,
  })
  localStorage.removeItem('onyka-recaps')
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  rateLimitInfo: RateLimitInfo | null
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>
  register: (username: string, password: string, email?: string) => Promise<void>
  logout: () => Promise<void>
  checkAuth: () => Promise<void>
  clearError: () => void
  setUser: (user: User) => void
  refreshUser: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  rateLimitInfo: null,

  login: async (username, password, rememberMe = false) => {
    set({ error: null, rateLimitInfo: null })
    try {
      const response = await authApi.login({ username, password, rememberMe })

      if ('requires2FA' in response && response.requires2FA) {
        const twoFAResponse = response as Auth2FARequiredResponse
        throw {
          requires2FA: true,
          userId: twoFAResponse.userId,
          pendingToken: twoFAResponse.pendingToken,
        }
      }

      const user = (response as { user: User }).user
      clearAllUserStores()
      resetSocket()
      resetRefreshState()
      if (user.language) {
        setLanguage(user.language)
      }
      await useThemeStore.getState().loadFromUser(user)
      setAuthenticatedState(true)
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      if (err && typeof err === 'object' && 'requires2FA' in err) {
        throw err
      }
      const rateLimitInfo = err instanceof ApiException ? err.rateLimitInfo : null
      const message = err instanceof ApiException
        ? (err.code === 'RATE_LIMITED' ? 'RATE_LIMITED' : err.message)
        : 'Login failed'
      set({ error: message, rateLimitInfo: rateLimitInfo ?? null })
      throw err
    }
  },

  register: async (username, password, email) => {
    set({ error: null, rateLimitInfo: null })
    try {
      const { user } = await authApi.register({ username, password, email })
      clearAllUserStores()
      resetSocket()
      await useThemeStore.getState().loadFromUser(user)
      setAuthenticatedState(true)
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (err) {
      const rateLimitInfo = err instanceof ApiException ? err.rateLimitInfo : null
      let message = 'Registration failed'
      if (err instanceof ApiException) {
        if (err.code === 'RATE_LIMITED') {
          message = 'RATE_LIMITED'
        } else if (err.code === 'VALIDATION_ERROR' && err.details) {
          const fields = Object.keys(err.details)
          if (fields.length > 0) {
            const field = fields[0]
            const fieldMessage = err.details[field]?.[0] || 'Invalid'
            message = `${field}: ${fieldMessage}`
          } else {
            message = err.message
          }
        } else {
          message = err.message
        }
      }
      set({ error: message, rateLimitInfo: rateLimitInfo ?? null })
      throw err
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // Clear local user data even when the logout request cannot reach the server.
    } finally {
      setAuthenticatedState(false)
      clearAllUserStores()
      resetSocket()
      set({ user: null, isAuthenticated: false, error: null })
    }
  },

  checkAuth: async () => {
    set({ isLoading: true })
    try {
      const { user } = await authApi.me()
      if (user.language) {
        setLanguage(user.language)
      }
      await useThemeStore.getState().loadFromUser(user)
      setAuthenticatedState(true)
      set({ user, isAuthenticated: true, isLoading: false })
    } catch (error) {
      if (error instanceof ApiException && error.code === 'SESSION_CHANGED') return
      clearAllUserStores()
      resetSocket()
      setAuthenticatedState(false)
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  clearError: () => set({ error: null, rateLimitInfo: null }),

  setUser: (user) => {
    if (useAuthStore.getState().user?.id !== user.id) {
      clearAllUserStores()
      resetSocket()
      resetRefreshState()
    }
    setAuthenticatedState(true)
    set({ user, isAuthenticated: true, isLoading: false })
  },

  refreshUser: async () => {
    try {
      const { user } = await authApi.me()
      set({ user })
    } catch {
      // Keep the last confirmed profile when refreshing it fails.
    }
  },
}))
