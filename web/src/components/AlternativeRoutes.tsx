import { ArrowRight, Sparkles, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import type { RouteResult } from '../lib/routing/types'
import type { ScaleSettings } from '../lib/scale'
import { formatDelta, formatRouteStats } from '../lib/format'

interface AlternativeRoutesProps {
  routes: RouteResult[]
  selectedId: string
  scale: ScaleSettings
  onSelect: (route: RouteResult) => void
}

export function AlternativeRoutes({ routes, selectedId, scale, onSelect }: AlternativeRoutesProps) {
  if (routes.length === 0) return null

  return (
    <section className="alt-routes">
      <div className="alt-routes__header">
        <Sparkles size={18} />
        <div>
          <h3>Alternative Verbindungen</h3>
          <p>{routes.length} weitere Routen gefunden — zum Vergleich auswählen</p>
        </div>
      </div>

      <div className="alt-routes__grid">
        {routes.map((route, index) => {
          const stats = formatRouteStats(
            route.totalDurationSeconds,
            route.totalDistanceMeters,
            scale,
          )
          const active = route.id === selectedId

          return (
            <motion.button
              key={route.id}
              type="button"
              className={`alt-route-card ${active ? 'is-active' : ''}`}
              onClick={() => onSelect(route)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <div className="alt-route-card__top">
                <span className="alt-route-card__rank">#{index + 2}</span>
                {route.isDirect && <span className="badge badge--direct"><Zap size={10} /> Direkt</span>}
                {route.tags.includes('kriterium') && (
                  <span className="badge badge--criterion">{route.label}</span>
                )}
                {route.tags.includes('ohne-gleiswechsel') && (
                  <span className="badge badge--accessible">Ohne Gleiswechsel</span>
                )}
                {route.tags.includes('sitzenbleiben') && (
                  <span className="badge badge--stay-seated">Sitzenbleiben</span>
                )}
                {route.accessibility?.requested && route.accessibility.fullySamePlatform && !route.tags.includes('ohne-gleiswechsel') && (
                  <span className="badge badge--accessible">Barrierefrei</span>
                )}
              </div>

              <div className="alt-route-card__duration">{stats.duration}</div>

              <div className="alt-route-card__meta">
                <span>{stats.distance}</span>
                <span>{route.transferCount} Umstiege</span>
                <span>{route.stopCount} Halte</span>
              </div>

              <div className="alt-route-card__lines">
                {route.legs.map((leg) => (
                  <span
                    key={leg.lineId}
                    className="alt-route-card__line"
                    style={{ backgroundColor: leg.lineColor }}
                    title={leg.lineName}
                  />
                ))}
              </div>

              <div className="alt-route-card__delta">
                {formatDelta(route.deltaSeconds ?? 0)}
              </div>

              <div className="alt-route-card__path">
                {route.stationNames[0]}
                <ArrowRight size={12} />
                {route.stationNames[route.stationNames.length - 1]}
                {route.stationNames.length > 2 && (
                  <span className="alt-route-card__via">
                    via {route.stationNames.length - 2} Stationen
                  </span>
                )}
              </div>
            </motion.button>
          )
        })}
      </div>
    </section>
  )
}
