import { ArrowRight, Accessibility, Clock, Copy, Footprints, Map, Shuffle, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import { useState } from 'react'
import type { NetworkMapMeta, NetworkExport } from '../types/network'
import type { RouteResult } from '../lib/routing/types'
import type { ScaleSettings } from '../lib/scale'
import { BRAND } from '../lib/brand'
import { formatArrivalTime, formatRouteStats } from '../lib/format'
import { getScaledRouteValues } from '../lib/scale'
import { RouteMap } from './RouteMap'
import { CollapsibleSection } from './CollapsibleSection'
import { RouteLegCard } from './route/RouteLegCard'
import type { StationOption } from '../lib/routing/types'

interface RouteTimelineProps {
  route: RouteResult
  fromName: string
  toName: string
  scale: ScaleSettings
  stations: StationOption[]
  network: NetworkExport
  boundingBox?: NetworkMapMeta['bounding_box']
  isPrimary?: boolean
}

export function RouteTimeline({
  route,
  fromName,
  toName,
  scale,
  stations,
  network,
  boundingBox,
  isPrimary = true,
}: RouteTimelineProps) {
  const [copied, setCopied] = useState(false)
  const stats = formatRouteStats(route.totalDurationSeconds, route.totalDistanceMeters, scale)
  const scaled = getScaledRouteValues(route.totalDurationSeconds, route.totalDistanceMeters, scale)

  async function copyRoute() {
    const lines = route.legs.map((l) => `${l.lineName}: ${l.fromStationName} → ${l.toStationName}`).join('\n')
    const text = [
      `${BRAND.copyRoutePrefix}: ${fromName} → ${toName}`,
      `Dauer: ${stats.duration} (${stats.label})`,
      `Strecke: ${stats.distance}`,
      `Umstiege: ${route.transferCount}`,
      '',
      lines,
    ].join('\n')

    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.article
      className={`route-card ${isPrimary ? 'route-card--primary' : ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
    >
      <div className="route-card__accent" aria-hidden />

      <header className="route-card__header">
        <div>
          <div className="route-card__badges">
            {isPrimary && <span className="badge badge--primary">Empfohlen</span>}
            {route.isDirect && <span className="badge badge--direct"><Zap size={10} /> Direktverbindung</span>}
            {route.tags.includes('strikt-modus') && (
              <span className="badge badge--strict">Strikt</span>
            )}
            {route.accessibility?.requested && route.accessibility.fullySamePlatform && (
              <span className="badge badge--accessible">Ohne Gleiswechsel</span>
            )}
            {route.accessibility?.requested && route.accessibility.fullySamePlatform && route.accessibility.usesStaySeated && (
              <span className="badge badge--stay-seated">Sitzenbleiben</span>
            )}
            {route.accessibility?.requested && !route.accessibility.fullySamePlatform && (
              <span className="badge badge--accessible-compromise">
                {route.accessibility.platformChangeCount} Gleiswechsel nötig
              </span>
            )}
            {(route.viaStationIds?.length ?? 0) > 0 && (
              <span className="badge badge--via">Über {route.viaStationIds!.length} Bahnhof{route.viaStationIds!.length > 1 ? 'e' : ''}</span>
            )}
            <span className="badge badge--scale">{stats.label}</span>
          </div>
          <h3 className="route-card__route">
            {fromName} <ArrowRight size={16} /> {toName}
          </h3>
          <p className="route-card__criterion">{route.label}</p>
        </div>
        <div className="route-card__summary">
          <span className="route-card__duration">{stats.duration}</span>
          <span className="route-card__arrival">
            Ankunft ca. {formatArrivalTime(scaled.durationSeconds)}
          </span>
          <span className="route-card__meta">
            {stats.distance} · {route.transferCount} Umstiege · {route.stopCount} Halte
          </span>
        </div>
      </header>

      {route.accessibility?.requested && route.accessibility.summary && (
        <div
          className={`route-card__accessibility${route.accessibility.fullySamePlatform ? ' route-card__accessibility--ok' : ''}`}
        >
          <Accessibility size={16} aria-hidden />
          <p>{route.accessibility.summary}</p>
        </div>
      )}

      <div className="route-card__actions">
        <div className="route-card__stats">
          <div className="stat-chip">
            <Clock size={14} />
            {stats.duration}
          </div>
          <div className="stat-chip">
            <Footprints size={14} />
            {stats.distance}
          </div>
          <div className="stat-chip">
            <Shuffle size={14} />
            {route.transferCount}× umsteigen
          </div>
        </div>
        <button type="button" className="route-card__copy" onClick={copyRoute}>
          <Copy size={14} />
          {copied ? 'Kopiert!' : 'Route kopieren'}
        </button>
      </div>

      <CollapsibleSection
        className="route-map-collapsible"
        title="Streckenverlauf"
        subtitle="Geografische Karte — Norden oben"
        icon={<Map size={16} />}
        badge={`${route.legs.length} Linie${route.legs.length !== 1 ? 'n' : ''}`}
        defaultOpen={false}
      >
        <RouteMap
          route={route}
          stations={stations}
          scale={scale}
          boundingBox={boundingBox}
          terrain={network.terrain}
          embedded
        />
      </CollapsibleSection>

      <div className="route-journey">
        <div className="route-journey__head">
          <h4>Fahrplan</h4>
          <span>{route.legs.length} Abschnitt{route.legs.length !== 1 ? 'e' : ''}</span>
        </div>

        <div className="route-journey__legs">
          {route.legs.map((leg, index) => (
            <RouteLegCard
              key={`${leg.lineId}-${index}`}
              leg={leg}
              index={index}
              scale={scale}
              stations={stations}
              network={network}
              nextLeg={route.legs[index + 1]}
              showTransfer={index < route.legs.length - 1}
              transferAccessibility={route.accessibility?.transfers[index]}
            />
          ))}
        </div>
      </div>

      {route.isExperimental && (
        <p className="route-card__disclaimer">
          Fahrzeiten und Distanzen basieren auf experimentellen Schätzungen — mit Realzeit-Multiplikator angepasst.
        </p>
      )}
    </motion.article>
  )
}
