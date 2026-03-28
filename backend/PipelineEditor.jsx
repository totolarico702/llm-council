import { useState, useEffect, useRef, useCallback } from 'react';
import { useModels } from '../modelsStore';
import './PipelineEditor.css';

const API_BASE = 'http://localhost:8001';

const ROLES = [
  { value: 'explorer',       label: '🧭 Explorer',     color: '#3B82F6' },
  { value: 'critic',         label: '🔬 Critique',      color: '#EF4444' },
  { value: 'optimizer',      label: '⚡ Optimiseur',    color: '#22C55E' },
  { value: 'devil_advocate', label: '😈 Contradicteur', color: '#A855F7' },
  { value: 'synthesizer',    label: '🔗 Synthétiseur',  color: '#F59E0B' },
  { value: 'chairman',       label: '👑 Chairman',      color: '#38BDF8' },
  { value: 'reader',         label: '📖 Lecteur',       color: '#06B6D4' },
  { value: 'custom',         label: '✏️ Custom',        color: '#94A3B8' },
];

const getRoleInfo = (role) => ROLES.find(r => r.value === role) || ROLES[0];

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
function NodePanel({ node, availableModels, onChange, onDelete, onClose }) {
  if (!node) return (
    <div className="pe-np-empty">
      <div className="pe-np-empty-icon">⬡</div>
      <p>Clique sur un nœud<br/>pour l'éditer</p>
    </div>
  );

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
          <select className="pe-np-select" value={node.model}
            onChange={e => onChange({ ...node, model: e.target.value })}>
            {/* Option courante toujours présente même si pas encore dans la liste */}
            {!availableModels.find(m => m.id === node.model) && (
              <option value={node.model}>{node.model}</option>
            )}
            {availableModels.length === 0 && (
              <option disabled>Chargement des modèles…</option>
            )}
            {availableModels.map(m => (
              <option key={m.id} value={m.id}>
                {m.is_free ? '🆓 ' : ''}{m.name || m.id}
              </option>
            ))}
          </select>
        </div>

        <div className="pe-np-field pe-np-field-row">
          <label className="pe-np-label">📎 Reçoit les documents</label>
          <label className="pe-toggle">
            <input type="checkbox" checked={node.accepts_documents || false}
              onChange={e => onChange({ ...node, accepts_documents: e.target.checked })} />
            <span className="pe-toggle-track" />
          </label>
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
export default function PipelineEditor({ group, onSave, onClose, allPipelines = [], onLoadPipeline }) {
  const canvasRef = useRef(null);

  const [nodes, setNodes]           = useState([]);
  const [edges, setEdges]           = useState([]); // [{from, to}]
  const [selectedId, setSelectedId] = useState(null);
  const [pipelineName, setPipelineName] = useState('');
  const availableModels = useModels(); // store global — déjà chargé par App.jsx
  const [saving, setSaving]         = useState(false);
  const [saveError, setSaveError]   = useState('');
  const [dirty, setDirty]           = useState(false);

  // Drag node
  const dragRef = useRef(null); // { nodeId, startX, startY, origX, origY }
  const didDragNode = useRef(false); // true si le dernier mousedown était sur un node
  // Connexion en cours
  const connectRef = useRef(null); // { fromId, mouseX, mouseY }
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [shiftTarget, setShiftTarget] = useState(null); // nœud survolé pendant shift-drag
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Init depuis groupe
  useEffect(() => {
    setPipelineName(group?.name || '');
    if (group?.nodes?.length > 0) {
      const ns = nodesFromBackend(group.nodes);
      setNodes(ns);
      // Reconstruire edges depuis inputs[]
      const es = [];
      group.nodes.forEach(n => {
        (n.inputs || []).forEach(inp => {
          if (inp !== 'user_prompt') es.push({ from: inp, to: n.id });
        });
      });
      setEdges(es);
    } else {
      setNodes([
        {
          id: 'hook', role: 'reader',
          model: group?.models?.[0] || 'google/gemini-2.0-flash-001',
          inputs: ['user_prompt'], accepts_documents: true, role_prompt: '',
          x: 80, y: 160, _source: true,
        },
        {
          id: 'chairman', role: 'chairman',
          model: group?.models?.[0] || 'google/gemini-2.0-flash-001',
          inputs: ['hook'], accepts_documents: false, role_prompt: '',
          x: 360, y: 160,
        },
      ]);
      setEdges([{ from: 'hook', to: 'chairman' }]);
    }
  }, [group]);


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
    if (rect) setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    if (!dragRef.current) return;
    const { nodeId, startX, startY, origX, origY, shiftConnect } = dragRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
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
      role: 'explorer',
      model: availableModels[0]?.id || 'google/gemini-2.0-flash-001',
      inputs: ['user_prompt'],
      accepts_documents: false,
      role_prompt: '',
      x: 120 + Math.random() * 300,
      y: 80 + Math.random() * 200,
    };
    setNodes(prev => [...prev, newNode]);
    setSelectedId(newNode.id);
    setDirty(true);
  };

  const deleteSelected = () => {
    if (!selectedId || nodes.length <= 1) return;
    setEdges(prev => prev.filter(e => e.from !== selectedId && e.to !== selectedId));
    setNodes(prev => prev.map(n => ({
      ...n,
      inputs: (n.inputs || []).filter(i => i !== selectedId),
    })).filter(n => n.id !== selectedId));
    setSelectedId(null);
    setDirty(true);
  };

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
    // Vérifier qu'il y a au moins un terminal
    setSaving(true); setSaveError('');
    try {
      // Sérialiser : inclure x,y dans les nodes, inputs depuis edges
      const backendNodes = nodes.map(({ _source, ...n }) => ({
        id: n.id,
        role: n.role,
        model: n.model,
        inputs: n.inputs || ['user_prompt'],
        accepts_documents: n.accepts_documents || false,
        role_prompt: n.role_prompt || '',
        x: Math.round(n.x),
        y: Math.round(n.y),
      }));
      const isNew = !group?.id;
      const res = await fetch(
        isNew ? `${API_BASE}/api/groups` : `${API_BASE}/api/groups/${group.id}`,
        {
          method: isNew ? 'POST' : 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, nodes: backendNodes }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      setDirty(false);
      onSave?.(updated, isNew);
    } catch (e) {
      setSaveError(e.message || 'Erreur sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  // ── Enregistrer sous (nouveau nom, nouvelle entrée) ──────────────────────
  const handleSaveAs = async () => {
    const newName = prompt('Nom du nouveau pipeline :', pipelineName + ' (copie)');
    if (!newName?.trim()) return;
    setSaving(true); setSaveError('');
    try {
      const backendNodes = nodes.map(({ _source, ...n }) => ({
        id: n.id, role: n.role, model: n.model,
        inputs: n.inputs || ['user_prompt'],
        accepts_documents: n.accepts_documents || false,
        role_prompt: n.role_prompt || '',
        x: Math.round(n.x), y: Math.round(n.y),
      }));
      const res = await fetch(`${API_BASE}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), nodes: backendNodes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      setPipelineName(newName.trim());
      setDirty(false);
      onSave?.(created, true);
    } catch (e) {
      setSaveError(e.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  // ── Dupliquer (crée une copie et la charge dans l'éditeur) ─────────────
  const handleDuplicate = async () => {
    const newName = prompt('Nom du duplicata :', pipelineName + ' (copie)');
    if (!newName?.trim()) return;
    setSaving(true); setSaveError('');
    try {
      const backendNodes = nodes.map(({ _source, ...n }) => ({
        id: n.id, role: n.role, model: n.model,
        inputs: n.inputs || ['user_prompt'],
        accepts_documents: n.accepts_documents || false,
        role_prompt: n.role_prompt || '',
        x: Math.round(n.x), y: Math.round(n.y),
      }));
      const res = await fetch(`${API_BASE}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), nodes: backendNodes }),
      });
      if (!res.ok) throw new Error(await res.text());
      const created = await res.json();
      // Charger le duplicata dans l'éditeur
      onSave?.(created, true);
      onLoadPipeline?.(created);
    } catch (e) {
      setSaveError(e.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const selectedNode = nodes.find(n => n.id === selectedId) || null;

  // Trouver le terminal (aucun node ne le cible)
  const referenced = new Set(edges.map(e => e.from));
  const terminalId = nodes.find(n => !referenced.has(n.id))?.id;

  const PRESETS = [
    { id:'par', label:'⚡ Parallèle', nodes:[
      {id:'reader',role:'reader',model:'google/gemini-2.0-flash-001',inputs:['user_prompt'],accepts_documents:true,role_prompt:''},
      {id:'analyst_a',role:'explorer',model:'anthropic/claude-sonnet-4-5',inputs:['reader'],accepts_documents:false,role_prompt:''},
      {id:'analyst_b',role:'critic',model:'meta-llama/llama-3.3-70b-instruct',inputs:['reader'],accepts_documents:false,role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['analyst_a','analyst_b'],accepts_documents:false,role_prompt:''},
    ]},
    { id:'debat', label:'⚔️ Débat', nodes:[
      {id:'explorer',role:'explorer',model:'meta-llama/llama-3.3-70b-instruct',inputs:['user_prompt'],accepts_documents:false,role_prompt:''},
      {id:'devil',role:'devil_advocate',model:'anthropic/claude-sonnet-4-5',inputs:['user_prompt'],accepts_documents:false,role_prompt:''},
      {id:'optimizer',role:'optimizer',model:'deepseek/deepseek-r1',inputs:['explorer','devil'],accepts_documents:false,role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['explorer','devil','optimizer'],accepts_documents:false,role_prompt:''},
    ]},
    { id:'code', label:'💻 Code', nodes:[
      {id:'explorer',role:'explorer',model:'deepseek/deepseek-r1',inputs:['user_prompt'],accepts_documents:false,role_prompt:''},
      {id:'critic',role:'critic',model:'anthropic/claude-sonnet-4-5',inputs:['explorer'],accepts_documents:false,role_prompt:''},
      {id:'optimizer',role:'optimizer',model:'deepseek/deepseek-r1',inputs:['critic'],accepts_documents:false,role_prompt:''},
      {id:'chairman',role:'chairman',model:'google/gemini-2.0-flash-001',inputs:['explorer','critic','optimizer'],accepts_documents:false,role_prompt:''},
    ]},
  ];

  return (
    <div className="pe-overlay" onClick={e => e.target === e.currentTarget && onClose?.()}>
      <div className="pe-modal">

        {/* ── Toolbar ── */}
        <div className="pe-toolbar">
          <span className="pe-toolbar-icon">⬡</span>
          <input className="pe-name-input" value={pipelineName}
            onChange={e => { setPipelineName(e.target.value); setDirty(true); }}
            placeholder="Nom du pipeline…" />

          {/* ── Actions pipeline ── */}
          <div className="pe-action-group">
            <button className="pe-toolbar-btn pe-action-new"
              onClick={() => onLoadPipeline?.({})}
              title="Nouveau pipeline vierge">＋</button>
            <button className="pe-toolbar-btn pe-action-saveas"
              onClick={handleSaveAs} title="Enregistrer sous" disabled={saving}>💾</button>
            <button className="pe-toolbar-btn pe-action-dup"
              onClick={handleDuplicate} title="Dupliquer" disabled={saving}>⧉</button>
          </div>

          <div className="pe-toolbar-sep" />
          <span className="pe-toolbar-hint">Modèles :</span>
          {PRESETS.map(p => (
            <button key={p.id} className="pe-preset-btn" onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
          <div className="pe-toolbar-sep" />

          <button className="pe-toolbar-btn" onClick={addNode} title="Ajouter un nœud">＋ Nœud</button>
          {selectedId && (
            <button className="pe-toolbar-btn pe-toolbar-btn-danger" onClick={deleteSelected} title="Supprimer le nœud sélectionné">🗑</button>
          )}

          <div className="pe-toolbar-spacer" />
          {connectingFrom && (
            <span className="pe-connecting-hint">
              ⚡ <strong>{connectingFrom}</strong>
              <button className="pe-cancel-connect" onClick={() => setConnectingFrom(null)}>✕</button>
            </span>
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
          >
            {/* SVG pour les connexions */}
            <svg className="pe-svg">
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L0,6 L8,3 z" fill="#3B82F6" opacity=".7" />
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
                  className={`pe-node${isSelected ? ' pe-node-selected' : ''}${isTerminal ? ' pe-node-terminal' : ''}${node._source ? ' pe-node-source' : ''}${shiftTarget === node.id ? ' pe-node-shift-target' : ''}`}
                  style={{
                    left: node.x, top: node.y,
                    width: NODE_W, height: NODE_H,
                    '--nc': node._source ? '#F59E0B' : ri.color,
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
                    <div className="pe-node-role" style={{ color: node._source ? '#F59E0B' : ri.color }}>
                      {node._source ? '🔗 Entrée' : ri.label}
                    </div>
                    <div className="pe-node-id">{node.id}</div>
                    <div className="pe-node-model">{node.model.split('/').pop().replace(/:free$/,'')}</div>
                  </div>

                  {/* Badges */}
                  <div className="pe-node-badges">
                    {node.accepts_documents && <span title="Reçoit les documents">📎</span>}
                    {isTerminal && <span title="Nœud terminal (sortie finale)">⬡</span>}
                  </div>

                  {/* Port sortie */}
                  <div className="pe-port pe-port-out"
                    onClick={e => onOutPortClick(e, node.id)}
                    title="Port de sortie" />
                </div>
              );
            })}

            {/* Hint canvas vide */}
            {nodes.length === 0 && (
              <div className="pe-canvas-empty">
                Clique sur <strong>＋ Nœud</strong> ou choisis un modèle de pipeline
              </div>
            )}
          </div>

          {/* Panneau latéral */}
          <div className="pe-side" onClick={e => e.stopPropagation()}>
            <NodePanel
              node={selectedNode}
              availableModels={availableModels}
              onChange={updateNode}
              onDelete={deleteSelected}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="pe-footer">
          <div className="pe-footer-info">
            <span className="pe-fi">{nodes.length} nœud{nodes.length > 1 ? 's' : ''}</span>
            <span className="pe-fi">{edges.length} connexion{edges.length > 1 ? 's' : ''}</span>
            <span className="pe-fi pe-fi-hint">
              Glisse les nœuds · clic port <span style={{color:'#22C55E'}}>●</span> sortie → port <span style={{color:'#3B82F6'}}>●</span> entrée · clic arête = supprimer
            </span>
          </div>
          {saveError && <span className="pe-save-error">{saveError}</span>}
          <button className="pe-btn-cancel" onClick={onClose}>Annuler</button>
          <button className="pe-btn-save" onClick={handleSave}
            disabled={saving || !dirty || !pipelineName.trim()}>
            {saving ? 'Sauvegarde…' : group?.id ? 'Sauvegarder' : 'Créer'}
          </button>
        </div>

      </div>
    </div>
  );
}
