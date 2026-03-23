import { useState, useEffect, useRef } from 'react';
import { useModels } from '../modelsStore';
import PipelineEditor from './PipelineEditor';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8001';

const WEB_SEARCH_MODES = [
  { value: 'none',      label: '🔍 Sans web',     desc: 'Aucune recherche web' },
  { value: 'factcheck', label: '✅ Fact-check',    desc: 'Chairman vérifie les faits' },
  { value: 'deep',      label: '🌐 Deep Research', desc: 'Tous les agents cherchent' },
];

export default function ModelSelector({ selectedModels, onModelsChange, webSearchMode, onWebSearchModeChange, disabled }) {
  const allModels = useModels();
  const [pipelines, setPipelines]     = useState([]);
  const [activePipelineId, setActivePipelineId] = useState(null);
  const [search, setSearch]           = useState('');
  const [tab, setTab]                 = useState('pipelines'); // 'pipelines' | 'free' | 'all'
  const [open, setOpen]               = useState(false);
  const [editingPipeline, setEditingPipeline] = useState(null); // pipeline en cours d'édition
  const [creatingPipeline, setCreatingPipeline] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { fetchPipelines(); }, []);

  const fetchPipelines = () => {
    fetch(`${API_BASE}/api/v1/groups`)
      .then(r => r.json())
      .then(data => {
        setPipelines(data);
        const general = data.find(g => g.id === 'general');
        // Appliquer le pipeline général si aucune sélection active
        // selectedModels est un tableau = pas encore de pipeline sélectionné
        if (general && Array.isArray(selectedModels)) {
          applyPipeline(general);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (open && searchRef.current) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open, tab]);

  // Appliquer un pipeline : transmet l'id au parent via onModelsChange([]) + stocke l'id actif
  const applyPipeline = (pipeline) => {
    setActivePipelineId(pipeline.id);
    // On passe l'id encodé dans un objet spécial pour que ChatInterface sache quel DAG utiliser
    onModelsChange({ __pipeline_id: pipeline.id, nodes: pipeline.nodes });
    setOpen(false);
  };

  const deletePipeline = async (id, e) => {
    e.stopPropagation();
    await fetch(`${API_BASE}/api/v1/groups/${id}`, { method: 'DELETE' });
    setPipelines(prev => prev.filter(g => g.id !== id));
    if (activePipelineId === id) setActivePipelineId(null);
  };

  const handlePipelineSaved = (updated, isNew) => {
    if (isNew) {
      setPipelines(prev => [...prev, updated]);
      applyPipeline(updated);
    } else {
      setPipelines(prev => prev.map(g => g.id === updated.id ? updated : g));
    }
    setEditingPipeline(null);
    setCreatingPipeline(false);
  };

  // Résumé du pipeline actif pour l'affichage dans le header
  const activePipeline = pipelines.find(g => g.id === activePipelineId);
  const pipelineSummary = (() => {
    if (!activePipeline?.nodes) return '—';
    const terminal = activePipeline.nodes.find(n => {
      const refs = new Set(activePipeline.nodes.flatMap(x => x.inputs || []).filter(i => i !== 'user_prompt'));
      return !refs.has(n.id);
    });
    const parallelCount = (() => {
      const levels = {};
      const nm = {};
      activePipeline.nodes.forEach(n => { nm[n.id] = n; });
      function lvl(id) {
        if (levels[id] !== undefined) return levels[id];
        const node = nm[id]; if (!node) return 0;
        const parents = (node.inputs||[]).filter(i => i !== 'user_prompt' && nm[i]);
        levels[id] = parents.length === 0 ? 0 : Math.max(...parents.map(p => lvl(p))) + 1;
        return levels[id];
      }
      activePipeline.nodes.forEach(n => lvl(n.id));
      const cols = {};
      activePipeline.nodes.forEach(n => { const l = levels[n.id]||0; cols[l] = (cols[l]||0)+1; });
      return Math.max(...Object.values(cols), 1);
    })();
    return `${activePipeline.nodes.length} nœuds${parallelCount > 1 ? ` · ${parallelCount}× //` : ''}`;
  })();

  // Modèles filtrés pour onglets free/all
  const shortName = (id) => id.split('/').pop().replace(/:free$/, '');
  const filteredModels = (() => {
    let list = tab === 'free' ? allModels.filter(m => m.is_free) : allModels;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(m => m.id.toLowerCase().includes(q) || (m.name||'').toLowerCase().includes(q));
    }
    return list;
  })();
  const grouped = filteredModels.reduce((acc, m) => {
    const p = m.provider || m.id.split('/')[0];
    if (!acc[p]) acc[p] = [];
    acc[p].push(m);
    return acc;
  }, {});

  return (
    <>
    {editingPipeline && (
      <PipelineEditor
        group={editingPipeline}
        onSave={handlePipelineSaved}
        onClose={() => setEditingPipeline(null)}
      />
    )}
    {creatingPipeline && (
      <PipelineEditor
        group={{}}
        onSave={handlePipelineSaved}
        onClose={() => setCreatingPipeline(false)}
      />
    )}

    <div className={`model-selector${disabled ? ' disabled' : ''}`}>

      {/* ── Pills pipelines ── */}
      <div className="group-pills-bar">
        {pipelines.map(g => (
          <div key={g.id} className={`group-pill${activePipelineId === g.id ? ' active' : ''}`}>
            <span onClick={() => applyPipeline(g)}>{g.name}</span>
            <button
              className="group-pill-edit" type="button"
              title="Éditer le pipeline"
              onClick={e => { e.stopPropagation(); setEditingPipeline(g); }}
            >⚙</button>
            {!g.builtin && (
              <button className="group-pill-del" type="button"
                onClick={e => deletePipeline(g.id, e)}>✕</button>
            )}
          </div>
        ))}
        <button
          className="group-pill-new-pipeline" type="button"
          onClick={() => setCreatingPipeline(true)}
          title="Nouveau pipeline"
        >＋</button>
      </div>

      {/* ── Header pipeline actif ── */}
      <div className="model-selector-header">
        <span className="model-selector-title">
          {activePipeline
            ? <>⬡ <strong>{activePipeline.name}</strong> <span className="pipeline-summary">{pipelineSummary}</span></>
            : '⬡ Aucun pipeline sélectionné'}
        </span>
        <button className="toggle-models-btn" type="button" onClick={() => setOpen(v => !v)}>
          {open ? 'Masquer ▲' : 'Détails ▼'}
        </button>
      </div>

      {/* ── Web search ── */}
      <div className="web-search-row">
        <span className="web-search-label">Recherche web :</span>
        {WEB_SEARCH_MODES.map(mode => (
          <label key={mode.value} className={`web-search-radio${webSearchMode === mode.value ? ' active' : ''}`}>
            <input type="radio" name="webSearch" value={mode.value}
              checked={webSearchMode === mode.value}
              onChange={() => onWebSearchModeChange(mode.value)}
              disabled={disabled} />
            {mode.label}
            <span className="web-search-desc">{mode.desc}</span>
          </label>
        ))}
      </div>

      {/* ── Picker ── */}
      {open && (
        <div className="model-picker">
          <div className="model-tabs">
            {[
              { key: 'pipelines', label: '⬡ Pipelines' },
              { key: 'free',      label: '🆓 Gratuits' },
              { key: 'all',       label: '🌐 Tous' },
            ].map(t => (
              <button key={t.key} type="button"
                className={`model-tab${tab === t.key ? ' active' : ''}`}
                onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>

          {tab === 'pipelines' ? (
            <div className="group-picker-list">
              {pipelines.map(g => {
                const nodeCount = g.nodes?.length || 0;
                const agents = (g.nodes || []).filter(n => n.role !== 'chairman');
                const chairman = (g.nodes || []).find(n => n.role === 'chairman');
                return (
                  <div key={g.id}
                    className={`group-picker-card${activePipelineId === g.id ? ' active' : ''}`}
                    onClick={() => applyPipeline(g)}
                  >
                    <div className="group-picker-name">
                      {g.name}
                      <span className="gpc-count">{nodeCount} nœuds</span>
                    </div>
                    <div className="group-picker-dag-info">
                      {agents.slice(0, 4).map(n => (
                        <span key={n.id} className="gpc-node-badge">{n.id}</span>
                      ))}
                      {agents.length > 4 && <span className="gpc-node-badge">+{agents.length - 4}</span>}
                      {chairman && <span className="gpc-node-badge gpc-chairman">👑 {chairman.model.split('/').pop().replace(/:free$/,'')}</span>}
                    </div>
                    <div className="gpc-actions">
                      <button className="gpc-edit-btn" type="button"
                        onClick={e => { e.stopPropagation(); setEditingPipeline(g); setOpen(false); }}>
                        ✏️ Éditer
                      </button>
                      {!g.builtin && (
                        <button className="gpc-del-btn" type="button"
                          onClick={e => deletePipeline(g.id, e)}>🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="gpc-new-wrap">
                <button className="gpc-new-btn" type="button"
                  onClick={() => { setCreatingPipeline(true); setOpen(false); }}>
                  ＋ Nouveau pipeline
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="model-search-bar">
                <input ref={searchRef} className="model-search-input"
                  placeholder="🔎 Rechercher..." value={search}
                  onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="model-groups">
                {Object.entries(grouped).map(([provider, models]) => (
                  <div key={provider} className="model-category">
                    <div className="model-category-title">
                      {provider} <span className="model-count">({models.length})</span>
                    </div>
                    <div className="model-grid">
                      {models.map(m => (
                        <div key={m.id}
                          className={`model-card${Array.isArray(selectedModels) && selectedModels.includes(m.id) ? ' selected' : ''}`}
                          title={m.id}
                          onClick={() => {
                            if (!Array.isArray(selectedModels)) {
                              // Sortir du mode pipeline → passer en mode sélection manuelle
                              onModelsChange([m.id]);
                              setActivePipelineId(null);
                            } else {
                              const next = selectedModels.includes(m.id)
                                ? selectedModels.filter(id => id !== m.id)
                                : [...selectedModels, m.id];
                              onModelsChange(next.length ? next : [m.id]);
                            }
                            setOpen(false);
                          }}>
                          <div className="model-card-top">
                            <span className="model-card-name">{m.name || shortName(m.id)}</span>
                            <span className="model-card-cost">{m.is_free ? '🆓' : m.cost_indicator || ''}</span>
                          </div>
                          {m.description && <div className="model-card-desc">{m.description}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {Object.keys(grouped).length === 0 && (
                  <div className="model-empty">Aucun résultat</div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
    </>
  );
}
