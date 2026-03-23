# BRIEF_RAG_SESSION4_LAYOUT — Refonte layout onglet RAG admin

## Contexte

Le layout actuel de l'onglet RAG admin est trop verbeux en haut et le file explorer est non fonctionnel.
Ce brief remplace BRIEF_RAG_SESSION4_FIXES_V2 pour la partie layout et navigation dossiers.
Les fixes useEffect ACL et auto-création dossier à la création service restent valables.

---

## 1. Bandeau supérieur — compact

### Problème actuel
Le bloc "Mémoire organisationnelle" + "Archives employés" + encart "Usage dans les pipelines"
empile trop de hauteur pour très peu d'information.

### Comportement attendu
Tout tenir sur **une barre horizontale compacte** (~48px) :

```
🟢 LanceDB   |   0 chunks indexés   |   0 archives   |   tool_type: rag_search  limit: 5  score_threshold: 0.3   [Actualiser]
```

- Séparateurs verticaux entre les sections
- Les badges `tool_type` / `limit` / `score_threshold` restent inline, plus petits
- Bouton "Actualiser" à droite
- Supprimer les titres "Mémoire organisationnelle", "ARCHIVES EMPLOYÉS (0)", le bloc "Usage dans les pipelines" en card séparée — tout inline

---

## 2. File Explorer — remplacer le composant actuel

### Librairie recommandée : SVAR React File Manager
- MIT, gratuit, dark theme natif compatible avec le style actuel
- Breadcrumbs natifs, upload drag & drop, rename, delete, navigation complète
- S'intègre via `RestDataProvider` branché sur les routes `/api/rag/*` existantes
- Doc : https://svar.dev/react/filemanager/

```bash
npm install wx-react-filemanager
```

### Mapping API — brancher SVAR sur le backend existant

SVAR attend un `RestDataProvider` avec ces endpoints :

| Action SVAR | Route backend existante |
|-------------|------------------------|
| Lister dossiers/fichiers | `GET /api/rag/folders` + `GET /api/rag/documents?folder_id=xxx` |
| Créer dossier | `POST /api/rag/folders` |
| Renommer dossier | `PATCH /api/rag/folders/{id}` |
| Supprimer dossier | `DELETE /api/rag/folders/{id}` |
| Upload fichier | `POST /api/rag/documents` (multipart) |
| Supprimer fichier | `DELETE /api/rag/documents/{id}` |

Si le format de réponse du backend ne correspond pas exactement au format attendu par SVAR,
créer un **adaptateur** dans le frontend qui transforme les réponses avant de les passer à SVAR.

### Configuration SVAR

- Thème : `WillowDark` (dark theme natif)
- Hauteur du composant : `calc(100vh - 200px)` — prend tout l'espace disponible sous le bandeau compact
- Activer : upload, rename, delete, création dossier
- Désactiver : move (drag & drop entre dossiers) — pas supporté par le backend pour l'instant
- Afficher les colonnes : nom | taille | date upload | uploadé par

### Gestion des permissions dans le file explorer

- Si l'user n'a pas `rag_write` sur un dossier → désactiver upload et delete sur ce dossier
- Si l'user n'a pas accès (`none`) → le dossier n'est pas retourné par l'API (filtrage backend déjà en place)

---

## 3. Sections ACL et Audit Log

- **Exceptions ACL** : reste en panneau latéral ou drawer qui s'ouvre au clic droit sur un dossier dans SVAR (menu contextuel), ou bouton "⚙ ACL" dans la toolbar SVAR
- **Audit Log** : reste en section collapsible en bas de page, inchangé

---

## 4. Fix useEffect ACL (inchangé depuis FIXES_V2)

Le composant Exceptions ACL tremble / re-render en boucle.
Vérifier les dépendances `useEffect` — le fetch ne doit se déclencher que si `folder_id` change.

---

## 5. Fix auto-création dossier RAG à la création de service (inchangé depuis FIXES_V2)

- `POST /api/services` → créer automatiquement dossier RAG racine du même nom
- Migration rétroactive dans `lifespan` pour les services existants sans dossier RAG

---

## Critères de validation

- [ ] Le bandeau supérieur tient en une ligne ~48px
- [ ] Le file explorer affiche l'arborescence complète avec breadcrumbs
- [ ] Navigation dans les dossiers fonctionne (entrer, revenir en arrière)
- [ ] Upload drag & drop et bouton classique fonctionnels
- [ ] Rename et delete fonctionnels
- [ ] Création de sous-dossier fonctionnelle
- [ ] Thème dark cohérent avec le reste de l'UI
- [ ] Composant ACL ne tremble plus
- [ ] Nouveau service → dossier RAG créé automatiquement
