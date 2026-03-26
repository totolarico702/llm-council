# BRIEF_V2_CLOSE — Clôture complète V2
## Parties indépendantes — exécuter une par une

---

## Partie 1 — Redesign "Salle de Conseil"

### Contexte
Appliquer le design system défini dans `BRIEF_DESIGN_COUNCIL.md`.
Direction : publication financière haut de gamme — Playfair Display + JetBrains Mono + filet doré.
Fond noir profond, accent unique or/laiton `#b8941f`, zéro violet/bleu.

### 1.1 — Ajouter les fonts dans index.html

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,600&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
```

### 1.2 — Remplacer variables.css

Remplacer intégralement `frontend/src/styles/variables.css` avec les variables du `BRIEF_DESIGN_COUNCIL.md` — palette noir profond, or, typographie Playfair/JetBrains.

### 1.3 — Créer animations.css

Créer `frontend/src/styles/animations.css` avec :
- `message-appear` — fade + slide 6px pour les nouveaux messages
- `pulse-green` — pulsation douce pour les status dots actifs
- `gold-pulse` — lueur dorée pour les boutons primaires au hover
- `shimmer` — skeleton loading pendant les appels LLM
- Import dans `main.jsx`

### 1.4 — LoginPage

Restyler `LoginPage.css` / `LoginPage.jsx` :
- Fond `#0a0a0a` avec pattern diagonal doré subtil
- Card centrée, bordure top `2px solid var(--color-gold)`
- Titre "LLM Council" en Playfair Display black
- Sous-titre italic doré
- Input et bouton selon le design system

### 1.5 — Sidebar

Restyler `Sidebar.css` / `Sidebar.jsx` :
- Logo "LLM Council" en Playfair Display black, "Council" en or
- Filet doré sous le logo (`border-bottom: 1px solid var(--color-gold)`)
- Section titles en JetBrains Mono uppercase espacé, couleur disabled
- Items avec accent gauche doré quand actif
- Scrollbar fine et dorée

### 1.6 — ChatInterface

Restyler `ChatInterface.css` / `ChatInterface.jsx` :
- Messages user en Playfair Display italic (la question posée = éditoriale)
- Noms des modèles LLM en Playfair italic doré
- Messages Chairman avec bordure gauche dorée + légère lueur
- Messages autres LLM avec bordure gauche `--color-border`
- Input chat : fond `--color-surface-inset`, focus ring doré
- Barre d'outils bas : fond `--color-surface`, séparateur top doré

### 1.7 — AdminPanel

Restyler `AdminPanel.css` / `AdminPanel.jsx` :
- Onglets en JetBrains Mono uppercase, actif souligné or
- Cards avec `border-top: 1px solid var(--color-border)` et hover doré
- Tableaux avec lignes alternées subtiles
- Badges statut selon design system (gold, active, danger)

### 1.8 — PipelineEditor

Restyler `PipelineEditor.css` / `PipelineEditor.jsx` :
- Canvas : fond `--color-bg`, grille points `--color-border-muted`
- Nœuds : `--color-surface`, border `--color-border`, hover/selected doré
- Nœud Chairman : header avec accent doré
- Connexions : `stroke: var(--color-border-accent)`, selected = or vif
- Toolbar : fond `--color-surface`, séparateur bottom `--color-border`
- Sidebar assistant : fond `--color-surface`, bordure right `--color-border`

### Critères validation Partie 1
- [ ] Playfair Display sur titres, noms modèles, messages user
- [ ] JetBrains Mono sur corps, labels, boutons, inputs
- [ ] Filet doré dans sidebar et cards
- [ ] Login card avec barre top dorée
- [ ] Messages Chairman avec bordure gauche dorée
- [ ] Nœuds pipeline hover/selected doré
- [ ] Scrollbar fine et dorée
- [ ] Skeleton loading sur appels LLM
- [ ] Status dots animés
- [ ] Zéro couleur violette ou bleue

---

## Partie 2 — Audit et réécriture code original

### Contexte
Le projet est dérivé d'un repo sans licence (tous droits réservés par défaut).
L'auteur n'a pas répondu aux demandes de licence depuis plusieurs mois.
Objectif : identifier et réécrire les dernières traces du code original
pour pouvoir poser une licence commerciale propre sur LLM Council.

### 2.1 — Audit git

Identifier les fichiers qui existaient dans le commit initial vs ce qui a été écrit depuis :

```bash
# Lister les fichiers du premier commit
git show --stat $(git rev-list --max-parents=0 HEAD)

# Comparer avec l'état actuel
git diff $(git rev-list --max-parents=0 HEAD) HEAD --name-only
```

Produire un tableau :
```
Fichier | Origine | % réécrit estimé | Action requise
```

### 2.2 — Réécriture council.py

`council.py` est le fichier le plus susceptible de contenir du code original
(logique de délibération 3 stages).

Réécrire from scratch avec une approche différente :
- Même fonctionnalité (Stage 1 / Stage 2 anonymisé / Stage 3 Chairman)
- Architecture différente : classes plutôt que fonctions, ou l'inverse
- Commentaires entièrement nouveaux en anglais
- Aucune variable/fonction avec le même nom que l'original

Structure cible :
```python
# backend/council.py — LLM Council deliberation engine
# Copyright 2026 — [ton nom/société]

class DeliberationSession:
    """Manages a 3-stage multi-LLM deliberation."""
    
    async def gather_opinions(self, query, models, context) -> list[Opinion]:
        """Stage 1: Collect independent opinions from all council members."""
        
    async def peer_review(self, opinions) -> list[Review]:
        """Stage 2: Anonymous cross-evaluation of opinions."""
        
    async def synthesize(self, opinions, reviews, chairman) -> str:
        """Stage 3: Chairman synthesizes final response."""
```

### 2.3 — Vérification dag_engine.py

Le DAG engine a été massivement refactorisé — vérifier qu'il ne reste
aucune fonction avec le même nom/signature que l'original.
Si oui, renommer et restructurer.

### 2.4 — Vérification fichiers frontend

Vérifier `App.jsx`, `ChatInterface.jsx`, `Sidebar.jsx` — les composants
qui existaient dans le repo original. Identifier les blocs non réécrits
et les refactoriser.

### 2.5 — Header copyright

Ajouter en haut de chaque fichier backend réécrit :
```python
# Copyright 2026 [Ton Nom / Société]
# LLM Council — Multi-LLM Deliberation System
# Licensed under [LICENCE À DÉFINIR]
```

### Critères validation Partie 2
- [ ] Tableau audit git produit (fichiers originaux vs réécrits)
- [ ] `council.py` entièrement réécrit avec nouvelle architecture
- [ ] `dag_engine.py` vérifié, fonctions renommées si nécessaire
- [ ] Composants frontend originaux refactorisés
- [ ] Headers copyright ajoutés sur tous les fichiers backend
- [ ] Tests passent toujours après réécriture (`uv run pytest`)

---

## Partie 3 — Documentation finale V2

### 3.1 — CLAUDE.md

Mettre à jour `CLAUDE.md` à la racine pour refléter V2 complet :

```markdown
## Status — Mars 2026 — V2 Complète

### Nouvelles fonctionnalités V2
- Mode Caféine — validation humaine post-Chairman
- Grammaire .cog v1.0 — export/import/assistant pipeline
- DAG engine complet — RAG Search, Fact-check, MCP, Condition, Merge, parallèle, boucles
- PipelineEditor 3 colonnes — assistant copilote, persistance TinyDB, dropdown pipelines
- Design system "Salle de Conseil" — Playfair Display + JetBrains Mono + or
- Scoring qualité LLM — auto + manuel + widget AdminPanel
- Simulation coûts par pipeline — badge temps réel
- Client API centralisé — api/client.js + api/routes.js
- CSS centralisé — variables branding

### Fichiers clés V2 ajoutés
- backend/council.py — réécrit, DeliberationSession class
- backend/scorer.py — scoring qualité LLM
- backend/cost_estimator.py — simulation coûts
- backend/cog_parser.py — grammaire .cog
- backend/cog_examples/ — 3 pipelines exemples few-shot
- frontend/src/styles/ — design system complet
- frontend/src/api/ — client.js + routes.js
- frontend/src/components/PipelineAssistant.jsx
- frontend/src/components/CaffeineValidation.jsx

### Roadmap V3
- Licence commerciale (MIT + Commons Clause)
- Docker Compose + CI/CD GitHub Actions
- Multi-agents avec orchestration Claude Code
- Open-core publication
- Scoring LLM avancé (finetuning sur données usage)
```

### 3.2 — README.md

Mettre à jour le README :
1. Section "Fonctionnalités" — refléter V2 complète
2. Section "Stack technique" — ajouter scorer.py, cost_estimator.py, cog_parser.py
3. Section "Roadmap" — marquer V2 ✅, décrire V3
4. Section "Déploiement" — vérifier que deploy.bat/sh sont à jour

### 3.3 — deploy.bat et deploy.sh

Vérifier et mettre à jour les deux scripts :
```bash
# Dépendances V2 à ajouter si absentes
uv add slowapi structlog httpx
```

Vérifier que le message de fin liste bien les nouvelles URLs et fonctionnalités V2.

### 3.4 — .env.example

Vérifier que `.env.example` contient toutes les variables V2 :
```env
OPENROUTER_API_KEY=sk-or-v1-...
JWT_SECRET=changez-moi-en-production
PRODUCTION=0
FS_BROWSER_ROOT=C:/Users/VotreNom
RAG_UPLOAD_MAX_MB=100
RAG_AUDIT_RETENTION_DAYS=90
RAG_COLLECTION=llm_council_rag
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
VITE_API_BASE=http://localhost:8001
```

### Critères validation Partie 3
- [ ] CLAUDE.md mis à jour avec état V2 complet
- [ ] README mis à jour (fonctionnalités + stack + roadmap)
- [ ] deploy.bat et deploy.sh vérifiés avec dépendances V2
- [ ] .env.example complet et à jour

---

## Partie 4 — Tag git v2.0

### 4.1 — Commit final

```bash
git add .
git commit -m "chore: V2 complete - design system, license-clean rewrite, docs update"
```

### 4.2 — Tag v2.0

```bash
git tag -a v2.0 -m "LLM Council V2.0

Fonctionnalités V2 :
- Mode Caféine (validation humaine post-Chairman)
- Grammaire .cog v1.0 (export/import/assistant pipeline)
- DAG engine complet (RAG, Fact-check, MCP, Condition, Merge, parallèle, boucles)
- PipelineEditor 3 colonnes (assistant copilote, persistance, dropdown)
- Design system Salle de Conseil (Playfair Display + JetBrains Mono + or)
- Scoring qualité LLM (auto + manuel)
- Simulation coûts par pipeline
- Client API centralisé
- Auth sécurisée (JWT cookie, refresh token, tests 80%+)
- API versionnée /api/v1/
- Code original réécrit (council.py, dag_engine.py)
"

git push origin main
git push origin v2.0
```

### Critères validation Partie 4
- [ ] Commit propre avec message descriptif
- [ ] Tag v2.0 créé localement
- [ ] Tag pushé sur GitHub
- [ ] Release visible sur github.com/totolarico702/llm-council/releases
