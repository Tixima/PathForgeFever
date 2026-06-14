import { useCallback, useEffect, useState } from 'react'
import type { NetworkExport } from '../types/network'
import { buildRoutingGraph, type RoutingGraph } from '../lib/routing/buildGraph'
import {
  fetchNetworkExport,
  readNetworkExportFile,
  toNetworkLoadError,
  validateNetworkExport,
  type NetworkLoadError,
} from '../lib/network/loadNetworkExport'
import { hasTerrainData } from '../lib/terrain/terrainAvailability'

export const NETWORK_DATA_URL = '/data/tpf2_network_export.json'
const SESSION_STORAGE_KEY = 'pathforgefever-uploaded-network'

interface NetworkState {
  network: NetworkExport | null
  graph: RoutingGraph | null
  loading: boolean
  reloading: boolean
  importing: boolean
  error: NetworkLoadError | null
  source: 'url' | 'upload' | null
  uploadedFileName: string | null
  reload: () => void
  importFile: (file: File) => Promise<void>
  retryFetch: () => void
}

function applyNetwork(data: NetworkExport): { network: NetworkExport; graph: RoutingGraph } {
  return { network: data, graph: buildRoutingGraph(data) }
}

function tryRestoreSessionUpload(): NetworkExport | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    return validateNetworkExport(JSON.parse(raw))
  } catch {
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    return null
  }
}

function persistSessionUpload(data: NetworkExport, fileName: string) {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data))
    sessionStorage.setItem(`${SESSION_STORAGE_KEY}:name`, fileName)
  } catch {
    /* Speicher voll — Upload gilt trotzdem für diese Session im State */
  }
}

export function useNetwork(dataUrl = NETWORK_DATA_URL): NetworkState {
  const [network, setNetwork] = useState<NetworkExport | null>(null)
  const [graph, setGraph] = useState<RoutingGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloading, setReloading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<NetworkLoadError | null>(null)
  const [source, setSource] = useState<'url' | 'upload' | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const [loadGeneration, setLoadGeneration] = useState(0)

  const reload = useCallback(() => {
    setLoadGeneration((n) => n + 1)
  }, [])

  const retryFetch = reload

  const importFile = useCallback(async (file: File) => {
    setImporting(true)
    setError(null)
    try {
      const data = await readNetworkExportFile(file)
      const next = applyNetwork(data)
      setNetwork(next.network)
      setGraph(next.graph)
      setSource('upload')
      setUploadedFileName(file.name)
      persistSessionUpload(data, file.name)
    } catch (err) {
      setError(toNetworkLoadError(err))
    } finally {
      setImporting(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const isReload = loadGeneration > 0

    async function load() {
      try {
        if (isReload) {
          setReloading(true)
        } else {
          setLoading(true)
        }
        setError(null)

        if (loadGeneration === 0) {
          const restored = tryRestoreSessionUpload()
          const restoredName = sessionStorage.getItem(`${SESSION_STORAGE_KEY}:name`)
          // Alte Uploads ohne Terrain nicht bevorzugen — Server-Export mit Gelände laden
          if (restored && hasTerrainData(restored.terrain)) {
            const next = applyNetwork(restored)
            if (cancelled) return
            setNetwork(next.network)
            setGraph(next.graph)
            setSource('upload')
            setUploadedFileName(restoredName)
            return
          }
          if (restored && !hasTerrainData(restored.terrain)) {
            sessionStorage.removeItem(SESSION_STORAGE_KEY)
            sessionStorage.removeItem(`${SESSION_STORAGE_KEY}:name`)
          }
        }

        const data = await fetchNetworkExport(dataUrl, isReload)
        if (cancelled) return

        const next = applyNetwork(data)
        setNetwork(next.network)
        setGraph(next.graph)
        setSource('url')
        setUploadedFileName(null)
      } catch (err) {
        if (cancelled) return
        setError(toNetworkLoadError(err))
        if (!isReload) {
          setNetwork(null)
          setGraph(null)
          setSource(null)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
          setReloading(false)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [dataUrl, loadGeneration])

  return {
    network,
    graph,
    loading,
    reloading,
    importing,
    error,
    source,
    uploadedFileName,
    reload,
    importFile,
    retryFetch,
  }
}
