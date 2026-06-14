import { Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import type { RouteResult } from '../lib/routing/types'
import type { ScaleSettings } from '../lib/scale'
import { AlternativeRouteCard } from './AlternativeRouteCard'

interface AlternativeRoutesProps {
  routes: RouteResult[]
  selectedId: string
  primaryRoute: RouteResult | null
  scale: ScaleSettings
  onSelect: (route: RouteResult) => void
}

export function AlternativeRoutes({
  routes,
  selectedId,
  primaryRoute,
  scale,
  onSelect,
}: AlternativeRoutesProps) {
  if (routes.length === 0) return null

  return (
    <section className="alt-routes">
      <div className="alt-routes__header">
        <Sparkles size={18} />
        <div>
          <h3>Alternative Verbindungen</h3>
          <p>
            {routes.length} weitere Routen — Zeiten inkl. Realzeit-Multiplikator, verglichen mit
            der Empfehlung
          </p>
        </div>
      </div>

      <div className="alt-routes__grid">
        {routes.map((route, index) => (
          <motion.div
            key={route.id}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.04 }}
          >
            <AlternativeRouteCard
              route={route}
              rank={index + 2}
              active={route.id === selectedId}
              primaryRoute={primaryRoute}
              scale={scale}
              onSelect={() => onSelect(route)}
            />
          </motion.div>
        ))}
      </div>
    </section>
  )
}
