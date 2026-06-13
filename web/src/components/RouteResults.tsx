import { useState } from 'react'
import { AlertCircle, Check, Link2, Pin, RefreshCw, Route } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { RouteTimeline } from './RouteTimeline'
import { AlternativeRoutes } from './AlternativeRoutes'
import type { RouteResult, StationOption } from '../lib/routing/types'
import type { NetworkMapMeta, NetworkExport } from '../types/network'
import type { ScaleSettings } from '../lib/scale'

interface RouteResultsProps {
  selectedRoute: RouteResult | null
  alternatives: RouteResult[]
  fromName: string
  toName: string
  error: string | null
  searched: boolean
  scale: ScaleSettings
  stations: StationOption[]
  network: NetworkExport
  boundingBox?: NetworkMapMeta['bounding_box']
  onSelectRoute: (route: RouteResult) => void
  frozenShareUrl?: string
  dynamicShareUrl?: string
  frozenRouteActive?: boolean
  frozenRouteWarning?: string | null
}

export function RouteResults({
  selectedRoute,
  alternatives,
  fromName,
  toName,
  error,
  searched,
  scale,
  stations,
  network,
  boundingBox,
  onSelectRoute,
  frozenShareUrl,
  dynamicShareUrl,
  frozenRouteActive = false,
  frozenRouteWarning,
}: RouteResultsProps) {
  const [copied, setCopied] = useState<'frozen' | 'dynamic' | null>(null)
  const [shareOpen, setShareOpen] = useState(false)

  if (!searched) return null

  async function copyUrl(kind: 'frozen' | 'dynamic', url?: string) {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(kind)
      setShareOpen(false)
      window.setTimeout(() => setCopied(null), 2000)
    } catch {
      /* ignore */
    }
  }

  const totalFound = frozenRouteActive
    ? selectedRoute
      ? 1
      : 0
    : (selectedRoute ? 1 : 0) + alternatives.length

  return (
    <section className="results">
      <AnimatePresence mode="wait">
        {error && (
          <motion.div
            key="error"
            className="results__message results__message--error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <AlertCircle size={20} />
            <div>
              <strong>Keine Verbindung gefunden</strong>
              <p>{error}</p>
            </div>
          </motion.div>
        )}

        {!error && selectedRoute && (
          <motion.div
            key="results"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="results__header">
              <Route size={20} />
              <h2>
                {frozenRouteActive
                  ? 'Gespeicherte Route'
                  : `${totalFound} Verbindung${totalFound !== 1 ? 'en' : ''} gefunden`}
              </h2>
              {(frozenShareUrl || dynamicShareUrl) && (
                <div className="results__share-wrap">
                  <button
                    type="button"
                    className="results__share"
                    onClick={() => setShareOpen((open) => !open)}
                    aria-expanded={shareOpen}
                  >
                    {copied === 'frozen' ? <Check size={15} /> : <Link2 size={15} />}
                    {copied === 'frozen' ? 'Kopiert!' : 'Link teilen'}
                  </button>
                  {shareOpen && (
                    <div className="results__share-menu">
                      <button
                        type="button"
                        className="results__share-option"
                        onClick={() => copyUrl('frozen', frozenShareUrl)}
                        disabled={!frozenShareUrl}
                      >
                        <Pin size={14} />
                        <span>
                          <strong>Exakte Route</strong>
                          <small>Mit Token — bleibt identisch, auch bei neuem Netz</small>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="results__share-option"
                        onClick={() => copyUrl('dynamic', dynamicShareUrl)}
                        disabled={!dynamicShareUrl}
                      >
                        <RefreshCw size={14} />
                        <span>
                          <strong>Dynamisch</strong>
                          <small>Neu berechnen — ggf. bessere Wege nach Export-Update</small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {frozenRouteActive && (
              <div className="results__frozen-banner">
                <Pin size={15} aria-hidden />
                <p>
                  Eingefrorene Route aus Share-Link — wird nicht neu optimiert.
                  {frozenRouteWarning ? ` ${frozenRouteWarning}` : ''}
                </p>
              </div>
            )}

            <RouteTimeline
              route={selectedRoute}
              fromName={fromName}
              toName={toName}
              scale={scale}
              stations={stations}
              network={network}
              boundingBox={boundingBox}
              isPrimary
            />

            {!frozenRouteActive && (
              <AlternativeRoutes
                routes={alternatives}
                selectedId={selectedRoute.id}
                scale={scale}
                onSelect={onSelectRoute}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
