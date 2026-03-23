"""
Image generation via OpenRouter — /api/v1/chat/completions + modalities.
Format réponse : message.images[].imageUrl.url  (base64 data URL)
"""

import uuid, json, base64, os, httpx
from datetime import datetime
from pathlib import Path
from .config import OPENROUTER_API_KEY

IMAGES_DIR = Path("data/images")
IMAGES_DIR.mkdir(parents=True, exist_ok=True)

CHAT_URL = "https://openrouter.ai/api/v1/chat/completions"
IMAGE_GEN_VERSION = "v4-snake_case"  # pour vérifier quelle version tourne
HEADERS = {
    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:5173",
    "X-Title": "LLM Council",
}

IMAGE_MODELS = [
    {
        "id": "google/gemini-2.5-flash-image",
        "label": "Gemini 2.5 Flash Image (Nano Banana)",
        "modalities": ["image", "text"],
        "aspect_ratios": ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    {
        "id": "google/gemini-3.1-flash-image-preview",
        "label": "Gemini 3.1 Flash Image (Nano Banana 2)",
        "modalities": ["image", "text"],
        "aspect_ratios": ["1:1", "16:9", "9:16", "4:3", "3:4"],
    },
    {
        "id": "openai/gpt-5-image-mini",
        "label": "GPT-5 Image Mini",
        "modalities": ["image", "text"],
        "aspect_ratios": ["1:1", "16:9", "9:16"],
    },
    {
        "id": "black-forest-labs/flux.2-pro",
        "label": "FLUX.2 Pro",
        "modalities": ["image"],
        "aspect_ratios": ["1:1", "16:9", "9:16", "4:3"],
    },
    {
        "id": "black-forest-labs/flux.2-klein-4b",
        "label": "FLUX.2 Klein (rapide)",
        "modalities": ["image"],
        "aspect_ratios": ["1:1", "16:9", "9:16"],
    },
    {
        "id": "bytedance-seed/seedream-4.5",
        "label": "Seedream 4.5 (ByteDance)",
        "modalities": ["image"],
        "aspect_ratios": ["1:1", "16:9", "9:16", "4:3"],
    },
]

ENHANCE_SYSTEM = """Tu es un expert en prompt engineering pour la génération d'images IA.
Améliore le prompt utilisateur pour obtenir une image plus précise, esthétique et détaillée.
Conserve l'intention originale. Ajoute : style artistique, éclairage, composition, qualité.
Réponds UNIQUEMENT avec le prompt amélioré — pas d'explication, pas de guillemets."""


async def enhance_prompt(prompt: str, model: str = "openai/gpt-4o-mini") -> str:
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            CHAT_URL, headers=HEADERS,
            json={
                "model": model, "max_tokens": 300,
                "messages": [
                    {"role": "system", "content": ENHANCE_SYSTEM},
                    {"role": "user",   "content": prompt},
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"].strip()


def _save_b64(img_id: str, data_url: str) -> tuple:
    """Décode et sauvegarde une data URL base64. Retourne (local_path, api_url)."""
    b64 = data_url.split(",", 1)[1]
    local_path = str(IMAGES_DIR / f"{img_id}.png")
    with open(local_path, "wb") as f:
        f.write(base64.b64decode(b64))
    return local_path, f"/api/images/{img_id}.png"


def _extract(msg: dict, img_id: str) -> tuple:
    """
    Extrait l'image depuis la réponse OpenRouter.
    Format doc officiel : message.images[].imageUrl.url
    Fallbacks : message.images[] string, content[].image_url.url, content string
    Retourne (local_path, url) — l'un peut être None si URL distante.
    """
    # Format réel observé : images[] = [{type: "image_url", image_url: {url: "data:..."}}]
    images = msg.get("images") or []
    for img in images:
        if isinstance(img, str):
            raw = img
        elif isinstance(img, dict):
            # Format {type: "image_url", image_url: {url: ...}}
            if img.get("type") == "image_url":
                raw = (img.get("image_url") or {}).get("url", "")
            # Format doc officiel {imageUrl: {url: ...}}
            elif img.get("imageUrl"):
                raw = (img.get("imageUrl") or {}).get("url", "")
            else:
                raw = ""
        else:
            continue
        if raw.startswith("data:image"):
            return _save_b64(img_id, raw)
        if raw:
            return None, raw

    # Fallback : content liste de blocs
    content = msg.get("content") or []
    if isinstance(content, list):
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "image_url":
                raw = (block.get("image_url") or {}).get("url", "")
                if raw.startswith("data:image"):
                    return _save_b64(img_id, raw)
                if raw:
                    return None, raw

    # Fallback : content string base64
    if isinstance(content, str) and content.startswith("data:image"):
        return _save_b64(img_id, content)

    return None, None


async def generate_image(
    prompt: str,
    model: str = "google/gemini-2.5-flash-image",
    aspect_ratio: str = "1:1",
) -> dict:
    model_info = next((m for m in IMAGE_MODELS if m["id"] == model), None)
    modalities = model_info["modalities"] if model_info else ["image"]

    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "modalities": modalities,
    }
    if aspect_ratio and aspect_ratio != "1:1":
        body["image_config"] = {"aspect_ratio": aspect_ratio}

    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(CHAT_URL, headers=HEADERS, json=body)
        if resp.status_code != 200:
            raise ValueError(f"OpenRouter {resp.status_code}: {resp.text[:400]}")
        data = resp.json()

    msg = data["choices"][0]["message"]
    img_id = str(uuid.uuid4())
    local_path, url = _extract(msg, img_id)

    if not url:
        import json as _j
        raise ValueError(
            f"[image_gen {IMAGE_GEN_VERSION}] Aucune image.\n"
            f"Clés: {list(msg.keys())}\n"
            f"images[0]: {_j.dumps(msg.get('images', [None])[0] if msg.get('images') else None)[:300]}\n"
            f"content[:100]: {str(msg.get('content',''))[:100]}"
        )

    metadata = {
        "id": img_id, "prompt": prompt, "model": model,
        "aspect_ratio": aspect_ratio, "url": url,
        "local_path": local_path,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }
    with open(IMAGES_DIR / f"{img_id}.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    return metadata


def list_images(limit: int = 50) -> list:
    items = []
    for p in IMAGES_DIR.glob("*.json"):
        try:
            with open(p, encoding="utf-8") as f:
                items.append(json.load(f))
        except Exception:
            pass
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items[:limit]


def delete_image(img_id: str) -> bool:
    meta_path = IMAGES_DIR / f"{img_id}.json"
    if not meta_path.exists():
        return False
    with open(meta_path) as f:
        meta = json.load(f)
    if meta.get("local_path") and os.path.exists(meta["local_path"]):
        os.unlink(meta["local_path"])
    os.unlink(meta_path)
    return True
