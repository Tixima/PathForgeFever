import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  FileJson,
  FolderOpen,
  RefreshCw,
  Train,
  Upload,
  Zap,
} from 'lucide-react'
import type { NetworkLoadError } from '../lib/network/loadNetworkExport'
import { BRAND } from '../lib/brand'

interface NetworkBootstrapScreenProps {
  error: NetworkLoadError | null
  importing: boolean
  reloading: boolean
  onImportFile: (file: File) => void | Promise<void>
  onRetryFetch: () => void
}

const STEPS = [
  `In ${BRAND.game} das Netzwerk exportieren (${BRAND.exportHint}).`,
  'Die Datei tpf2_network_export.json speichern.',
  'Hier per Drag & Drop oder Dateiauswahl hochladen — fertig.',
]

export function NetworkBootstrapScreen({
  error,
  importing,
  reloading,
  onImportFile,
  onRetryFetch,
}: NetworkBootstrapScreenProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      void onImportFile(file)
    },
    [onImportFile],
  )

  const busy = importing || reloading

  return (
    <div className="bootstrap">
      <div className="bootstrap__backdrop" aria-hidden />
      <motion.div
        className="bootstrap__card"
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <div className="bootstrap__brand">
          <span className="bootstrap__logo">
            <Train size={28} aria-hidden />
          </span>
          <div>
            <p className="bootstrap__eyebrow">{BRAND.game} · {BRAND.publisher}</p>
            <h1>{BRAND.productName}</h1>
          </div>
        </div>

        {error && (
          <div className={`bootstrap__alert bootstrap__alert--${error.kind}`}>
            <AlertCircle size={20} aria-hidden />
            <div>
              <strong>{error.title}</strong>
              <p>{error.message}</p>
              {error.detail && <p className="bootstrap__alert-detail">{error.detail}</p>}
            </div>
          </div>
        )}

        {!error && (
          <p className="bootstrap__lead">
            Willkommen — lade dein exportiertes Bahnnetz hoch, um Routen, Karten und Analysen zu
            nutzen.
          </p>
        )}

        <div
          className={`bootstrap__dropzone ${dragOver ? 'is-dragover' : ''} ${busy ? 'is-busy' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            handleFiles(e.dataTransfer.files)
          }}
          onClick={() => !busy && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (!busy) inputRef.current?.click()
            }
          }}
          role="button"
          tabIndex={0}
          aria-busy={busy}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="bootstrap__file-input"
            disabled={busy}
            onChange={(e) => {
              handleFiles(e.target.files)
              e.target.value = ''
            }}
          />

          <span className="bootstrap__drop-icon">
            {busy ? <RefreshCw size={32} className="bootstrap__spin" /> : <Upload size={32} />}
          </span>
          <strong>
            {importing
              ? 'Export wird eingelesen…'
              : 'tpf2_network_export.json hier ablegen'}
          </strong>
          <span className="bootstrap__drop-sub">oder klicken zum Auswählen</span>
        </div>

        <div className="bootstrap__actions">
          <button
            type="button"
            className="bootstrap__btn bootstrap__btn--ghost"
            onClick={onRetryFetch}
            disabled={busy}
          >
            <RefreshCw size={16} className={reloading ? 'bootstrap__spin' : ''} />
            Server-Datei erneut versuchen
          </button>
          <button
            type="button"
            className="bootstrap__btn bootstrap__btn--ghost"
            onClick={() => !busy && inputRef.current?.click()}
            disabled={busy}
          >
            <FolderOpen size={16} />
            Datei wählen
          </button>
        </div>

        <div className="bootstrap__steps">
          <h2>
            <Zap size={16} aria-hidden />
            So startest du
          </h2>
          <ol>
            {STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>

        <div className="bootstrap__dev-hint">
          <FileJson size={14} aria-hidden />
          <span>
            Entwickler: alternativ <code>public/data/tpf2_network_export.json</code> ablegen und
            „Server-Datei erneut versuchen“.
          </span>
        </div>
      </motion.div>
    </div>
  )
}
