# BRIEF_RAG_PC_EXPLORER — Explorateur PC via FastAPI + react-arborist

## Contexte

Le panneau gauche "Explorateur PC" utilise la File System Access API du navigateur
qui est trop contraignante (compatibilité, pas de dossier par défaut, pas de retour arrière).

On remplace par une approche backend : un endpoint FastAPI expose le filesystem local,
le panneau gauche est un second arbre react-arborist branché sur cet endpoint.
Pas de nouvelle dépendance npm.

---

## 1. Backend — endpoint filesystem

### Nouveau fichier : `backend/fs_browser.py`

```python
import os
from fastapi import APIRouter, HTTPException, Depends
from backend.auth import get_current_user

router = APIRouter()

# Dossier racine autorisé — configurable dans .env
# Par défaut : dossier home de l'utilisateur Windows
import pathlib
DEFAULT_ROOT = str(pathlib.Path.home())

ALLOWED_EXTENSIONS = {'.pdf', '.docx', '.txt', '.md'}

def is_safe_path(root: str, path: str) -> bool:
    """Vérifier que le path demandé est bien dans le root autorisé."""
    real_root = os.path.realpath(root)
    real_path = os.path.realpath(path)
    return real_path.startswith(real_root)

@router.get("/api/fs/browse")
async def browse(path: str = None, current_user=Depends(get_current_user)):
    root = os.environ.get("FS_BROWSER_ROOT", DEFAULT_ROOT)
    target = path if path else root

    if not is_safe_path(root, target):
        raise HTTPException(status_code=403, detail="Accès refusé")

    if not os.path.isdir(target):
        raise HTTPException(status_code=404, detail="Dossier introuvable")

    items = []
    try:
        with os.scandir(target) as entries:
            for entry in sorted(entries, key=lambda e: (not e.is_dir(), e.name.lower())):
                # Ignorer fichiers cachés
                if entry.name.startswith('.'):
                    continue
                if entry.is_dir():
                    items.append({
                        "id": entry.path,
                        "name": entry.name,
                        "type": "folder",
                        "path": entry.path,
                        "children": []  # lazy loading
                    })
                elif entry.is_file():
                    ext = os.path.splitext(entry.name)[1].lower()
                    if ext in ALLOWED_EXTENSIONS:
                        size = entry.stat().st_size
                        items.append({
                            "id": entry.path,
                            "name": entry.name,
                            "type": "file",
                            "path": entry.path,
                            "ext": ext,
                            "size": size,
                            "size_human": _human_size(size)
                        })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission refusée")

    return {
        "path": target,
        "parent": str(pathlib.Path(target).parent) if target != root else None,
        "items": items
    }

def _human_size(size: int) -> str:
    for unit in ['o', 'Ko', 'Mo', 'Go']:
        if size < 1024:
            return f"{size:.0f} {unit}"
        size /= 1024
    return f"{size:.1f} Go"
```

### `.env` — ajouter la variable

```
FS_BROWSER_ROOT=C:\Users\romua
```

### `backend/main.py` — enregistrer le router

```python
from backend.fs_browser import router as fs_router
app.include_router(fs_router)
```

---

## 2. Frontend — panneau gauche react-arborist

### Comportement

- Au chargement : appel `GET /api/fs/browse` sans paramètre → affiche le dossier racine (`FS_BROWSER_ROOT`)
- Clic sur un dossier → appel `GET /api/fs/browse?path=xxx` → charge le contenu
- Lazy loading : les dossiers ont `children: []` par défaut, chargés à l'expand
- Retour arrière : la réponse contient `parent` → bouton "← [nom dossier parent]" en haut du panneau
- Breadcrumb : chemin actuel affiché en haut (cliquable pour remonter)

### Icônes par extension
- 📁 dossier
- 📕 `.pdf`
- 📘 `.docx`
- 📄 `.txt` `.md`

### Drag depuis le panneau gauche

```javascript
const handleDragStart = (e, node) => {
  if (node.data.type !== 'file') return;
  e.dataTransfer.effectAllowed = 'copy';
  // Stocker le path du fichier dans dataTransfer
  e.dataTransfer.setData('text/plain', node.data.path);
};
```

### Composant `RAGPCExplorer.jsx` — structure

```jsx
const RAGPCExplorer = ({ onFileDrop }) => {
  const [treeData, setTreeData] = useState([]);
  const [currentPath, setCurrentPath] = useState(null);
  const [parentPath, setParentPath] = useState(null);
  const [breadcrumb, setBreadcrumb] = useState([]);

  const loadPath = async (path = null) => {
    const url = path ? `/api/fs/browse?path=${encodeURIComponent(path)}` : '/api/fs/browse';
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setTreeData(data.items);
    setCurrentPath(data.path);
    setParentPath(data.parent);
    // Mettre à jour le breadcrumb
  };

  useEffect(() => { loadPath(); }, []);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Breadcrumb + bouton retour */}
      {parentPath && (
        <button onClick={() => loadPath(parentPath)}>← Retour</button>
      )}
      <div style={{ fontSize: '11px', color: '#888', padding: '4px 8px' }}>
        {currentPath}
      </div>
      {/* Arbre */}
      <Tree
        data={treeData}
        disableDrag={false}
        disableDrop={true}  // pas de drop dans le panneau PC
        onToggle={(id) => {
          // Lazy load dossier à l'expand
          const node = findNode(treeData, id);
          if (node?.type === 'folder' && node.children.length === 0) {
            loadChildren(id);
          }
        }}
      >
        {({ node, style, dragHandle }) => (
          <div
            style={style}
            ref={dragHandle}
            draggable={node.data.type === 'file'}
            onDragStart={(e) => handleDragStart(e, node)}
          >
            {node.data.type === 'folder' ? '📁' : getIcon(node.data.ext)}
            {' '}{node.data.name}
            {node.data.size_human && (
              <span style={{ color: '#666', fontSize: '11px', marginLeft: '8px' }}>
                {node.data.size_human}
              </span>
            )}
          </div>
        )}
      </Tree>
    </div>
  );
};
```

---

## 3. Panneau droit — adapter le drop

Dans `RAGNodeRenderer.jsx`, adapter `handleDrop` pour récupérer le path via `dataTransfer` :

```javascript
const handleDrop = async (e, folderId) => {
  e.preventDefault();
  setIsDragOver(false);

  // Source : panneau PC (path via dataTransfer)
  const filePath = e.dataTransfer.getData('text/plain');
  if (filePath) {
    await uploadFromPath(filePath, folderId);
    return;
  }

  // Source : Windows Explorer natif (fallback)
  if (e.dataTransfer.files.length > 0) {
    uploadFiles(Array.from(e.dataTransfer.files), folderId);
  }
};
```

### Route backend pour upload depuis path local

```
POST /api/rag/documents/from-path
Body : { "file_path": "C:\\Users\\romua\\Documents\\rapport.pdf", "folder_id": "xxx" }
```

Le backend lit le fichier depuis le disque (il est local), l'indexe dans LanceDB.
Pas de transfert réseau du fichier — juste le path.

```python
@router.post("/api/rag/documents/from-path")
async def upload_from_path(file_path: str, folder_id: str, ...):
    # Vérifier is_safe_path
    # Lire le fichier depuis le disque
    # Indexer dans LanceDB
    # Enregistrer dans TinyDB
    # Logger dans audit
```

---

## 4. Variable d'environnement

Dans `.env` :
```
FS_BROWSER_ROOT=C:\Users\romua
```

Valeur par défaut si absent : `pathlib.Path.home()` (dossier home Windows détecté automatiquement).

---

## 5. Critères de validation

- [ ] `GET /api/fs/browse` retourne le contenu de `FS_BROWSER_ROOT`
- [ ] Navigation dans les sous-dossiers fonctionne
- [ ] Bouton "← Retour" remonte d'un niveau
- [ ] Breadcrumb affiche le chemin courant
- [ ] Seuls PDF, DOCX, TXT, MD affichés
- [ ] Fichiers cachés masqués
- [ ] Drag d'un fichier PC → drop sur dossier RAG → upload via `from-path`
- [ ] Drop Windows Explorer natif toujours fonctionnel (fallback)
- [ ] `is_safe_path` empêche de sortir du `FS_BROWSER_ROOT`

---

## 6. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `backend/fs_browser.py` | Nouveau |
| `backend/main.py` | Enregistrer fs_router + route from-path |
| `frontend/src/components/AdminPanel/RAGPCExplorer.jsx` | Réécrire sans File System Access API |
| `frontend/src/components/AdminPanel/RAGNodeRenderer.jsx` | Adapter handleDrop |
| `.env` | Ajouter FS_BROWSER_ROOT |
