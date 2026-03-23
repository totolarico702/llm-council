"""
errors.py — LLM Council
========================
Format d'erreur uniforme pour toutes les routes FastAPI.
"""
from fastapi import HTTPException
from typing import Optional


def api_error(
    code: str,
    message: str,
    detail: Optional[str] = None,
    status: int = 400,
) -> None:
    """Lève une HTTPException avec un format d'erreur uniforme."""
    raise HTTPException(
        status_code=status,
        detail={"error": message, "code": code, "detail": detail},
    )
