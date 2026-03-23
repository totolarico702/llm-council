# BRIEF_AUDIT_LLM_COUNCIL — Audit complet V1 + Prérequis V2/V3

## Contexte

LLM Council est une application intranet multi-LLM (FastAPI + React 18 + TinyDB + LanceDB + OpenRouter + Ollama).
Cet audit couvre l'ensemble de l'application V1 : bugs, UI cassée, fonctionnalités incomplètes, erreurs console/backend, performance.
En fin d'audit, produire une liste priorisée des prérequis techniques pour V2 et V3.

Stack :
- Backend : FastAPI port 8001 (`uv run python -m backend.main`)
- Frontend : React 18 + Vite port 5173 (`npm run dev`)
- BDD : TinyDB + LanceDB (`data/lancedb/`)
- LLM : OpenRouter (cloud) + Ollama port 11434 (local)
- Démarrage : `start.bat`

---

## Méthode d'audit

1. Démarrer le projet (`start.bat`)
2. Ouvrir la console navigateur (F12) avant chaque test — noter toutes les erreurs JS
3. Observer les logs backend en parallèle — noter toutes les erreurs FastAPI
4. Tester chaque section méthodiquement selon le plan ci-dessous
5. Produire le rapport final

---

## 1. Authentification & Gestion users

### Tests à effectuer
- [ ] Login admin → vérifie que le token est bien stocké et persistant
- [ ] Login user non-admin → vérifie l'isolation (pas d'accès AdminPanel)
- [ ] Déconnexion → vérifie que le token est bien effacé
- [ ] Création d'un nouvel utilisateur depuis AdminPanel > Utilisateurs
- [ ] Modification d'un utilisateur existant
- [ ] Suppression d'un utilisateur
- [ ] Changement de mot de passe
- [ ] Vérifier que les permissions (rag_write, rag_read, etc.) sont bien appliquées

### Points à vérifier
- Expiration du token : comportement quand il expire en cours de session
- Pas de fuite de données entre users (isolation TinyDB)

---

## 2. Interface Chat

### Tests à effectuer
- [ ] Envoyer un message simple avec le pipeline "Général"
- [ ] Vérifier que la réponse s'affiche correctement (streaming ou bloc)
- [ ] Tester chaque pipeline disponible (Code, Analyse, Écriture, local)
- [ ] Tester le pipeline "local" avec Ollama (mistral:latest)
- [ ] Créer une nouvelle conversation
- [ ] Renommer une conversation
- [ ] Supprimer une conversation
- [ ] Vérifier l'historique des conversations (persistance TinyDB)
- [ ] Tester les options Recherche web / Fact-check / Deep Research
- [ ] Tester le sélecteur de langue (FR forcé)
- [ ] Vérifier le compteur de tokens / solde OpenRouter affiché
- [ ] Tester l'upload de fichier (trombone) si présent
- [ ] Tester le Shift+Enter pour nouvelle ligne vs Enter pour envoyer

### Points à vérifier
- Erreurs console pendant le streaming
- Comportement si la réponse est longue (scroll automatique)
- Comportement si OpenRouter est indisponible (fallback)

---

## 3. Panel RAAD (sidebar RAG)

### Tests à effectuer
- [ ] Ouvrir le panel RAAD (icône droite)
- [ ] Vérifier que l'arborescence des dossiers s'affiche
- [ ] Naviguer dans les dossiers
- [ ] Rechercher un document (barre de recherche)
- [ ] Cliquer sur un document → vérifie que @mention s'insère dans le prompt
- [ ] Vérifier le tooltip au hover sur un document (aperçu 200 chars)
- [ ] Tester le drag & drop depuis l'explorateur Windows vers le panel
- [ ] Épingler/désépingler le panel

### Points à vérifier
- Re-render en boucle (tremblement) sur certains composants
- Comportement si aucun dossier accessible
- La @mention est-elle bien résolue à l'envoi du message

---

## 4. AdminPanel — tous les onglets

### 4.1 Onglet Utilisateurs
- [ ] Liste des users s'affiche
- [ ] Création / modification / suppression fonctionnelle
- [ ] Permissions éditables et sauvegardées

### 4.2 Onglet Services
- [ ] Liste des services s'affiche
- [ ] Création d'un service → vérifie qu'un dossier RAG racine est créé automatiquement
- [ ] Modification / suppression

### 4.3 Onglet Pipelines
- [ ] Liste des pipelines s'affiche
- [ ] Éditeur de pipeline (PipelineEditor) s'ouvre
- [ ] Ajout / suppression de nœuds
- [ ] Sauvegarde d'un pipeline modifié
- [ ] Nœud RAG Search présent et configurable

### 4.4 Onglet Droits
- [ ] Matrice de permissions s'affiche
- [ ] Modification d'un droit → sauvegardé

### 4.5 Onglet Modèles
- [ ] Liste des modèles OpenRouter s'affiche
- [ ] Modèle par défaut (mistral-medium-3) visible
- [ ] Fallback chain configurable

### 4.6 Onglet RAG
- [ ] Bandeau compact (LanceDB 🟢, chunks, archives) visible
- [ ] Section "Dossiers & Documents" — arborescence react-arborist fonctionnelle
- [ ] Créer un dossier racine
- [ ] Créer un sous-dossier
- [ ] Rename inline fonctionne
- [ ] Supprimer un dossier vide
- [ ] Supprimer un dossier non vide → message d'erreur explicite
- [ ] Upload document via drag & drop sur un dossier
- [ ] Upload document via bouton "+ Uploader"
- [ ] Réindexer un document
- [ ] Supprimer un document
- [ ] Déplacer un document (drag & drop entre dossiers)
- [ ] Exceptions ACL par dossier (drawer)
- [ ] Audit Log — filtres et export CSV fonctionnels
- [ ] Explorateur PC (panneau gauche) — navigation, drag vers RAG

### 4.7 Onglet État modèles
- [ ] Panel temps réel 🟢🟡🔴 s'affiche
- [ ] Refresh fonctionne

### 4.8 Onglet Local (Ollama)
- [ ] Liste des modèles Ollama installés
- [ ] Gestionnaire modèles Ollama fonctionnel

### 4.9 Onglet Liens dashboard
- [ ] Lien Comex partageable généré correctement
- [ ] Le lien fonctionne sans authentification

### 4.10 Onglet Paramètres
- [ ] Paramètres sauvegardés correctement

---

## 5. Dashboard Comex

### Tests à effectuer
- [ ] Ouvrir le lien dashboard (sans être connecté)
- [ ] Vérifier que l'interface est accessible en lecture seule
- [ ] Vérifier les données affichées (solde, usage, état modèles)
- [ ] Vérifier le rafraîchissement automatique

---

## 6. Erreurs console JS à documenter

Pour chaque section testée, noter :
- Message d'erreur exact
- Fichier et ligne (si disponible)
- Fréquence (one-shot, récurrent, en boucle)
- Impact (bloquant, dégradé, cosmétique)

---

## 7. Erreurs backend FastAPI à documenter

- Vérifier les logs au démarrage (erreurs lifespan)
- Noter toutes les routes qui retournent 4xx ou 5xx
- Vérifier les warnings TinyDB (thread-safety)
- Vérifier les erreurs LanceDB (indexation)

---

## 8. Performance

- [ ] Temps de chargement initial de l'app (> 3s = problème)
- [ ] Temps de réponse premier token LLM (OpenRouter)
- [ ] Temps d'indexation d'un document RAG
- [ ] Scroll fluide dans l'arborescence RAG (react-arborist)
- [ ] Pas de re-render excessif (React DevTools si disponible)

---

## 9. Livrable — Rapport d'audit

Produire le fichier `outputs/AUDIT_V1_REPORT.md` avec :

### Structure du rapport

```markdown
# AUDIT V1 — LLM Council

## Bugs bloquants (priorité 1)
Liste des bugs qui empêchent une fonctionnalité de fonctionner.

## Bugs dégradés (priorité 2)
Liste des bugs qui dégradent l'expérience sans bloquer.

## Bugs cosmétiques (priorité 3)
Liste des problèmes visuels mineurs.

## Fonctionnalités incomplètes
Liste des fonctionnalités partiellement implémentées.

## Erreurs console JS récurrentes
Liste avec fichier/ligne/fréquence/impact.

## Erreurs backend récurrentes
Liste avec route/code HTTP/fréquence/impact.

## Prérequis V2
Liste des éléments techniques à mettre en place AVANT de démarrer V2.

## Prérequis V3
Liste des éléments techniques à mettre en place AVANT de démarrer V3.
```

---

## 10. Prérequis V2 — éléments à évaluer

Claude Code doit évaluer si ces éléments sont déjà en place ou manquants :

**Architecture**
- [ ] CLAUDE.md à la racine (mémoire partagée agents)
- [ ] Tests unitaires backend (pytest) sur les routes critiques
- [ ] Tests d'intégration frontend (Vitest ou Playwright)
- [ ] Versioning API (`/api/v1/...`)
- [ ] Logging structuré backend (JSON logs, niveau configurable)
- [ ] Gestion d'erreurs cohérente (format uniforme des réponses d'erreur)

**RAG**
- [ ] RAG Session 1/2/3/4 complètes et stables
- [ ] Chunking configurable (taille chunk, overlap)
- [ ] Score threshold configurable par pipeline
- [ ] Metadata LanceDB cohérentes (folder_id, user_id, timestamp)

**Pipelines**
- [ ] Nœud RAG Search opérationnel dans PipelineEditor
- [ ] Trace d'exécution DAG complète et lisible
- [ ] Coût estimé par exécution de pipeline

**Auth**
- [ ] Refresh token (expiration gérée proprement)
- [ ] Rate limiting par user

---

## 11. Prérequis V3 — éléments à évaluer

**Grammaire cognitive .cog**
- [ ] Format .cog défini et documenté
- [ ] Parser .cog implémenté
- [ ] PipelineEditor capable d'exporter en .cog

**Mode Caféine**
- [ ] Mécanisme de validation post-Chairman défini
- [ ] Interface de validation implémentée

**Scoring qualité LLM**
- [ ] Métriques de scoring définies
- [ ] Collecte des scores par réponse
- [ ] Agrégation et affichage

**Infrastructure multi-agents**
- [ ] claude-code-mcp-enhanced configuré
- [ ] CLAUDE.md solide et à jour
- [ ] Système de briefs multi-agents testé

**Open-core**
- [ ] README complet rédigé
- [ ] CHANGELOG à jour
- [ ] Licence choisie et appliquée
- [ ] Données sensibles exclues du repo (.gitignore complet)
- [ ] Variables d'environnement documentées (.env.example)
- [ ] Premier commit git v1.0 tagué
