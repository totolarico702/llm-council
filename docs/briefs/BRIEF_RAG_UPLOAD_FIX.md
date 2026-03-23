# BRIEF_RAG_UPLOAD_FIX — Zone upload + déplacement documents

## 1. Zone upload tronquée

### Problème
La zone "Upload — [dossier]" est trop petite verticalement, le contenu est coupé.

### Correction
- Hauteur minimale : **160px**
- La zone doit être entièrement visible sans scroll
- Afficher clairement : icône 📁 + texte "Glissez vos fichiers ici" + bouton "Choisir fichier(s)"
- Types acceptés affichés en petit : PDF, DOCX, TXT, MD

---

## 2. Déplacement de document entre dossiers (drag & drop)

### Comportement attendu
- L'user peut **glisser un document** depuis son dossier actuel vers un autre dossier dans l'arbre
- Pendant le drag : le dossier cible se met en surbrillance au hover
- Au drop : le document est déplacé vers le nouveau dossier
  - Mettre à jour `folder_id` du document dans TinyDB
  - Pas besoin de réindexer dans LanceDB (les chunks restent valides, seul le `folder_id` change)
- Si le dossier cible n'est pas accessible en écriture pour l'user → refuser avec message toast

### Route backend à créer
```
PATCH /api/rag/documents/{id}/move
Body : { "folder_id": "nouveau_folder_id" }
```
- Vérifie que l'user a accès `write` sur le dossier cible
- Met à jour `folder_id` dans TinyDB
- Met à jour le metadata `folder_id` dans LanceDB pour les chunks du document
- Logge dans `rag_audit_log` : action `document_moved`, details `{ from: ancien_id, to: nouveau_id }`

### Implémentation dans react-arborist
react-arborist supporte le drag & drop nativement via la prop `onMove`.
Utiliser ce callback pour appeler `PATCH /api/rag/documents/{id}/move` :

```javascript
const onMove = ({ dragIds, parentId }) => {
  // dragIds = [document_id]
  // parentId = nouveau folder_id
  moveDocument(dragIds[0], parentId);
};
```

Désactiver le drag & drop sur les dossiers eux-mêmes (pas de déplacement de dossier pour l'instant).

---

## Critères de validation
- [ ] Zone upload visible entièrement, hauteur min 160px
- [ ] Drag & drop document vers dossier fonctionne
- [ ] Dossier cible se met en surbrillance au hover pendant le drag
- [ ] `folder_id` mis à jour dans TinyDB et LanceDB après déplacement
- [ ] Action loggée dans audit log
- [ ] Déplacement de dossiers désactivé (documents uniquement)

---

## Fichiers concernés
| Fichier | Modification |
|---------|-------------|
| `frontend/src/components/AdminPanel/RAGUploadZone.jsx` | Fix hauteur |
| `frontend/src/components/AdminPanel/RAGTab.jsx` | Activer onMove sur l'arbre |
| `backend/rag_store.py` ou `rag_documents.py` | Route PATCH move |
| `backend/main.py` | Enregistrer la route |
