# BRIEF_V2_FINAL — Clôture V2

---

## Partie 1 — CSS centralisé + variables branding

### Objectif
Regrouper tout le CSS de l'application dans une architecture centralisée avec variables CSS
pour faciliter le branding client à terme.

### Structure cible

```
frontend/src/styles/
├── variables.css      ← toutes les variables CSS (couleurs, fonts, spacing, radius)
├── reset.css          ← reset/normalize minimal
├── components.css     ← styles génériques réutilisables (boutons, inputs, badges, cards)
├── layout.css         ← grilles, flexbox, conteneurs
└── themes/
    └── dark.css       ← thème dark actuel (surcharge des variables)
```

### variables.css — variables à définir

```css
:root {
  /* Couleurs principales */
  --color-primary:        #6366f1;
  --color-primary-hover:  #4f46e5;
  --color-accent:         #22d3ee;
  --color-success:        #22c55e;
  --color-warning:        #f59e0b;
  --color-danger:         #ef4444;

  /* Backgrounds */
  --color-bg:             #0f1117;
  --color-surface:        #1a1d2e;
  --color-surface-2:      #232640;
  --color-border:         #2e3155;

  /* Texte */
  --color-text:           #e2e8f0;
  --color-text-muted:     #94a3b8;
  --color-text-disabled:  #4b5563;

  /* Typography */
  --font-main:            'Inter', system-ui, sans-serif;
  --font-mono:            'JetBrains Mono', 'Fira Code', monospace;
  --font-size-sm:         12px;
  --font-size-base:       14px;
  --font-size-lg:         16px;
  --font-size-xl:         20px;

  /* Spacing */
  --spacing-xs:           4px;
  --spacing-sm:           8px;
  --spacing-md:           16px;
  --spacing-lg:           24px;
  --spacing-xl:           32px;

  /* Radius */
  --radius-sm:            4px;
  --radius-md:            8px;
  --radius-lg:            12px;
  --radius-full:          9999px;

  /* Shadows */
  --shadow-sm:            0 1px 3px rgba(0,0,0,0.3);
  --shadow-md:            0 4px 12px rgba(0,0,0,0.4);
  --shadow-lg:            0 8px 24px rgba(0,0,0,0.5);

  /* Transitions */
  --transition-fast:      0.15s ease;
  --transition-normal:    0.25s ease;

  /* Sidebar */
  --sidebar-width:        240px;

  /* Pipeline editor */
  --pipeline-assistant-width: 260px;
  --pipeline-nodeconfig-width: 300px;
}
```

### Migration

1. Créer les fichiers dans `frontend/src/styles/`
2. Importer dans `frontend/src/main.jsx` :
   ```javascript
   import './styles/variables.css'
   import './styles/reset.css'
   import './styles/components.css'
   import './styles/layout.css'
   ```
3. Dans chaque fichier CSS existant (`App.css`, `AdminPanel.css`, `ChatInterface.css`, etc.)
   remplacer les valeurs hardcodées par les variables CSS correspondantes.
   Exemple : `background: #1a1d2e` → `background: var(--color-surface)`
4. Ne pas supprimer les fichiers CSS existants — les modifier pour utiliser les variables.
5. Vérifier que l'UI est identique après migration (pas de régression visuelle).

### Critères de validation
- [ ] `frontend/src/styles/variables.css` créé avec toutes les variables
- [ ] `frontend/src/styles/themes/dark.css` créé
- [ ] Import dans `main.jsx`
- [ ] Tous les fichiers CSS utilisent les variables (pas de couleurs hardcodées)
- [ ] UI identique avant/après migration

---

## Partie 2 — Scoring qualité LLM

### Objectif
Collecter un score de qualité par réponse LLM et agréger par modèle pour identifier
les modèles les plus performants sur les usages réels.

### Modèle de données — collection `llm_scores` (TinyDB)

```json
{
  "id": "uuid",
  "conversation_id": "uuid",
  "message_id": "uuid",
  "model": "mistralai/mistral-medium-3",
  "stage": "stage1 | stage2 | chairman",
  "user_id": "uuid",
  "timestamp": "ISO8601",
  "scores": {
    "relevance": 8,       // 1-10 — pertinence par rapport à la question
    "accuracy": 7,        // 1-10 — précision factuelle
    "format": 9,          // 1-10 — clarté et structure de la réponse
    "overall": 8          // 1-10 — note globale
  },
  "source": "user | auto"   // user = noté manuellement, auto = calculé
}
```

### Scoring automatique (auto)

À chaque réponse de Stage 3 (Chairman), calculer automatiquement un score via un LLM juge :

```python
# backend/scorer.py
async def auto_score_response(
    question: str,
    response: str,
    model: str
) -> dict:
    prompt = f"""Note cette réponse LLM sur 3 critères (score 1-10) :

Question posée : {question}
Réponse : {response}

Réponds UNIQUEMENT en JSON :
{{"relevance": X, "accuracy": X, "format": X, "overall": X, "reasoning": "..."}}"""

    result = await call_llm(
        model="mistralai/mistral-medium-3",  # modèle juge fixe
        prompt=prompt,
        temperature=0.1
    )
    return json.loads(result)
```

### Scoring manuel (user)

Dans le chat, sous chaque réponse du Chairman, ajouter des boutons de feedback discrets :

```
👍  👎  ⭐⭐⭐⭐⭐
```

- 👍 → score overall = 8, 👎 → score overall = 3
- ⭐ 1-5 → mappe sur 1-10 (×2)
- Clic → POST `/api/v1/scores` → sauvegarde en TinyDB

### Routes backend

```
POST /api/v1/scores                          # enregistrer un score
GET  /api/v1/scores/summary                  # agrégat par modèle
GET  /api/v1/scores/summary?model=xxx        # agrégat pour un modèle
GET  /api/v1/admin/scores                    # tous les scores (admin)
```

### Widget AdminPanel — onglet "État modèles"

Ajouter sous le panel état modèles existant un tableau de scoring :

```
┌──────────────────────────────────────────────────────────┐
│  Scoring qualité — 30 derniers jours                     │
├──────────────────┬──────────┬──────────┬────────┬────────┤
│  Modèle          │ Pertinence│ Précision│ Format │ Global │
├──────────────────┼──────────┼──────────┼────────┼────────┤
│ mistral-medium-3 │  8.2/10  │  7.9/10  │ 8.5/10 │ 8.2/10 │
│ claude-sonnet    │  8.7/10  │  8.4/10  │ 9.1/10 │ 8.7/10 │
│ gpt-4o           │  8.1/10  │  8.0/10  │ 8.3/10 │ 8.1/10 │
│ llama3.2:3b      │  6.2/10  │  5.8/10  │ 7.1/10 │ 6.4/10 │
└──────────────────┴──────────┴──────────┴────────┴────────┘
  N évaluations   Période : [7j] [30j] [90j]
```

### Critères de validation
- [ ] `backend/scorer.py` créé avec `auto_score_response()`
- [ ] Score auto calculé après chaque réponse Chairman
- [ ] Boutons 👍 👎 ⭐ dans le chat sous les réponses Chairman
- [ ] Routes POST/GET scores fonctionnelles
- [ ] Widget tableau scoring dans AdminPanel > État modèles
- [ ] Filtre par période (7j / 30j / 90j)

---

## Partie 3 — Simulation de coûts par pipeline

### Objectif
Afficher le coût estimé d'un pipeline avant son exécution, basé sur les modèles
configurés et une estimation des tokens.

### Logique de calcul

```python
# backend/cost_estimator.py

PRICE_PER_1K_TOKENS = {
    "mistralai/mistral-medium-3":   {"input": 0.0004, "output": 0.002},
    "anthropic/claude-sonnet-4-5":  {"input": 0.003,  "output": 0.015},
    "openai/gpt-4o":                {"input": 0.005,  "output": 0.015},
    "google/gemini-2.0-flash-001":  {"input": 0.0001, "output": 0.0004},
    "mistral:latest":               {"input": 0.0,    "output": 0.0},  # local = gratuit
}

DEFAULT_TOKENS = {
    "input": 500,   # tokens d'entrée estimés par nœud
    "output": 800,  # tokens de sortie estimés par nœud
}

def estimate_pipeline_cost(pipeline: dict) -> dict:
    total = 0.0
    node_costs = []

    for node in pipeline.get("nodes", []):
        if node["type"] not in ("llm", "llm_local", "tool"):
            continue

        model = node.get("model", "mistralai/mistral-medium-3")
        prices = PRICE_PER_1K_TOKENS.get(model, {"input": 0.001, "output": 0.002})

        cost = (
            DEFAULT_TOKENS["input"] / 1000 * prices["input"] +
            DEFAULT_TOKENS["output"] / 1000 * prices["output"]
        )
        total += cost
        node_costs.append({"node_id": node["id"], "model": model, "cost_usd": round(cost, 6)})

    return {
        "total_usd": round(total, 6),
        "total_credits": round(total, 6),
        "node_breakdown": node_costs,
        "disclaimer": "Estimation basée sur ~500 tokens input / ~800 tokens output par nœud"
    }
```

### Route backend

```
POST /api/v1/pipelines/estimate-cost
Body : { "pipeline": { "nodes": [...], "edges": [...] } }
Response : { "total_usd": 0.0042, "node_breakdown": [...], "disclaimer": "..." }
```

### UI — PipelineEditor

Ajouter un badge de coût estimé dans la toolbar du PipelineEditor :

```
[💰 ~$0.004 / requête]
```

- Mis à jour en temps réel à chaque modification du pipeline (debounce 1s)
- Clic sur le badge → popup détail par nœud :

```
┌─────────────────────────────────────┐
│  Coût estimé par requête            │
├──────────────────────┬──────────────┤
│  llm_1 (Mistral)     │  $0.0012    │
│  llm_2 (Claude)      │  $0.0028    │
│  fact_check (Mistral)│  $0.0012    │
├──────────────────────┼──────────────┤
│  TOTAL               │  $0.0052    │
└──────────────────────┴──────────────┘
  ~500 tokens input / ~800 tokens output par nœud
```

- Nœuds locaux Ollama affichés avec coût $0.00 (gratuit)

### Critères de validation
- [ ] `backend/cost_estimator.py` créé
- [ ] Route `POST /api/v1/pipelines/estimate-cost` fonctionnelle
- [ ] Badge `💰 ~$X.XXX` dans la toolbar PipelineEditor
- [ ] Popup détail par nœud au clic
- [ ] Mise à jour en temps réel (debounce 1s)
- [ ] Nœuds locaux affichés à $0.00

---

## Partie 4 — Mise à jour documentation + Tag git v2.0

### CLAUDE.md — mettre à jour

Mettre à jour `CLAUDE.md` à la racine pour refléter l'état V2 complet :

```markdown
## Status — 2026-03-25 — V2

**Nouvelles fonctionnalités V2 :**
- Mode Caféine (validation humaine post-Chairman)
- Grammaire .cog v1.0 (export/import/assistant pipeline)
- DAG engine complet (RAG Search, Fact-check, MCP, Condition, Merge, parallèle, boucles)
- PipelineEditor 3 colonnes + persistance TinyDB + modification par prompt
- CSS centralisé avec variables de branding
- Scoring qualité LLM (auto + manuel)
- Simulation de coûts par pipeline
- Client API centralisé (api/client.js + api/routes.js)

**Stack V2 ajouts :**
- backend/scorer.py — scoring qualité LLM
- backend/cost_estimator.py — simulation coûts
- backend/cog_parser.py — grammaire .cog
- frontend/src/styles/ — CSS centralisé
- frontend/src/components/PipelineAssistant.jsx
- frontend/src/components/CaffeineValidation.jsx
```

### README.md — mettre à jour

1. Mettre à jour la section "Fonctionnalités V1" → "Fonctionnalités V2"
2. Ajouter les nouvelles fonctionnalités V2
3. Mettre à jour la section Roadmap :
   - V2 → ✅ Terminé
   - V3 → en cours

### deploy.bat et deploy.sh — vérifier les dépendances

S'assurer que toutes les nouvelles dépendances sont installées :

```bash
uv add slowapi structlog httpx
```

Ajouter cette commande dans les deux scripts de déploiement si absente.

### Commits et tag

```bash
git add .
git commit -m "docs: update CLAUDE.md + README for V2 complete"

git tag -a v2.0 -m "LLM Council V2 - .cog pipelines, DAG agent engine, Caféine mode, scoring, cost estimation"
git push origin main
git push origin v2.0
```

### Critères de validation
- [ ] CLAUDE.md mis à jour avec l'état V2
- [ ] README mis à jour (fonctionnalités + roadmap)
- [ ] deploy.bat et deploy.sh vérifiés avec nouvelles dépendances
- [ ] Commit docs propre
- [ ] Tag v2.0 créé et pushé sur GitHub
