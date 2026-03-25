import { useState, useEffect, useRef } from 'react';
import { api, auth, apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import PipelineEditor from './PipelineEditor';
import './Sidebar.css';

export default function Sidebar({
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onRenameConversation,
  onProjectsChange,
  activeTab,
  onTabChange,
  user,
  onLogout,
  language = 'fr',
  onLangChange,
}) {
  const [credits,           setCredits]           = useState(null);
  const isAdmin = auth.isAdmin();
  const [projects,          setProjects]          = useState([]);
  const [expandedProject,   setExpandedProject]   = useState(null);
  const [newProjectName,    setNewProjectName]    = useState('');
  const [showNewProject,    setShowNewProject]    = useState(false);
  const [selectedForExport, setSelectedForExport] = useState({});
  const [renamingProject,   setRenamingProject]   = useState(null);
  const [renameValue,       setRenameValue]       = useState('');
  const [renamingConv,      setRenamingConv]      = useState(null);
  const [renameConvValue,   setRenameConvValue]   = useState('');
  const [draggedConvId,     setDraggedConvId]     = useState(null);
  const [dropTargetId,      setDropTargetId]      = useState(null);
  const [pipelines,         setPipelines]         = useState([]);
  const [editingPipeline,   setEditingPipeline]   = useState(null); // null | pipeline obj
  const [pipelineMenu,      setPipelineMenu]      = useState(null); // null | pipeline id
  const pipelineMenuRef = useRef(null);

  const fetchCredits = async () => {
    try { setCredits(await api.getCredits()); }
    catch (err) { console.error('Failed to fetch credits:', err); }
  };

  const loadPipelines = async () => {
    try {
      const res = await apiFetch(ROUTES.pipelines.list);
      if (res.ok) setPipelines(await res.json());
    } catch (err) { console.error('Failed to load pipelines:', err); }
  };

  const handleDeletePipeline = async (e, id) => {
    e.stopPropagation();
    setPipelineMenu(null);
    if (!confirm('Supprimer ce pipeline ?')) return;
    await apiFetch(ROUTES.pipelines.delete(id), { method: 'DELETE' });
    loadPipelines();
  };

  const handleDuplicatePipeline = async (e, pipeline) => {
    e.stopPropagation();
    setPipelineMenu(null);
    const res = await apiFetch(ROUTES.pipelines.create, {
      method: 'POST',
      body: JSON.stringify({ name: `${pipeline.name} (copie)`, cog: pipeline.cog }),
    });
    if (res.ok) loadPipelines();
  };

  const handleExportPipelineCog = async (e, id, name) => {
    e.stopPropagation();
    setPipelineMenu(null);
    const res = await apiFetch(ROUTES.pipelines.exportCog(id));
    if (!res?.ok) return;
    const cog  = await res.json();
    const blob = new Blob([JSON.stringify(cog, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `${(name || 'pipeline').toLowerCase().replace(/\s+/g, '-')}.cog.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const loadProjects = async () => {
    try {
      const data = await api.listProjects();
      setProjects(data);
      if (onProjectsChange) onProjectsChange(data);
    } catch (err) { console.error('Failed to load projects:', err); }
  };

  useEffect(() => {
    fetchCredits();
    loadProjects();
    loadPipelines();
    const interval = setInterval(fetchCredits, 30000);
    // Fermer le menu pipeline au clic extérieur
    const handleClickOutside = (e) => {
      if (pipelineMenuRef.current && !pipelineMenuRef.current.contains(e.target))
        setPipelineMenu(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      clearInterval(interval);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    await api.createProject(newProjectName.trim());
    setNewProjectName('');
    setShowNewProject(false);
    loadProjects();
  };

  const handleDeleteProject = async (e, projectId) => {
    e.stopPropagation();
    await api.deleteProject(projectId);
    if (expandedProject === projectId) setExpandedProject(null);
    loadProjects();
  };

  const handleRenameProject = async (projectId) => {
    if (!renameValue.trim()) return;
    await api.renameProject(projectId, renameValue.trim());
    setRenamingProject(null);
    loadProjects();
  };

  const handleAssignToProject = async (convId, projectId) => {
    await api.assignToProject(convId, projectId);
    loadProjects();
  };

  const handleRenameConv = async (convId) => {
    if (!renameConvValue.trim()) { setRenamingConv(null); return; }
    await api.renameConversation(convId, renameConvValue.trim());
    setRenamingConv(null);
    // Mettre à jour localement dans la liste
    if (typeof onRenameConversation === 'function') onRenameConversation(convId, renameConvValue.trim());
    loadProjects();
  };

  // Drag & drop handlers
  const onDragStart = (e, convId) => {
    setDraggedConvId(convId);
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e, projectId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetId(projectId);
  };
  const onDragLeave = () => setDropTargetId(null);
  const onDrop = async (e, projectId) => {
    e.preventDefault();
    setDropTargetId(null);
    if (draggedConvId) {
      await handleAssignToProject(draggedConvId, projectId);
      setDraggedConvId(null);
    }
  };

  const toggleExportSelect = (convId) =>
    setSelectedForExport(prev => ({ ...prev, [convId]: !prev[convId] }));

  const handleExport = async (project) => {
    const selectedIds = project.conversation_ids.filter(id => selectedForExport[id]);
    if (selectedIds.length === 0) return alert('Sélectionnez au moins une conversation.');
    try {
      const blob = await api.exportProject(project.id, selectedIds);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${project.name}.zip`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error('Export failed:', e); }
  };

  const unassigned = conversations.filter(
    conv => !projects.some(p => p.conversation_ids?.includes(conv.id))
  );


  return (
    <>
    <div className="sidebar">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="sidebar-header">
        <div className="sidebar-title-row">
          <h1>LLM Council</h1>
          <button className="settings-btn" title="Paramètres"
            onClick={() => alert('Settings — bientôt disponible')}>⚙️</button>
        </div>

        {credits && (
          <div className="credits-box">
            <div className="credits-row">
              <span className="credits-label">💰 Solde</span>
              <span className="credits-value">${credits.balance.toFixed(4)}</span>
            </div>
            <div className="credits-row">
              <span className="credits-label">📊 Utilisé</span>
              <span className="credits-value used">${credits.usage.toFixed(4)}</span>
            </div>
          </div>
        )}

        <button className="new-conversation-btn" onClick={onNewConversation}>
          + New Conversation
        </button>
      </div>

      {/* ── Liste conversations / projets ─────────────────────────────── */}
      <div className="conversation-list">

        {/* ── Section Pipelines ── */}
        <div className="section-label">
          <span>🔧 Pipelines</span>
          <button className="add-project-btn" title="Nouveau pipeline"
            onClick={() => setEditingPipeline({})}>+</button>
        </div>

        {pipelines.length === 0 && (
          <div className="no-conversations" style={{ fontSize: 11 }}>Aucun pipeline</div>
        )}

        {pipelines.map(p => (
          <div key={p.id} className="pipeline-sidebar-item" onClick={() => setEditingPipeline(p)}>
            <span className="pipeline-sidebar-icon">⬡</span>
            <span className="pipeline-sidebar-name">{p.name || 'Sans nom'}</span>
            <div style={{ position: 'relative' }} ref={pipelineMenu === p.id ? pipelineMenuRef : null}>
              <button className="pipeline-sidebar-menu-btn"
                onClick={e => { e.stopPropagation(); setPipelineMenu(pipelineMenu === p.id ? null : p.id); }}
                title="Actions">···</button>
              {pipelineMenu === p.id && (
                <div className="pipeline-sidebar-dropdown">
                  <button onClick={e => handleDuplicatePipeline(e, p)}>📋 Dupliquer</button>
                  <button onClick={e => handleExportPipelineCog(e, p.id, p.name)}>📤 Exporter .cog</button>
                  <button className="danger" onClick={e => handleDeletePipeline(e, p.id)}>🗑 Supprimer</button>
                </div>
              )}
            </div>
          </div>
        ))}

        <div className="section-label" style={{ marginTop: 12 }}>
          <span>📁 Projets</span>
          <button className="add-project-btn" onClick={() => setShowNewProject(v => !v)} title="Nouveau projet">+</button>
        </div>

        {showNewProject && (
          <div className="new-project-form">
            <input
              className="new-project-input"
              placeholder="Nom du projet..."
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
              autoFocus
            />
            <button className="new-project-confirm" onClick={handleCreateProject}>✓</button>
          </div>
        )}

        {projects.map(project => (
          <div key={project.id} className="project-block">
            <div
              className={`project-header${dropTargetId === project.id ? ' drop-target' : ''}`}
              onClick={() => setExpandedProject(expandedProject === project.id ? null : project.id)}
              onDragOver={e => onDragOver(e, project.id)}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e, project.id)}>
              <span className="project-arrow">{expandedProject === project.id ? '▾' : '▸'}</span>
              {renamingProject === project.id ? (
                <input
                  className="rename-input"
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRenameProject(project.id);
                    if (e.key === 'Escape') setRenamingProject(null);
                  }}
                  onClick={e => e.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span className="project-name">{project.name}</span>
              )}
              <span className="project-count">{project.conversation_ids.length}</span>
              <button className="project-action-btn" title="Renommer"
                onClick={e => { e.stopPropagation(); setRenamingProject(project.id); setRenameValue(project.name); }}>✏️</button>
              <button className="project-action-btn" title="Supprimer"
                onClick={e => handleDeleteProject(e, project.id)}>🗑</button>
            </div>

            {expandedProject === project.id && (
              <div className="project-conversations">
                {project.conversation_ids.length === 0 && (
                  <div className="no-conversations" style={{ fontSize: '12px' }}>Aucune conversation</div>
                )}
                {project.conversation_ids.map(convId => {
                  const conv = conversations.find(c => c.id === convId);
                  if (!conv) return null;
                  return (
                    <div key={conv.id}
                      className={`conversation-item project-conv-item ${conv.id === currentConversationId ? 'active' : ''}`}
                      draggable
                      onDragStart={e => onDragStart(e, conv.id)}>
                      <input type="checkbox" className="export-checkbox"
                        checked={!!selectedForExport[conv.id]}
                        onChange={() => toggleExportSelect(conv.id)}
                        onClick={e => e.stopPropagation()} />
                      <div className="conv-info" onClick={() => onSelectConversation(conv.id)}>
                        {renamingConv === conv.id ? (
                          <input className="rename-input" autoFocus
                            value={renameConvValue}
                            onChange={e => setRenameConvValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRenameConv(conv.id);
                              if (e.key === 'Escape') setRenamingConv(null);
                            }}
                            onClick={e => e.stopPropagation()} />
                        ) : (
                          <div className="conversation-title"
                            onDoubleClick={e => { e.stopPropagation(); setRenamingConv(conv.id); setRenameConvValue(conv.title || ''); }}>
                            {conv.title || 'New Conversation'}
                          </div>
                        )}
                        <div className="conversation-meta">{conv.message_count} messages</div>
                      </div>
                      <button className="delete-conversation-btn"
                        onClick={e => { e.stopPropagation(); onDeleteConversation(conv.id); loadProjects(); }}
                        title="Supprimer">🗑</button>
                    </div>
                  );
                })}
                <button className="export-btn" onClick={() => handleExport(project)}>
                  ⬇️ Exporter la sélection
                </button>
              </div>
            )}
          </div>
        ))}

        <div className="section-label" style={{ marginTop: '12px' }}>
          <span>💬 Conversations</span>
        </div>

        {unassigned.length === 0 && (
          <div className="no-conversations">Aucune conversation</div>
        )}

        {unassigned.map(conv => (
          <div key={conv.id}
            className={`conversation-item ${conv.id === currentConversationId ? 'active' : ''}${draggedConvId === conv.id ? ' dragging' : ''}`}
            draggable
            onDragStart={e => onDragStart(e, conv.id)}
            onClick={() => onSelectConversation(conv.id)}>
            {renamingConv === conv.id ? (
              <input className="rename-input" autoFocus
                value={renameConvValue}
                onChange={e => setRenameConvValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRenameConv(conv.id);
                  if (e.key === 'Escape') setRenamingConv(null);
                }}
                onClick={e => e.stopPropagation()} />
            ) : (
              <div className="conversation-title"
                onDoubleClick={e => { e.stopPropagation(); setRenamingConv(conv.id); setRenameConvValue(conv.title || ''); }}>
                {conv.title || 'New Conversation'}
              </div>
            )}
            <div className="conversation-meta">{conv.message_count} messages</div>
            <div className="conv-actions">
              <button className="delete-conversation-btn"
                onClick={e => { e.stopPropagation(); onDeleteConversation(conv.id); }}
                title="Supprimer">🗑</button>
            </div>
          </div>
        ))}

        {draggedConvId && (
          <div className="drag-hint">
            ☝ Glisse vers un projet pour l'y déplacer
          </div>
        )}
      </div>

      {/* ── Footer : onglets + profil ─────────────────────────────────── */}
      <div className="sidebar-footer">
        <div className="sidebar-tabs">
          <button className={`sidebar-tab ${activeTab === 'chat'  ? 'active' : ''}`}
            onClick={() => onTabChange('chat')} title="Chat">💬 Chat</button>

          {isAdmin && (
            <button className={`sidebar-tab ${activeTab === 'admin' ? 'active' : ''}`}
              onClick={() => onTabChange('admin')} title="Administration">⚙ Admin</button>
          )}
        </div>

        {user && (
          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <span className="sidebar-user-avatar">{user.login[0].toUpperCase()}</span>
              <div className="sidebar-user-details">
                <span className="sidebar-user-name">{user.login}</span>
                <span className="sidebar-user-role">{user.role}</span>
              </div>
            </div>
            <select
              className="sidebar-lang-select"
              value={language}
              onChange={e => onLangChange?.(e.target.value)}
              title="Langue des réponses LLM"
            >
              <option value="fr">🇫🇷</option>
              <option value="en">🇺🇸</option>
            </select>
            <button className="sidebar-logout-btn" onClick={onLogout} title="Se déconnecter">⏻</button>
          </div>
        )}
      </div>

    </div>

    {/* ── PipelineEditor modal ── */}
    {editingPipeline !== null && (
      <PipelineEditor
        group={editingPipeline}
        onSave={(updated) => { loadPipelines(); if (updated?.id) setEditingPipeline(updated); }}
        onClose={() => setEditingPipeline(null)}
      />
    )}
    </>
  );
}
