# Copyright 2026 LLM Council Project
# Licensed under [LICENCE À DÉFINIR]
"""
agent_manager.py — LLM Council V3
==================================
Gère le cycle de vie des agents autonomes :
  - Déploiement (validation .cog + enregistrement)
  - Déclencheurs : schedulé (cron), événementiel (RAG), webhook
  - Exécution : DAG engine + historique
  - Pause / Reprise / Suppression
"""
import uuid, time, asyncio, logging
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from . import db as _db

log = logging.getLogger(__name__)

# ── Helpers TinyDB ────────────────────────────────────────────────────────────

def _agents():
    return _db._table("agents")

def _executions():
    return _db._table("agent_executions")

Q = _db.Q

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

# ── CRUD agents ───────────────────────────────────────────────────────────────

def list_agents() -> List[dict]:
    return _agents().all()

def get_agent(agent_id: str) -> Optional[dict]:
    return _agents().get(Q.agent_id == agent_id)

def create_agent(config: dict, created_by: str) -> dict:
    agent = {
        "agent_id":    str(uuid.uuid4()),
        "name":        config.get("name", "Agent sans nom"),
        "description": config.get("description", ""),
        "version":     config.get("version", "1.0"),
        "cog":         config.get("cog", {}),
        "trigger":     config.get("trigger", {"type": "manual"}),
        "output":      config.get("output", {"type": "conversation", "notify_users": []}),
        "status":      "active",
        "created_by":  created_by,
        "created_at":  _now(),
        "last_run_at": None,
        "last_error":  None,
        "run_count":   0,
    }
    _agents().insert(agent)
    return agent

def update_agent(agent_id: str, data: dict) -> Optional[dict]:
    _agents().update(data, Q.agent_id == agent_id)
    return get_agent(agent_id)

def delete_agent(agent_id: str) -> bool:
    removed = _agents().remove(Q.agent_id == agent_id)
    return bool(removed)

def pause_agent(agent_id: str) -> Optional[dict]:
    _agents().update({"status": "paused"}, Q.agent_id == agent_id)
    return get_agent(agent_id)

def resume_agent(agent_id: str) -> Optional[dict]:
    _agents().update({"status": "active"}, Q.agent_id == agent_id)
    return get_agent(agent_id)

# ── Exécutions ────────────────────────────────────────────────────────────────

def list_executions(agent_id: str, limit: int = 20) -> List[dict]:
    all_execs = _executions().search(Q.agent_id == agent_id)
    all_execs.sort(key=lambda x: x.get("started_at", ""), reverse=True)
    return all_execs[:limit]

def _start_execution(agent_id: str, trigger: str, context: dict) -> dict:
    exec_record = {
        "execution_id": str(uuid.uuid4()),
        "agent_id":     agent_id,
        "trigger":      trigger,
        "context":      context,
        "status":       "running",
        "started_at":   _now(),
        "finished_at":  None,
        "duration_s":   None,
        "output":       None,
        "error":        None,
    }
    _executions().insert(exec_record)
    return exec_record

def _finish_execution(execution_id: str, output: str = None, error: str = None):
    finished = _now()
    # Calculer la durée approximative
    rec = _executions().get(Q.execution_id == execution_id)
    duration = None
    if rec and rec.get("started_at"):
        try:
            start = datetime.fromisoformat(rec["started_at"].replace("Z", "+00:00"))
            end   = datetime.fromisoformat(finished.replace("Z", "+00:00"))
            duration = round((end - start).total_seconds(), 1)
        except Exception:
            pass
    _executions().update({
        "status":      "error" if error else "success",
        "finished_at": finished,
        "duration_s":  duration,
        "output":      output,
        "error":       error,
    }, Q.execution_id == execution_id)

# ── Déclenchement ─────────────────────────────────────────────────────────────

async def trigger_agent(agent_id: str, context: dict, trigger_source: str = "manual") -> str:
    """
    Déclenche un agent — retourne l'execution_id.
    Exécute le pipeline .cog de l'agent dans le DAG engine.
    """
    agent = get_agent(agent_id)
    if not agent:
        raise ValueError(f"Agent {agent_id} introuvable")
    if agent["status"] == "paused":
        raise ValueError(f"L'agent {agent['name']} est en pause")

    exec_rec = _start_execution(agent_id, trigger_source, context)
    exec_id  = exec_rec["execution_id"]

    # Lancer l'exécution en arrière-plan
    asyncio.ensure_future(_run_agent_async(agent, exec_id, context))

    # Mettre à jour last_run_at et run_count
    _agents().update({
        "last_run_at": _now(),
        "run_count":   (agent.get("run_count") or 0) + 1,
    }, Q.agent_id == agent_id)

    return exec_id

async def _run_agent_async(agent: dict, exec_id: str, context: dict):
    """Exécute le pipeline .cog de l'agent et stocke le résultat."""
    try:
        from .dag_engine import run_pipeline as _run_pipeline
        from .storage   import create_conversation, append_message, generate_conv_id

        cog      = agent.get("cog", {})
        nodes    = cog.get("nodes", [])
        edges    = cog.get("edges", [])
        user_msg = context.get("user_input", f"Exécution agent : {agent['name']}")

        if not nodes:
            _finish_execution(exec_id, error="Aucun nœud défini dans le pipeline .cog")
            _agents().update({"status": "error", "last_error": "empty_cog"}, Q.agent_id == agent["agent_id"])
            return

        result_text = []

        async def on_done(node_id, model, role, output, **kw):
            if role in ("chairman", "synthesizer") or not any(
                True for n in nodes
                if n.get("role") in ("chairman", "synthesizer")
            ):
                result_text.append(output)

        try:
            await _run_pipeline(
                nodes=nodes,
                edges=edges,
                user_query=user_msg,
                on_node_done=on_done,
            )
        except Exception as dag_err:
            log.error(f"[agent] DAG error for {agent['agent_id']}: {dag_err}")
            _finish_execution(exec_id, error=str(dag_err))
            _agents().update({"status": "error", "last_error": str(dag_err)},
                             Q.agent_id == agent["agent_id"])
            return

        final_output = "\n\n".join(result_text) or "(aucune sortie)"

        # Créer une conversation si output.type == conversation
        output_cfg = agent.get("output", {})
        if output_cfg.get("type") == "conversation":
            try:
                notify = output_cfg.get("notify_users", [])
                for login in notify:
                    user = _db._table("users").get(Q.login == login)
                    if user:
                        conv_id = generate_conv_id()
                        create_conversation(conv_id, owner_id=user["id"])
                        append_message(conv_id, {
                            "role": "assistant",
                            "content": f"**{agent['name']}** — exécution automatique\n\n{final_output}",
                            "agent_id": agent["agent_id"],
                            "execution_id": exec_id,
                        })
            except Exception as e:
                log.warning(f"[agent] impossible de créer la conversation: {e}")

        _finish_execution(exec_id, output=final_output[:2000])

    except Exception as e:
        log.exception(f"[agent] _run_agent_async failed: {e}")
        _finish_execution(exec_id, error=str(e))

# ── Scheduler APScheduler ─────────────────────────────────────────────────────

_scheduler = None

def get_scheduler():
    global _scheduler
    if _scheduler is None:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            _scheduler = AsyncIOScheduler(timezone="Europe/Paris")
        except ImportError:
            log.warning("[agent] APScheduler non installé — les crons seront ignorés")
    return _scheduler

def start_scheduler():
    """Démarre le scheduler et enregistre tous les agents actifs schedulés."""
    sched = get_scheduler()
    if sched is None:
        return
    if sched.running:
        return
    sched.start()
    _reload_scheduled_agents()
    log.info("[agent] Scheduler APScheduler démarré")

def _reload_scheduled_agents():
    """Recharge tous les agents cron actifs dans le scheduler."""
    sched = get_scheduler()
    if sched is None:
        return
    # Supprimer les jobs existants
    for job in sched.get_jobs():
        if job.id.startswith("agent_"):
            job.remove()
    # Réenregistrer
    for agent in _agents().all():
        if agent.get("status") == "active":
            _register_cron_job(agent, sched)

def _register_cron_job(agent: dict, sched=None):
    """Enregistre un cron job pour un agent schedulé."""
    trigger = agent.get("trigger", {})
    if trigger.get("type") != "scheduled":
        return
    cron_expr = trigger.get("cron")
    if not cron_expr:
        return
    if sched is None:
        sched = get_scheduler()
    if sched is None:
        return
    try:
        from apscheduler.triggers.cron import CronTrigger
        parts = cron_expr.split()  # "0 8 * * 1" → [min, hour, day, month, dow]
        if len(parts) == 5:
            cron_trigger = CronTrigger(
                minute=parts[0], hour=parts[1],
                day=parts[2], month=parts[3], day_of_week=parts[4],
                timezone=trigger.get("timezone", "Europe/Paris"),
            )
        else:
            return
        job_id = f"agent_{agent['agent_id']}"
        if sched.get_job(job_id):
            sched.remove_job(job_id)
        sched.add_job(
            _cron_trigger_wrapper,
            trigger=cron_trigger,
            id=job_id,
            args=[agent["agent_id"]],
            replace_existing=True,
        )
        log.info(f"[agent] Cron enregistré : {agent['name']} ({cron_expr})")
    except Exception as e:
        log.warning(f"[agent] Erreur enregistrement cron {agent['agent_id']}: {e}")

def _cron_trigger_wrapper(agent_id: str):
    """Wrapper synchrone appelé par APScheduler."""
    try:
        loop = asyncio.get_event_loop()
        loop.create_task(trigger_agent(agent_id, {}, "scheduled"))
    except Exception as e:
        log.error(f"[agent] cron trigger error {agent_id}: {e}")

# ── Événements RAG ────────────────────────────────────────────────────────────

async def handle_rag_event(event_type: str, folder_id: str, metadata: dict):
    """
    Déclenche les agents abonnés à un événement RAG.
    Appelé par la route d'upload RAG quand un document est ingéré.
    """
    for agent in _agents().all():
        if agent.get("status") != "active":
            continue
        trigger = agent.get("trigger", {})
        if trigger.get("type") != "rag_event":
            continue
        if trigger.get("event") != event_type:
            continue
        if trigger.get("folder_id") and trigger["folder_id"] != folder_id:
            continue
        # Vérifier le filtre extension si défini
        ext_filter = trigger.get("filter", {}).get("extension", [])
        if ext_filter:
            doc_ext = metadata.get("extension", "")
            if doc_ext not in ext_filter:
                continue
        try:
            await trigger_agent(agent["agent_id"], {
                "user_input": f"Document reçu : {metadata.get('filename', 'fichier')}",
                **metadata
            }, "rag_event")
            log.info(f"[agent] RAG event déclenché : {agent['name']}")
        except Exception as e:
            log.error(f"[agent] RAG event error {agent['agent_id']}: {e}")
