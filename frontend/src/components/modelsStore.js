/**
 * modelsStore.js — singleton partagé entre tous les composants.
 * Le fetch n'est fait qu'une seule fois, au premier appel.
 * Les composants s'abonnent via subscribe() et reçoivent la liste dès qu'elle est prête.
 */

const API_BASE = import.meta.env?.VITE_API_BASE || 'http://localhost:8001';

let models = [];          // cache
let loading = false;
let loaded  = false;
let listeners = [];       // callbacks abonnés
let _getToken = () => null;  // injecté par App.jsx

export function setTokenProvider(fn) { _getToken = fn; }

function notify() {
  listeners.forEach(fn => fn(models));
}

export function getModels() {
  return models;
}

export function isLoaded() {
  return loaded;
}

/**
 * S'abonner aux mises à jour.
 * Retourne une fonction de désabonnement.
 * Si les modèles sont déjà chargés, le callback est appelé immédiatement.
 */
export function subscribe(fn) {
  listeners.push(fn);
  if (loaded) fn(models);   // réponse immédiate si déjà en cache
  return () => {
    listeners = listeners.filter(l => l !== fn);
  };
}

/**
 * Déclencher le chargement (idempotent — ignoré si déjà en cours ou chargé).
 * Appelé une fois dans App.jsx au montage.
 */
export async function loadModels() {
  if (loaded || loading) return;
  loading = true;
  try {
    const token = _getToken();
    const r = await fetch(`${API_BASE}/api/v1/models`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const d = await r.json();
    models = d.models || [];
    loaded = true;
    notify();
  } catch (e) {
    console.error('modelsStore: impossible de charger les modèles', e);
  } finally {
    loading = false;
  }
}

/**
 * Hook React — retourne la liste et se met à jour quand elle arrive.
 */
import { useState, useEffect } from 'react';

export function useModels() {
  const [list, setList] = useState(models); // déjà en cache = immédiat
  useEffect(() => {
    const unsub = subscribe(setList);
    return unsub;
  }, []);
  return list;
}
