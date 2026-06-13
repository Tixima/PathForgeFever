import { Accessibility, Clock, MapPin, Route, Shuffle, ShieldCheck } from 'lucide-react'
import { ROUTE_CRITERIA, type RouteCriterion } from '../lib/routing/types'

const ICONS = {
  clock: Clock,
  route: Route,
  shuffle: Shuffle,
  'map-pin': MapPin,
} as const

interface RouteCriteriaSelectorProps {
  value: RouteCriterion
  onChange: (criterion: RouteCriterion) => void
  accessible: boolean
  onAccessibleChange: (accessible: boolean) => void
  accessibleStrict: boolean
  onAccessibleStrictChange: (accessibleStrict: boolean) => void
}

export function RouteCriteriaSelector({
  value,
  onChange,
  accessible,
  onAccessibleChange,
  accessibleStrict,
  onAccessibleStrictChange,
}: RouteCriteriaSelectorProps) {
  return (
    <div className="criteria">
      <span className="criteria__label">Optimierung</span>
      <div className="criteria__grid">
        {ROUTE_CRITERIA.map((option) => {
          const Icon = ICONS[option.icon as keyof typeof ICONS]
          const active = value === option.id
          return (
            <button
              key={option.id}
              type="button"
              className={`criteria__pill ${active ? 'is-active' : ''}`}
              onClick={() => onChange(option.id)}
              title={option.description}
            >
              <Icon size={16} />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      <div className="criteria__accessibility">
        <label className="criteria__accessible">
          <input
            type="checkbox"
            checked={accessible}
            onChange={(e) => {
              const checked = e.target.checked
              onAccessibleChange(checked)
              if (!checked) onAccessibleStrictChange(false)
            }}
          />
          <span className="criteria__accessible-icon" aria-hidden>
            <Accessibility size={16} />
          </span>
          <span className="criteria__accessible-copy">
            <strong>Barrierefrei</strong>
            <small>Möglichst ohne Gleiswechsel — Umwege vor Sitzenbleiben</small>
          </span>
        </label>

        <label
          className={`criteria__accessible criteria__accessible--strict${accessible ? '' : ' is-disabled'}`}
        >
          <input
            type="checkbox"
            checked={accessible && accessibleStrict}
            disabled={!accessible}
            onChange={(e) => onAccessibleStrictChange(e.target.checked)}
          />
          <span className="criteria__accessible-icon" aria-hidden>
            <ShieldCheck size={16} />
          </span>
          <span className="criteria__accessible-copy">
            <strong>Strikt</strong>
            <small>Nur gleiswechselfreie Routen — kein Gleiswechsel, egal wie</small>
          </span>
        </label>
      </div>
    </div>
  )
}
