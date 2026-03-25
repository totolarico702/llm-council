/**
 * PipelineAssistant — Sidebar droite du PipelineEditor
 * Chat avec un assistant LLM pour générer des pipelines .cog
 */
import React, { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../api'
import { ROUTES }   from '../api/routes'

export default function PipelineAssistant({ currentPipeline, onApply, onClose }) {
  const isModification = (currentPipeline?.nodes?.length ?? 0) > 0

  const [messages,  setMessages]  = useState([
    { role: 'assistant', content: 'Décris le pipeline que tu veux créer. Ex: "Un pipeline qui recherche dans le RAG puis analyse avec Claude"' }
  ])
  const [input,     setInput]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [lastCog,   setLastCog]   = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const newMessages = [...messages, { role: 'user', content: text }]
    setMessages(newMessages)
    setLoading(true)
    try {
      const res  = await apiFetch(ROUTES.pipelines.assistant, {
        method: 'POST',
        body: JSON.stringify({
          message: text,
          conversation_history: newMessages.slice(-10),
          current_pipeline: isModification ? currentPipeline : null,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.message }])
      if (data.cog) setLastCog(data.cog)
    } catch (e) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Erreur : ${e.message}` }])
    } finally {
      setLoading(false)
    }
  }

  const sidebarStyle = {
    width: 260, flexShrink: 0,
    background: '#0D1117',
    borderRight: '1px solid #21262D',
    display: 'flex', flexDirection: 'column',
    height: '100%',
    position: 'relative',
  }

  return (
    <div style={sidebarStyle}>
      {/* Header */}
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262D', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#E6EDF3', flex: 1 }}>🤖 Assistant</span>
        <span style={{
          fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600,
          background: isModification ? 'rgba(245,158,11,.15)' : 'rgba(34,197,94,.12)',
          color:      isModification ? '#F59E0B' : '#22C55E',
          border:     `1px solid ${isModification ? 'rgba(245,158,11,.3)' : 'rgba(34,197,94,.3)'}`,
        }}>
          {isModification ? `✏️ ${currentPipeline?.name || 'Modification'}` : '🆕 Nouveau'}
        </span>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={i} style={{
            background: m.role === 'user' ? '#161B22' : '#0f1318',
            border: `1px solid ${m.role === 'user' ? '#30363D' : '#21262D'}`,
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            color: '#C9D1D9',
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '90%',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ color: '#555', fontSize: 11, padding: 8 }}>⏳ Génération en cours…</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Aperçu + Appliquer */}
      {lastCog && (
        <div style={{ padding: '8px 12px', borderTop: '1px solid #21262D', background: '#0f1318', flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: '#3FB950', marginBottom: 6 }}>
            ✅ <strong>{lastCog.name}</strong> — {lastCog.nodes?.length ?? 0} nœuds
          </div>
          <button
            onClick={() => { onApply(lastCog); setLastCog(null) }}
            style={{ width: '100%', padding: '7px 0', background: '#238636', border: '1px solid #2ea043', borderRadius: 6, color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            ⚡ Appliquer au pipeline
          </button>
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #21262D', display: 'flex', gap: 8, flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder='Décris ton pipeline… (Entrée pour envoyer)'
          style={{
            flex: 1, resize: 'none', height: 60,
            background: '#161B22', border: '1px solid #30363D', borderRadius: 6,
            color: '#E6EDF3', padding: '6px 10px', fontSize: 12,
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || loading}
          style={{ padding: '0 12px', background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff', cursor: input.trim() && !loading ? 'pointer' : 'not-allowed', fontSize: 16, flexShrink: 0 }}
        >→</button>
      </div>
    </div>
  )
}
