# BRIEF_RAG_SPLITVIEW — Vue double : Explorateur PC ↔ Arbre RAG

## Contexte

Remplacer le bouton "+ Uploader" par une vue split :
- **Gauche** : explorateur de fichiers local (navigateur de dossiers PC)
- **Droite** : arbre RAG existant (react-arborist)
- L'user glisse un fichier du panneau gauche vers un dossier du panneau droit → upload

---

## 1. Layout général

```
┌──────────────────────┬──────────────────────────────────┐
│  📂 Explorateur PC   │  📁 Mémoire RAG                  │
│  ──────────────────  │  ──────────────────────────────  │
│  > Documents         │  > COMPTA          0 docs         │
│    > Projets         │  > développement   1 doc          │
│      fichier.pdf     │  > testouille      0 docs         │
│      rapport.docx    │    └ testouille2   0 docs         │
│  > Bureau            │  > toto2           0 docs         │
│  > Téléchargements   │                                   │
│                      │                                   │
│  ← drag depuis ici   │  → drop ici                      │
└──────────────────────┴──────────────────────────────────┘
```

- Chaque panneau prend **50% de la largeur**
- Hauteur : `calc(100vh - 200px)` avec scroll interne indépendant
- Séparateur vertical entre les deux panneaux

---

## 2. Panneau gauche — Explorateur PC (File System Access API)

Utiliser la **File System Access API** du navigateur (Chrome/Edge) :

```javascript
const dirHandle = await window.showDirectoryPicker();
```

### Comportement
- Au premier affichage : bouton "📂 Choisir un dossier à explorer"
- L'user choisit un dossier racine → l'arbre se construit
- Navigation : clic sur un sous-dossier → expand/collapse
- Filtrer : n'afficher que PDF, DOCX, TXT, MD — masquer les fichiers cachés (`.`)

### Affichage des nœuds
- 📁 dossiers, 📕 .pdf, 📘 .docx, 📄 .txt .md
- Afficher nom + taille pour les fichiers

### Drag depuis le panneau gauche
```javascript
const handleDragStart = (e, fileHandle) => {
  e.dataTransfer.effectAllowed = 'copy';
  // FileHandle non sérialisable → stocker dans state partagé
  setDraggedFileHandle(fileHandle);
};
```

---

## 3. Panneau droit — Arbre RAG (react-arborist existant)

Conserver l'arbre RAG tel quel.
Adapter `handleDrop` sur les nœuds dossiers pour les deux sources :

```javascript
const handleDrop = async (e, folderId) => {
  e.preventDefault();
  setIsDragOver(false);

  // Source : panneau PC (handle en state)
  if (draggedFileHandle) {
    const file = await draggedFileHandle.getFile();
    uploadFiles([file], folderId);
    setDraggedFileHandle(null);
    return;
  }

  // Source : Windows Explorer natif (fallback)
  if (e.dataTransfer.files.length > 0) {
    uploadFiles(Array.from(e.dataTransfer.files), folderId);
  }
};
```

---

## 4. Compatibilité navigateur

File System Access API = Chrome/Edge uniquement (pas Firefox).

```javascript
const isSupported = 'showDirectoryPicker' in window;
```

Si non supporté → afficher dans le panneau gauche :
> "L'explorateur de fichiers nécessite Chrome ou Edge.
> Vous pouvez glisser des fichiers directement depuis l'explorateur Windows."

---

## 5. State partagé

Dans `RAGTab.jsx` :
```javascript
const [draggedFileHandle, setDraggedFileHandle] = useState(null);
// Passé en props aux deux panneaux
```

---

## 6. Critères de validation

- [ ] Layout split 50/50, scroll indépendant dans chaque panneau
- [ ] Bouton "Choisir un dossier" → ouvre le picker système
- [ ] Arbre PC navigable (expand/collapse)
- [ ] Seuls PDF, DOCX, TXT, MD affichés côté PC
- [ ] Drag fichier PC → drop dossier RAG → upload + toast + refresh arbre
- [ ] Drop natif Windows Explorer → dossier RAG fonctionne (fallback)
- [ ] Message compatibilité si non Chrome/Edge
- [ ] Bouton "+ Uploader" toolbar conservé comme fallback ultime

---

## 7. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `frontend/src/components/AdminPanel/RAGTab.jsx` | Layout split + state draggedFileHandle |
| `frontend/src/components/AdminPanel/RAGPCExplorer.jsx` | Nouveau — panneau gauche |
| `frontend/src/components/AdminPanel/RAGNodeRenderer.jsx` | Adapter handleDrop deux sources |
