# BRIEF_RAG_UPLOAD_NATIVE — Drop fichiers sur nœuds arbre + suppression zone Upload

## Contexte

La zone Upload dédiée est buggée et non réparable rapidement. On la supprime.
Le drop de fichiers se fait directement sur les nœuds dossiers dans react-arborist.
Un bouton "+ Uploader" dans la toolbar reste comme fallback.

---

## 1. Supprimer la zone Upload

- Supprimer le composant `RAGUploadZone.jsx` et toutes ses références dans `RAGTab.jsx`
- Supprimer la section "Upload — [dossier]" de la page

---

## 2. Drop fichiers natif sur les nœuds dossiers

### Comportement attendu

- L'user glisse un ou plusieurs fichiers depuis l'explorateur Windows
- Il survole un dossier dans l'arbre → le dossier se met en surbrillance (highlight)
- Il lâche → upload dans ce dossier

### Implémentation dans le NodeRenderer

Ajouter les handlers drag natifs sur chaque nœud de type dossier :

```jsx
const FolderNode = ({ node, style, dragHandle }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Vérifier que ce sont des fichiers système (pas un drag interne arborist)
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e) => {
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      uploadFiles(files, node.data.id); // node.data.id = folder_id
    }
  };

  return (
    <div
      style={{
        ...style,
        background: isDragOver ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
        border: isDragOver ? '1px dashed #6366f1' : '1px solid transparent',
        borderRadius: '4px',
        transition: 'all 0.15s'
      }}
      ref={dragHandle}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      📁 {node.data.name}
      {/* icônes d'action existantes */}
    </div>
  );
};
```

### Fonction uploadFiles

```javascript
const uploadFiles = async (files, folderId) => {
  for (const file of files) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('folder_id', folderId);

    try {
      // Afficher un toast "Upload en cours : nom_fichier"
      await fetch('/api/rag/documents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      // Toast succès : "✅ nom_fichier indexé"
      // Rafraîchir l'arbre
      refreshTree();
    } catch (err) {
      // Toast erreur : "❌ Échec upload nom_fichier"
    }
  }
};
```

### Types acceptés — validation côté frontend avant upload

```javascript
const ACCEPTED_TYPES = ['.pdf', '.docx', '.txt', '.md'];
const validFiles = files.filter(f =>
  ACCEPTED_TYPES.some(ext => f.name.toLowerCase().endsWith(ext))
);
if (validFiles.length < files.length) {
  // Toast warning : "Certains fichiers ignorés (types non supportés)"
}
```

---

## 3. Bouton "+ Uploader" dans la toolbar — fallback

- Conserver un bouton "+ Uploader" dans la toolbar au-dessus de l'arbre
- Clic → `<input type="file" multiple hidden>` → file picker système
- Si aucun dossier sélectionné dans l'arbre → toast "Sélectionnez d'abord un dossier"
- Si dossier sélectionné → upload dans ce dossier via `uploadFiles(files, selectedFolderId)`

---

## 4. Feedback utilisateur — toasts

Utiliser le système de notification existant dans le projet (toast/snackbar).
Si aucun système n'existe, utiliser une div fixe en bas à droite avec auto-dismiss 3s.

Messages :
- `"⏳ Upload en cours : nom_fichier.pdf"`
- `"✅ nom_fichier.pdf indexé (N chunks)"`
- `"❌ Échec upload nom_fichier.pdf"`
- `"⚠️ Types non supportés ignorés"`
- `"📁 Sélectionnez d'abord un dossier"`

---

## 5. Distinction drag interne vs drag fichier système

react-arborist gère son propre drag & drop interne (déplacement de nœuds).
Il ne faut pas confondre les deux :

```javascript
// Dans handleDragOver — n'activer le highlight que pour des fichiers système
if (e.dataTransfer.types.includes('Files')) {
  setIsDragOver(true); // fichier Windows/Mac
}
// Si types ne contient pas 'Files' → c'est un drag interne arborist, ignorer
```

---

## 6. Critères de validation

- [ ] Zone Upload supprimée, plus aucune référence dans le code
- [ ] Glisser un fichier depuis l'explorateur Windows sur un dossier → highlight
- [ ] Drop → upload dans le bon dossier → toast succès + arbre rafraîchi
- [ ] Types non supportés → toast warning, fichiers ignorés
- [ ] Bouton "+ Uploader" toolbar fonctionne avec dossier sélectionné
- [ ] Bouton "+ Uploader" sans dossier sélectionné → toast explicite
- [ ] Drag interne arborist (déplacement nœuds) non perturbé

---

## 7. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `frontend/src/components/AdminPanel/RAGUploadZone.jsx` | Supprimer |
| `frontend/src/components/AdminPanel/RAGTab.jsx` | Supprimer référence UploadZone, ajouter bouton toolbar |
| `frontend/src/components/AdminPanel/RAGNodeRenderer.jsx` | Ajouter handlers drag natifs sur nœuds dossiers |
