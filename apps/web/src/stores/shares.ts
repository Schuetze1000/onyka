import { create } from 'zustand'
import type { Note, SharedFolder, ShareWithUser, ShareWithOwner, Permission } from '@onyka/shared'
import { notesApi, foldersApi, sharesApi } from '@/services/api'

export interface SharedNote extends Note {
  sharedBy: {
    id: string
    username: string
    name: string
    avatarUrl?: string
    avatarColor?: string
  }
  permission: Permission
}

interface SharesState {
  sharedWithMe: SharedNote[]
  sharedFolders: SharedFolder[]
  sharedLoadError: boolean
  isLoadingSharedWithMe: boolean
  myShares: ShareWithUser[]
  isLoadingMyShares: boolean
  sharedFolderIds: Set<string>
  fetchSharedWithMe: () => Promise<void>
  fetchMyShares: () => Promise<void>
  refreshAll: () => Promise<void>
}

/** Returns a Set of folder IDs that the current user has shared with others */
export const useSharedFolderIds = () =>
  useSharesStore((state) => state.sharedFolderIds)

export const useSharesStore = create<SharesState>((set, get) => ({
  sharedWithMe: [],
  sharedFolders: [],
  sharedLoadError: false,
  isLoadingSharedWithMe: false,

  myShares: [],
  isLoadingMyShares: false,
  sharedFolderIds: new Set<string>(),

  fetchSharedWithMe: async () => {
    set({ isLoadingSharedWithMe: true, sharedLoadError: false })
    try {
      const [notesResult, sharesResult, foldersResult] = await Promise.all([
        notesApi.sharedWithMe(),
        sharesApi.sharedWithMe(),
        foldersApi.sharedWithMe(),
      ])

      const { notes } = notesResult
      const { shares } = sharesResult

      const sharedNotes: SharedNote[] = notes.map(note => {
        const share = shares.find((s: ShareWithOwner) => s.resourceType === 'note' && s.resourceId === note.id)
        return {
          ...note,
          sharedBy: share?.owner ?? {
            id: '',
            username: 'Unknown',
            name: 'Unknown',
          },
          permission: share?.permission ?? 'read',
        }
      })

      set({ sharedWithMe: sharedNotes, sharedFolders: foldersResult.folders, isLoadingSharedWithMe: false })
    } catch (err) {
      console.error('Failed to fetch shared notes:', err)
      set({ isLoadingSharedWithMe: false, sharedLoadError: true })
    }
  },

  fetchMyShares: async () => {
    set({ isLoadingMyShares: true })
    try {
      const { shares } = await sharesApi.list()
      const folderIds = new Set<string>()
      for (const share of shares) {
        if (share.resourceType === 'folder') {
          folderIds.add(share.resourceId)
        }
      }
      set({ myShares: shares, sharedFolderIds: folderIds, isLoadingMyShares: false })
    } catch (err) {
      console.error('Failed to fetch my shares:', err)
      set({ isLoadingMyShares: false })
    }
  },

  refreshAll: async () => {
    await Promise.all([
      get().fetchSharedWithMe(),
      get().fetchMyShares(),
    ])
  },
}))
