import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import PipelineAssistant from './PipelineAssistant';
import './PipelineEditor.css';

const ROLES = [
  { value: 'explorer',       label: '🧭 Explorer',     color: '#d4aa2a' },
  { value: 'critic',         label: '🔬 Critique',      color: '#cc6666' },
  { value: 'optimizer',      label: '⚡ Optimiseur',    color: '#6dbb87' },
  { value: 'devil_advocate', label: '😈 Contradicteur', color: '#cc9944' },
  { value: 'synthesizer',    label: '🔗 Synthétiseur',  color: '#b8941f' },
  { value: 'chairman',       label: '👑 Chairman',      color: '#b8941f' },
  { value: 'reader',         label: '📖 Lecteur',       color: '#7a7570' },
  { value: 'custom',         label: '✏️ Custom',        color: '#7a7570' },
];

const getRoleInfo = (role) => ROLES.find(r => r.value === role) || ROLES[0];

// ── Tool nodes ────────────────────────────────────────────────────────────────
const TOOL_TYPES = [
  { value: 'web_search',  label: '🌐 Web Search',  color: '#b8941f',
    description: 'Recherche web en temps réel',
    params: [{ key: 'query_from_input', label: "Requête depuis l'entrée", type: 'bool', default: true }] },
  { value: 'rag_search',  label: '🧠 RAG Search',  color: '#d4aa2a',
    description: 'Mémoire organisationnelle (archives employés)',
    params: [
      { key: 'limit',           label: 'Nb résultats',          type: 'text',   default: '5' },
      { key: 'score_threshold', label: 'Score min (0-1)',        type: 'text',   default: '0.3' },
      { key: 'query',           label: 'Requête fixe (optionnel)', type: 'text', default: '' },
      { key: 'filters',         label: 'Filtre user_login',      type: 'text',   default: '' },
    ]},
  { value: 'code_exec',   label: '⚙ Code Exec',    color: '#F59E0B',
    description: 'Exécute un script',
    params: [
      { key: 'language', label: 'Langage', type: 'select', options: ['python','javascript','bash'], default: 'python' },
      { key: 'script',   label: 'Script',  type: 'textarea', default: '# code ici\nprint(input_data)' },
    ]},
  { value: 'file_read',   label: '📄 File Read',   color: '#22C55E',
    description: 'Lit un fichier du workspace',
    params: [{ key: 'path', label: 'Chemin', type: 'text', default: './data/input.txt' }] },
  { value: 'git',         label: '🔀 Git',          color: '#cc9944',
    description: 'Commande git',
    params: [{ key: 'command', label: 'Commande', type: 'text', default: 'git status' }] },
  { value: 'http_call',   label: '🔌 HTTP Call',    color: '#EF4444',
    description: 'Appel API REST',
    params: [
      { key: 'url',    label: 'URL',     type: 'text',   default: 'https://api.example.com' },
      { key: 'method', label: 'Méthode', type: 'select', options: ['GET','POST','PUT','DELETE'], default: 'GET' },
      { key: 'body',   label: 'Body',    type: 'textarea', default: '' },
    ]},
  { value: 'custom_tool', label: '🔧 Custom',       color: '#94A3B8',
    description: 'Outil personnalisé',
    params: [{ key: 'command', label: 'Commande', type: 'textarea', default: '' }] },
];
const getToolInfo = (type) => TOOL_TYPES.find(t => t.value === type) || TOOL_TYPES[TOOL_TYPES.length - 1];

const NODE_W = 160;
const NODE_H = 80;
const PORT_R = 6;

// Coordonnées des ports (relatif au node)
const outPortPos = () => ({ x: NODE_W, y: NODE_H / 2 });
const inPortPos  = () => ({ x: 0,      y: NODE_H / 2 });

// Courbe de Bézier entre deux points
function bezierPath(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1) * 0.5 + 40;
  return `M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2},${y2}`;
}

const genId = (role, existingIds) => {
  let c = role, i = 2;
  while (existingIds.includes(c)) c = `${role}_${i++}`;
  return c;
};

const defaultPos = (index) => ({
  x: 80 + (index % 4) * 220,
  y: 80 + Math.floor(index / 4) * 160,
});

// Convertit nodes[] (format backend) en nodesMap avec positions
function nodesFromBackend(backendNodes) {
  return backendNodes.map((n, i) => ({
    ...n,
    x: n.x ?? defaultPos(i).x,
    y: n.y ?? defaultPos(i).y,
  }));
}

// ─── Panneau d'édition ────────────────────────────────────────────────────────
function ToolParamField({ param, value, onChange }) {
  if (param.type === 'bool') return (
    <div className="pe-np-field pe-np-field-row">
      <label className="pe-np-label">{param.label}</label>
      <label className="pe-toggle">
        <input type="checkbox" checked={value ?? param.default}
          onChange={e => onChange(e.target.checked)} />
        <span className="pe-toggle-track" />
      </label>
    </div>
  );
  if (param.type === 'select') return (
    <div className="pe-np-field">
      <label className="pe-np-label">{param.label}</label>
      <select className="pe-np-select" value={value ?? param.default}
        onChange={e => onChange(e.target.value)}>
        {param.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
  if (param.type === 'textarea') return (
    <div className="pe-np-field">
      <label className="pe-np-label">{param.label}</label>
      <textarea className="pe-np-textarea" rows={4}
        value={value ?? param.default}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
  return (
    <div className="pe-np-field">
      <label className="pe-np-label">{param.label}</label>
      <input className="pe-np-input" type="text"
        value={value ?? param.default}
        onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function NodePanelTool({ node, onChange, onDelete, onClose }) {
  const ti  = getToolInfo(node.tool_type);
  const cfg = node.tool_config || {};
  const setParam = (key, val) => onChange({ ...node, tool_config: { ...cfg, [key]: val } });

  return (
    <div className="pe-node-panel">
      <div className="pe-np-header">
        <span className="pe-np-title" style={{ color: ti.color }}>{ti.label}</span>
        <button className="pe-np-close" onClick={onClose}>✕</button>
      </div>
      <div className="pe-np-body">

        <div className="pe-np-field">
          <label className="pe-np-label">ID du node</label>
          <input className="pe-np-input" value={node.id}
            onChange={e => onChange({ ...node, id: e.target.value.replace(/\s/g,'_') })} />
        </div>

        <div className="pe-np-field">
          <label className="pe-np-label">Type d'outil</label>
          <div className="pe-role-grid">
            {TOOL_TYPES.map(t => (
              <label key={t.value}
                className={`pe-role-chip${node.tool_type === t.value ? ' active' : ''}`}
                style={node.tool_type === t.value
                  ? { borderColor: t.color, color: t.color, background: t.color+'18' }
                  : {}}>
                <input type="radio" name={`tool-${node.id}`}
                  checked={node.tool_type === t.value}
                  onChange={() => onChange({ ...node, tool_type: t.value, tool_config: {} })} />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="pe-np-separator" />
        <div className="pe-np-section-title" style={{ color: ti.color }}>
          ⚙ Configuration — {ti.description}
        </div>

        {ti.params.map(param => (
          <ToolParamField key={param.key} param={param}
            value={cfg[param.key]}
            onChange={val => setParam(param.key, val)} />
        ))}

        <div className="pe-np-field">
          <label className="pe-np-label">Note (optionnel)</label>
          <input className="pe-np-input" type="text"
            value={node.note || ''}
            onChange={e => onChange({ ...node, note: e.target.value })}
            placeholder="Description de ce node…" />
        </div>

        <button className="pe-np-delete" onClick={onDelete}>🗑 Supprimer ce node</button>
      </div>
    </div>
  );
}

function NodePanel({ node, availableModels, defaultModel, localModels, ollamaAvailable, onChange, onDelete, onClose }) {
  if (node?.node_type === 'tool')
    return <NodePanelTool node={node} onChange={onChange} onDelete={onDelete} onClose={onClose} />;
  if (!node) return null;

  const isLocal = (node.model || '').startsWith('ollama/') || (node.model || '').startsWith('local/');

  const switchToCloud = () => onChange({ ...node, model: '' });
  const switchToLocal = () => {
    const first = localModels[0]?.id || '';
    onChange({ ...node, model: first });
  };

  const ri = getRoleInfo(node.role);
  return (
    <div className="pe-np">
      <div className="pe-np-head" style={{ borderColor: ri.color }}>
        <span className="pe-np-role" style={{ color: ri.color }}>{ri.label}</span>
        <div className="pe-np-head-actions">
          <button className="pe-np-del" onClick={onDelete} title="Supprimer">🗑</button>
          <button className="pe-np-close" onClick={onClose}>✕</button>
        </div>
      </div>
      <div className="pe-np-body">

        <div className="pe-np-field">
          <label className="pe-np-label">ID du nœud</label>
          <input className="pe-np-input" value={node.id}
            onChange={e => onChange({ ...node, id: e.target.value.replace(/\s/g,'_') })} />
        </div>

        <div className="pe-np-field">
          <label className="pe-np-label">Rôle</label>
          <div className="pe-role-grid">
            {ROLES.map(r => (
              <label key={r.value}
                className={`pe-role-chip${node.role === r.value ? ' active' : ''}`}
                style={node.role === r.value ? { borderColor: r.color, color: r.color, background: r.color+'18' } : {}}>
                <input type="radio" name={`role-${node.id}`}
                  checked={node.role === r.value}
                  onChange={() => onChange({ ...node, role: r.value })} />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        <div className="pe-np-field">
          <label className="pe-np-label">Modèle</label>

          {/* Toggle ☁ Cloud / 🖥 Local */}
          <div className="node-source-toggle">
            <button className={!isLocal ? 'active' : ''} onClick={switchToCloud}>
              ☁ Cloud
            </button>
            <button className={isLocal ? 'active' : ''} onClick={switchToLocal}
              title={!ollamaAvailable ? 'Ollama non disponible' : undefined}>
              🖥 Local
            </button>
          </div>

          {isLocal ? (
            /* Select modèles locaux Ollama */
            ollamaAvailable && localModels.length > 0 ? (
              <select className="pe-np-select" value={node.model || ''}
                onChange={e => onChange({ ...node, model: e.target.value })}>
                {localModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.size > 0 ? ` (${(m.size / 1e9).toFixed(1)} GB)` : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="pe-np-local-unavail">
                🔴 Ollama non disponible sur {os.getenv?.('OLLAMA_URL') || 'localhost:11434'}<br/>
                <small>Lancez <code>ollama serve</code> puis actualisez</small>
              </div>
            )
          ) : (
            /* Select modèles cloud */
            <select className="pe-np-select" value={node.model || ''}
              onChange={e => onChange({ ...node, model: e.target.value })}>
              <option value="">
                Par défaut ({(defaultModel || 'mistral-medium-3').split('/').pop()})
              </option>
              {node.model && !availableModels.find(m => m.id === node.model) && (
                <option value={node.model}>⚠️ {node.model.split('/').pop()} (non autorisé)</option>
              )}
              {availableModels.length === 0 && (
                <option disabled>Aucun modèle autorisé — configurez-les dans l&apos;AdminPanel</option>
              )}
              {availableModels.map(m => (
                <option key={m.id} value={m.id}>
                  {m.is_free ? '🆓 ' : ''}{m.name || m.id}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="pe-np-field">
          <label className="pe-np-label">🌐 Recherche web</label>
          <div className="pe-web-search-group">
            {[
              { value: 'none',      label: 'Aucune',      desc: 'Pas de recherche',              color: '#64748B' },
              { value: 'factcheck', label: 'Fact-check',  desc: 'Vérifie les faits clés',        color: '#F59E0B' },
              { value: 'deep',      label: 'Deep search', desc: 'Recherche active et extensive',  color: '#d4aa2a' },
            ].map(opt => (
              <label key={opt.value}
                className={`pe-ws-chip${(node.web_search || 'none') === opt.value ? ' active' : ''}`}
                style={(node.web_search || 'none') === opt.value
                  ? { borderColor: opt.color, color: opt.color, background: opt.color + '18' }
                  : {}}
                title={opt.desc}>
                <input type="radio" name={`ws-${node.id}`}
                  checked={(node.web_search || 'none') === opt.value}
                  onChange={() => onChange({ ...node, web_search: opt.value })} />
                {opt.label}
              </label>
            ))}
          </div>
        </div>

        <div className="pe-np-field">
          <label className="pe-np-label">Prompt système (optionnel)</label>
          <textarea className="pe-np-textarea"
            value={node.role_prompt || ''}
            onChange={e => onChange({ ...node, role_prompt: e.target.value })}
            placeholder={`Vide = prompt par défaut du rôle`}
            rows={4} />
        </div>

      </div>
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function PipelineEditor({ group, onSave, onClose }) {
  const canvasRef = useRef(null);

  const [nodes, setNodes]           = useState([]);
  const [edges, setEdges]           = useState([]); // [{from, to}]
  const [selectedId, setSelectedId] = useState(null);
  const [pipelineName, setPipelineName] = useState('');
  const [availableModels, setAvailableModels] = useState([]); // liste allowed-models
  const [defaultModel,    setDefaultModel]    = useState('mistralai/mistral-medium-3');
  const [localModels,     setLocalModels]     = useState([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [dirty, setDirty]           = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved' | 'unsaved' | 'saving'
  const [pipelineId, setPipelineId] = useState(group?.id || null);
  const [confirmDelete, setConfirmDelete] = useState(false); // M9
  const [toast, setToast] = useState(null); // { msg, type: 'ok'|'err' }
  const [allPipelines, setAllPipelines] = useState([]);
  const [importModal, setImportModal]     = useState(false);
  const [importText, setImportText]       = useState('');
  const [importPreview, setImportPreview] = useState(null);
  const [importError, setImportError]     = useState(null);
  const importFileRef = useRef(null);

  // ── Simulation de coûts ────────────────────────────────────────────────────
  const [costEstimate, setCostEstimate]   = useState(null);  // { total_usd, node_breakdown, disclaimer }
  const [costPopup, setCostPopup]         = useState(false);
  const costDebounceRef = useRef(null);

  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Estimation de coût — debounce 1s à chaque modification des nœuds ──────
  useEffect(() => {
    if (costDebounceRef.current) clearTimeout(costDebounceRef.current);
    costDebounceRef.current = setTimeout(async () => {
      if (nodes.length === 0) { setCostEstimate(null); return; }
      try {
        const res = await apiFetch(ROUTES.pipelines.estimateCost, {
          method: 'POST',
          body: JSON.stringify({ pipeline: { nodes, edges } }),
        });
        if (res && res.ok) {
          const data = await res.json();
          setCostEstimate(data);
        }
      } catch (_) { /* silencieux */ }
    }, 1000);
    return () => clearTimeout(costDebounceRef.current);
  }, [nodes, edges]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drag node
  const dragRef = useRef(null); // { nodeId, startX, startY, origX, origY }
  const didDragNode = useRef(false); // true si le dernier mousedown était sur un node
  // Connexion en cours
  const connectRef = useRef(null); // { fromId, mouseX, mouseY }
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [shiftTarget, setShiftTarget] = useState(null); // nœud survolé pendant shift-drag
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Zoom + Pan
  const [zoom, setZoom]   = useState(1);
  const [pan,  setPan]    = useState({ x: 0, y: 0 });
  const panRef = useRef(null); // { startX, startY, origPanX, origPanY }
  const zoomRef = useRef(zoom);
  const panValRef = useRef(pan);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  useEffect(() => { panValRef.current = pan; }, [pan]);

  // Charger le modèle par défaut + modèles locaux Ollama + allowed-models au montage
  useEffect(() => {
    apiFetch(ROUTES.admin.settings)
      .then(r => r?.ok ? r.json() : null)
      .then(s => { if (s?.default_model) setDefaultModel(s.default_model); })
      .catch(() => {});

    apiFetch(ROUTES.local.models)
      .then(r => r?.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        setOllamaAvailable(data.available || false);
        setLocalModels(Array.isArray(data.models) ? data.models : []);
      })
      .catch(() => {});

    apiFetch(ROUTES.models.allowed)
      .then(r => r?.ok ? r.json() : [])
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setAvailableModels(list.map(m => ({
          id:   m.model_id,
          name: m.name || m.model_id,
          tags: m.tags || [],
          cost_stars: m.cost_stars || 0,
        })));
      })
      .catch(() => {});

    apiFetch(ROUTES.pipelines.list)
      .then(r => r?.ok ? r.json() : [])
      .then(data => setAllPipelines(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Init depuis groupe (supporte format cog et format direct)
  useEffect(() => {
    setPipelineName(group?.name || '');
    setPipelineId(group?.id || null);
    // Support new cog format + legacy direct nodes/edges
    const loadNodes = group?.cog?.nodes || group?.nodes || [];
    const loadEdges = group?.cog?.edges || group?.edges || [];
    if (loadNodes.length > 0) {
      const ns = nodesFromBackend(loadNodes);
      setNodes(ns);
      // Utiliser les edges stockés, sinon reconstruire depuis inputs[]
      let es = Array.isArray(loadEdges) && loadEdges.length > 0
        ? loadEdges
        : (() => {
            const rebuilt = [];
            loadNodes.forEach(n => {
              (n.inputs || []).forEach(inp => {
                if (inp !== 'user_prompt') rebuilt.push({ from: inp, to: n.id });
              });
            });
            return rebuilt;
          })();
      console.log('edges chargées:', es);
      setEdges(es);
      setSaveStatus('saved');
    } else {
      setNodes([
        {
          id: 'hook', role: 'reader',
          model: group?.models?.[0] || 'google/gemini-2.0-flash-001',
          inputs: ['user_prompt'], web_search: 'none', role_prompt: '',
          x: 80, y: 160, _source: true,
        },
        {
          id: 'chairman', role: 'chairman',
          model: group?.models?.[0] || 'google/gemini-2.0-flash-001',
          inputs: ['hook'], web_search: 'none', role_prompt: '',
          x: 360, y: 160,
        },
      ]);
      setEdges([{ from: 'hook', to: 'chairman' }]);
    }
  }, [group]);

  // Marquer unsaved quand nodes/edges/nom changent (après init)
  const initDone = useRef(false);
  useEffect(() => {
    if (!initDone.current) { initDone.current = true; return; }
    setSaveStatus('unsaved');
    setDirty(true);
  }, [nodes, edges, pipelineName]);

  // Auto-save toutes les 30s si unsaved
  useEffect(() => {
    if (saveStatus !== 'unsaved') return;
    const timer = setTimeout(() => handleSave(), 30000);
    return () => clearTimeout(timer);
  }, [saveStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag node ──────────────────────────────────────────────────────────────
  const onNodeMouseDown = useCallback((e, nodeId) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    didDragNode.current = true;
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;
    dragRef.current = {
      nodeId,
      startX: e.clientX, startY: e.clientY,
      origX: node.x, origY: node.y,
      shiftConnect: e.shiftKey, // mode connexion par superposition
    };
    setSelectedId(nodeId);
    if (e.shiftKey) setShiftTarget(null);
  }, [nodes]);

  const onCanvasMouseMove = useCallback((e) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      // Position souris en coordonnées canvas (tenant compte zoom/pan)
      const z = zoomRef.current, p = panValRef.current;
      setMousePos({
        x: (e.clientX - rect.left - p.x) / z,
        y: (e.clientY - rect.top  - p.y) / z,
      });
    }

    if (!dragRef.current) return;
    const { nodeId, startX, startY, origX, origY, shiftConnect } = dragRef.current;
    const z  = zoomRef.current;
    const dx = (e.clientX - startX) / z;
    const dy = (e.clientY - startY) / z;
    const newX = Math.max(0, origX + dx);
    const newY = Math.max(0, origY + dy);

    setNodes(prev => {
      // En mode shift, détecter chevauchement avec un autre nœud
      if (shiftConnect) {
        const overlapping = prev.find(n =>
          n.id !== nodeId &&
          newX < n.x + NODE_W && newX + NODE_W > n.x &&
          newY < n.y + NODE_H && newY + NODE_H > n.y
        );
        setShiftTarget(overlapping?.id || null);
      }
      return prev.map(n =>
        n.id === nodeId ? { ...n, x: newX, y: newY } : n
      );
    });
  }, []);

  const onCanvasMouseUp = useCallback(() => {
    if (dragRef.current) {
      const { nodeId, shiftConnect } = dragRef.current;
      dragRef.current = null;
      setDirty(true);

      // Shift-drag : créer la connexion si un nœud cible est détecté
      if (shiftConnect) {
        setShiftTarget(prev => {
          if (prev && prev !== nodeId) {
            const targetId = prev;
            // Ajouter l'arête sourceId → targetId si elle n'existe pas
            setEdges(eds => {
              const exists = eds.some(e => e.from === nodeId && e.to === targetId);
              if (!exists) {
                setNodes(ns => ns.map(n =>
                  n.id === targetId
                    ? { ...n, inputs: [...new Set([...(n.inputs || []), nodeId])] }
                    : n
                ));
                return [...eds, { from: nodeId, to: targetId }];
              }
              return eds;
            });
          }
          return null;
        });
      }
    }
  }, []);

  // Attacher mousemove/mouseup sur window pour que le drag et la preview
  // fonctionnent même si la souris sort du canvas ou passe sur le panneau
  useEffect(() => {
    window.addEventListener('mousemove', onCanvasMouseMove);
    window.addEventListener('mouseup', onCanvasMouseUp);
    return () => {
      window.removeEventListener('mousemove', onCanvasMouseMove);
      window.removeEventListener('mouseup', onCanvasMouseUp);
    };
  }, [onCanvasMouseMove, onCanvasMouseUp]);

  // ── Wheel → zoom ──────────────────────────────────────────────────────────
  const onCanvasWheel = useCallback((e) => {
    e.preventDefault();
    const delta  = e.deltaY > 0 ? 0.9 : 1.1;
    const rect   = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Zoom centré sur la position souris
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    setZoom(prev => {
      const next = Math.min(3, Math.max(0.1, prev * delta));
      // Ajuster le pan pour zoomer vers le curseur
      setPan(p => ({
        x: mouseX - (mouseX - p.x) * (next / prev),
        y: mouseY - (mouseY - p.y) * (next / prev),
      }));
      return next;
    });
  }, []);

  // ── Middle-click / Space+drag → pan ───────────────────────────────────────
  const onCanvasMiddleDown = useCallback((e) => {
    if (e.button !== 1) return; // middle click
    e.preventDefault();
    panRef.current = {
      startX: e.clientX, startY: e.clientY,
      origPanX: panValRef.current.x, origPanY: panValRef.current.y,
    };
  }, []);

  const onCanvasMiddleMove = useCallback((e) => {
    if (!panRef.current) return;
    const { startX, startY, origPanX, origPanY } = panRef.current;
    setPan({ x: origPanX + e.clientX - startX, y: origPanY + e.clientY - startY });
  }, []);

  const onCanvasMiddleUp = useCallback(() => { panRef.current = null; }, []);

  // Bouton reset zoom/pan
  const resetView = useCallback(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, []);

  // Charger un pipeline depuis le dropdown
  const loadFromPipeline = (pipeline) => {
    setPipelineName(pipeline.name || '');
    setPipelineId(pipeline.id || null);
    const loadNodes = pipeline.cog?.nodes || pipeline.nodes || [];
    const loadEdges = pipeline.cog?.edges || pipeline.edges || [];
    if (loadNodes.length > 0) {
      setNodes(nodesFromBackend(loadNodes));
      const es = loadEdges.length > 0 ? loadEdges : (() => {
        const rebuilt = [];
        loadNodes.forEach(n => {
          (n.inputs || []).forEach(inp => {
            if (inp !== 'user_prompt') rebuilt.push({ from: inp, to: n.id });
          });
        });
        return rebuilt;
      })();
      setEdges(es);
    }
    setSaveStatus('saved');
    setDirty(false);
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    el.addEventListener('wheel', onCanvasWheel, { passive: false });
    return () => el.removeEventListener('wheel', onCanvasWheel);
  }, [onCanvasWheel]);

  useEffect(() => {
    window.addEventListener('mousemove', onCanvasMiddleMove);
    window.addEventListener('mouseup',   onCanvasMiddleUp);
    return () => {
      window.removeEventListener('mousemove', onCanvasMiddleMove);
      window.removeEventListener('mouseup',   onCanvasMiddleUp);
    };
  }, [onCanvasMiddleMove, onCanvasMiddleUp]);

  // ── Connexion ──────────────────────────────────────────────────────────────
  const onOutPortClick = useCallback((e, nodeId) => {
    e.stopPropagation();
    setConnectingFrom(nodeId);
  }, []);

  const onInPortClick = useCallback((e, nodeId) => {
    e.stopPropagation();
    if (!connectingFrom || connectingFrom === nodeId) {
      setConnectingFrom(null); return;
    }
    // Éviter doublons
    const exists = edges.some(ed => ed.from === connectingFrom && ed.to === nodeId);
    if (!exists) {
      setEdges(prev => [...prev, { from: connectingFrom, to: nodeId }]);
      setNodes(prev => prev.map(n =>
        n.id === nodeId
          ? { ...n, inputs: [...new Set([...(n.inputs || []), connectingFrom])] }
          : n
      ));
      setDirty(true);
    }
    setConnectingFrom(null);
  }, [connectingFrom, edges]);

  const deleteEdge = useCallback((from, to) => {
    setEdges(prev => prev.filter(e => !(e.from === from && e.to === to)));
    setNodes(prev => prev.map(n =>
      n.id === to ? { ...n, inputs: (n.inputs || []).filter(i => i !== from) } : n
    ));
    setDirty(true);
  }, []);

  const onCanvasClick = useCallback(() => {
    if (didDragNode.current) { didDragNode.current = false; return; }
    setConnectingFrom(null);
    setSelectedId(null);
  }, []);

  // ── Ajouter un node ────────────────────────────────────────────────────────
  const addNode = () => {
    const existingIds = nodes.map(n => n.id);
    const newNode = {
      id: genId('explorer', existingIds),
      node_type: 'llm',
      role: 'explorer',
      model: availableModels[0]?.id || 'google/gemini-2.0-flash-001',
      inputs: ['user_prompt'],
      web_search: 'none',
      role_prompt: '',
      x: 120 + Math.random() * 300,
      y: 80 + Math.random() * 200,
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(newNode.id);
    setDirty(true);
  };

  // ── Tout en local / tout en cloud ─────────────────────────────────────────
  const applyAllLocal = () => {
    if (!ollamaAvailable || localModels.length === 0) {
      showToast('Ollama non disponible — démarrez le service local', 'err');
      return;
    }
    const firstLocal = localModels[0].id;
    setNodes(prev => prev.map(n =>
      n.node_type === 'tool' ? n : { ...n, model: firstLocal }
    ));
    setDirty(true);
    showToast(`Tous les nœuds LLM → ${firstLocal}`, 'ok');
  };

  const applyAllCloud = () => {
    setNodes(prev => prev.map(n =>
      n.node_type === 'tool' ? n : { ...n, model: '' }
    ));
    setDirty(true);
    showToast('Tous les nœuds LLM → modèle par défaut (cloud)', 'ok');
  };

  const addToolNode = () => {
    const existingIds = nodes.map(n => n.id);
    const newNode = {
      id: genId('tool', existingIds),
      node_type: 'tool',
      tool_type: 'web_search',
      tool_config: { query_from_input: true },
      inputs: [],
      note: '',
      x: 120 + Math.random() * 300,
      y: 80 + Math.random() * 200,
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(newNode.id);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (!selectedId || nodes.length <= 1) return;
    if (!confirmDelete) { setConfirmDelete(true); return; } // M9 : demander confirmation
    setConfirmDelete(false);
    setEdges(prev => prev.filter(e => e.from !== selectedId && e.to !== selectedId));
    setNodes(prev => prev.map(n => ({
      ...n,
      inputs: (n.inputs || []).filter(i => i !== selectedId),
    })).filter(n => n.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
  };

  const cancelDelete = () => setConfirmDelete(false);

  const updateNode = useCallback((updated) => {
    const oldId = nodes.find(n => n.id === selectedId)?.id;
    setNodes(prev => prev.map(n => n.id === selectedId ? { ...updated, id: updated.id } : n));
    // Si l'id a changé, mettre à jour les edges et inputs
    if (oldId && updated.id !== oldId) {
      setEdges(prev => prev.map(e => ({
        from: e.from === oldId ? updated.id : e.from,
        to: e.to === oldId ? updated.id : e.to,
      })));
      setNodes(prev => prev.map(n => ({
        ...n,
        inputs: (n.inputs || []).map(i => i === oldId ? updated.id : i),
      })));
      setSelectedId(updated.id);
    }
    setDirty(true);
  }, [nodes, selectedId]);

  // Preset
  const applyPreset = (preset) => {
    const ns = nodesFromBackend(preset.nodes);
    // Layout automatique en colonnes pour les presets
    const levelMap = {};
    const nm = {}; preset.nodes.forEach(n => { nm[n.id] = n; });
    function getLevel(id) {
      if (levelMap[id] !== undefined) return levelMap[id];
      const node = nm[id]; if (!node) return 0;
      const parents = (node.inputs||[]).filter(i => i !== 'user_prompt' && nm[i]);
      levelMap[id] = parents.length === 0 ? 0 : Math.max(...parents.map(p => getLevel(p))) + 1;
      return levelMap[id];
    }
    preset.nodes.forEach(n => getLevel(n.id));
    const colCounts = {};
    const layouted = ns.map(n => {
      const lv = levelMap[n.id] || 0;
      colCounts[lv] = (colCounts[lv] || 0);
      const row = colCounts[lv];
      colCounts[lv]++;
      return { ...n, x: 60 + lv * 220, y: 60 + row * 140 };
    });

    setNodes(layouted);
    const es = [];
    preset.nodes.forEach(n => {
      (n.inputs || []).forEach(inp => {
        if (inp !== 'user_prompt') es.push({ from: inp, to: n.id });
      });
    });
    setEdges(es);
    setSelectedId(null);
    setDirty(true);
  };

  // ── Sauvegarder ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    const name = pipelineName.trim();
    if (!name) { setSaveError('Nom requis'); return; }
    setSaving(true); setSaveStatus('saving'); setSaveError('');
    try {
      const backendNodes = nodes.map(({ _source, ...n }) => {
        const base = {
          id:        n.id,
          node_type: n.node_type || 'llm',
          inputs:    n.inputs || ['user_prompt'],
          x: Math.round(n.x),
          y: Math.round(n.y),
        };
        if ((n.node_type || 'llm') === 'tool') {
          return { ...base, tool_type: n.tool_type || 'web_search',
                            tool_config: n.tool_config || {}, note: n.note || '' };
        }
        return { ...base, role: n.role, model: n.model,
                          web_search: n.web_search || 'none',
                          role_prompt: n.role_prompt || '' };
      });
      const isNew = !pipelineId;
      const payload = {
        name,
        cog: { cog_version: '1.0', nodes: backendNodes, edges, config: {} },
      };
      const res = await apiFetch(
        isNew ? ROUTES.pipelines.create : ROUTES.pipelines.update(pipelineId),
        { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(payload) }
      );
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      if (isNew) setPipelineId(updated.id);
      setDirty(false);
      setSaveStatus('saved');
      showToast('Pipeline sauvegardé', 'ok');
      onSave?.(updated, isNew);
    } catch (e) {
      setSaveError(e.message || 'Erreur sauvegarde');
      setSaveStatus('unsaved');
    } finally {
      setSaving(false);
    }
  };

  const handleExportCog = async () => {
    if (!group?.id) return
    const res = await apiFetch(ROUTES.pipelines.exportCog(group.id))
    if (!res || !res.ok) return
    const cog  = await res.json()
    const blob = new Blob([JSON.stringify(cog, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${(group.name || 'pipeline').toLowerCase().replace(/\s+/g, '-')}.cog.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImportFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result)
        await previewImport(parsed)
      } catch {
        setImportError('JSON invalide')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const previewImport = async (parsed) => {
    const res  = await apiFetch(ROUTES.pipelines.validateCog, {
      method: 'POST', body: JSON.stringify(parsed),
    })
    const data = await res.json()
    if (data.valid) {
      setImportPreview(parsed)
      setImportError(null)
    } else {
      setImportError(data.error || 'Invalide')
      setImportPreview(null)
    }
  }

  const handleConfirmImport = async () => {
    if (!importPreview) return
    const res = await apiFetch(ROUTES.pipelines.importCog, {
      method: 'POST', body: JSON.stringify(importPreview),
    })
    if (res?.ok) {
      const imported = await res.json()
      setImportModal(false)
      setImportPreview(null)
      setImportText('')
      onSave?.()   // rafraîchir la liste des pipelines
      alert(`✅ Pipeline "${imported.name}" importé`)
    }
  }

  const handleCopyJson = async () => {
    const json = JSON.stringify({ nodes, edges }, null, 2)
    await navigator.clipboard.writeText(json)
    alert('JSON copié !')
  }

  const selectedNode = nodes.find(n => n.id === selectedId) || null;

  // Trouver le terminal (aucun node ne le cible)
  const referenced = new Set(edges.map(e => e.from));
  const terminalId = nodes.find(n => !referenced.has(n.id))?.id;

  const PRESETS = [
    { id:'par', label:'⚡ Parallèle', nodes:[
      {id:'reader',role:'reader',model:'google/gemini-2.0-flash-001',inputs:['user_prompt'],web_search:'none',role_prompt:''},
      {id:'analyst_a',role:'explorer',model:'anthropic/claude-sonnet-4-5',inputs:['reader'],web_search:'none',role_prompt:''},
      {id:'analyst_b',role:'critic',model:'meta-llama/llama-3.3-70b-instruct',inputs:['reader'],web_search:'none',role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['analyst_a','analyst_b'],web_search:'none',role_prompt:''},
    ]},
    { id:'debat', label:'⚔️ Débat', nodes:[
      {id:'explorer',role:'explorer',model:'meta-llama/llama-3.3-70b-instruct',inputs:['user_prompt'],web_search:'none',role_prompt:''},
      {id:'devil',role:'devil_advocate',model:'anthropic/claude-sonnet-4-5',inputs:['user_prompt'],web_search:'none',role_prompt:''},
      {id:'optimizer',role:'optimizer',model:'deepseek/deepseek-r1',inputs:['explorer','devil'],web_search:'none',role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['explorer','devil','optimizer'],web_search:'none',role_prompt:''},
    ]},
    { id:'code', label:'💻 Code', nodes:[
      {id:'explorer',role:'explorer',model:'deepseek/deepseek-r1',inputs:['user_prompt'],web_search:'none',role_prompt:''},
      {id:'critic',role:'critic',model:'anthropic/claude-sonnet-4-5',inputs:['explorer'],web_search:'none',role_prompt:''},
      {id:'optimizer',role:'optimizer',model:'deepseek/deepseek-r1',inputs:['critic'],web_search:'none',role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['explorer','critic','optimizer'],web_search:'none',role_prompt:''},
    ]},
  ];

  return (
    <div className="pe-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="pe-modal">

        {/* ── Colonne gauche : Assistant (toujours visible) ── */}
        <PipelineAssistant
          currentPipeline={{ nodes, edges, name: pipelineName }}
          onApply={(cog) => {
            const existingPositions = {};
            nodes.forEach(n => { existingPositions[n.id] = { x: n.x, y: n.y }; });
            const converted = (cog.nodes || []).map((n, i) => {
              const pos = existingPositions[n.id] || { x: n.x ?? defaultPos(i).x, y: n.y ?? defaultPos(i).y };
              if (n.type === 'input') {
                return { id: n.id, role: 'reader', model: n.model || '', _source: true, inputs: ['user_prompt'], web_search: 'none', role_prompt: n.system_prompt || '', ...pos };
              }
              if (n.type === 'output') {
                return { id: n.id, role: 'chairman', model: n.model || '', inputs: [], web_search: 'none', role_prompt: n.system_prompt || '', ...pos };
              }
              if (n.type === 'llm' || n.type === 'llm_local') {
                return { id: n.id, role: 'reader', model: n.model || '', inputs: [], web_search: 'none', role_prompt: n.system_prompt || '', ...pos };
              }
              if (n.type === 'rag_search') {
                return { id: n.id, node_type: 'tool', tool_type: 'rag_search', inputs: [], folder_id: n.folder_id || '', limit: n.limit ?? 5, score_threshold: n.score_threshold ?? 0.3, ...pos };
              }
              if (n.type === 'tool') {
                return { id: n.id, node_type: 'tool', tool_type: n.tool_type || 'web_search', inputs: [], ...pos };
              }
              if (n.type === 'merge') {
                return { id: n.id, role: 'synthesizer', model: n.model || '', inputs: [], web_search: 'none', role_prompt: '', ...pos };
              }
              if (n.type === 'condition' || n.type === 'mcp') {
                return { id: n.id, role: 'custom', model: n.model || '', inputs: [], web_search: 'none', role_prompt: n.system_prompt || n.condition || '', ...pos };
              }
              return { id: n.id, role: 'custom', model: n.model || '', inputs: [], web_search: 'none', role_prompt: n.system_prompt || '', ...pos };
            });
            const convertedEdges = (cog.edges || []).map(e => ({ from: e.from, to: e.to }));
            setNodes(converted);
            setEdges(convertedEdges);
            setDirty(true);
          }}
        />

        {/* ── Colonne centrale : Toolbar + Canvas + Footer ── */}
        <div className="pe-canvas-col">

        {/* ── Toolbar ── */}
        <div className="pe-toolbar">
          <span className="pe-toolbar-icon">⬡</span>
          <input className="pe-name-input" value={pipelineName}
            onChange={e => { setPipelineName(e.target.value); setDirty(true); }}
            placeholder="Nom du pipeline…" />

          <div className="pe-toolbar-sep" />
          <select
            className="pe-pipeline-select"
            value=""
            onChange={e => {
              const found = allPipelines.find(p => p.id === e.target.value);
              if (found) loadFromPipeline(found);
            }}
          >
            <option value="">Charger un pipeline…</option>
            {allPipelines.map(p => (
              <option key={p.id} value={p.id}>{p.name || p.id}</option>
            ))}
          </select>
          <div className="pe-toolbar-sep" />

          <button className="pe-toolbar-btn" onClick={addNode} title="Ajouter un nœud LLM">＋ Nœud LLM</button>
          <button className="pe-toolbar-btn pe-btn-tool" onClick={addToolNode}
            title="Ajouter un nœud outil (web search, code, git…)">⚙ Outil</button>
          <div className="pe-toolbar-sep" />
          <button className="pe-toolbar-btn pe-btn-local" onClick={applyAllLocal}
            title="Passer tous les nœuds LLM sur le premier modèle Ollama disponible">🖥 Tout en local</button>
          <button className="pe-toolbar-btn pe-btn-cloud" onClick={applyAllCloud}
            title="Repasser tous les nœuds LLM sur le modèle cloud par défaut">☁ Tout en cloud</button>
          <div className="pe-toolbar-sep" />
          <button onClick={() => setImportModal(true)} className="pe-toolbar-btn">📥 Importer</button>
          <button onClick={handleExportCog} className="pe-toolbar-btn">📤 Exporter</button>
          <button onClick={handleCopyJson} className="pe-toolbar-btn">📋 Copier JSON</button>
          <button onClick={handleSave} className="pe-toolbar-btn pe-btn-save-inline"
            disabled={saving || !pipelineName.trim()}
            title="Sauvegarder le pipeline">
            {saving ? '⟳' : '💾'} Sauvegarder
          </button>
          <span className={`pe-save-indicator ${saveStatus}`}>
            {saveStatus === 'unsaved' ? '● Non sauvegardé' : saveStatus === 'saving' ? '⟳ Sauvegarde…' : '✓ Sauvegardé'}
          </span>
          {toast && (
            <span className={`pe-toast pe-toast-${toast.type}`}>{toast.msg}</span>
          )}
          {selectedId && (
            confirmDelete ? (
              <>
                <span className="pe-confirm-label">Supprimer {selectedId} ?</span>
                <button className="pe-toolbar-btn pe-toolbar-btn-danger" onClick={deleteSelected}>✓ Oui</button>
                <button className="pe-toolbar-btn" onClick={cancelDelete}>✗ Non</button>
              </>
            ) : (
              <button className="pe-toolbar-btn pe-toolbar-btn-danger"
                onClick={deleteSelected}
                title="Supprimer le nœud sélectionné">🗑 Suppr.</button>
            )
          )}

          <div className="pe-toolbar-spacer" />
          {connectingFrom && (
            <span className="pe-connecting-hint">
              ⚡ Connexion depuis <strong>{connectingFrom}</strong> — clique sur un port d'entrée
              <button className="pe-cancel-connect" onClick={() => setConnectingFrom(null)}>✕</button>
            </span>
          )}

          {/* ── Badge coût estimé ── */}
          {costEstimate !== null && (
            <div className="pe-cost-badge-wrapper">
              <button
                className="pe-cost-badge"
                onClick={() => setCostPopup(v => !v)}
                title="Coût estimé par requête — cliquer pour le détail"
              >
                💰 ~${costEstimate.total_usd === 0 ? '0.000' : costEstimate.total_usd.toFixed(4)} / req
              </button>
              {costPopup && (
                <div className="pe-cost-popup">
                  <div className="pe-cost-popup-header">
                    <span>Coût estimé par requête</span>
                    <button className="pe-cost-popup-close" onClick={() => setCostPopup(false)}>✕</button>
                  </div>
                  <table className="pe-cost-table">
                    <tbody>
                      {costEstimate.node_breakdown.map(n => (
                        <tr key={n.node_id}>
                          <td className="pe-cost-node">{n.label || n.node_id}</td>
                          <td className="pe-cost-model">{n.model.split('/').pop()}</td>
                          <td className={`pe-cost-value ${n.is_local ? 'pe-cost-free' : ''}`}>
                            {n.is_local ? '$0.00' : `$${n.cost_usd.toFixed(4)}`}
                          </td>
                        </tr>
                      ))}
                      <tr className="pe-cost-total-row">
                        <td colSpan={2}>TOTAL</td>
                        <td className="pe-cost-value">${costEstimate.total_usd.toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="pe-cost-disclaimer">{costEstimate.disclaimer}</div>
                </div>
              )}
            </div>
          )}

          <button className="pe-close-btn" onClick={onClose}>✕</button>
        </div>

        {/* ── Corps ── */}
        <div className="pe-body">

          {/* Canvas */}
          <div
            className={`pe-canvas-wrap${connectingFrom ? ' pe-canvas-connecting' : ''}${dragRef.current?.shiftConnect ? ' pe-canvas-shift' : ''}`}
            ref={canvasRef}
            onClick={onCanvasClick}
            onMouseDown={e => {
              // Alt+clic gauche OU clic molette → pan
              if (e.button === 1 || (e.button === 0 && e.altKey)) {
                e.preventDefault();
                panRef.current = {
                  startX: e.clientX, startY: e.clientY,
                  origPanX: panValRef.current.x, origPanY: panValRef.current.y,
                };
              }
            }}
          >
            {/* Groupe transformé zoom+pan — contient SVG + nodes */}
            <div className="pe-canvas-inner" style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute', inset: 0,
              width: '4000px', height: '3000px',
            }}>

            {/* SVG pour les connexions */}
            <svg className="pe-svg" style={{ width: '4000px', height: '3000px' }}>
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#b8941f" opacity=".7" />
                </marker>
              </defs>

              {/* Arêtes existantes */}
              {edges.map(e => {
                const fromNode = nodes.find(n => n.id === e.from);
                const toNode   = nodes.find(n => n.id === e.to);
                if (!fromNode || !toNode) return null;
                const x1 = fromNode.x + NODE_W;
                const y1 = fromNode.y + NODE_H / 2;
                const x2 = toNode.x;
                const y2 = toNode.y + NODE_H / 2;
                return (
                  <g key={`${e.from}-${e.to}`} className="pe-edge-group"
                    onClick={ev => { ev.stopPropagation(); deleteEdge(e.from, e.to); }}>
                    {/* Zone cliquable large */}
                    <path d={bezierPath(x1,y1,x2,y2)} className="pe-edge-hitbox" />
                    <path d={bezierPath(x1,y1,x2,y2)} className="pe-edge" markerEnd="url(#arrow)" />
                  </g>
                );
              })}

              {/* Connexion en cours */}
              {connectingFrom && (() => {
                const fromNode = nodes.find(n => n.id === connectingFrom);
                if (!fromNode) return null;
                const x1 = fromNode.x + NODE_W;
                const y1 = fromNode.y + NODE_H / 2;
                return <path d={bezierPath(x1,y1,mousePos.x,mousePos.y)} className="pe-edge pe-edge-preview" />;
              })()}
            </svg>

            {/* Nœuds */}
            {nodes.map(node => {
              const ri = getRoleInfo(node.role);
              const isSelected = node.id === selectedId;
              const isTerminal = node.id === terminalId;
              return (
                <div
                  key={node.id}
                  className={`pe-node${isSelected ? ' pe-node-selected' : ''}${isTerminal ? ' pe-node-terminal' : ''}${node._source ? ' pe-node-source' : ''}${shiftTarget === node.id ? ' pe-node-shift-target' : ''}${node.node_type === 'tool' ? ' pe-node-tool' : ''}`}
                  style={{
                    left: node.x, top: node.y,
                    width: NODE_W, height: NODE_H,
                    '--nc': node.node_type === 'tool'
                      ? getToolInfo(node.tool_type).color
                      : (node._source ? '#F59E0B' : ri.color),
                  }}
                  onMouseDown={e => onNodeMouseDown(e, node.id)}
                >
                  {/* Port entrée — masqué pour nœud source */}
                  {!node._source && (
                    <div className="pe-port pe-port-in"
                      onClick={e => onInPortClick(e, node.id)}
                      title="Port d'entrée" />
                  )}

                  {/* Contenu */}
                  <div className="pe-node-content">
                    {node.node_type === 'tool' ? (() => {
                      const ti = getToolInfo(node.tool_type);
                      return (<>
                        <div className="pe-node-role" style={{ color: ti.color }}>{ti.label}</div>
                        <div className="pe-node-id">{node.id}</div>
                        {node.note && <div className="pe-node-model" style={{ fontStyle: 'italic' }}>{node.note}</div>}
                      </>);
                    })() : (<>
                      <div className="pe-node-role" style={{ color: node._source ? '#F59E0B' : ri.color }}>
                        {node._source ? '🔗 Entrée' : ri.label}
                      </div>
                      <div className="pe-node-id">{node.id}</div>
                      <div className="pe-node-model">
                        {(node.model || '').startsWith('ollama/') || (node.model || '').startsWith('local/')
                          ? `🖥 ${(node.model || '').split('/').pop()}`
                          : (node.model || '').split('/').pop().replace(/:free$/, '') || '(défaut)'}
                      </div>
                    </>)}
                  </div>

                  {/* Badges */}
                  <div className="pe-node-badges">
                    {node.web_search && node.web_search !== 'none' && (
                      <span title={node.web_search === 'deep' ? 'Deep search' : 'Fact-check'}
                        style={{ fontSize: 9, opacity: .85 }}>
                        {node.web_search === 'deep' ? '🌐⚡' : '🌐✓'}
                      </span>
                    )}
                    {isTerminal && <span title="Nœud terminal (sortie finale)">⬡</span>}
                  </div>

                  {/* Port sortie */}
                  <div className="pe-port pe-port-out"
                    onClick={e => onOutPortClick(e, node.id)}
                    title="Port de sortie" />
                </div>
              );
            })}

            </div>{/* fin pe-canvas-inner */}

            {/* Hint canvas vide */}
            {nodes.length === 0 && (
              <div className="pe-canvas-empty">
                Clique sur <strong>＋ Nœud</strong> ou choisis un modèle de pipeline
              </div>
            )}
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="pe-footer">
          <div className="pe-footer-info">
            <span className="pe-fi">{nodes.length} nœud{nodes.length > 1 ? 's' : ''}</span>
            <span className="pe-fi">{edges.length} connexion{edges.length > 1 ? 's' : ''}</span>
            <span className="pe-fi pe-fi-hint">
              Glisse les nœuds · clic port <span style={{color:'#6dbb87'}}>●</span> sortie → port <span style={{color:'#b8941f'}}>●</span> entrée · clic arête = supprimer
              · <strong>Molette</strong> = zoom · <strong>Alt+drag</strong> = pan
            </span>
            <button className="pe-zoom-reset" onClick={resetView}
              title="Réinitialiser la vue">
              {Math.round(zoom * 100)}% ↺
            </button>
          </div>
          {saveError && <span className="pe-save-error">{saveError}</span>}
          <button className="pe-btn-cancel" onClick={onClose}>Annuler</button>
          <button className="pe-btn-save" onClick={handleSave}
            disabled={saving || !dirty || !pipelineName.trim()}>
            {saving ? 'Sauvegarde…' : group?.id ? 'Sauvegarder' : 'Créer'}
          </button>
        </div>

        </div>{/* fin pe-canvas-col */}

        {/* ── Colonne droite : Config nœud (slide-in si nœud sélectionné) ── */}
        <div className={`pe-side${selectedNode ? '' : ' pe-side-hidden'}`} onClick={e => e.stopPropagation()}>
          {selectedNode && (
            <NodePanel
              node={selectedNode}
              availableModels={availableModels}
              defaultModel={defaultModel}
              localModels={localModels}
              ollamaAvailable={ollamaAvailable}
              onChange={updateNode}
              onDelete={deleteSelected}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>

        {/* Import modal */}
        {importModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: '#161B22', border: '1px solid #30363D', borderRadius: 10, padding: 24, width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, color: '#E6EDF3', fontSize: 15 }}>📥 Importer un pipeline .cog</h3>
                <button onClick={() => { setImportModal(false); setImportPreview(null); setImportText(''); setImportError(null); }} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18 }}>✕</button>
              </div>

              {/* Bouton fichier */}
              <button onClick={() => importFileRef.current?.click()} style={{ padding: '8px 14px', background: '#21262D', border: '1px solid #30363D', borderRadius: 6, color: '#E6EDF3', cursor: 'pointer' }}>
                📂 Choisir un fichier .json / .cog
              </button>
              <input ref={importFileRef} type="file" accept=".json,.cog" hidden onChange={handleImportFile} />

              {/* Coller JSON */}
              <textarea
                placeholder='Ou coller le JSON ici…'
                value={importText}
                onChange={e => setImportText(e.target.value)}
                style={{ height: 160, background: '#0D1117', border: '1px solid #30363D', borderRadius: 6, color: '#E6EDF3', padding: 10, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
              />
              {importText && (
                <button onClick={async () => { try { await previewImport(JSON.parse(importText)) } catch { setImportError('JSON invalide') } }} style={{ padding: '6px 12px', background: '#21262D', border: '1px solid #30363D', borderRadius: 6, color: '#E6EDF3', cursor: 'pointer' }}>
                  🔍 Valider
                </button>
              )}

              {importError && <div style={{ color: '#F85149', fontSize: 12 }}>⚠ {importError}</div>}

              {importPreview && (
                <div style={{ background: '#0D1117', border: '1px solid #238636', borderRadius: 6, padding: 12, fontSize: 12, color: '#3FB950' }}>
                  ✅ <strong>{importPreview.name}</strong> — {importPreview.nodes?.length ?? 0} nœuds, {importPreview.edges?.length ?? 0} connexions
                  {importPreview.description && <div style={{ color: '#8B949E', marginTop: 4 }}>{importPreview.description}</div>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => { setImportModal(false); setImportPreview(null); setImportText(''); setImportError(null); }} style={{ padding: '6px 16px', background: '#21262D', border: '1px solid #30363D', borderRadius: 6, color: '#E6EDF3', cursor: 'pointer' }}>
                  Annuler
                </button>
                <button onClick={handleConfirmImport} disabled={!importPreview} style={{ padding: '6px 16px', background: importPreview ? '#238636' : '#1c2b1e', border: '1px solid #2ea043', borderRadius: 6, color: importPreview ? '#fff' : '#555', cursor: importPreview ? 'pointer' : 'not-allowed' }}>
                  ✅ Confirmer l'import
                </button>
              </div>
            </div>
          </div>
        )}


      </div>
    </div>
  );
}
