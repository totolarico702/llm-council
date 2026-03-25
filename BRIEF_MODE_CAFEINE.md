# BRIEF_MODE_CAFEINE — Validation humaine post-Chairman

## Concept

Le Mode Caféine intercale une étape de validation humaine entre la réponse du Chairman
et son envoi à l'utilisateur. Activé par conversation via un bouton toggle dans le chat,
il permet à l'utilisateur de relire, modifier, relancer ou rejeter la réponse avant envoi.

---

## 1. Activation — Toggle dans l'interface de chat

### UI

Ajouter un bouton toggle ☕ dans la barre d'outils du chat (à côté de Recherche web / Fact-check) :

```
[ ☕ Caféine OFF ]  ←→  [ ☕ Caféine ON ]
```

- État stocké dans le state de la conversation (pas en base — par session)
- Badge visuel quand actif : icône ☕ colorée dans la barre
- Tooltip : "Mode Caféine — vous validez la réponse avant envoi"

---

## 2. Flux d'exécution avec Mode Caféine actif

### Sans Caféine (normal)
```
User → Stage 1 → Stage 2 → Chairman → Réponse affichée
```

### Avec Caféine
```
User → Stage 1 → Stage 2 → Chairman → ⏸ EN ATTENTE VALIDATION
                                           ↓
                              Interface de validation
                                           ↓
              ┌────────────┬──────────────┬──────────────┐
              ↓            ↓              ↓              ↓
          Approuver    Modifier       Relancer       Rejeter
              ↓            ↓          Chairman           ↓
         Afficher     Afficher avec     avec inst.    Recommencer
         tel quel     modifications                  depuis début
```

---

## 3. Backend — Interception post-Chairman

### Modification de `backend/council.py` ou `dag_engine.py`

Quand le mode Caféine est actif (flag dans la requête), le backend :
1. Exécute normalement jusqu'au Chairman
2. Au lieu de streamer la réponse finale, sauvegarde en TinyDB avec statut `pending_validation`
3. Retourne un événement SSE spécial `validation_required` au lieu de la réponse

```python
# Dans le handler de stream
if cafeine_mode and stage == "chairman_output":
    # Sauvegarder en attente
    validation_id = storage.save_pending_validation(
        conversation_id=conversation_id,
        message_id=message_id,
        chairman_output=chairman_response,
        user_id=current_user["id"]
    )
    # Signaler au frontend
    yield f"data: {json.dumps({'type': 'validation_required', 'validation_id': validation_id})}\n\n"
    return  # Ne pas streamer la réponse
```

### Modèle TinyDB — collection `pending_validations`

```json
{
  "id": "validation_uuid",
  "conversation_id": "conv_uuid",
  "message_id": "msg_uuid",
  "user_id": "user_uuid",
  "chairman_output": "texte complet du Chairman",
  "status": "pending | approved | modified | rejected | relaunched",
  "created_at": "ISO8601",
  "resolved_at": "ISO8601",
  "resolution": {
    "action": "approved | modified | relaunched | rejected",
    "modified_text": "texte modifié si action=modified",
    "relaunch_instructions": "instructions si action=relaunched"
  }
}
```

### Nouvelles routes

```
GET  /api/v1/conversations/{id}/pending-validation   # récupérer la validation en attente
POST /api/v1/conversations/{id}/validate             # soumettre la décision
```

```python
# POST /validate — body
{
  "validation_id": "uuid",
  "action": "approve | modify | relaunch | reject",
  "modified_text": "...",        # si action=modify
  "relaunch_instructions": "..."  # si action=relaunch
}
```

---

## 4. Frontend — Interface de validation

### Déclenchement

Quand le frontend reçoit l'événement SSE `validation_required` :
1. Arrêter le spinner de chargement
2. Afficher l'interface de validation à la place de la réponse

### Interface de validation

```
┌─────────────────────────────────────────────────────────┐
│  ☕ Mode Caféine — Réponse en attente de validation      │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [Textarea éditable avec la réponse du Chairman]        │
│                                                          │
│  La réponse ci-dessus a été générée par le Chairman.    │
│  Relisez, modifiez si nécessaire, puis validez.         │
│                                                          │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────────┐  ┌──────────────────────────────┐  │
│  │ ✅ Approuver    │  │ ✏️ Modifier et envoyer        │  │
│  │ et envoyer      │  │ (envoie le texte modifié)    │  │
│  └─────────────────┘  └──────────────────────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 🔄 Relancer le Chairman avec instructions       │    │
│  │ [input: "Sois plus concis / plus formel / ..."] │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────┐                                    │
│  │ ❌ Rejeter      │                                    │
│  │ (recommencer)   │                                    │
│  └─────────────────┘                                    │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Comportement de chaque action

**✅ Approuver** :
- POST `/validate` avec `action: "approve"`
- La réponse du Chairman s'affiche telle quelle dans le chat
- Interface de validation disparaît

**✏️ Modifier et envoyer** :
- Le textarea est éditable depuis le début
- POST `/validate` avec `action: "modify"` + `modified_text`
- Le texte modifié s'affiche dans le chat (avec un badge discret `✏️ modifié`)

**🔄 Relancer** :
- Afficher un input : "Instructions pour le Chairman..."
- POST `/validate` avec `action: "relaunch"` + `relaunch_instructions`
- Relance l'exécution du Chairman avec les instructions additionnelles
- Nouvelle interface de validation s'affiche avec la nouvelle réponse

**❌ Rejeter** :
- POST `/validate` avec `action: "reject"`
- Message d'annulation dans le chat : "Réponse rejetée."
- L'user peut reposer sa question

---

## 5. Notification visuelle

### Bandeau dans le chat

Pendant qu'une validation est en attente, afficher un bandeau discret en haut du chat :

```
☕ Une réponse attend votre validation ↓
```

Clic sur le bandeau → scroll vers l'interface de validation.

### Badge sur le bouton Caféine

Quand actif ET une validation en attente :
```
[ ☕ Caféine ● ]   ← point orange clignotant
```

---

## 6. Cas limites

- **Timeout** : si la validation n'est pas résolue en 30 minutes → expirer automatiquement, notifier l'user
- **Reload de page** : si l'user recharge, récupérer la validation en attente via `GET /pending-validation` au chargement de la conversation
- **Multi-onglets** : une seule validation active par conversation à la fois

---

## 7. Critères de validation

- [ ] Toggle ☕ Caféine visible dans la barre d'outils du chat
- [ ] Avec Caféine actif, la réponse Chairman ne s'affiche pas immédiatement
- [ ] Interface de validation s'affiche avec le texte éditable
- [ ] ✅ Approuver → affiche la réponse dans le chat
- [ ] ✏️ Modifier → affiche le texte modifié avec badge ✏️
- [ ] 🔄 Relancer → relance Chairman avec instructions, nouvelle interface de validation
- [ ] ❌ Rejeter → message d'annulation dans le chat
- [ ] Bandeau de notification quand validation en attente
- [ ] Reload de page → validation en attente restaurée
- [ ] Timeout 30min → expiration automatique

---

## 8. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `backend/council.py` | Interception post-Chairman si cafeine_mode |
| `backend/storage.py` | CRUD pending_validations TinyDB |
| `backend/main.py` | Routes GET/POST validate |
| `frontend/src/components/ChatInterface.jsx` | Toggle Caféine + réception SSE validation_required |
| `frontend/src/components/CaffeineValidation.jsx` | Nouveau — interface de validation |
| `frontend/src/api/routes.js` | Ajouter routes validation |
