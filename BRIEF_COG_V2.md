# BRIEF_COG_V2 — Grammaire .cog + Export/Import + Assistant Pipeline

## Contexte

La grammaire `.cog` est le format de pipeline reproductible de LLM Council.
Un fichier `.cog` décrit un pipeline DAG complet — nœuds, connexions, paramètres —
exportable, partageable, versionnable et exécutable directement par le backend.

Ce brief couvre :
1. La spécification JSON de la grammaire `.cog`
2. L'export/import JSON dans le PipelineEditor
3. L'assistant pipeline (sidebar droite) avec in-context learning

---

## 1. Spécification JSON — Grammaire .cog

### Structure racine

```json
{
  "cog_version": "1.0",
  "name": "Analyse documentaire RAG",
  "description": "Recherche dans la mémoire RAG puis synthèse par Chairman",
  "author": "admin",
  "created_at": "2026-03-24T10:00:00Z",
  "tags": ["rag", "analyse", "documentation"],
  "nodes": [...],
  "edges": [...],
  "config": {
    "language": "fr",
    "timeout_global": 300,
    "chairman": "mistralai/mistral-medium-3"
  }
}
```

### Types de nœuds

#### Nœud LLM
```json
{
  "id": "llm_1",
  "type": "llm",
  "label": "Analyse initiale",
  "model": "mistralai/mistral-medium-3",
  "system_prompt": "Tu es un expert en analyse de documents.",
  "temperature": 0.7,
  "max_tokens": 2000,
  "stream": true
}
```

#### Nœud LLM Local (Ollama)
```json
{
  "id": "local_1",
  "type": "llm_local",
  "label": "Résumé local",
  "model": "mistral:latest",
  "system_prompt": "Résume le document fourni.",
  "temperature": 0.5
}
```

#### Nœud RAG Search
```json
{
  "id": "rag_1",
  "type": "rag_search",
  "label": "Recherche documentation",
  "folder_id": "uuid-du-dossier",
  "folder_name": "développement",
  "limit": 5,
  "score_threshold": 0.3,
  "inject_as": "context"
}
```

#### Nœud Outil — Web Search
```json
{
  "id": "tool_1",
  "type": "tool",
  "tool_type": "web_search",
  "label": "Recherche web",
  "max_results": 5
}
```

#### Nœud Outil — Fact Check
```json
{
  "id": "tool_2",
  "type": "tool",
  "tool_type": "fact_check",
  "label": "Vérification des faits"
}
```

#### Nœud MCP
```json
{
  "id": "mcp_1",
  "type": "mcp",
  "label": "Données gouv.fr",
  "server_url": "https://data.gouv.fr/mcp",
  "tool_name": "search_datasets",
  "params": {
    "query": "{{user_input}}",
    "page_size": 5
  },
  "auth": {
    "type": "none"
  }
}
```

#### Nœud Condition (contrôle)
```json
{
  "id": "cond_1",
  "type": "condition",
  "label": "Vérification qualité",
  "condition": "output.confidence > 0.8",
  "branch_true": "llm_2",
  "branch_false": "llm_3"
}
```

#### Nœud Merge
```json
{
  "id": "merge_1",
  "type": "merge",
  "label": "Fusion des réponses",
  "strategy": "concatenate",
  "separator": "\n\n---\n\n"
}
```

#### Nœud Input (point d'entrée)
```json
{
  "id": "input",
  "type": "input",
  "label": "Question utilisateur"
}
```

#### Nœud Output (point de sortie)
```json
{
  "id": "output",
  "type": "output",
  "label": "Réponse finale",
  "format": "markdown"
}
```

### Edges (connexions)

```json
{
  "edges": [
    { "id": "e1", "from": "input",  "to": "rag_1"  },
    { "id": "e2", "from": "rag_1",  "to": "llm_1"  },
    { "id": "e3", "from": "llm_1",  "to": "merge_1"},
    { "id": "e4", "from": "merge_1","to": "output" }
  ]
}
```

### Variables dynamiques

Les nœuds peuvent référencer des variables avec `{{variable}}` :
- `{{user_input}}` — la question de l'utilisateur
- `{{context}}` — le contexte RAG injecté
- `{{previous_output}}` — la sortie du nœud précédent
- `{{conversation_history}}` — l'historique de la conversation

---

## 2. Backend — Parser .cog

### Nouveau fichier : `backend/cog_parser.py`

```python
import json
from typing import dict, list, Any
from backend.errors import api_error

SUPPORTED_NODE_TYPES = {
    "input", "output", "llm", "llm_local", "rag_search",
    "tool", "mcp", "condition", "merge"
}

def parse_cog(content: str | dict) -> dict:
    """Parse et valide un fichier .cog JSON."""
    if isinstance(content, str):
        try:
            data = json.loads(content)
        except json.JSONDecodeError as e:
            api_error("COG_INVALID_JSON", f"JSON invalide : {e}", status=400)
    else:
        data = content

    # Validation version
    if data.get("cog_version") not in ("1.0",):
        api_error("COG_UNSUPPORTED_VERSION", f"Version {data.get('cog_version')} non supportée")

    # Validation nœuds
    for node in data.get("nodes", []):
        if node.get("type") not in SUPPORTED_NODE_TYPES:
            api_error("COG_UNKNOWN_NODE", f"Type de nœud inconnu : {node.get('type')}")

    # Vérifier qu'il y a un nœud input et un nœud output
    types = [n["type"] for n in data.get("nodes", [])]
    if "input" not in types:
        api_error("COG_MISSING_INPUT", "Le pipeline doit avoir un nœud 'input'")
    if "output" not in types:
        api_error("COG_MISSING_OUTPUT", "Le pipeline doit avoir un nœud 'output'")

    return data

def cog_to_dag(cog: dict) -> dict:
    """Convertit un .cog en format DAG interne pour dag_engine.py"""
    return {
        "nodes": cog["nodes"],
        "edges": cog["edges"],
        "config": cog.get("config", {}),
    }

def dag_to_cog(dag: dict, meta: dict) -> dict:
    """Convertit un pipeline DAG existant en format .cog exportable"""
    return {
        "cog_version": "1.0",
        "name": meta.get("name", "Pipeline sans nom"),
        "description": meta.get("description", ""),
        "author": meta.get("author", "admin"),
        "created_at": meta.get("created_at", ""),
        "tags": meta.get("tags", []),
        "nodes": dag.get("nodes", []),
        "edges": dag.get("edges", []),
        "config": dag.get("config", {}),
    }
```

### Nouvelles routes dans `backend/main.py`

```
POST /api/v1/pipelines/import-cog     # Importer un .cog → créer/mettre à jour pipeline
GET  /api/v1/pipelines/{id}/export-cog # Exporter un pipeline → fichier .cog JSON
POST /api/v1/pipelines/validate-cog   # Valider un .cog sans l'importer
```

---

## 3. Frontend — Export/Import dans PipelineEditor

### Boutons dans la toolbar du PipelineEditor

```
[← Retour]  [Nom du pipeline]  ...  [📥 Importer JSON]  [📤 Exporter JSON]  [💾 Sauvegarder]
```

### Export JSON

Clic sur "📤 Exporter JSON" :
1. Appel `GET /api/v1/pipelines/{id}/export-cog`
2. Téléchargement automatique du fichier `nom-du-pipeline.cog.json`

### Import JSON

Clic sur "📥 Importer JSON" :
1. File picker → accepte `.json` et `.cog`
2. Afficher un aperçu du pipeline (nom, description, nombre de nœuds)
3. Bouton "Confirmer l'import"
4. Appel `POST /api/v1/pipelines/import-cog`
5. Rafraîchissement de l'éditeur avec le nouveau pipeline

### Copier/Coller JSON

- Bouton "📋 Copier JSON" → copie le JSON du pipeline dans le presse-papier
- Zone de texte "Coller JSON" → paste direct → validation + import immédiat
- Utile pour partager un pipeline par message ou email

---

## 4. Assistant Pipeline — Sidebar droite

### UI

- Icône 🤖 dans la toolbar du PipelineEditor → ouvre/ferme la sidebar (300px)
- Sidebar divisée en deux zones :
  - **Zone chat** (70%) — historique de la conversation avec l'assistant
  - **Zone aperçu** (30%) — preview JSON du pipeline suggéré

### Comportement

1. L'user décrit en langage naturel ce qu'il veut :
   > "Crée un pipeline qui cherche dans le dossier RH, puis analyse avec Claude et vérifie les faits"

2. L'assistant génère un `.cog` JSON valide

3. Le JSON apparaît dans la zone aperçu avec un bouton **"Appliquer au pipeline"**

4. Clic → le PipelineEditor se met à jour avec les nouveaux nœuds

### Prompt système de l'assistant

```
Tu es un expert en construction de pipelines LLM Council.
Tu aides l'utilisateur à créer des pipelines DAG en générant du JSON au format .cog v1.0.

Grammaire .cog disponible :
- type "llm" : nœud LLM cloud (OpenRouter)
- type "llm_local" : nœud LLM local (Ollama)
- type "rag_search" : recherche dans la mémoire RAG
- type "tool" : outil (web_search, fact_check)
- type "mcp" : appel serveur MCP externe
- type "condition" : branchement conditionnel
- type "merge" : fusion de plusieurs sorties
- type "input" : point d'entrée (obligatoire)
- type "output" : point de sortie (obligatoire)

Variables disponibles : {{user_input}}, {{context}}, {{previous_output}}

Règles :
1. Toujours inclure un nœud "input" et un nœud "output"
2. Les edges connectent les nœuds dans l'ordre d'exécution
3. Répondre UNIQUEMENT avec un JSON valide, sans texte autour
4. Utiliser des id courts et descriptifs (ex: "rag_docs", "llm_analyse")

Exemples de pipelines disponibles dans le contexte ci-dessous :
[FEW-SHOT EXAMPLES INJECTÉS ICI]
```

### Exemples few-shot (à créer dans `backend/cog_examples/`)

Créer 3 fichiers d'exemple :
- `exemple_rag_analyse.cog.json` — RAG + LLM analyse
- `exemple_web_factcheck.cog.json` — Web search + fact-check + synthèse
- `exemple_multiagent.cog.json` — Multiple LLMs + merge + Chairman

Ces exemples sont injectés dans le prompt de l'assistant pour le guider.

### Route backend pour l'assistant

```
POST /api/v1/pipelines/assistant
Body : {
  "message": "Crée un pipeline RAG + analyse",
  "conversation_history": [...],
  "current_pipeline": {...}   // pipeline actuel pour contexte
}
Response : {
  "message": "Voici le pipeline suggéré...",
  "cog": {...}   // JSON .cog généré
}
```

---

## 5. Critères de validation

- [ ] `backend/cog_parser.py` créé et fonctionnel
- [ ] Route `POST /api/v1/pipelines/import-cog` fonctionnelle
- [ ] Route `GET /api/v1/pipelines/{id}/export-cog` fonctionnelle
- [ ] Route `POST /api/v1/pipelines/validate-cog` fonctionnelle
- [ ] Boutons Export/Import dans toolbar PipelineEditor
- [ ] Téléchargement fichier `.cog.json` à l'export
- [ ] Import depuis fichier et depuis copier/coller fonctionnel
- [ ] Sidebar assistant s'ouvre/ferme dans PipelineEditor
- [ ] Assistant génère un `.cog` JSON valide depuis description naturelle
- [ ] Bouton "Appliquer au pipeline" met à jour l'éditeur
- [ ] 3 fichiers exemples few-shot créés dans `backend/cog_examples/`

---

## 6. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `backend/cog_parser.py` | Nouveau |
| `backend/cog_examples/` | Nouveau — 3 fichiers JSON |
| `backend/main.py` | Ajouter routes import/export/validate/assistant |
| `frontend/src/components/PipelineEditor.jsx` | Toolbar + import/export + copier/coller |
| `frontend/src/components/PipelineAssistant.jsx` | Nouveau — sidebar assistant |
| `frontend/src/api/routes.js` | Ajouter routes pipelines |
