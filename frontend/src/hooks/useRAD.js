/**
 * useRAD — hook React pour le système RAAD (Recherche et Accès aux Documents)
 * Gère : arborescence dossiers, recherche full-text, preview, résolution @mentions
 */

import { useState, useCallback, useRef } from 'react';
import { apiFetch } from '../api';

export function useRAD() {
  const [folders,       setFolders]       = useState([]);
  const [documents,     setDocuments]     = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const debounceRef = useRef(null);

  // ── Arborescence ──────────────────────────────────────────────────────────

  const fetchFolders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/rag/folders');
      setFolders(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Documents d'un dossier ────────────────────────────────────────────────

  const fetchDocuments = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch(`/rag/documents?folder_id=${encodeURIComponent(folderId)}`);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearDocuments = useCallback(() => setDocuments([]), []);

  // ── Recherche debounced 300 ms ────────────────────────────────────────────

  const search = useCallback((query) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiFetch(
          `/rag/search?q=${encodeURIComponent(query)}&limit=10`
        );
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  const clearSearch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchResults([]);
  }, []);

  // ── Preview d'un document (tooltip) ──────────────────────────────────────

  const previewDoc = useCallback(async (docId) => {
    try {
      const data = await apiFetch(`/rag/documents/${docId}/preview?max_chars=200`);
      return data.preview || '';
    } catch {
      return '';
    }
  }, []);

  // ── Résolution @mentions ──────────────────────────────────────────────────

  const resolveMentions = useCallback(async (mentions) => {
    if (!mentions || mentions.length === 0) return {};
    try {
      const data = await apiFetch('/rag/resolve-mentions', {
        method: 'POST',
        body:   JSON.stringify({ mentions }),
      });
      return data.resolved || {};
    } catch {
      return {};
    }
  }, []);

  return {
    folders,
    documents,
    searchResults,
    loading,
    error,
    fetchFolders,
    fetchDocuments,
    clearDocuments,
    search,
    clearSearch,
    previewDoc,
    resolveMentions,
  };
}
