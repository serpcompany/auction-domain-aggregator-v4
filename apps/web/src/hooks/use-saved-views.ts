'use client'

import { useSyncExternalStore } from 'react'

import {
  deleteView,
  noSavedViews,
  type SavedView,
  type SaveViewResult,
  savedViewStore,
  saveView
} from '@/domain/saved-views'

// The saved views, and saving and deleting them. 'failed' means storage
// refused the write.
export function useSavedViews() {
  const store = savedViewStore
  const views = useSyncExternalStore(store.subscribe, store.read, noSavedViews)
  return {
    views,
    save: (view: SavedView): SaveViewResult | 'failed' => {
      const next = saveView(store.read(), view)
      if (next.result === 'full') return 'full'
      return store.write(next.views) ? next.result : 'failed'
    },
    remove: (name: string) => store.write(deleteView(store.read(), name))
  }
}
