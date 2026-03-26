// Copyright 2026 LLM Council Project
// Licensed under [LICENCE À DÉFINIR]
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes.js';
import ReactMarkdown from 'react-markdown';
import Stage1 from './Stage1';
import Stage2 from './Stage2';
import Stage3 from './Stage3';
import ModelSelector from './ModelSelector';
import RAADPanel from './RAADPanel';
import CaffeineValidation from './CaffeineValidation';
import FeedbackBar from './FeedbackBar';
import './ChatInterface.css';

const DEFAULT_MODELS = [
  'google/gemini-2.5-flash:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-235b-a22b:free',
  'mistralai/mistral-7b-instruct:free',
];

// ── ExecutionPanel — panneau latéral trace d'exécution ───────────────────────
function ExecutionPanel({ dag, open, onClose }) {
  if (!dag || !dag.trace || dag.trace.length === 0) return null;

  const shortName  = (m) => m ? m.split('/').pop().replace(/:free$/, '') : '—';
  const formatCost = (c) => c ? `$${c.toFixed(4)}` : '$0.0000';

  const statusIcon = (s) => ({ waiting: '○', running: '⟳', done: '✓', error: '✗' }[s] || '○');
  const statusColor = (s) => ({
    waiting: 'var(--dim)', running: '#F59E0B', done: '#22C55E', error: '#EF4444',
  }[s] || 'var(--dim)');

  const totalCost = dag.total_cost       || 0;
  const totalIn   = dag.total_tokens_in  || 0;
  const totalOut  = dag.total_tokens_out || 0;

  return (
    <div className={`exec-panel${open ? ' open' : ''}`}>
      <div className="exec-panel-header">
        <span>⚡ Exécution</span>
        <button className="exec-panel-close" onClick={onClose}>×</button>
      </div>

      <div className="exec-panel-nodes">
        {dag.trace.map((node) => (
          <div key={node.node_id} className={`exec-node exec-node-${node.status}`}>
            <div className="exec-node-header">
              <span className="exec-node-status" style={{ color: statusColor(node.status) }}>
                {node.status === 'running'
                  ? <span className="exec-node-spinner" />
                  : statusIcon(node.status)}
              </span>
              <span className="exec-node-id">{node.node_id}</span>
              {node.role && <span className="exec-node-role">[{node.role}]</span>}
              {node.duration_s != null && (
                <span className="exec-node-duration">{node.duration_s}s</span>
              )}
            </div>

            <div className="exec-node-model">
              {node.fallback ? (
                <>
                  <span className="exec-model-original">⚠ {shortName(node.model)}</span>
                  <span className="exec-model-arrow"> → </span>
                  <span className="exec-model-used">{shortName(node.used_model)}</span>
                </>
              ) : (
                <span className="exec-model-used">{shortName(node.used_model || node.model)}</span>
              )}
            </div>

            {node.status === 'done' && (
              <div className="exec-node-stats">
                <span>↑{node.tokens_in}t</span>
                <span>↓{node.tokens_out}t</span>
                <span>{formatCost(node.cost)}</span>
              </div>
            )}
            {node.status === 'error' && (
              <div className="exec-node-error-msg">✗ Erreur</div>
            )}
          </div>
        ))}
      </div>

      <div className="exec-panel-total">
        <span>↑{totalIn}t ↓{totalOut}t</span>
        <span className="exec-total-cost">{formatCost(totalCost)}</span>
      </div>
    </div>
  );
}

// ── DagView — rendu des messages de pipeline nodal ───────────────────────────
function DagView({ dag }) {
  const [activeTab, setActiveTab] = React.useState(null);
  if (!dag) return null;

  // M5 : ordre stable = execution_order si disponible (après dag_complete),
  // sinon arrival_order enregistré au fur et à mesure des node_start events,
  // sinon Object.keys en dernier recours
  const outputs = dag.outputs || {};
  const order = dag.execution_order?.length
    ? dag.execution_order
    : (dag.arrival_order?.length ? dag.arrival_order : Object.keys(outputs));
  const final = dag.final;

  // Onglet actif par défaut = terminal node ou dernier arrivé
  const defaultTab = dag.terminal_node || order[order.length - 1] || null;
  const current = activeTab || defaultTab;

  const ROLE_COLORS = {
    explorer: '#d4aa2a', critic: '#cc6666', optimizer: '#6dbb87',
    devil_advocate: '#cc9944', synthesizer: '#b8941f', chairman: '#b8941f',
    reader: '#7a7570', custom: '#3a3835', tool: '#cc9944',
  };

  return (
    <div className="dag-view">
      {/* Tabs */}
      <div className="dag-tabs">
        {order.map(nodeId => {
          const nd     = outputs[nodeId] || {};
          const color  = ROLE_COLORS[nd.role] || ROLE_COLORS[nd.role?.split('_')[0]] || '#94A3B8';
          const isTerminal = nodeId === dag.terminal_node;
          const isDone = nd.status === 'done';
          const isRunning = nd.status === 'running';
          const isError = nd.status === 'error';
          return (
            <button key={nodeId}
              className={`dag-tab${current === nodeId ? ' active' : ''}${isTerminal ? ' terminal' : ''}`}
              style={{ '--tc': color }}
              onClick={() => setActiveTab(nodeId)}>
              {isRunning && <span className="dag-spinner" />}
              {isDone && !isTerminal && <span style={{ color }}>●</span>}
              {isTerminal && isDone && <span style={{ color }}>⬡</span>}
              {isError && <span style={{ color: '#EF4444' }}>✕</span>}
              {' '}{nodeId}
              {nd.model && <span className="dag-tab-model">{nd.model.split('/').pop().replace(/:free$/, '')}</span>}
            </button>
          );
        })}
      </div>

      {/* Contenu de l'onglet actif */}
      {current && outputs[current] && (
        <div className="dag-panel">
          {outputs[current].status === 'running' ? (
            <div className="stage-loading">
              <div className="spinner" />
              <span>Exécution de <strong>{current}</strong>…</span>
            </div>
          ) : outputs[current].status === 'error' ? (
            <div className="dag-error">⚠ {outputs[current].error}</div>
          ) : (
            <div className="markdown-content">
              <ReactMarkdown>{outputs[current].output || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      )}

      {/* Réponse finale si onglet = terminal */}
      {current === dag.terminal_node && final && (
        <div className="dag-final-badge">⬡ Réponse finale du pipeline</div>
      )}

      {/* Trace d'exécution */}
      {dag.execution_order?.length > 0 && (
        <div className="dag-trace">
          <span className="dag-trace-label">Ordre d'exécution :</span>
          {dag.execution_order.map((nid, i) => {
            const nd    = outputs[nid] || {};
            const color = (ROLE_COLORS[nd.role] || ROLE_COLORS[nd.role?.split('_')[0]] || '#64748B');
            const isErr = nd.status === 'error';
            return (
              <span key={nid} className="dag-trace-step"
                style={{ color: isErr ? '#EF4444' : color }}
                title={nd.model || ''}>
                {i > 0 && <span className="dag-trace-arrow">→</span>}
                {isErr ? '✗' : '✓'} {nid}
              </span>
            );
          })}
          {dag.execution_order.length > 0 && (
            <span className="dag-trace-time">
              {dag.nodeCount && `${dag.execution_order.length}/${dag.nodeCount} nodes`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatInterface({
  conversation,
  onSendMessage,
  isLoading,
  cafeinePending = null,
  onValidate,
}) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [selectedModels, setSelectedModels] = useState(DEFAULT_MODELS);
  const [pipelineNodes,  setPipelineNodes]  = useState(null); // nodes DAG si pipeline nodal actif
  const [webSearchMode, setWebSearchMode] = useState('none');
  const [caffeineMode, setCaffeineMode] = useState(false);
  const [execPanelOpen, setExecPanelOpen] = useState(false);
  const [execMsgIdx,    setExecMsgIdx]    = useState(null);
  const caffeineNotifRef = useRef(null);
  const messagesEndRef = useRef(null);
  const fileInputRef   = useRef(null);
  const textareaRef    = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversation]);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files);
    for (const file of files) {
      const formData = new FormData();
      formData.append('file', file);
      try {
        const response = await apiFetch(ROUTES.upload, {
          method: 'POST',
          body: formData,
        });
        if (!response || !response.ok) throw new Error('Upload failed');
        const data = await response.json();
        setAttachments((prev) => [
          ...prev,
          { name: file.name, content: data.content },
        ]);
      } catch (err) {
        console.error('Failed to upload file:', err);
        alert(`Erreur lors de l'upload de ${file.name}`);
      }
    }
    // Reset input so same file can be re-uploaded
    e.target.value = '';
  };

  const handleRemoveAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  /** Insère @filename à la position courante du curseur dans le textarea. */
  const handleInsertMention = useCallback((filename) => {
    const mention = '@' + filename + ' ';
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? input.length;
      const end   = ta.selectionEnd   ?? input.length;
      const newVal = input.slice(0, start) + mention + input.slice(end);
      setInput(newVal);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(start + mention.length, start + mention.length);
      });
    } else {
      setInput(prev => prev + mention);
    }
  }, [input]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    if (isLoading) return;

    const userText = input.trim();

    // Résolution des @mentions — inject contenu des documents référencés
    const mentionMatches = [...userText.matchAll(/(?:^|\s)@(\S+)/g)];
    const mentions = mentionMatches.map(m => m[1]);
    let mentionContext = null;
    if (mentions.length > 0) {
      try {
        const res = await apiFetch(ROUTES.rag.resolveMentions, {
          method: 'POST',
          body:   JSON.stringify({ mentions }),
        });
        const data = res && res.ok ? await res.json() : {};
        const resolved = data.resolved || {};
        const parts = Object.entries(resolved).map(
          ([name, content]) => `[Document: ${name}]\n${content}\n[/Document]`
        );
        if (parts.length > 0) mentionContext = parts.join('\n\n');
      } catch {
        // Silencieux — ne pas bloquer l'envoi
      }
    }

    // documentContent = pièces jointes + @mentions résolus
    const attachmentContent = attachments.length > 0
      ? attachments.map((a) => `--- Fichier : ${a.name} ---\n${a.content}`).join('\n\n')
      : null;
    const documentContent = [attachmentContent, mentionContext].filter(Boolean).join('\n\n') || null;

    // fullContent = ce qui est affiché dans la conversation
    const fullContent = documentContent ? `${documentContent}\n\n${userText}` : userText;
    const attachmentNames = attachments.map(a => a.name);

    onSendMessage(fullContent, selectedModels, webSearchMode, documentContent, attachmentNames, pipelineNodes, caffeineMode);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const getFileIcon = (name) => {
    if (name.endsWith('.pdf')) return '📄';
    if (name.endsWith('.docx') || name.endsWith('.doc')) return '📝';
    if (name.match(/\.(png|jpg|jpeg|gif|webp)$/i)) return '🖼️';
    return '📃';
  };

  const inputForm = (
    <div className="input-area">
      {attachments.length > 0 && (
        <div className="attachments-bar">
          {attachments.map((att, i) => (
            <div key={i} className="attachment-badge">
              <span className="attachment-icon">{getFileIcon(att.name)}</span>
              <span className="attachment-name">{att.name}</span>
              <button
                className="attachment-remove"
                onClick={() => handleRemoveAttachment(i)}
                title="Supprimer"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <form className="input-form" onSubmit={handleSubmit}>
        <button
          type="button"
          className="upload-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isLoading}
          title="Joindre un fichier"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.docx,.doc,.png,.jpg,.jpeg,.gif,.webp"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <textarea
          ref={textareaRef}
          className="message-input"
          placeholder="Posez votre question... (Shift+Enter pour nouvelle ligne, Enter pour envoyer)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={3}
        />
        <button
          type="submit"
          className="send-button"
          disabled={(!input.trim() && attachments.length === 0) || isLoading}
        >
          Send
        </button>
      </form>
      <div className="input-toolbar">
        <ModelSelector
          selectedModels={selectedModels}
          onModelsChange={(val) => {
            if (val && val.__pipeline_id) {
              setPipelineNodes(val.nodes || null);
              setSelectedModels([]);
            } else {
              setPipelineNodes(null);
              setSelectedModels(val);
            }
          }}
          webSearchMode={webSearchMode}
          onWebSearchModeChange={setWebSearchMode}
          disabled={isLoading}
        />
        {/* Toggle Mode Caféine */}
        <button
          type="button"
          className={`caffeine-toggle${caffeineMode ? ' active' : ''}`}
          onClick={() => setCaffeineMode(v => !v)}
          title="Mode Caféine — vous validez la réponse avant envoi"
        >
          ☕ {caffeineMode ? 'Caféine ON' : 'Caféine OFF'}
          {caffeineMode && cafeinePending && <span className="caffeine-dot" />}
        </button>
      </div>
    </div>
  );

  if (!conversation) {
    return (
      <div className="chat-interface">
        <div className="empty-state">
          <h2>Welcome to LLM Council</h2>
          <p>Create a new conversation to get started</p>
        </div>
        <RAADPanel onInsertMention={handleInsertMention} />
      </div>
    );
  }

  return (
    <div className="chat-interface">
      {/* Bandeau notification validation en attente */}
      {cafeinePending && (
        <div
          className="caffeine-banner"
          ref={caffeineNotifRef}
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
        >
          ☕ Une réponse attend votre validation ↓
        </div>
      )}

      <div className="messages-container">
        {conversation.messages.length === 0 ? (
          <div className="empty-state">
            <h2>Start a conversation</h2>
            <p>Ask a question to consult the LLM Council</p>
          </div>
        ) : (
          conversation.messages.map((msg, index) => (
            <div key={index} className="message-group">
              {msg.role === 'user' ? (
                <div className="user-message">
                  <div className="message-label">You</div>
                  <div className="message-content">
                    <div className="markdown-content">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="assistant-message">
                  <div className="message-label">LLM Council</div>

                  {/* Mode DAG — pipeline nodal */}
                  {(msg.dag || msg.loading?.dag) && (<>
                    {msg.loading?.dag && !msg.dag?.final ? (
                      msg.dag ? <DagView dag={msg.dag} /> : (
                        <div className="stage-loading">
                          <div className="spinner" /><span>Initialisation du pipeline…</span>
                        </div>
                      )
                    ) : (
                      <DagView dag={msg.dag} />
                    )}
                    <button
                      className={`exec-panel-toggle${execPanelOpen && execMsgIdx === index ? ' active' : ''}`}
                      onClick={() => {
                        if (execPanelOpen && execMsgIdx === index) {
                          setExecPanelOpen(false);
                        } else {
                          setExecMsgIdx(index);
                          setExecPanelOpen(true);
                        }
                      }}
                      title="Trace d'exécution"
                    >
                      ⚡ Exécution
                      {msg.dag?.trace?.length > 0 && ` (${msg.dag.trace.length})`}
                    </button>
                  </>)}

                  {/* Mode council classique */}
                  {!msg.dag && !msg.loading?.dag && (<>
                  {msg.loading?.stage1 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 1: Collecting individual responses...</span>
                    </div>
                  )}
                  {msg.stage1 && <Stage1 responses={msg.stage1} />}

                  {msg.loading?.stage2 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 2: Peer rankings...</span>
                    </div>
                  )}
                  {msg.stage2 && (
                    <Stage2
                      rankings={msg.stage2}
                      labelToModel={msg.metadata?.label_to_model}
                      aggregateRankings={msg.metadata?.aggregate_rankings}
                    />
                  )}

                  {msg.loading?.stage3 && (
                    <div className="stage-loading">
                      <div className="spinner"></div>
                      <span>Running Stage 3: Final synthesis...</span>
                    </div>
                  )}
                  {msg.stage3 && <Stage3 finalResponse={msg.stage3} />}
                  {msg.stage3 && !msg.loading?.stage3 && (
                    <FeedbackBar
                      conversationId={conversation?.id}
                      model={msg.stage3?.model}
                      stage="chairman"
                    />
                  )}
                  </>)}
                </div>
              )}
            </div>
          ))
        )}

        {isLoading && !cafeinePending && (
          <div className="loading-indicator">
            <div className="spinner"></div>
            <span>Consulting the council...</span>
          </div>
        )}

        {/* Interface de validation Mode Caféine */}
        {cafeinePending && (
          <CaffeineValidation
            pending={cafeinePending}
            onValidate={onValidate}
          />
        )}

        <div ref={messagesEndRef} />
      </div>

      {inputForm}

      <ExecutionPanel
        dag={execMsgIdx !== null ? conversation.messages[execMsgIdx]?.dag : null}
        open={execPanelOpen}
        onClose={() => setExecPanelOpen(false)}
      />

      <RAADPanel onInsertMention={handleInsertMention} />
    </div>
  );
}
