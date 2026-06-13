import { Train } from 'lucide-react'
import { motion } from 'framer-motion'

export function LoadingScreen() {
  return (
    <div className="loading-screen">
      <motion.div
        className="loading-screen__train"
        animate={{ x: [-20, 20, -20] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Train size={48} />
      </motion.div>
      <p>Netzwerkdaten werden geladen…</p>
    </div>
  )
}
