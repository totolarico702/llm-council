# BRIEF_PIPELINE_V2 — Layout 3 colonnes + Persistance .cog + Modification par prompt

## Contexte

Ce brief couvre trois améliorations majeures du PipelineEditor :
1. Refonte du layout en 3 colonnes (assistant gauche, canvas centre, config droite)
2. Persistance des pipelines en JSON `.cog` dans TinyDB
3. Assistant capable de modifier un pipeline existant via prompt

---

## 1. Layout 3 colonnes

### Structure cible

```
┌─────────────────┬────────────────────────────┬──────────────────┐
│  Assistant      │      Pipeline Canvas        │  Config nœud     │
│  (260px fixe)   │      (flex, 100%)           │  (300px fixe)    │
│                 │                             │  visible si      │
│  toujours       │   nœuds + connexions        │  nœud sélect.    │
│  visible        │   react-flow                │  sinon caché     │
│                 │                             │                  │
│  [historique]   │                             │  [éditeur nœud]  │
│  [input chat]   │                             │                  │
└─────────────────┴────────────────────────────┴──────────────────┘
```

### Règles layout

- **Colonne gauche (Assistant)** : 260px fixe, toujours visible, pas de toggle
  - Historique conversation scrollable
  - Input prompt en bas
  - Aperçu JSON du `.cog` suggéré au-dessus de l'input
  - Bouton "⚡ Appliquer" si un `.cog` est en attente

- **Colonne centre (Canvas)** : `flex: 1`, prend tout l'espace restant
  - react-flow occupe 100% de la hauteur disponible
  - Toolbar en haut : `[Nom pipeline] [Modèles] [+ Nœud LLM] [Outil] [Tout local] [Tout cloud] [Importer] [Exporter] [Copier JSON] [💾 Sauvegarder]`

- **Colonne droite (Config nœud)** : 300px fixe, **visible uniquement si un nœud est sélectionné**
  - Si aucun nœud sélectionné → colonne droite masquée, canvas prend la place
  - Si nœud sélectionné → slide-in depuis la droite
  - Bouton ✕ pour désélectionner et masquer

### CSS

```css
.pipeline-editor {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.pipeline-assistant-col {
  width: 260px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
}

.pipeline-canvas-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.pipeline-node-config-col {
  width: 300px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  transform: translateX(0);
  transition: width 0.2s ease, transform 0.2s ease;
}

.pipeline-node-config-col.hidden {
  width: 0;
  overflow: hidden;
}
```

---

## 2. Persistance des pipelines en TinyDB

### Modèle de données TinyDB — collection `pipelines`

```json
{
  "id": "uuid",
  "name": "RAG + Analyse Mistral",
  "description": "Pipeline RAG développement avec synthèse",
  "owner_id": "user_uuid",
  "created_at": "ISO8601",
  "updated_at": "ISO8601",
  "version": 1,
  "cog": {
    "cog_version": "1.0",
    "nodes": [...],
    "edges": [...],
    "config": {...}
  },
  "is_default": false,
  "tags": ["rag", "analyse"]
}
```

### Routes backend à créer/modifier

```
GET    /api/v1/pipelines                    # liste tous les pipelines de l'user
POST   /api/v1/pipelines                    # créer nouveau pipeline (vide ou depuis .cog)
GET    /api/v1/pipelines/{id}               # charger un pipeline
PATCH  /api/v1/pipelines/{id}               # mettre à jour (nodes, edges, name, config)
DELETE /api/v1/pipelines/{id}               # supprimer
GET    /api/v1/pipelines/{id}/export-cog    # exporter en .cog.json (déjà existant)
POST   /api/v1/pipelines/import-cog         # importer depuis .cog (déjà existant)
```

### Sauvegarde automatique

- Bouton "💾 Sauvegarder" dans la toolbar → `PATCH /api/v1/pipelines/{id}`
- Auto-save toutes les 30 secondes si des modifications ont été faites (flag `isDirty`)
- Indicateur visuel dans la toolbar : `● Non sauvegardé` / `✓ Sauvegardé`

### Chargement des edges au rechargement

Bug actuel : les edges disparaissent au rechargement. Fix :
```javascript
// Dans la fonction loadPipeline()
const pipeline = await apiJSON(ROUTES.pipelines.get(id))
setNodes(pipeline.cog.nodes.map(cogNodeToReactFlow))
setEdges(pipeline.cog.edges.map(cogEdgeToReactFlow))  // ← s'assurer que c'est appelé
```

---

## 3. Assistant — Modification de pipeline par prompt

### Nouveau comportement de l'assistant

L'assistant reçoit maintenant le pipeline actuel en contexte et peut :
- **Créer** un nouveau pipeline depuis zéro
- **Modifier** le pipeline actuel (ajouter/supprimer/modifier des nœuds)
- **Expliquer** ce que fait le pipeline actuel

### Prompt système mis à jour

```
Tu es un expert en construction de pipelines LLM Council.
Tu peux créer ou modifier des pipelines DAG au format .cog v1.0.

Pipeline actuel :
{{current_pipeline_json}}

Modes de réponse :
1. Si l'user veut créer un nouveau pipeline → générer un .cog complet
2. Si l'user veut modifier le pipeline actuel → générer le .cog modifié complet
3. Si l'user pose une question sur le pipeline → répondre en texte (pas de JSON)

Exemples de modifications :
- "ajoute un nœud fact-check après llm_mistral" → insérer le nœud et l'edge
- "remplace Mistral par Claude Sonnet" → changer le model du nœud LLM
- "supprime le merge" → retirer le nœud merge et recâbler les edges
- "ajoute une condition : si moins de 3 chunks RAG, utilise le web search"

Règles :
- Toujours retourner le .cog COMPLET (pas juste le diff)
- Conserver les nœuds/edges existants sauf ceux explicitement modifiés
- Générer UNIQUEMENT du JSON valide quand tu génères un pipeline
- Si c'est une question → répondre en texte naturel sans JSON
```

### Détection automatique du mode

```javascript
// Dans PipelineAssistant.jsx — avant d'envoyer à l'API
const isModification = currentNodes.length > 0  // pipeline non vide

// Envoyer le pipeline actuel en contexte
const payload = {
  message: userMessage,
  conversation_history: history,
  current_pipeline: isModification ? {
    nodes: currentNodes,
    edges: currentEdges,
    config: currentConfig
  } : null
}
```

### Indicateur visuel dans l'assistant

Selon le mode détecté, afficher un badge dans l'assistant :
- Pipeline vide → badge `🆕 Nouveau pipeline`
- Pipeline existant → badge `✏️ Modification de [nom du pipeline]`

### Bouton "Appliquer" — comportement selon le mode

- **Nouveau pipeline** : remplace tout le canvas
- **Modification** : merge intelligent — remplace les nœuds modifiés, conserve les positions des nœuds non modifiés

```javascript
const applyPipeline = (newCog) => {
  if (isModification) {
    // Conserver les positions des nœuds existants
    const existingPositions = {}
    currentNodes.forEach(n => { existingPositions[n.id] = n.position })

    const newNodes = newCog.nodes.map(n => ({
      ...cogNodeToReactFlow(n),
      position: existingPositions[n.id] || autoLayout(n)  // garder position si nœud existant
    }))
    setNodes(newNodes)
    setEdges(newCog.edges.map(cogEdgeToReactFlow))
  } else {
    // Nouveau pipeline — layout automatique
    setNodes(newCog.nodes.map((n, i) => ({
      ...cogNodeToReactFlow(n),
      position: { x: i * 220, y: 200 }
    })))
    setEdges(newCog.edges.map(cogEdgeToReactFlow))
  }
}
```

---

## 4. Liste des pipelines sauvegardés

### Dans la sidebar principale (Sidebar.jsx)

Ajouter une section "Pipelines" dans la sidebar gauche de l'app :

```
📋 PIPELINES
  + Nouveau pipeline
  ─────────────────
  🔧 RAG + Analyse Mistral     [···]
  🔧 Web Search + Fact-check   [···]
  🔧 Multiagent parallèle      [···]
```

- Clic sur un pipeline → ouvre le PipelineEditor avec ce pipeline chargé
- `[···]` → menu contextuel : Dupliquer, Exporter .cog, Supprimer

---

## 5. Critères de validation

- [ ] Layout 3 colonnes en place (assistant gauche, canvas centre, config droite)
- [ ] Config nœud masquée par défaut, visible au clic sur un nœud
- [ ] Pipelines sauvegardés en TinyDB avec `cog` complet
- [ ] Rechargement d'un pipeline restaure nœuds ET edges
- [ ] Auto-save 30s avec indicateur `● Non sauvegardé` / `✓ Sauvegardé`
- [ ] Assistant reçoit le pipeline actuel en contexte
- [ ] "ajoute un nœud X" → l'assistant génère le .cog modifié avec le nouveau nœud
- [ ] "remplace X par Y" → l'assistant met à jour le nœud concerné
- [ ] Bouton Appliquer conserve les positions des nœuds non modifiés
- [ ] Badge 🆕 / ✏️ dans l'assistant selon le mode
- [ ] Liste des pipelines dans la sidebar principale

---

## 6. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `frontend/src/components/PipelineEditor.jsx` | Layout 3 colonnes, auto-save, indicateur sauvegarde |
| `frontend/src/components/PipelineEditor.css` | CSS 3 colonnes |
| `frontend/src/components/PipelineAssistant.jsx` | Mode création/modification, pipeline en contexte |
| `frontend/src/components/Sidebar.jsx` | Section pipelines sauvegardés |
| `frontend/src/api/routes.js` | Routes pipelines CRUD |
| `backend/main.py` | Routes GET/POST/PATCH/DELETE /pipelines |
| `backend/storage.py` | CRUD pipelines TinyDB |
