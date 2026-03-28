// Copyright 2026 LLM Council Project
// Licensed under [LICENCE À DÉFINIR]
import { useState, useEffect, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import ProfileModal from './components/ProfileModal';
import ErrorBoundary from './components/ErrorBoundary';
import { api, auth } from './api';
import { loadModels } from './modelsStore';
import './App.css';

// Functional updater: apply fn(lastMsg) on the last message in conversation state
function applyToTailMessage(fn) {
  return prev => {
    const msgs = [...prev.messages];
    const tail = msgs[msgs.length - 1];
    if (tail) fn(tail);
    return { ...prev, messages: msgs };
  };
}

function App() {
  const [user,                  setUser]                  = useState(auth.getUser());
  const [activeTab,             setActiveTab]             = useState('chat');
  const [conversations,         setConversations]         = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation,   setCurrentConversation]   = useState(null);
  const [isLoading,             setIsLoading]             = useState(false);
  const [activeStreams,         setActiveStreams]         = useState({}); // { convId: AbortController }
  const [profileOpen,          setProfileOpen]           = useState(false);
  const currentConvIdRef = useRef(null);
  const [cafeinePending,        setCafeinePending]        = useState(null); // { validation_id, chairman_output, stage1, stage2, stage3 }
  const [language,              setLanguage]              = useState(
    () => localStorage.getItem('llmc_lang') || auth.getUser()?.language || 'fr'
  );

  // Vérifier la session au démarrage
  useEffect(() => {
    if (auth.isLoggedIn()) {
      api.me()
        .then(u => { setUser(u); auth.setSession(auth.getToken(), u); })
        .catch(() => { auth.clearSession(); setUser(null); });
    }
  }, []);

  useEffect(() => {
    if (user) loadConversations();
  }, [user]);

  useEffect(() => {
    if (currentConversationId) loadConversation(currentConversationId);
    currentConvIdRef.current = currentConversationId;
  }, [currentConversationId]);

  const loadConversations = async () => {
    try { setConversations(await api.listConversations()); }
    catch (e) { console.error('Failed to load conversations:', e); }
  };

  const loadConversation = async (id) => {
    try {
      const conv = await api.getConversation(id);
      setCurrentConversation(conv);
      // Vérifier si une validation est en attente (reload de page)
      const pv = await api.getPendingValidation(id);
      if (pv?.pending && pv.validation) {
        const v = pv.validation;
        setCafeinePending({
          validation_id:   v.id,
          chairman_output: v.chairman_output,
          stage1_results:  v.stage1_results,
          stage2_results:  v.stage2_results,
          stage3_result:   v.stage3_result,
        });
      } else {
        setCafeinePending(null);
      }
    }
    catch (e) { console.error('Failed to load conversation:', e); }
  };

  const handleLogin  = (loggedUser) => {
    setUser(loggedUser);
    if (loggedUser?.language) {
      setLanguage(loggedUser.language);
      localStorage.setItem('llmc_lang', loggedUser.language);
    }
    loadModels();  // charger les modèles après login
  };

  const handleLangChange = async (lang) => {
    setLanguage(lang);
    localStorage.setItem('llmc_lang', lang);
    try { await api.updateMe({ language: lang }); }
    catch (e) { console.error('Failed to save language preference:', e); }
  };

  const handleLogout = () => {
    auth.clearSession();
    setUser(null);
    setConversations([]);
    setCurrentConversationId(null);
    setCurrentConversation(null);
    setActiveTab('chat');
  };

  const handleNewConversation = async () => {
    try {
      const newConv = await api.createConversation();
      setConversations([
        { id: newConv.id, created_at: newConv.created_at,
          title: 'Nouvelle conversation', message_count: 0 },
        ...conversations,
      ]);
      setCurrentConversationId(newConv.id);
      setActiveTab('chat');
    } catch (e) { console.error('Failed to create conversation:', e); }
  };

  const handleSelectConversation = (id) => {
    setCurrentConversationId(id);
    setActiveTab('chat');
  };

  const handleRenameConversation = (id, title) => {
    setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
  };

  const handleDeleteConversation = async (id) => {
    try {
      await api.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (currentConversationId === id) {
        setCurrentConversationId(null);
        setCurrentConversation(null);
      }
    } catch (e) { console.error('Failed to delete conversation:', e); }
  };

  const handleAbortStream = (convId) => {
    setActiveStreams(prev => {
      const ctrl = prev[convId];
      if (ctrl) ctrl.abort();
      const next = { ...prev };
      delete next[convId];
      return next;
    });
  };

  const handleSendMessage = async (content, models, webSearchMode = 'none', documentContent = null, attachmentNames = [], pipelineNodes = null, caffeineMode = false, pipelineInfo = null) => {
    console.log('[handleSendMessage] called', { convId: currentConversationId, pipelineNodes: pipelineNodes?.length ?? null, models });
    if (!currentConversationId) {
      console.warn('[handleSendMessage] blocked — no currentConversationId');
      return;
    }
    const convId = currentConversationId;
    const controller = new AbortController();
    setActiveStreams(prev => ({ ...prev, [convId]: controller }));

    // Helper : n'applique la mise à jour que si on est encore sur cette conversation
    const updateIfCurrent = (fn) => {
      if (currentConvIdRef.current === convId) {
        setCurrentConversation(applyToTailMessage(fn));
      }
    };

    setCafeinePending(null);
    setIsLoading(true);
    try {
      setCurrentConversation(prev => ({
        ...prev,
        messages: [
          ...prev.messages,
          { role: 'user', content, attachments: attachmentNames },
          {
            role: 'assistant',
            stage1: null, stage2: null, stage3: null, metadata: null,
            dag: null,  // outputs DAG si mode pipeline nodal
            loading: { stage1: false, stage2: false, stage3: false, dag: false },
          },
        ],
      }));

      await api.sendMessageStream(
        convId, content, models, webSearchMode,
        (eventType, event) => {
          switch (eventType) {
            case 'validation_required':
              if (currentConvIdRef.current === convId) {
                setCafeinePending({
                  validation_id:   event.validation_id,
                  chairman_output: event.chairman_output,
                  stage1_results:  null,
                  stage2_results:  null,
                });
                setIsLoading(false);
              }
              break;
            // ── Events DAG (pipeline nodal) ──────────────────────────────
            case 'dag_start':
              updateIfCurrent(tail => {
                const traceNodes = (event.nodes || pipelineNodes || []).map(n => ({
                  node_id:    n.id || n.node_id,
                  role:       n.role || '',
                  model:      n.model || '',
                  used_model: n.model || '',
                  fallback:   false,
                  status:     'waiting',
                }));
                tail.dag = {
                  outputs: {}, final: null, execution_order: [], arrival_order: [],
                  nodeCount: event.node_count,
                  trace: traceNodes,
                  total_cost: 0, total_tokens_in: 0, total_tokens_out: 0,
                  pipeline_meta: {
                    id:    event.pipeline_id   || pipelineInfo?.id   || null,
                    name:  event.pipeline_name || pipelineInfo?.name || null,
                    nodes: pipelineNodes || event.nodes || [],
                  },
                };
                tail.loading.dag = true;
              });
              break;
            case 'node_start':
              updateIfCurrent(tail => {
                if (!tail.dag) return;
                const alreadyKnown = tail.dag.arrival_order?.includes(event.node_id);
                tail.dag = { ...tail.dag,
                  running: event.node_id,
                  arrival_order: alreadyKnown
                    ? tail.dag.arrival_order
                    : [...(tail.dag.arrival_order || []), event.node_id],
                  outputs: { ...tail.dag.outputs,
                    [event.node_id]: { status: 'running', model: event.model, role: event.role } },
                  trace: (tail.dag.trace || []).map(n =>
                    n.node_id === event.node_id
                      ? { ...n, status: 'running', started_at: Date.now(), model: event.model || n.model }
                      : n
                  ),
                };
              });
              break;
            case 'node_done':
              updateIfCurrent(tail => {
                if (!tail.dag) return;
                tail.dag = { ...tail.dag,
                  outputs: { ...tail.dag.outputs,
                    [event.node_id]: {
                      status: 'done', model: event.used_model || event.model,
                      role: event.role, output: event.output,
                    }},
                  trace: (tail.dag.trace || []).map(n =>
                    n.node_id === event.node_id
                      ? {
                          ...n,
                          used_model: event.used_model || n.model,
                          fallback:   event.fallback  || false,
                          status:     'done',
                          duration_s: event.duration_s,
                          tokens_in:  event.tokens_in  || 0,
                          tokens_out: event.tokens_out || 0,
                          cost:       event.cost       || 0,
                        }
                      : n
                  ),
                  total_cost:       (tail.dag.total_cost       || 0) + (event.cost       || 0),
                  total_tokens_in:  (tail.dag.total_tokens_in  || 0) + (event.tokens_in  || 0),
                  total_tokens_out: (tail.dag.total_tokens_out || 0) + (event.tokens_out || 0),
                };
              });
              break;
            case 'node_error':
              updateIfCurrent(tail => {
                if (!tail.dag) return;
                tail.dag = { ...tail.dag,
                  outputs: { ...tail.dag.outputs,
                    [event.node_id]: { status: 'error', error: event.error } },
                  trace: (tail.dag.trace || []).map(n =>
                    n.node_id === event.node_id
                      ? { ...n, status: 'error', duration_s: event.duration_s }
                      : n
                  ),
                };
              });
              break;
            case 'dag_complete':
              updateIfCurrent(tail => {
                if (!tail.dag) return;
                tail.dag = { ...tail.dag,
                  final: event.final,
                  outputs: Object.fromEntries(
                    Object.entries(tail.dag.outputs).map(([k, v]) => [k, { ...v,
                      output: event.outputs?.[k] || v.output }])
                  ),
                  execution_order: event.execution_order,
                  terminal_node: event.terminal_node,
                  loading: false,
                };
                tail.loading.dag = false;
              });
              break;
            case 'stage1_start':
              updateIfCurrent(tail => { tail.loading.stage1 = true; });
              break;
            case 'stage1_complete':
              updateIfCurrent(tail => {
                tail.stage1 = event.data; tail.loading.stage1 = false;
              });
              break;
            case 'stage2_start':
              updateIfCurrent(tail => { tail.loading.stage2 = true; });
              break;
            case 'stage2_complete':
              updateIfCurrent(tail => {
                tail.stage2 = event.data; tail.metadata = event.metadata; tail.loading.stage2 = false;
              });
              break;
            case 'stage3_start':
              updateIfCurrent(tail => { tail.loading.stage3 = true; });
              break;
            case 'stage3_complete':
              updateIfCurrent(tail => {
                tail.stage3 = event.data; tail.loading.stage3 = false;
              });
              break;
            case 'title_complete':
              loadConversations();
              break;
            case 'complete':
              loadConversations();
              if (currentConvIdRef.current === convId) setIsLoading(false);
              break;
            case 'error':
              console.error('Stream error:', event.message);
              if (currentConvIdRef.current === convId) setIsLoading(false);
              break;
            default:
              break;
          }
        },
        { signal: controller.signal },
        documentContent,
        pipelineNodes,
        caffeineMode,
        pipelineInfo,
      );
    } catch (e) {
      if (e?.name !== 'AbortError') {
        console.error('[handleSendMessage] stream error:', e);
        if (currentConvIdRef.current === convId) {
          setCurrentConversation(prev => prev ? { ...prev, messages: prev.messages.slice(0, -2) } : prev);
        }
      }
    } finally {
      // Toujours débloquer isLoading, même si le stream se ferme sans event 'complete'
      if (currentConvIdRef.current === convId) setIsLoading(false);
      setActiveStreams(prev => { const n = { ...prev }; delete n[convId]; return n; });
    }
  };

  const handleValidate = async (action, payload = {}) => {
    if (!currentConversationId || !cafeinePending) return;
    try {
      const res = await api.submitValidation(currentConversationId, {
        validation_id: cafeinePending.validation_id,
        action,
        ...payload,
      });
      if (action === 'relaunch') {
        // Nouvelle validation en attente
        setCafeinePending({
          validation_id:   res.validation_id,
          chairman_output: res.chairman_output,
          stage1_results:  cafeinePending.stage1_results,
          stage2_results:  cafeinePending.stage2_results,
        });
      } else {
        setCafeinePending(null);
        if (action !== 'reject') {
          const s3 = res.stage3_result;
          setCurrentConversation(applyToTailMessage(tail => {
            if (tail.role !== 'assistant') return;
            tail.stage3 = s3;
            tail.loading = { stage1: false, stage2: false, stage3: false };
          }));
        } else {
          setCurrentConversation(applyToTailMessage(tail => {
            if (tail.role !== 'assistant') return;
            tail.stage3 = { model: 'system', response: '❌ Réponse rejetée par l\'utilisateur.' };
            tail.loading = { stage1: false, stage2: false, stage3: false };
          }));
        }
        loadConversations();
      }
    } catch (e) {
      console.error('Validation error:', e);
    }
  };

  // Gate login
  if (!user) return <LoginPage onLogin={handleLogin} />;

  return (
    <div className="app">
      <Sidebar
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRenameConversation={handleRenameConversation}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        user={user}
        onLogout={handleLogout}
        language={language}
        onLangChange={handleLangChange}
        activeStreams={activeStreams}
        onAbortStream={handleAbortStream}
        onOpenProfile={() => setProfileOpen(true)}
      />
      {/* main-content prend tout l'espace restant et laisse ChatInterface gérer son propre scroll */}
      <div className="main-content">
        {activeTab === 'chat' && (
          <ChatInterface
            conversation={currentConversation}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
            cafeinePending={cafeinePending}
            onValidate={handleValidate}
          />
        )}
        {activeTab === 'admin' && auth.isAdmin() && (
          <AdminPanel onBack={() => setActiveTab('chat')} />
        )}
      </div>

      {profileOpen && user && (
        <ProfileModal
          user={user}
          onClose={() => setProfileOpen(false)}
          onUpdated={() => {
            // Rafraîchir l'utilisateur courant depuis /auth/me
            api.me().then(u => { auth.setSession(null, u); setUser(u); }).catch(() => {});
          }}
        />
      )}
    </div>
  );
}

export default App;
