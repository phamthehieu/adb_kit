import { createRoot } from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './styles.css'
import { startA11y } from './lib/a11y'

startA11y()

// No <StrictMode>: its double-mount would start/stop the device mirror twice on load.
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary name="ADB Kit" className="app-crash">
    <App />
  </ErrorBoundary>
)
