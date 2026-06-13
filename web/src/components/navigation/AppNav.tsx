import { BarChart3, Building2, FlaskConical, Map, Radar, Route, Stethoscope, Train } from 'lucide-react'

export type AppView = 'planner' | 'station' | 'lines' | 'maps' | 'reach' | 'insights' | 'simulator' | 'diagnostics'

interface AppNavProps {
  view: AppView
  onChange: (view: AppView) => void
}

const TABS: Array<{ id: AppView; label: string; icon: typeof Train }> = [
  { id: 'planner', label: 'Routenplaner', icon: Train },
  { id: 'station', label: 'Inside Bahnhof', icon: Building2 },
  { id: 'lines', label: 'Linien', icon: Route },
  { id: 'maps', label: 'Netzpläne', icon: Map },
  { id: 'reach', label: 'Erreichbarkeit', icon: Radar },
  { id: 'insights', label: 'Analyse', icon: BarChart3 },
  { id: 'diagnostics', label: 'Diagnose', icon: Stethoscope },
  { id: 'simulator', label: 'Simulator', icon: FlaskConical },
]

export function AppNav({ view, onChange }: AppNavProps) {
  return (
    <nav className="app-nav" aria-label="Hauptnavigation">
      {TABS.map((tab) => {
        const Icon = tab.icon
        const active = view === tab.id
        return (
          <button
            key={tab.id}
            type="button"
            className={`app-nav__tab ${active ? 'is-active' : ''}`}
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={17} />
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
