// frontend/src/api/client.js
// Client HTTP unique pour LLM Council
// - Envoie toujours les cookies httpOnly (credentials: 'include')
// - Refresh token automatique si 401
// - Format d'erreur uniforme
// - FormData : pas de Content-Type forcé (le navigateur gère le boundary)

import ROUTES from './routes.js'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001'

let isRefreshing = false
let refreshQueue = []

const processQueue = (error) => {
  refreshQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve()
  )
  refreshQueue = []
}

/**
 * Client fetch principal — utiliser à la place de fetch() partout
 */
export async function apiFetch(url, options = {}) {
  const fullUrl = url.startsWith('/') ? `${API_BASE}${url}` : url
  url = fullUrl
  const config = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  }

  // Ne pas forcer Content-Type sur FormData (multipart)
  if (options.body instanceof FormData) {
    delete config.headers['Content-Type']
  }

  let response = await fetch(url, config)

  // Refresh token automatique si 401
  if (response.status === 401) {
    if (isRefreshing) {
      await new Promise((resolve, reject) =>
        refreshQueue.push({ resolve, reject })
      )
      response = await fetch(url, config)
    } else {
      isRefreshing = true
      try {
        const refreshResponse = await fetch(ROUTES.auth.refresh, {
          method: 'POST',
          credentials: 'include',
        })
        if (refreshResponse.ok) {
          processQueue(null)
          response = await fetch(url, config)
        } else {
          processQueue(new Error('Session expirée'))
          window.location.href = '/login'
          return
        }
      } finally {
        isRefreshing = false
      }
    }
  }

  return response
}

/**
 * apiFetch + parse JSON automatique
 * Lance une erreur si la réponse n'est pas ok
 */
export async function apiJSON(url, options = {}) {
  const response = await apiFetch(url, options)
  if (!response) return  // cas window.location.href redirect
  if (!response.ok) {
    let errorMessage = `Erreur ${response.status}`
    try {
      const data = await response.json()
      errorMessage = data.detail || data.error || errorMessage
    } catch {}
    throw new Error(errorMessage)
  }
  if (response.status === 204) return null
  return response.json()
}

export default apiFetch
