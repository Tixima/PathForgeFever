import { ArrowLeftRight, Search, Train } from 'lucide-react'
import { motion } from 'framer-motion'
import { StationAutocomplete } from './StationAutocomplete'
import { RouteCriteriaSelector } from './RouteCriteriaSelector'
import { QuickPicks } from './QuickPicks'
import { ViaStations } from './ViaStations'
import type { RecentSearch } from '../hooks/useRecentSearches'
import type { StationOption, RouteCriterion } from '../lib/routing/types'
import { BRAND } from '../lib/brand'

interface HeroSearchProps {
  stations: StationOption[]
  from: StationOption | null
  to: StationOption | null
  vias: (StationOption | null)[]
  criterion: RouteCriterion
  accessible: boolean
  accessibleStrict: boolean
  searching: boolean
  recent: RecentSearch[]
  onFromChange: (station: StationOption | null) => void
  onToChange: (station: StationOption | null) => void
  onViasChange: (vias: (StationOption | null)[]) => void
  onCriterionChange: (criterion: RouteCriterion) => void
  onAccessibleChange: (accessible: boolean) => void
  onAccessibleStrictChange: (accessibleStrict: boolean) => void
  onSwap: () => void
  onSearch: () => void
  onQuickPick: (from: StationOption, to: StationOption) => void
}

export function HeroSearch({
  stations,
  from,
  to,
  vias,
  criterion,
  accessible,
  accessibleStrict,
  searching,
  recent,
  onFromChange,
  onToChange,
  onViasChange,
  onCriterionChange,
  onAccessibleChange,
  onAccessibleStrictChange,
  onSwap,
  onSearch,
  onQuickPick,
}: HeroSearchProps) {
  const viaIds = vias.map((v) => v?.id).filter((id): id is number => id != null)
  const allExcludeForFrom = [to?.id, ...viaIds].filter((id): id is number => id != null)
  const allExcludeForTo = [from?.id, ...viaIds].filter((id): id is number => id != null)

  const canSearch = Boolean(
    from &&
    to &&
    from.id !== to.id &&
    !viaIds.includes(from.id) &&
    !viaIds.includes(to.id) &&
    vias.every((v) => v !== null),
  )

  return (
    <motion.section
      className="hero-search"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <div className="hero-search__glow" aria-hidden />
      <div className="hero-search__mesh" aria-hidden />

      <div className="hero-search__header">
        <div className="hero-search__brand">
          <div className="hero-search__logo">
            <Train size={22} />
          </div>
          <div>
            <p className="hero-search__eyebrow">{BRAND.game} · {BRAND.publisher}</p>
            <h1 className="hero-search__title">{BRAND.productName}</h1>
          </div>
        </div>
        <p className="hero-search__subtitle">
          {BRAND.tagline} — {BRAND.subtitle}
        </p>
      </div>

      <div className="hero-search__card">
        <div className="hero-search__card-bar" aria-hidden />

        <div className="hero-search__stations">
          <StationAutocomplete
            label="Von"
            placeholder="Startbahnhof wählen"
            stations={stations}
            value={from}
            onChange={onFromChange}
            excludeIds={allExcludeForFrom}
          />

          <button
            type="button"
            className="hero-search__swap"
            onClick={onSwap}
            aria-label="Start und Ziel tauschen"
            disabled={!from && !to}
          >
            <ArrowLeftRight size={18} />
          </button>

          <StationAutocomplete
            label="Nach"
            placeholder="Zielbahnhof wählen"
            stations={stations}
            value={to}
            onChange={onToChange}
            excludeIds={allExcludeForTo}
          />
        </div>

        <ViaStations
          stations={stations}
          vias={vias}
          fromId={from?.id}
          toId={to?.id}
          onChange={onViasChange}
        />

        <RouteCriteriaSelector
          value={criterion}
          onChange={onCriterionChange}
          accessible={accessible}
          onAccessibleChange={onAccessibleChange}
          accessibleStrict={accessibleStrict}
          onAccessibleStrictChange={onAccessibleStrictChange}
        />

        <button
          type="button"
          className="hero-search__submit"
          onClick={onSearch}
          disabled={!canSearch || searching}
        >
          <Search size={18} />
          {searching ? 'Route wird berechnet…' : 'Verbindung suchen'}
        </button>
      </div>

      <QuickPicks recent={recent} stations={stations} onPick={onQuickPick} />
    </motion.section>
  )
}
