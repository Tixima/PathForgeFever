import { useCallback, useEffect, useState } from 'react'

export interface RecentSearch {
  fromId: number
  fromName: string
  toId: number
  toName: string
  timestamp: number
}

const STORAGE_KEY = 'pathforgefever-recent'
const MAX_RECENT = 6

export function useRecentSearches() {
  const [recent, setRecent] = useState<RecentSearch[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as RecentSearch[]
    } catch {
      /* ignore */
    }
    return []
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent))
  }, [recent])

  const addSearch = useCallback((fromId: number, fromName: string, toId: number, toName: string) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => !(r.fromId === fromId && r.toId === toId))
      return [{ fromId, fromName, toId, toName, timestamp: Date.now() }, ...filtered].slice(0, MAX_RECENT)
    })
  }, [])

  return { recent, addSearch }
}
