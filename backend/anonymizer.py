# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
anonymizer.py — Proxy d'anonymisation réversible par tokenisation.

Fonctionnement :
  1. anonymize(text, session_id) → texte anonymisé + table de tokens en mémoire
  2. deanonymize(text, session_id) → texte reconstruit avec les valeurs originales
  3. La table est détruite à la fin de la conversation (flush_session)

Entités couvertes :
  Regex  : emails, téléphones, IPs, URLs, IBANs, CB, n° sécu, adresses
  spaCy  : PER (personnes), ORG (organisations), LOC (lieux)
"""

import re
import threading
import time
import uuid
from typing import Dict, Tuple, Optional

# ─── Chargement spaCy (lazy, une seule fois) ──────────────────────────────────

_nlp = None
_nlp_lock = threading.Lock()
_spacy_available = False

def _get_nlp():
    global _nlp, _spacy_available
    if _nlp is not None:
        return _nlp
    with _nlp_lock:
        if _nlp is not None:
            return _nlp
        try:
            import spacy
            # Essayer le modèle français d'abord, puis multilingue, puis anglais
            for model in ("fr_core_news_md", "fr_core_news_sm", "xx_ent_wiki_sm", "en_core_web_sm"):
                try:
                    _nlp = spacy.load(model)
                    _spacy_available = True
                    print(f"[anonymizer] spaCy chargé : {model}")
                    break
                except OSError:
                    continue
            if not _spacy_available:
                print("[anonymizer] Aucun modèle spaCy disponible — NER désactivé, regex seul actif")
        except ImportError:
            print("[anonymizer] spaCy non installé — regex seul actif")
    return _nlp


# ─── Table de sessions ────────────────────────────────────────────────────────

# { session_id: { token: original_value, "_ts": timestamp } }
_sessions: Dict[str, Dict[str, str]] = {}
_session_lock = threading.Lock()
SESSION_TTL = 3600  # 1h


def _get_session(session_id: str) -> Dict[str, str]:
    with _session_lock:
        if session_id not in _sessions:
            _sessions[session_id] = {"_ts": time.time()}
        else:
            _sessions[session_id]["_ts"] = time.time()
        return _sessions[session_id]


def flush_session(session_id: str):
    """Détruire la table de tokens d'une session (appeler en fin de conversation)."""
    with _session_lock:
        _sessions.pop(session_id, None)


def _cleanup_expired():
    """Supprimer les sessions expirées."""
    cutoff = time.time() - SESSION_TTL
    with _session_lock:
        expired = [sid for sid, data in _sessions.items() if data.get("_ts", 0) < cutoff]
        for sid in expired:
            del _sessions[sid]


# ─── Patterns regex ───────────────────────────────────────────────────────────

REGEX_PATTERNS = [
    # Ordre important : du plus spécifique au plus général

    # Email
    ("EMAIL",    r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b"),

    # IBAN (EU)
    ("IBAN",     r"\b[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){4,7}\d{1,4}\b"),

    # Carte bancaire (16 chiffres groupés)
    ("CB",       r"\b(?:\d{4}[\s\-]){3}\d{4}\b"),

    # Numéro de sécurité sociale français
    ("NSS",      r"\b[12]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{3}\s?\d{3}\s?\d{2}\b"),

    # Téléphone FR (+33, 06, 07, 01-05, 08, 09)
    ("PHONE",    r"\b(?:\+33|0033|0)\s?[1-9](?:[\s.\-]?\d{2}){4}\b"),

    # Téléphone international générique
    ("PHONE",    r"\+\d{1,3}[\s.\-]?\d{3,5}[\s.\-]?\d{3,5}[\s.\-]?\d{2,4}"),

    # Adresse IP v4
    ("IP",       r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),

    # Adresse IP v6
    ("IP",       r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b"),

    # URL (http/https/ftp)
    ("URL",      r"https?://[^\s<>\"']+|ftp://[^\s<>\"']+"),

    # Adresse postale FR (numéro + rue + code postal + ville)
    ("ADDRESS",  r"\b\d{1,4}\s+(?:rue|avenue|av\.|boulevard|bd\.?|allée|impasse|chemin|route|place|square)\s+[^\n,]{3,40},?\s*\d{5}\s+[A-ZÀ-Ý][a-zà-ÿ\-]{2,}"),

    # Code postal seul (5 chiffres FR)
    ("ZIPCODE",  r"\b(?:0[1-9]|[1-8]\d|9[0-5])\d{3}\b"),
]

_COMPILED = [(label, re.compile(pattern, re.IGNORECASE)) for label, pattern in REGEX_PATTERNS]


# ─── Tokenisation ─────────────────────────────────────────────────────────────

def _make_token(label: str, session: Dict[str, str]) -> str:
    """Générer un token unique pour une entité."""
    # Compter les tokens existants de ce type
    prefix = f"[{label}_"
    count = sum(1 for k in session if k.startswith(prefix))
    return f"[{label}_{count + 1}]"


def _register(value: str, label: str, session: Dict[str, str]) -> str:
    """
    Enregistrer une valeur et retourner son token.
    Si la valeur est déjà connue, retourner le token existant (idempotent).
    """
    # Chercher si la valeur existe déjà
    for token, original in session.items():
        if token.startswith("_"):
            continue
        if original == value:
            return token
    token = _make_token(label, session)
    session[token] = value
    return token


# ─── Anonymisation ────────────────────────────────────────────────────────────

def anonymize(text: str, session_id: str, use_spacy: bool = True) -> str:
    """
    Anonymiser le texte et stocker la table de tokens dans la session.
    Retourne le texte anonymisé.
    """
    if not text or not text.strip():
        return text

    _cleanup_expired()
    session = _get_session(session_id)

    # Phase 1 : Regex (patterns structurés)
    result = text
    # On collecte d'abord tous les matches pour éviter les chevauchements
    matches = []
    for label, pattern in _COMPILED:
        for m in pattern.finditer(result):
            matches.append((m.start(), m.end(), m.group(), label))

    # Trier par position décroissante pour remplacer sans décaler les indices
    matches.sort(key=lambda x: x[0], reverse=True)
    # Dédupliquer les chevauchements (garder le plus spécifique = premier dans la liste originale)
    seen_ranges = []
    filtered = []
    for start, end, value, label in matches:
        overlap = any(s < end and start < e for s, e in seen_ranges)
        if not overlap:
            filtered.append((start, end, value, label))
            seen_ranges.append((start, end))

    filtered.sort(key=lambda x: x[0], reverse=True)
    for start, end, value, label in filtered:
        token = _register(value, label, session)
        result = result[:start] + token + result[end:]

    # Phase 2 : spaCy NER (entités linguistiques)
    if use_spacy:
        nlp = _get_nlp()
        if nlp and _spacy_available:
            doc = nlp(result)
            ner_matches = []
            for ent in doc.ents:
                if ent.label_ in ("PER", "PERSON"):
                    label = "PERSON"
                elif ent.label_ in ("ORG",):
                    label = "ORG"
                elif ent.label_ in ("LOC", "GPE", "FAC"):
                    label = "LOCATION"
                else:
                    continue
                # Ne pas re-tokeniser ce qui est déjà un token [...]
                if re.match(r"^\[.+_\d+\]$", ent.text.strip()):
                    continue
                ner_matches.append((ent.start_char, ent.end_char, ent.text, label))

            ner_matches.sort(key=lambda x: x[0], reverse=True)
            for start, end, value, label in ner_matches:
                token = _register(value, label, session)
                result = result[:start] + token + result[end:]

    return result


# ─── Désanonymisation ─────────────────────────────────────────────────────────

def deanonymize(text: str, session_id: str) -> str:
    """
    Réinjecter les valeurs originales dans le texte reçu du LLM.
    Les tokens non reconnus sont laissés tels quels.
    """
    if not text:
        return text

    session = _get_session(session_id)
    result = text

    # Remplacer tous les tokens connus, du plus long au plus court
    tokens = [(k, v) for k, v in session.items() if not k.startswith("_")]
    tokens.sort(key=lambda x: len(x[0]), reverse=True)

    for token, original in tokens:
        result = result.replace(token, original)

    return result


# ─── Rapport de session ───────────────────────────────────────────────────────

def session_report(session_id: str) -> Dict[str, str]:
    """Retourner la table token→valeur pour debug/audit (ne jamais exposer en prod)."""
    session = _get_session(session_id)
    return {k: v for k, v in session.items() if not k.startswith("_")}


def session_entity_count(session_id: str) -> Dict[str, int]:
    """Nombre d'entités anonymisées par type dans la session."""
    report = session_report(session_id)
    counts: Dict[str, int] = {}
    for token in report:
        label = token.strip("[]").rsplit("_", 1)[0]
        counts[label] = counts.get(label, 0) + 1
    return counts


# ─── Intégration FastAPI (middleware helper) ──────────────────────────────────

class AnonymizerMiddleware:
    """
    Helper à utiliser dans les routes FastAPI.
    Usage :
        anon = AnonymizerMiddleware()
        clean_content = anon.before(content, conversation_id)
        # ... appel OpenRouter ...
        restored_response = anon.after(response, conversation_id)
    """

    def before(self, text: str, session_id: str) -> str:
        return anonymize(text, session_id)

    def after(self, text: str, session_id: str) -> str:
        return deanonymize(text, session_id)

    def stats(self, session_id: str) -> Dict[str, int]:
        return session_entity_count(session_id)

    def close(self, session_id: str):
        """Appeler en fin de conversation pour libérer la mémoire."""
        flush_session(session_id)


# Instance globale
anon = AnonymizerMiddleware()
