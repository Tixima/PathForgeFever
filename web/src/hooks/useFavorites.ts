import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'pathforgefever-favorites'

export interface Favorites {
  stations: number[]
  lines: number[]
}

export function useFavorites() {
  const [favorites, setFavorites] = useState<Favorites>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return JSON.parse(stored) as Favorites
    } catch {
      /* ignore */
    }
    return { stations: [], lines: [] }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites))
  }, [favorites])

  const toggleStation = useCallback((id: number) => {
    setFavorites((prev) => {
      const has = prev.stations.includes(id)
      return {
        ...prev,
        stations: has ? prev.stations.filter((s) => s !== id) : [id, ...prev.stations],
      }
    })
  }, [])

  const toggleLine = useCallback((id: number) => {
    setFavorites((prev) => {
      const has = prev.lines.includes(id)
      return {
        ...prev,
        lines: has ? prev.lines.filter((l) => l !== id) : [id, ...prev.lines],
      }
    })
  }, [])

  const isStationFavorite = useCallback(
    (id: number) => favorites.stations.includes(id),
    [favorites.stations],
  )

  const isLineFavorite = useCallback(
    (id: number) => favorites.lines.includes(id),
    [favorites.lines],
  )

  return { favorites, toggleStation, toggleLine, isStationFavorite, isLineFavorite }
}
