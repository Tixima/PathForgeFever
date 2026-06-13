import { useCallback, useEffect, useState } from 'react'
import { DEFAULT_SCALE, type ScaleSettings } from '../lib/scale'

const STORAGE_KEY = 'pathforgefever-scale'

export function useScaleSettings() {
  const [settings, setSettings] = useState<ScaleSettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) return { ...DEFAULT_SCALE, ...JSON.parse(stored) }
    } catch {
      /* ignore */
    }
    return DEFAULT_SCALE
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  const update = useCallback((patch: Partial<ScaleSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }))
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SCALE)
  }, [])

  return { settings, update, reset }
}
