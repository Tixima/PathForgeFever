import { Gauge, RotateCcw, Ruler, Timer } from 'lucide-react'
import { motion } from 'framer-motion'
import { DEFAULT_SCALE, type ScaleSettings } from '../lib/scale'

interface ScaleControlsProps {
  settings: ScaleSettings
  onChange: (patch: Partial<ScaleSettings>) => void
  onReset: () => void
}

export function ScaleControls({ settings, onChange, onReset }: ScaleControlsProps) {
  const isDefault =
    settings.distanceMultiplier === DEFAULT_SCALE.distanceMultiplier &&
    settings.timeMultiplier === DEFAULT_SCALE.timeMultiplier &&
    !settings.showGameValues

  return (
    <motion.section
      className="scale-controls"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <div className="scale-controls__header">
        <div className="scale-controls__title">
          <Gauge size={18} />
          <div>
            <h3>Realzeit-Anpassung</h3>
            <p>Spielwerte in realistische Strecken & Fahrzeiten umrechnen</p>
          </div>
        </div>
        <button
          type="button"
          className="scale-controls__reset"
          onClick={onReset}
          disabled={isDefault}
          title="Auf Standard zurücksetzen"
        >
          <RotateCcw size={14} />
          Standard
        </button>
      </div>

      <div className="scale-controls__grid">
        <label className="scale-slider">
          <div className="scale-slider__head">
            <Ruler size={15} />
            <span>Strecken-Multiplikator</span>
            <strong>×{settings.distanceMultiplier}</strong>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={settings.distanceMultiplier}
            onChange={(e) => onChange({ distanceMultiplier: Number(e.target.value) })}
          />
          <div className="scale-slider__range">
            <span>1×</span>
            <span>50×</span>
          </div>
        </label>

        <label className="scale-slider">
          <div className="scale-slider__head">
            <Timer size={15} />
            <span>Zeit-Multiplikator</span>
            <strong>×{settings.timeMultiplier}</strong>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={settings.timeMultiplier}
            onChange={(e) => onChange({ timeMultiplier: Number(e.target.value) })}
          />
          <div className="scale-slider__range">
            <span>1×</span>
            <span>50×</span>
          </div>
        </label>
      </div>

      <label className="scale-toggle">
        <input
          type="checkbox"
          checked={settings.showGameValues}
          onChange={(e) => onChange({ showGameValues: e.target.checked })}
        />
        <span className="scale-toggle__track" />
        <span>Rohe Spielwerte anzeigen (ohne Multiplikator)</span>
      </label>

      <p className="scale-controls__hint">
        Standard: Strecke ×{DEFAULT_SCALE.distanceMultiplier}, Zeit ×{DEFAULT_SCALE.timeMultiplier}
        {' '}— z. B. 5 km Spiel → {5 * DEFAULT_SCALE.distanceMultiplier} km real
      </p>
    </motion.section>
  )
}
