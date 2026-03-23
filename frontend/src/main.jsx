import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const dashMatch = window.location.pathname.match(/^\/dashboard\/([^/]+)/)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary message="Une erreur inattendue s'est produite. Rechargez la page.">
      {dashMatch ? <DashboardPage token={dashMatch[1]} /> : <App />}
    </ErrorBoundary>
  </StrictMode>,
)
