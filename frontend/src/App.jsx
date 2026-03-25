import { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ChatInterface from './components/ChatInterface';
import LoginPage from './components/LoginPage';
import AdminPanel from './components/AdminPanel';
import ErrorBoundary from './components/ErrorBoundary';
import { api, auth } from './api';
import { loadModels } from './modelsStore';
import './App.css';

function App() {
  const [user,                  setUser]                  = useState(auth.getUser());
  const [activeTab,             setActiveTab]             = useState('chat');
  const [conversations,         setConversations]         = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [currentConversation,   setCurrentConversation]   = useState(null);
  const [isLoading,             setIsLoading]             = useState(false);
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

  const handleSendMessage = async (content, models, webSearchMode = 'none', documentContent = null, attachmentNames = [], pipelineNodes = null, caffeineMode = false) => {
    if (!currentConversationId) return;
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
        currentConversationId, content, models, webSearchMode,
        (eventType, event) => {
          switch (eventType) {
            case 'validation_required':
              setCafeinePending({
                validation_id:   event.validation_id,
                chairman_output: event.chairman_output,
                stage1_results:  null,  // déjà dans le message via SSE
                stage2_results:  null,
              });
              setIsLoading(false);
              break;
            // ── Events DAG (pipeline nodal) ──────────────────────────────
            case 'dag_start':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) {
                  // Initialiser la trace avec tous les nodes en statut "waiting"
                  const traceNodes = (event.nodes || pipelineNodes || []).map(n => ({
                    node_id:    n.id || n.node_id,
                    role:       n.role || '',
                    model:      n.model || '',
                    used_model: n.model || '',
                    fallback:   false,
                    status:     'waiting',
                  }));
                  last.dag = {
                    outputs: {}, final: null, execution_order: [], arrival_order: [],
                    nodeCount: event.node_count,
                    trace: traceNodes,
                    total_cost: 0, total_tokens_in: 0, total_tokens_out: 0,
                  };
                  last.loading.dag = true;
                }
                return { ...prev, messages: msgs };
              });
              break;
            case 'node_start':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last?.dag) {
                  const alreadyKnown = last.dag.arrival_order?.includes(event.node_id);
                  last.dag = { ...last.dag,
                    running: event.node_id,
                    arrival_order: alreadyKnown
                      ? last.dag.arrival_order
                      : [...(last.dag.arrival_order || []), event.node_id],
                    outputs: { ...last.dag.outputs,
                      [event.node_id]: { status: 'running', model: event.model, role: event.role } },
                    trace: (last.dag.trace || []).map(n =>
                      n.node_id === event.node_id
                        ? { ...n, status: 'running', started_at: Date.now(), model: event.model || n.model }
                        : n
                    ),
                  };
                }
                return { ...prev, messages: msgs };
              });
              break;
            case 'node_done':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last?.dag) {
                  last.dag = { ...last.dag,
                    outputs: { ...last.dag.outputs,
                      [event.node_id]: {
                        status: 'done', model: event.used_model || event.model,
                        role: event.role, output: event.output,
                      }},
                    trace: (last.dag.trace || []).map(n =>
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
                    total_cost:       (last.dag.total_cost       || 0) + (event.cost       || 0),
                    total_tokens_in:  (last.dag.total_tokens_in  || 0) + (event.tokens_in  || 0),
                    total_tokens_out: (last.dag.total_tokens_out || 0) + (event.tokens_out || 0),
                  };
                }
                return { ...prev, messages: msgs };
              });
              break;
            case 'node_error':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last?.dag) {
                  last.dag = { ...last.dag,
                    outputs: { ...last.dag.outputs,
                      [event.node_id]: { status: 'error', error: event.error } },
                    trace: (last.dag.trace || []).map(n =>
                      n.node_id === event.node_id
                        ? { ...n, status: 'error', duration_s: event.duration_s }
                        : n
                    ),
                  };
                }
                return { ...prev, messages: msgs };
              });
              break;
            case 'dag_complete':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last?.dag) {
                  last.dag = { ...last.dag,
                    final: event.final,
                    outputs: Object.fromEntries(
                      Object.entries(last.dag.outputs).map(([k, v]) => [k, { ...v,
                        output: event.outputs?.[k] || v.output }])
                    ),
                    execution_order: event.execution_order,
                    terminal_node: event.terminal_node,
                    loading: false,
                  };
                  last.loading.dag = false;
                }
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage1_start':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) last.loading.stage1 = true;
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage1_complete':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) { last.stage1 = event.data; last.loading.stage1 = false; }
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage2_start':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) last.loading.stage2 = true;
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage2_complete':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) { last.stage2 = event.data; last.metadata = event.metadata; last.loading.stage2 = false; }
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage3_start':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) last.loading.stage3 = true;
                return { ...prev, messages: msgs };
              });
              break;
            case 'stage3_complete':
              setCurrentConversation(prev => {
                const msgs = [...prev.messages];
                const last = msgs[msgs.length - 1];
                if (last) { last.stage3 = event.data; last.loading.stage3 = false; }
                return { ...prev, messages: msgs };
              });
              break;
            case 'title_complete':
              loadConversations();
              break;
            case 'complete':
              loadConversations();
              setIsLoading(false);
              break;
            case 'error':
              console.error('Stream error:', event.message);
              setIsLoading(false);
              break;
            default:
              break;
          }
        },
        {},
        documentContent,
        pipelineNodes,
        caffeineMode,
      );
    } catch (e) {
      console.error('Failed to send message:', e);
      setCurrentConversation(prev => ({ ...prev, messages: prev.messages.slice(0, -2) }));
      setIsLoading(false);
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
          // Ajouter stage3 au dernier message assistant
          const s3 = res.stage3_result;
          setCurrentConversation(prev => {
            const msgs = [...prev.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              last.stage3 = s3;
              last.loading = { stage1: false, stage2: false, stage3: false };
            }
            return { ...prev, messages: msgs };
          });
        } else {
          // Reject : ajouter message d'annulation
          setCurrentConversation(prev => {
            const msgs = [...prev.messages];
            const last = msgs[msgs.length - 1];
            if (last && last.role === 'assistant') {
              last.stage3 = { model: 'system', response: '❌ Réponse rejetée par l\'utilisateur.' };
              last.loading = { stage1: false, stage2: false, stage3: false };
            }
            return { ...prev, messages: msgs };
          });
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
    </div>
  );
}

export default App;
