import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { BRAND } from './lib/brand'
import './index.css'

document.title = BRAND.pageTitle

createRoot(document.getElementById('app')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
