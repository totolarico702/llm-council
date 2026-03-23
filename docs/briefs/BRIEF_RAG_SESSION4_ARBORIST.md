# BRIEF_RAG_SESSION4_ARBORIST_V2 — File Explorer react-arborist

## Contexte

Le bandeau supérieur est déjà corrigé ✅. Ce brief couvre uniquement :
- Remplacement du composant "Gestion des dossiers" par react-arborist
- Zone upload
- Drawer ACL
- Fixes useEffect et auto-création service

---

## 1. Installation

```bash
npm install react-arborist
```

---

## 2. Remplacement de la section "Gestion des dossiers"

### Structure de données

Transformer la réponse de `GET /api/rag/folders` en arbre react-arborist :

```javascript
// Dossiers : { id, name, children: [sous-dossiers + documents] }
// Documents : { id, name, isLeaf: true, size, uploaded_by, uploaded_at, chunk_count }
```

### Composant Tree

```jsx
import { Tree } from 'react-arborist';

<Tree
  data={treeData}
  onCreate={handleCreate}
  onRename={handleRename}
  onDelete={handleDelete}
  height={treeHeight}   // calc(100vh - 280px)
  rowHeight={32}
  indent={20}
>
  {NodeRenderer}
</Tree>
```

### NodeRenderer — rendu custom

**Dossier** :
```
📁 Nom du dossier    [nb docs]  [+] [✏️] [⚙️ ACL] [🗑️]
```

**Document** :
```
📄 nom_fichier.pdf    [taille]  [↺ réindexer] [🗑️]
```

- Les icônes apparaissent au **hover** sur le nœud
- `[+]` → créer sous-dossier → `POST /api/rag/folders`
- `[✏️]` → rename inline natif react-arborist → `PATCH /api/rag/folders/{id}`
- `[⚙️ ACL]` → ouvre le drawer ACL (voir section 3)
- `[🗑️]` dossier → confirmation modale → `DELETE /api/rag/folders/{id}` (bloqué si non vide, message explicite)
- `[🗑️]` document → confirmation modale → `DELETE /api/rag/documents/{id}`
- `[↺]` document → `POST /api/rag/documents/{id}/reindex` → spinner sur la ligne pendant traitement

### Bouton "+ Nouveau dossier racine"

- Conservé au-dessus de l'arbre (déjà présent)
- Crée un dossier à la racine → `POST /api/rag/folders` avec `parent_id: null`

---

## 3. Zone upload — sous l'arbre

- Drag & drop de fichiers sur un **dossier sélectionné** → upload dans ce dossier
- Bouton "+ Uploader des fichiers" → file picker → upload dans le dossier sélectionné
- Si aucun dossier sélectionné → message "Sélectionnez un dossier pour uploader"
- Types acceptés : PDF, DOCX, TXT, MD (affiché dans la zone)
- Upload multiple supporté
- Barre de progression par fichier
- Statut final : ✅ indexé (N chunks) / ❌ erreur avec message

---

## 4. Drawer ACL

- Clic sur `[⚙️ ACL]` d'un dossier → ouvre un **drawer** (panel latéral droit, ~360px)
- Contenu :
  - Rappel héritage : "Ce dossier hérite des permissions du service : **[nom_service]**"
  - Tableau des exceptions : entité (user/rôle) | niveau (read/write/none) | supprimer
  - Formulaire ajout exception : sélecteur user ou rôle + niveau + bouton "Ajouter"
- Fermeture : bouton ✕ ou clic en dehors
- Routes : `GET/PATCH/DELETE /api/rag/folders/{id}/acl`

---

## 5. Fix useEffect ACL

Le fetch ACL ne doit se déclencher que si `folder_id` change :

```javascript
useEffect(() => {
  if (!folderId) return;
  fetchAcl(folderId);
}, [folderId]);
```

---

## 6. Fix auto-création dossier RAG à la création de service

- `POST /api/services` → créer automatiquement dossier RAG racine du même nom
- Migration rétroactive dans `lifespan` : pour chaque service sans dossier RAG racine → en créer un
- Si échec → ne pas bloquer la création du service, juste logger un warning

---

## 7. Mapping API

| Action UI | Route backend |
|-----------|--------------|
| Charger l'arbre | `GET /api/rag/folders` + `GET /api/rag/documents?folder_id=xxx` |
| Créer dossier | `POST /api/rag/folders` |
| Renommer dossier | `PATCH /api/rag/folders/{id}` |
| Supprimer dossier | `DELETE /api/rag/folders/{id}` |
| Upload document | `POST /api/rag/documents` (multipart, champ `folder_id`) |
| Supprimer document | `DELETE /api/rag/documents/{id}` |
| Réindexer document | `POST /api/rag/documents/{id}/reindex` |
| ACL dossier | `GET/PATCH/DELETE /api/rag/folders/{id}/acl` |

---

## 8. Critères de validation

- [ ] L'arbre react-arborist affiche dossiers et documents
- [ ] Expand/collapse fonctionne
- [ ] Création sous-dossier via icône `[+]` au hover
- [ ] Rename inline natif fonctionne
- [ ] Suppression dossier bloquée si non vide
- [ ] Upload drag & drop et bouton fichier fonctionnels
- [ ] Réindexation avec spinner fonctionnelle
- [ ] Drawer ACL s'ouvre/ferme correctement
- [ ] Aucun re-render en boucle

---

## 9. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `frontend/src/components/AdminPanel/RAGTab.jsx` | Remplacer section dossiers par react-arborist |
| `frontend/src/components/AdminPanel/RAGNodeRenderer.jsx` | Nouveau |
| `frontend/src/components/AdminPanel/RAGAclDrawer.jsx` | Nouveau |
| `frontend/src/components/AdminPanel/RAGUploadZone.jsx` | Nouveau |
| `backend/services.py` | Auto-création dossier RAG après POST service |
| `backend/main.py` | Migration rétroactive dans lifespan |
