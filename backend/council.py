"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, Optional
from .openrouter import query_models_parallel, query_model
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL

# Modes de recherche web
WEB_SEARCH_NONE = "none"
WEB_SEARCH_FACTCHECK = "factcheck"   # Chairman uniquement
WEB_SEARCH_DEEP = "deep"             # Tous les agents + Chairman


async def stage1_collect_responses(
    user_query: str,
    council_models: List[str] = None,
    web_search_mode: str = WEB_SEARCH_NONE,
    history: List[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Stage 1: Collect individual responses from all council models."""
    models = council_models if council_models else COUNCIL_MODELS
    use_web = web_search_mode == WEB_SEARCH_DEEP

    messages = list(history) if history else []
    messages.append({"role": "user", "content": user_query})
    responses = await query_models_parallel(models, messages, web_search=use_web)

    stage1_results = []
    for model, response in responses.items():
        if response is not None:
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    council_models: List[str] = None,
    history: List[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.
    M4 : history injecté pour le contexte conversationnel.
    M6 : chaque modèle reçoit les réponses avec sa propre réponse exclue
         (ou marquée) pour éviter le biais d'auto-évaluation.
    """
    models = council_models if council_models else COUNCIL_MODELS

    # Assigner des labels alphabétiques aux réponses (anonymisation)
    labels = [chr(65 + i) for i in range(len(stage1_results))]
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }
    # Index inverse : model → label (pour exclure l'auto-évaluation)
    model_to_label = {result['model']: f"Response {label}"
                      for label, result in zip(labels, stage1_results)}

    def build_ranking_prompt(evaluator_model: str) -> str:
        """
        M6 : construit un prompt de ranking en excluant la propre réponse
        du modèle évaluateur pour éviter le biais d'auto-évaluation.
        """
        own_label = model_to_label.get(evaluator_model)
        # Construire la liste des réponses en excluant la sienne
        responses_to_rank = [
            (label, result)
            for label, result in zip(labels, stage1_results)
            if f"Response {label}" != own_label
        ]
        n_responses = len(responses_to_rank)

        responses_text = "\n\n".join([
            f"Response {label}:\n{result['response']}"
            for label, result in responses_to_rank
        ])

        exclusion_note = (
            f"\nNote: You have been excluded from evaluating your own response "
            f"({own_label}) to avoid bias. Please rank only the {n_responses} "
            f"responses shown below.\n"
        ) if own_label else ""

        return f"""You are evaluating different responses to the following question:

Question: {user_query}
{exclusion_note}
Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...

FINAL RANKING:
1. Response B
2. Response A

Now provide your evaluation and ranking:"""

    # M4 : construire les messages avec history pour chaque modèle
    async def rank_one(model: str) -> Optional[Dict[str, Any]]:
        prompt = build_ranking_prompt(model)
        messages = list(history) if history else []
        messages.append({"role": "user", "content": prompt})
        from .openrouter import query_model as _qm
        response = await _qm(model, messages, web_search=False)
        if response is None:
            return None
        full_text      = response.get('content', '')
        parsed_ranking = parse_ranking_from_text(full_text)
        if not parsed_ranking:
            print(f"[council] WARNING: parse_ranking_empty model={model} raw={full_text[:200]!r}")
        return {
            "model":           model,
            "ranking":         full_text,
            "parsed_ranking":  parsed_ranking,
            "parse_failed":    not parsed_ranking,
        }

    # Exécuter tous les rankings en parallèle
    import asyncio as _asyncio
    tasks   = [rank_one(m) for m in models]
    results = await _asyncio.gather(*tasks)

    stage2_results = [r for r in results if r is not None]
    return stage2_results, label_to_model


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
    chairman_model: str = None,
    web_search_mode: str = WEB_SEARCH_NONE,
    history: List[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Stage 3: Chairman synthesizes final response, avec web search optionnel."""
    chairman = chairman_model if chairman_model else CHAIRMAN_MODEL
    use_web = web_search_mode in (WEB_SEARCH_FACTCHECK, WEB_SEARCH_DEEP)

    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    web_instruction = ""
    if use_web:
        web_instruction = "\nYou have access to web search. Use it to verify key facts, check sources, and enrich your synthesis with current information before writing your final answer.\n"

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.
{web_instruction}
Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement
{"- Use web search to verify disputed facts or add current information" if use_web else ""}

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = list(history) if history else []
    messages.append({"role": "user", "content": chairman_prompt})
    response = await query_model(chairman, messages, web_search=use_web)

    if response is None:
        return {
            "model": chairman,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": chairman,
        "response": response.get('content', '')
    }


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    import re
    if "FINAL RANKING:" in ranking_text:
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches
    return re.findall(r'Response [A-Z]', ranking_text)


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    from collections import defaultdict
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        parsed_ranking = parse_ranking_from_text(ranking['ranking'])
        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_positions[label_to_model[label]].append(position)

    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            aggregate.append({
                "model": model,
                "average_rank": round(sum(positions) / len(positions), 2),
                "rankings_count": len(positions)
            })

    aggregate.sort(key=lambda x: x['average_rank'])
    return aggregate


async def generate_conversation_title(user_query: str) -> str:
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip().strip('"\'')
    return title[:47] + "..." if len(title) > 50 else title


async def run_full_council(user_query: str) -> Tuple[List, List, Dict, Dict]:
    stage1_results = await stage1_collect_responses(user_query)
    if not stage1_results:
        return [], [], {"model": "error", "response": "All models failed to respond."}, {}

    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)
    aggregate_rankings = calculate_aggregate_rankings(stage2_results, label_to_model)
    stage3_result = await stage3_synthesize_final(user_query, stage1_results, stage2_results)

    return stage1_results, stage2_results, stage3_result, {
        "label_to_model": label_to_model,
        "aggregate_rankings": aggregate_rankings
    }
