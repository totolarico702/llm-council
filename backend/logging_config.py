# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
logging_config.py — LLM Council
=================================
Configure structlog pour un logging JSON structuré.
Usage dans chaque module :
    from .logging_config import get_logger
    log = get_logger(__name__)
    log.info("message", user_id=uid, key=value)
"""
import logging
import structlog


def configure_logging(level: str = "INFO") -> None:
    """Initialise structlog + stdlib logging. À appeler une seule fois au démarrage."""
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )

    logging.basicConfig(
        format="%(message)s",
        level=getattr(logging, level.upper(), logging.INFO),
    )


def get_logger(name: str = "llmc"):
    """Retourne un logger structlog lié à un nom de module."""
    return structlog.get_logger(name)
