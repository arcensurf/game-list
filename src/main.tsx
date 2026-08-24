import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'

// Dev-only styles (the editing controls and the trophy picker) load
// dynamically so Rollup keeps them out of the public bundle — matching
// how App.tsx already gates the picker's JS. They were ~25% of the
// shipped CSS despite being unreachable in production.
if (import.meta.env.DEV) {
  import('./styles/dev/index.css')
}
import App from './components/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
