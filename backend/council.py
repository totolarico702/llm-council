# Copyright 2026 LLM Council Project
# LLM Council — Multi-LLM Deliberation System
# Licensed under [LICENCE À DÉFINIR]

"""
LLM Council deliberation engine.

Orchestrates a 3-stage deliberation process:
  Stage 1 — Parallel opinion gathering from all council members
  Stage 2 — Anonymous peer review to prevent favoritism
  Stage 3 — Chairman synthesis of all opinions and evaluations
"""

import asyncio
import re
from collections import defaultdict
from typing import Any, Optional

from .openrouter import query_model, query_models_parallel
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL


# ── Web search modes ──────────────────────────────────────────────────────────

WEB_NONE      = "none"
WEB_FACTCHECK = "factcheck"   # Chairman only
WEB_DEEP      = "deep"        # All agents + Chairman


# ── Internal helpers ──────────────────────────────────────────────────────────

def _alpha_codes(n: int) -> list[str]:
    """Return n alphabetical labels: A, B, C, …"""
    return [chr(65 + i) for i in range(n)]


def extract_ranking(raw_text: str) -> list[str]:
    """
    Parse the FINAL RANKING section from a peer-review response.

    Accepts two formats:
      numbered  — "1. Response B"
      plain     — "Response B"

    Returns an ordered list of label strings, e.g. ["Response B", "Response A"].
    Falls back to scanning the whole text if the header is absent.
    """
    if "FINAL RANKING:" in raw_text:
        section = raw_text.split("FINAL RANKING:", 1)[1]
        numbered = re.findall(r'\d+\.\s*Response [A-Z]', section)
        if numbered:
            return [re.search(r'Response [A-Z]', m).group() for m in numbered]
        return re.findall(r'Response [A-Z]', section)
    return re.findall(r'Response [A-Z]', raw_text)


def rank_aggregator(
    reviews: list[dict[str, Any]],
    code_map: dict[str, str],
) -> list[dict[str, Any]]:
    """
    Compute average ranking positions across all peer evaluations.

    Returns a list sorted from best (lowest avg position) to worst.
    Each entry: { "model": str, "average_rank": float, "rankings_count": int }
    """
    positions: dict[str, list[int]] = defaultdict(list)

    for review in reviews:
        parsed = extract_ranking(review["evaluation"])
        for pos, code in enumerate(parsed, start=1):
            if code in code_map:
                positions[code_map[code]].append(pos)

    leaderboard = []
    for model, pos_list in positions.items():
        if pos_list:
            leaderboard.append({
                "model":          model,
                "average_rank":   round(sum(pos_list) / len(pos_list), 2),
                "rankings_count": len(pos_list),
            })

    leaderboard.sort(key=lambda x: x["average_rank"])
    return leaderboard


# ── DeliberationSession ───────────────────────────────────────────────────────

class DeliberationSession:
    """
    Manages a 3-stage multi-LLM deliberation for a single user query.

    Usage:
        session = DeliberationSession(query, models, history, web_mode)
        opinions = await session.gather_opinions()
        reviews, code_map = await session.peer_review(opinions)
        conclusion = await session.synthesize(opinions, reviews)
    """

    def __init__(
        self,
        query: str,
        models: list[str],
        history: list[dict[str, Any]],
        web_mode: str = WEB_NONE,
        chairman: Optional[str] = None,
    ) -> None:
        self.query    = query
        self.models   = models
        self.history  = history
        self.web_mode = web_mode
        self.chairman = chairman or CHAIRMAN_MODEL

    # ── Stage 1 ───────────────────────────────────────────────────────────────

    async def gather_opinions(self) -> list[dict[str, Any]]:
        """
        Stage 1: Query all council members in parallel.

        Each member receives the same conversation history + the user query.
        Responses that fail (None) are silently dropped — the deliberation
        continues with whatever succeeds (graceful degradation).

        Returns a list of { "model": str, "response": str } dicts.
        """
        use_web = (self.web_mode == WEB_DEEP)
        thread  = list(self.history) + [{"role": "user", "content": self.query}]

        raw_responses = await query_models_parallel(
            self.models, thread, web_search=use_web
        )

        return [
            {"model": m, "response": r.get("content", "")}
            for m, r in raw_responses.items()
            if r is not None
        ]

    # ── Stage 2 ───────────────────────────────────────────────────────────────

    async def peer_review(
        self,
        opinions: list[dict[str, Any]],
    ) -> tuple[list[dict[str, Any]], dict[str, str]]:
        """
        Stage 2: Each council member evaluates the anonymised opinions.

        Responses are labelled A, B, C … so evaluators cannot identify
        their own answer or favour a known model (anti-sycophancy).
        Each model is excluded from evaluating its own response.

        Returns:
          - list of evaluation dicts (one per model)
          - code_map: { "Response A": "provider/model-name", … }
        """
        codes    = _alpha_codes(len(opinions))
        code_map = {
            f"Response {c}": op["model"]
            for c, op in zip(codes, opinions)
        }
        author_code = {op["model"]: f"Response {c}" for c, op in zip(codes, opinions)}

        def _build_prompt(evaluator: str) -> str:
            own = author_code.get(evaluator)
            candidates = [
                (c, op)
                for c, op in zip(codes, opinions)
                if f"Response {c}" != own
            ]
            body = "\n\n".join(
                f"Response {c}:\n{op['response']}"
                for c, op in candidates
            )
            exclusion = (
                f"\nNote: Your own response ({own}) is excluded from this "
                f"evaluation to avoid self-evaluation bias. "
                f"Please rank only the {len(candidates)} responses below.\n"
            ) if own else ""

            return (
                f"You are evaluating different responses to the following question:\n\n"
                f"Question: {self.query}\n"
                f"{exclusion}\n"
                f"Here are the responses from different models (anonymised):\n\n"
                f"{body}\n\n"
                f"Your task:\n"
                f"1. Evaluate each response individually. Explain strengths and weaknesses.\n"
                f"2. At the very end, provide a final ranking.\n\n"
                f"IMPORTANT — Your final ranking MUST follow this exact format:\n"
                f'- Start with the line "FINAL RANKING:" (all caps, with colon)\n'
                f"- List responses from best to worst as a numbered list\n"
                f'- Each line: number, period, space, label only — e.g. "1. Response A"\n'
                f"- No extra text after the ranking section\n\n"
                f"Now provide your evaluation and ranking:"
            )

        async def _evaluate_one(model: str) -> Optional[dict[str, Any]]:
            prompt   = _build_prompt(model)
            messages = list(self.history) + [{"role": "user", "content": prompt}]
            result   = await query_model(model, messages, web_search=False)
            if result is None:
                return None
            text   = result.get("content", "")
            parsed = extract_ranking(text)
            if not parsed:
                print(f"[council] WARNING: empty ranking — model={model} raw={text[:200]!r}")
            return {
                "model":        model,
                "evaluation":   text,
                # Backwards-compat key used by legacy callers (main.py / storage)
                "ranking":      text,
                "parsed_ranking": parsed,
                "parse_failed": not parsed,
            }

        tasks   = [_evaluate_one(m) for m in self.models]
        results = await asyncio.gather(*tasks)
        reviews = [r for r in results if r is not None]
        return reviews, code_map

    # ── Stage 3 ───────────────────────────────────────────────────────────────

    async def synthesize(
        self,
        opinions: list[dict[str, Any]],
        reviews:  list[dict[str, Any]],
    ) -> dict[str, Any]:
        """
        Stage 3: Chairman synthesises a final answer from all evidence.

        The chairman receives:
          - the original question
          - all individual opinions (with model names visible)
          - all peer evaluations

        Optional web search is enabled when web_mode is factcheck or deep.

        Returns { "model": str, "response": str }.
        """
        use_web = (self.web_mode in (WEB_FACTCHECK, WEB_DEEP))

        opinions_block = "\n\n".join(
            f"Model: {op['model']}\nOpinion: {op['response']}"
            for op in opinions
        )
        reviews_block = "\n\n".join(
            f"Model: {rev['model']}\nEvaluation: {rev['evaluation']}"
            for rev in reviews
        )
        web_note = (
            "\nYou have access to web search. Use it to verify disputed facts "
            "and enrich your synthesis with current information.\n"
        ) if use_web else ""

        prompt = (
            f"You are the Chairman of an LLM Council. "
            f"Multiple AI models have independently answered a user's question, "
            f"then reviewed each other's answers anonymously.\n"
            f"{web_note}\n"
            f"Original Question: {self.query}\n\n"
            f"STAGE 1 — Individual Opinions:\n{opinions_block}\n\n"
            f"STAGE 2 — Peer Evaluations:\n{reviews_block}\n\n"
            f"Synthesise all of the above into one comprehensive, accurate answer. "
            f"Consider: the range of opinions, the peer evaluations, patterns of "
            f"agreement or disagreement"
            f"{', and verify disputed facts via web search' if use_web else ''}.\n\n"
            f"Provide a clear, well-reasoned final answer:"
        )

        messages = list(self.history) + [{"role": "user", "content": prompt}]
        result   = await query_model(self.chairman, messages, web_search=use_web)

        if result is None:
            return {"model": self.chairman, "response": "Error: Chairman synthesis failed."}

        return {"model": self.chairman, "response": result.get("content", "")}


# ── Module-level entry points (used by main.py and tests) ─────────────────────

async def gather_opinions(
    query:    str,
    models:   list[str]              = None,
    web_mode: str                     = WEB_NONE,
    history:  list[dict[str, Any]]   = None,
) -> list[dict[str, Any]]:
    """Stage 1 entry point — see DeliberationSession.gather_opinions."""
    session = DeliberationSession(
        query    = query,
        models   = models or COUNCIL_MODELS,
        history  = history or [],
        web_mode = web_mode,
    )
    return await session.gather_opinions()


async def peer_review(
    query:    str,
    opinions: list[dict[str, Any]],
    models:   list[str]              = None,
    history:  list[dict[str, Any]]   = None,
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Stage 2 entry point — see DeliberationSession.peer_review."""
    session = DeliberationSession(
        query   = query,
        models  = models or COUNCIL_MODELS,
        history = history or [],
    )
    return await session.peer_review(opinions)


async def synthesize_final(
    query:    str,
    opinions: list[dict[str, Any]],
    reviews:  list[dict[str, Any]],
    chairman: str                    = None,
    web_mode: str                    = WEB_NONE,
    history:  list[dict[str, Any]]   = None,
) -> dict[str, Any]:
    """Stage 3 entry point — see DeliberationSession.synthesize."""
    session = DeliberationSession(
        query    = query,
        models   = COUNCIL_MODELS,
        history  = history or [],
        web_mode = web_mode,
        chairman = chairman,
    )
    return await session.synthesize(opinions, reviews)


async def generate_title(query: str) -> str:
    """
    Generate a short conversation title (3-5 words) from the user query.
    Falls back to "New Conversation" on failure.
    """
    prompt = (
        "Generate a very short title (3-5 words maximum) summarising this question. "
        "Be concise and descriptive. No quotes, no punctuation.\n\n"
        f"Question: {query}\n\nTitle:"
    )
    result = await query_model(
        "google/gemini-2.5-flash",
        [{"role": "user", "content": prompt}],
        timeout=30.0,
    )
    if result is None:
        return "New Conversation"
    title = result.get("content", "New Conversation").strip().strip("\"'")
    return title[:47] + "..." if len(title) > 50 else title


async def run_deliberation(
    query: str,
) -> tuple[list, list, dict, dict]:
    """
    Run a full 3-stage deliberation and return all outputs.

    Returns: (opinions, reviews, conclusion, metadata)
    """
    opinions = await gather_opinions(query)
    if not opinions:
        return [], [], {"model": "error", "response": "All models failed to respond."}, {}

    reviews, code_map = await peer_review(query, opinions)
    leaderboard       = rank_aggregator(reviews, code_map)
    conclusion        = await synthesize_final(query, opinions, reviews)

    return opinions, reviews, conclusion, {
        "label_to_model":     code_map,
        "aggregate_rankings": leaderboard,
    }
