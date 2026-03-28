import { createRoot } from 'react-dom/client'
import './styles/variables.css'
import './styles/reset.css'
import './styles/components.css'
import './styles/layout.css'
import './styles/themes/next-dark.css'
import './styles/animations.css'
import './index.css'

// Appliquer le thème sauvegardé au démarrage (avant le premier rendu)
const savedTheme = localStorage.getItem('llmc-theme') || 'council'
document.documentElement.setAttribute('data-theme', savedTheme)
import App from './App.jsx'
import DashboardPage from './pages/DashboardPage.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

const dashMatch = window.location.pathname.match(/^\/dashboard\/([^/]+)/)

createRoot(document.getElementById('root')).render(
  <ErrorBoundary message="Une erreur inattendue s'est produite. Rechargez la page.">
    {dashMatch ? <DashboardPage token={dashMatch[1]} /> : <App />}
  </ErrorBoundary>,
)
