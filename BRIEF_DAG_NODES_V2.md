# BRIEF_DAG_NODES_V2 — Activation complète des nœuds + moteur agent

## Contexte

Le moteur DAG actuel (`dag_engine.py`) exécute déjà :
- ✅ Nœud LLM cloud (OpenRouter)
- ✅ Nœud LLM local (Ollama)
- ✅ Nœud Web Search

Ce brief active les nœuds manquants et étend le moteur pour supporter
tous les patterns d'exécution : séquentiel, parallèle, condition, boucle, merge.

---

## 1. État actuel du moteur DAG

Avant de coder, lire et analyser `backend/dag_engine.py` pour comprendre :
- Comment les nœuds sont exécutés aujourd'hui
- Comment le contexte est passé entre nœuds
- Comment le streaming SSE est géré
- Où ajouter les nouveaux types de nœuds

---

## 2. Nœuds à activer

### 2.1 Nœud RAG Search

```python
async def execute_rag_search(node: dict, context: dict) -> dict:
    """
    Recherche dans LanceDB et injecte les chunks dans le contexte.
    """
    from backend.rag_store import search_documents

    query = context.get("user_input", "")
    folder_id = node.get("folder_id")
    limit = node.get("limit", 5)
    score_threshold = node.get("score_threshold", 0.3)

    results = await search_documents(
        query=query,
        folder_id=folder_id,
        limit=limit,
        score_threshold=score_threshold
    )

    # Formater les chunks pour injection LLM
    context_text = "\n\n".join([
        f"[Document: {r['name']}]\n{r['content']}"
        for r in results
    ])

    return {
        "output": context_text,
        "chunks": results,
        "inject_as": node.get("inject_as", "context")
    }
```

### 2.2 Nœud Fact-check

```python
async def execute_fact_check(node: dict, context: dict) -> dict:
    """
    Envoie le texte précédent à un LLM dédié pour vérification factuelle.
    Retourne le texte annoté avec les points vérifiés/douteux.
    """
    text_to_check = context.get("previous_output", "")

    prompt = f"""Tu es un fact-checker expert. Analyse le texte suivant et :
1. Identifie les affirmations vérifiables
2. Note leur niveau de certitude (✅ vérifié / ⚠️ douteux / ❌ incorrect)
3. Explique brièvement chaque annotation

Texte à vérifier :
{text_to_check}"""

    model = node.get("model", "mistralai/mistral-medium-3")
    # Appel OpenRouter avec le prompt
    result = await call_llm(model=model, prompt=prompt, system="Tu es un fact-checker rigoureux.")

    return {"output": result, "fact_checked": True}
```

### 2.3 Nœud MCP

```python
async def execute_mcp(node: dict, context: dict) -> dict:
    """
    Appel d'un serveur MCP externe.
    Supporte : GET/POST HTTP, auth bearer, params dynamiques.
    """
    import httpx
    from string import Template

    server_url = node.get("server_url")
    tool_name = node.get("tool_name")
    raw_params = node.get("params", {})
    auth = node.get("auth", {})

    # Résoudre les variables dynamiques dans les params
    params = {}
    for key, value in raw_params.items():
        if isinstance(value, str):
            params[key] = value.replace("{{user_input}}", context.get("user_input", ""))
            params[key] = params[key].replace("{{previous_output}}", context.get("previous_output", ""))
        else:
            params[key] = value

    headers = {}
    if auth.get("type") == "bearer":
        headers["Authorization"] = f"Bearer {auth.get('token', '')}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{server_url}/tools/{tool_name}",
            json=params,
            headers=headers
        )
        response.raise_for_status()
        result = response.json()

    return {"output": str(result), "mcp_result": result}
```

### 2.4 Nœud Condition

```python
def evaluate_condition(node: dict, context: dict) -> str:
    """
    Évalue une condition sur le contexte et retourne l'id du nœud suivant.
    Retourne branch_true ou branch_false selon le résultat.
    """
    condition = node.get("condition", "true")

    # Évaluation sécurisée — variables disponibles
    safe_vars = {
        "output": context.get("previous_output", ""),
        "user_input": context.get("user_input", ""),
        "confidence": context.get("confidence", 1.0),
        "chunks_count": len(context.get("chunks", [])),
        "len": len,
        "True": True,
        "False": False,
    }

    try:
        result = eval(condition, {"__builtins__": {}}, safe_vars)
    except Exception:
        result = False

    return node.get("branch_true") if result else node.get("branch_false")
```

### 2.5 Nœud Merge

```python
def execute_merge(node: dict, contexts: list[dict]) -> dict:
    """
    Fusionne les sorties de plusieurs nœuds parents.
    Stratégies : concatenate, summary, vote
    """
    strategy = node.get("strategy", "concatenate")
    separator = node.get("separator", "\n\n---\n\n")

    outputs = [ctx.get("previous_output", "") for ctx in contexts if ctx.get("previous_output")]

    if strategy == "concatenate":
        merged = separator.join(outputs)
    elif strategy == "vote":
        # Retourner la réponse la plus longue (heuristique simple)
        merged = max(outputs, key=len) if outputs else ""
    else:
        merged = separator.join(outputs)

    return {"output": merged, "merged_count": len(outputs)}
```

---

## 3. Patterns d'exécution à supporter

### 3.1 Séquentiel (déjà partiellement fonctionnel)
```
input → node_A → node_B → node_C → output
```
Chaque nœud reçoit la sortie du précédent dans `context["previous_output"]`.

### 3.2 Parallèle + Merge
```
input → node_A ──┐
input → node_B ──┼── merge → output
input → node_C ──┘
```
Les nœuds sans dépendance entre eux s'exécutent avec `asyncio.gather()`.
Le nœud merge attend toutes les sorties.

**Implémentation :**
```python
# Détecter les nœuds parallélisables (même nœud parent)
parallel_groups = get_parallel_groups(dag)
for group in parallel_groups:
    if len(group) > 1:
        results = await asyncio.gather(*[execute_node(n, ctx) for n in group])
    else:
        result = await execute_node(group[0], ctx)
```

### 3.3 Conditionnel
```
input → llm_eval → condition ──(true)──→ llm_expert → output
                             └─(false)─→ llm_simple → output
```
Le nœud condition évalue son expression et route vers `branch_true` ou `branch_false`.

### 3.4 Boucle (max_iterations pour éviter les boucles infinies)
```
input → llm_draft → condition ──(not_good)──→ llm_refine ──┐
                  ↑                                         │
                  └─────────────────────────────────────────┘
                             └─(good)────→ output
```
```python
MAX_LOOP_ITERATIONS = 10  # sécurité anti-boucle infinie
loop_counter = {}

def check_loop_safety(node_id: str) -> bool:
    loop_counter[node_id] = loop_counter.get(node_id, 0) + 1
    return loop_counter[node_id] <= MAX_LOOP_ITERATIONS
```

---

## 4. Contexte inter-nœuds

Le contexte est un dict partagé et enrichi à chaque nœud :

```python
context = {
    "user_input": "question originale",
    "previous_output": "sortie du nœud précédent",
    "outputs": {
        "node_id_1": "sortie nœud 1",
        "node_id_2": "sortie nœud 2",
    },
    "chunks": [...],          # injecté par RAG Search
    "rag_context": "...",     # texte formaté des chunks
    "conversation_history": [...],
    "confidence": 1.0,
    "metadata": {}
}
```

Chaque nœud peut lire `context["outputs"]["node_id"]` pour accéder
à la sortie d'un nœud spécifique (pas seulement le précédent).

---

## 5. Suppression du message warning

Supprimer le message `⚠ Ce node est sauvegardé dans le graphe...`
dans le frontend une fois les nœuds activés côté backend.

---

## 6. Trace d'exécution SSE

Pour chaque nœud exécuté, émettre un événement SSE :

```python
yield f"data: {json.dumps({'type': 'node_start', 'node_id': node['id'], 'node_type': node['type'], 'label': node.get('label', '')})}\n\n"
# ... exécution ...
yield f"data: {json.dumps({'type': 'node_done', 'node_id': node['id'], 'duration_ms': elapsed, 'output_preview': output[:100]})}\n\n"
```

---

## 7. Critères de validation

- [ ] Nœud RAG Search injecte les chunks dans le contexte LLM suivant
- [ ] Nœud Fact-check annote la sortie précédente
- [ ] Nœud MCP appelle un endpoint externe et retourne le résultat
- [ ] Nœud Condition route vers branch_true ou branch_false
- [ ] Nœud Merge fusionne les sorties de plusieurs nœuds parents
- [ ] Exécution parallèle avec `asyncio.gather()` fonctionnelle
- [ ] Boucles protégées par MAX_LOOP_ITERATIONS = 10
- [ ] Contexte inter-nœuds accessible via `context["outputs"]["node_id"]`
- [ ] Trace SSE émise pour chaque nœud (start + done)
- [ ] Message warning ⚠ supprimé dans le frontend
- [ ] Test end-to-end : pipeline RAG → LLM → Fact-check → output

---

## 8. Fichiers concernés

| Fichier | Action |
|---------|--------|
| `backend/dag_engine.py` | Ajouter execute_rag_search, execute_fact_check, execute_mcp, execute_condition, execute_merge + patterns parallèle/boucle |
| `backend/cog_parser.py` | Vérifier que tous les types sont validés |
| `frontend/src/components/PipelineEditor.jsx` | Supprimer message warning ⚠ |
