import { Clock, MapPin, Shuffle } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { RouteResult } from '../lib/routing/types'
import type { ScaleSettings } from '../lib/scale'
import { formatArrivalTime, formatRouteDelta, formatRouteStats } from '../lib/format'
import { getScaledRouteValues } from '../lib/scale'
import {
  computeRouteDeltaSeconds,
  formatDistanceDelta,
  formatGameTimeDelta,
  getLegSegmentShares,
  getRouteTransferHubs,
  lineShortName,
  routeDeltaPercent,
} from '../lib/routing/routeCardSummary'

interface AlternativeRouteCardProps {
  route: RouteResult
  rank: number
  active: boolean
  primaryRoute: RouteResult | null
  scale: ScaleSettings
  onSelect: () => void
}

export function AlternativeRouteCard({
  route,
  rank,
  active,
  primaryRoute,
  scale,
  onSelect,
}: AlternativeRouteCardProps) {
  const stats = formatRouteStats(route.totalDurationSeconds, route.totalDistanceMeters, scale)
  const scaled = getScaledRouteValues(route.totalDurationSeconds, route.totalDistanceMeters, scale)
  const transferHubs = getRouteTransferHubs(route)
  const segments = getLegSegmentShares(route)
  const deltaSeconds = computeRouteDeltaSeconds(route, primaryRoute, scale)
  const distanceDelta = formatDistanceDelta(route, primaryRoute, scale)
  const gameDelta = formatGameTimeDelta(route, primaryRoute)
  const percentSlower = routeDeltaPercent(route, primaryRoute, scale)
  const arrival = formatArrivalTime(scaled.durationSeconds)
  const accent = route.legs[0]?.lineColor ?? 'var(--accent)'

  let transferOffset = 0
  const transferMarkers = segments.slice(0, -1).map(({ share }, i) => {
    transferOffset += share
    return { hub: transferHubs[i], left: transferOffset * 100 }
  })

  return (
    <button
      type="button"
      className={`alt-route-card ${active ? 'is-active' : ''}`}
      style={{ '--alt-accent': accent } as CSSProperties}
      onClick={onSelect}
    >
      <div className="alt-route-card__accent" aria-hidden />

      <div className="alt-route-card__head">
        <span className="alt-route-card__rank">#{rank}</span>
        <div className="alt-route-card__badges">
          {route.isDirect && <span className="badge badge--direct">Direkt</span>}
          {route.tags.includes('barrierefrei-strikt') && (
            <span className="badge badge--strict">Barrierefrei strikt</span>
          )}
          {route.tags.includes('barrierefrei') && !route.tags.includes('barrierefrei-strikt') && (
            <span className="badge badge--accessible">Barrierefrei</span>
          )}
          {route.tags.includes('kriterium') && (
            <span className="badge badge--criterion">{route.label}</span>
          )}
          {route.tags.includes('ohne-gleiswechsel') && (
            <span className="badge badge--accessible">Ohne Gleiswechsel</span>
          )}
          {route.accessibility?.requested &&
            !route.tags.includes('barrierefrei') &&
            !route.tags.includes('barrierefrei-strikt') &&
            !route.accessibility.fullySamePlatform && (
              <span className="badge badge--accessible-compromise">
                {route.accessibility.platformChangeCount} Gleiswechsel
              </span>
            )}
        </div>
      </div>

      <div className="alt-route-card__hero">
        <div className="alt-route-card__duration">{stats.duration}</div>
        <div className="alt-route-card__compare">
          <span className={`alt-route-card__delta ${deltaSeconds <= 0 ? 'is-best' : ''}`}>
            {formatRouteDelta(deltaSeconds)}
          </span>
          <span className="alt-route-card__compare-label">vs. Empfohlen</span>
          {percentSlower != null && (
            <span className="alt-route-card__percent">+{percentSlower} %</span>
          )}
          {distanceDelta && <span className="alt-route-card__dist-delta">{distanceDelta}</span>}
          {scaled.isScaled && gameDelta && (
            <span className="alt-route-card__game-delta" title="Spielzeit-Differenz">
              ({gameDelta} Spielzeit)
            </span>
          )}
        </div>
      </div>

      <div className="alt-route-card__stats">
        <span>
          <Clock size={12} aria-hidden />
          ~{arrival}
        </span>
        <span>
          <MapPin size={12} aria-hidden />
          {stats.distance}
        </span>
        <span>
          <Shuffle size={12} aria-hidden />
          {route.transferCount} Umst.
        </span>
        <span>{route.stopCount} Halte</span>
      </div>

      <div className="alt-route-card__journey" aria-label="Routenverlauf">
        {segments.map(({ leg, share }, legIndex) => (
          <span
            key={`${leg.lineId}-${legIndex}`}
            className="alt-route-card__journey-seg"
            style={{
              flexGrow: Math.max(share, 0.06),
              backgroundColor: leg.lineColor,
            }}
            title={`${leg.lineName}: ${leg.fromStationName} → ${leg.toStationName}`}
          />
        ))}
        {transferMarkers.map(
          (marker) =>
            marker.hub && (
              <span
                key={marker.hub}
                className="alt-route-card__journey-pin"
                style={{ left: `${marker.left}%` }}
                title={`Umstieg ${marker.hub}`}
              />
            ),
        )}
      </div>

      <div className="alt-route-card__leg-strip">
        {route.legs.map((leg, legIndex) => (
          <span
            key={`${leg.lineId}-${legIndex}`}
            className="alt-route-card__leg-pill"
            style={{ '--line-color': leg.lineColor } as CSSProperties}
            title={`${leg.lineName}: ${leg.fromStationName} → ${leg.toStationName}`}
          >
            <span className="alt-route-card__leg-square">{lineShortName(leg.lineName)}</span>
            <span className="alt-route-card__leg-arrow">→</span>
            <span className="alt-route-card__leg-dest">{leg.toStationName}</span>
          </span>
        ))}
      </div>

      {transferHubs.length > 0 && (
        <p className="alt-route-card__hubs">
          Umstieg in <strong>{transferHubs.join(' · ')}</strong>
        </p>
      )}
    </button>
  )
}
