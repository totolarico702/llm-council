"""
Usage logger — LLM Council
Capture les coûts OpenRouter et les persiste dans TinyDB (table usage_logs).
Migration transparente depuis data/usage_logs.jsonl si le fichier existe.
"""

import json, time, threading
from pathlib import Path
from typing import Optional

from .logging_config import get_logger

log = get_logger("usage_logger")

DATA_DIR       = Path("data")
LEGACY_FILE    = DATA_DIR / "usage_logs.jsonl"
INCIDENTS_FILE = DATA_DIR / "fallback_incidents.jsonl"
DATA_DIR.mkdir(exist_ok=True)

_incidents_lock = threading.Lock()

# Coûts OpenRouter fallback (si le champ usage est absent)
_FALLBACK_COSTS = {
    "openai/gpt-4o":           (0.005,  0.015),
    "openai/gpt-4o-mini":      (0.00015, 0.0006),
    "openai/gpt-5":            (0.01,   0.03),
    "anthropic/claude-sonnet": (0.003,  0.015),
    "anthropic/claude-haiku":  (0.00025, 0.00125),
    "google/gemini-2.5-flash": (0.00015, 0.0006),
    "google/gemini-3-pro":     (0.0035, 0.0105),
    "x-ai/grok":               (0.005,  0.015),
    "meta-llama/llama-3":      (0.00059, 0.00079),
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    for prefix, (p, c) in _FALLBACK_COSTS.items():
        if model.startswith(prefix):
            return round(prompt_tokens / 1000 * p + completion_tokens / 1000 * c, 8)
    return round((prompt_tokens + completion_tokens) / 1000 * 0.002, 8)


def _get_db():
    """Importe db à la demande pour éviter les imports circulaires."""
    from . import db
    return db


def _migrate_legacy_logs():
    """Migre usage_logs.jsonl vers TinyDB une seule fois."""
    if not LEGACY_FILE.exists():
        return
    db = _get_db()
    tbl = db._table("usage_logs")
    if tbl.all():
        return  # déjà migré
    count = 0
    with open(LEGACY_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                tbl.insert(json.loads(line))
                count += 1
            except json.JSONDecodeError:
                pass
    if count:
        log.info("usage_logs_migrated", count=count)
    LEGACY_FILE.rename(LEGACY_FILE.with_suffix(".jsonl.bak"))


# Migration au premier import
try:
    _migrate_legacy_logs()
except Exception as _e:
    log.error("usage_logs_migration_failed", error=str(_e))


def log_usage(
    *,
    user_id: Optional[str],
    user_login: Optional[str],
    service_id: Optional[str],
    model: str,
    conversation_id: Optional[str],
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    native_cost: Optional[float] = None,
):
    """Persiste une entrée de coût dans la table TinyDB usage_logs."""
    cost = native_cost if native_cost is not None else _estimate_cost(
        model, prompt_tokens, completion_tokens
    )
    entry = {
        "ts":                time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "user_id":           user_id,
        "user_login":        user_login,
        "service_id":        service_id,
        "model":             model,
        "conversation_id":   conversation_id,
        "prompt_tokens":     prompt_tokens,
        "completion_tokens": completion_tokens,
        "cost_usd":          cost,
    }
    _get_db()._table("usage_logs").insert(entry)
    return entry


def _read_logs() -> list:
    return _get_db()._table("usage_logs").all()


# ── Agrégations ───────────────────────────────────────────────────────────────

def _period_key(ts: str, period: str) -> str:
    import datetime
    try:
        dt = datetime.datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
    except Exception:
        return "unknown"
    if period == "day":
        return dt.strftime("%Y-%m-%d")
    elif period == "week":
        monday = dt - datetime.timedelta(days=dt.weekday())
        return monday.strftime("%Y-W%V")
    elif period == "month":
        return dt.strftime("%Y-%m")
    return dt.strftime("%Y-%m-%d")


def get_stats(period: str = "day", limit_periods: int = 30) -> dict:
    logs   = _read_logs()
    total  = 0.0
    by_period:  dict = {}
    by_user:    dict = {}
    by_service: dict = {}
    by_model:   dict = {}

    for e in logs:
        cost = e.get("cost_usd", 0) or 0
        pk = _period_key(e.get("ts", ""), period)
        by_period.setdefault(pk, {"cost": 0.0, "calls": 0})
        by_period[pk]["cost"]  += cost
        by_period[pk]["calls"] += 1
        uk = e.get("user_login") or "inconnu"
        by_user.setdefault(uk, {"cost": 0.0, "calls": 0, "user_id": e.get("user_id")})
        by_user[uk]["cost"]  += cost
        by_user[uk]["calls"] += 1
        sk = e.get("service_id") or "aucun"
        by_service.setdefault(sk, {"cost": 0.0, "calls": 0})
        by_service[sk]["cost"]  += cost
        by_service[sk]["calls"] += 1
        mk = e.get("model") or "inconnu"
        by_model.setdefault(mk, {"cost": 0.0, "calls": 0})
        by_model[mk]["cost"]  += cost
        by_model[mk]["calls"] += 1
        total += cost

    sorted_periods = sorted(by_period.items())[-limit_periods:]
    return {
        "total_cost_usd": round(total, 6),
        "period_type":    period,
        "by_period":  [{"period": k, **v} for k, v in sorted_periods],
        "by_user":    [{"login": k, **v} for k, v in sorted(by_user.items(),    key=lambda x: -x[1]["cost"])],
        "by_service": [{"service_id": k, **v} for k, v in sorted(by_service.items(), key=lambda x: -x[1]["cost"])],
        "by_model":   [{"model": k, **v} for k, v in sorted(by_model.items(),   key=lambda x: -x[1]["cost"])],
    }


# ── Incidents de fallback ─────────────────────────────────────────────────────
# Conservé en JSONL séparé (volume faible, pas de risque de race condition critique)

def log_fallback_incident(
    *,
    original_model: str,
    fallback_model: str,
    reason: str,
    node_id: str = None,
    pipeline_id: str = None,
    user_id: str = None,
) -> dict:
    entry = {
        "timestamp":      time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()),
        "original_model": original_model,
        "fallback_model": fallback_model,
        "reason":         reason,
        "node_id":        node_id,
        "pipeline_id":    pipeline_id,
        "user_id":        user_id,
    }
    with _incidents_lock:
        with open(INCIDENTS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read_fallback_incidents(
    model: str = None,
    since: str = None,
    limit: int = 50,
) -> list:
    if not INCIDENTS_FILE.exists():
        return []
    incidents = []
    with open(INCIDENTS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                if model and e.get("original_model") != model:
                    continue
                if since and e.get("timestamp", "") < since:
                    continue
                incidents.append(e)
            except json.JSONDecodeError:
                pass
    return incidents[-limit:]


# ── Dashboard Comex ────────────────────────────────────────────────────────────

def get_dashboard_data(token: str) -> dict:
    import datetime, calendar
    from . import db

    db.verify_dashboard_token(token)
    services_map = {s["id"]: s["name"] for s in db.list_services()}
    users_map    = {u["id"]: u          for u in db.list_users()}
    logs = _read_logs()

    now        = datetime.datetime.utcnow()
    cur_month  = now.strftime("%Y-%m")
    prev_dt    = (now.replace(day=1) - datetime.timedelta(days=1))
    prev_month = prev_dt.strftime("%Y-%m")

    def ts_to_dt(entry):
        ts = entry.get("ts") or entry.get("timestamp", "")
        try:
            return datetime.datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S")
        except Exception:
            return None

    def cost(e):
        return e.get("cost_usd") or e.get("native_cost") or 0.0

    month_logs, prev_logs = [], []
    for e in logs:
        dt = ts_to_dt(e)
        if dt is None:
            continue
        ym = dt.strftime("%Y-%m")
        if ym == cur_month:
            month_logs.append((e, dt))
        elif ym == prev_month:
            prev_logs.append((e, dt))

    total_cost_month     = sum(cost(e) for e, _ in month_logs)
    total_cost_prev      = sum(cost(e) for e, _ in prev_logs)
    total_requests_month = len(month_logs)

    variation_pct = round(
        ((total_cost_month - total_cost_prev) / total_cost_prev) * 100, 1
    ) if total_cost_prev > 0 else 0.0

    days_elapsed  = now.day
    days_in_month = calendar.monthrange(now.year, now.month)[1]
    projection    = round((total_cost_month / days_elapsed) * days_in_month, 2) if days_elapsed > 0 and total_cost_month > 0 else 0.0
    avg_cost_per_req = round(total_cost_month / total_requests_month, 4) if total_requests_month > 0 else 0.0

    by_svc: dict = {}
    for e, _ in month_logs:
        sid  = e.get("service_id") or "none"
        name = services_map.get(sid, "Non assigné")
        by_svc.setdefault(name, {"cost": 0.0, "requests": 0})
        by_svc[name]["cost"]     += cost(e)
        by_svc[name]["requests"] += 1
    by_service = sorted(
        [{"service_name": k, "cost": round(v["cost"], 2), "requests": v["requests"]}
         for k, v in by_svc.items()],
        key=lambda x: -x["cost"]
    )

    by_mdl: dict = {}
    for e, _ in month_logs:
        m     = e.get("model") or "inconnu"
        short = m.split("/")[-1] if "/" in m else m
        by_mdl.setdefault(short, {"cost": 0.0, "requests": 0})
        by_mdl[short]["cost"]     += cost(e)
        by_mdl[short]["requests"] += 1
    by_model = [
        {"model": k, "cost": round(v["cost"], 2), "requests": v["requests"],
         "pct": round(v["cost"] / total_cost_month * 100, 1) if total_cost_month > 0 else 0.0}
        for k, v in sorted(by_mdl.items(), key=lambda x: -x[1]["cost"])
    ]

    by_usr: dict = {}
    for e, _ in month_logs:
        uid   = e.get("user_id") or ""
        login = e.get("user_login") or "inconnu"
        u     = users_map.get(uid, {})
        sid   = u.get("service_id") or e.get("service_id") or "none"
        sname = services_map.get(sid, "Non assigné")
        by_usr.setdefault(login, {"cost": 0.0, "requests": 0, "service": sname})
        by_usr[login]["cost"]     += cost(e)
        by_usr[login]["requests"] += 1
    top_users = sorted(
        [{"login": k, "service": v["service"], "cost": round(v["cost"], 2), "requests": v["requests"]}
         for k, v in by_usr.items()],
        key=lambda x: -x["cost"]
    )[:5]

    by_day: dict = {}
    for e, dt in month_logs:
        day = dt.strftime("%Y-%m-%d")
        by_day.setdefault(day, 0.0)
        by_day[day] += cost(e)
    daily_costs = [{"date": k, "cost": round(v, 2)} for k, v in sorted(by_day.items())]

    return {
        "period":       cur_month,
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "kpis": {
            "total_cost_month":        round(total_cost_month, 2),
            "total_cost_prev_month":   round(total_cost_prev, 2),
            "variation_pct":           variation_pct,
            "projection_end_of_month": projection,
            "total_requests_month":    total_requests_month,
            "avg_cost_per_request":    avg_cost_per_req,
        },
        "by_service":  by_service,
        "by_model":    by_model,
        "top_users":   top_users,
        "daily_costs": daily_costs,
    }
