#!/bin/bash

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}[OK]${NC} $1"; }
info() { echo -e "  ${BLUE}[INFO]${NC} $1"; }
warn() { echo -e "  ${YELLOW}[AVERTISSEMENT]${NC} $1"; }
fail() { echo -e "  ${RED}[ERREUR]${NC} $1"; exit 1; }

echo ""
echo "  ██╗     ██╗     ███╗   ███╗     ██████╗ ██████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗██╗"
echo "  ██║     ██║     ████╗ ████║    ██╔════╝██╔═══██╗██║   ██║████╗  ██║██╔════╝██║██║"
echo "  ██║     ██║     ██╔████╔██║    ██║     ██║   ██║██║   ██║██╔██╗ ██║██║     ██║██║"
echo "  ██║     ██║     ██║╚██╔╝██║    ██║     ██║   ██║██║   ██║██║╚██╗██║██║     ██║██║"
echo "  ███████╗███████╗██║ ╚═╝ ██║    ╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║╚██████╗██║███████╗"
echo "  ╚══════╝╚══════╝╚═╝     ╚═╝     ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝╚══════╝"
echo ""
echo "  LLM Council — Script de déploiement Linux/Mac"
echo "  ================================================"
echo ""

# ─── Étape 1 : Vérification des prérequis ───────────────────────────────────

echo "[1/7] Vérification des prérequis..."

# Python
if ! command -v python3 &>/dev/null; then
    fail "Python3 n'est pas installé. Installez Python 3.10+ depuis https://www.python.org/"
fi
PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
ok "Python $PY_VER"

# uv
if ! command -v uv &>/dev/null; then
    info "uv non trouvé. Installation..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="$HOME/.cargo/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        fail "Échec installation uv. Installez manuellement : https://docs.astral.sh/uv/"
    fi
fi
UV_VER=$(uv --version 2>&1 | awk '{print $2}')
ok "uv $UV_VER"

# Node.js
if ! command -v node &>/dev/null; then
    fail "Node.js n'est pas installé. Installez Node.js 18+ depuis https://nodejs.org/"
fi
NODE_VER=$(node --version)
ok "Node.js $NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
    fail "npm n'est pas installé."
fi
NPM_VER=$(npm --version)
ok "npm $NPM_VER"

echo ""

# ─── Étape 2 : Fichier .env ──────────────────────────────────────────────────

echo "[2/7] Configuration de l'environnement..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        info "Fichier .env créé depuis .env.example"
        echo ""
        echo "  ╔══════════════════════════════════════════════════════════════╗"
        echo "  ║  ACTION REQUISE : Editez le fichier .env                    ║"
        echo "  ║  et renseignez votre OPENROUTER_API_KEY avant de continuer  ║"
        echo "  ╚══════════════════════════════════════════════════════════════╝"
        echo ""
        read -p "  Appuyez sur ENTREE une fois le .env configuré..."
    else
        fail "Ni .env ni .env.example trouvé."
    fi
else
    ok ".env existant conservé"
fi

# Vérifier OPENROUTER_API_KEY
if ! grep -q "OPENROUTER_API_KEY=sk-or-" .env 2>/dev/null; then
    warn "OPENROUTER_API_KEY ne semble pas configurée dans .env"
    warn "L'application démarrera mais les appels LLM échoueront."
fi

echo ""

# ─── Étape 3 : Dépendances Python ────────────────────────────────────────────

echo "[3/7] Installation des dépendances Python..."

uv sync
uv add slowapi structlog > /dev/null 2>&1
ok "Dépendances Python installées"

echo ""

# ─── Étape 4 : Dépendances Node.js ───────────────────────────────────────────

echo "[4/7] Installation des dépendances Node.js..."

cd frontend
npm install --silent
cd ..
ok "Dépendances Node.js installées"

echo ""

# ─── Étape 5 : Ollama (optionnel) ────────────────────────────────────────────

echo "[5/7] Vérification Ollama (optionnel)..."

if ! command -v ollama &>/dev/null; then
    info "Ollama non installé - les modèles locaux ne seront pas disponibles"
    info "Pour installer Ollama : https://ollama.ai/"
else
    ok "Ollama détecté"
    if ! ollama list | grep -q "mistral" 2>/dev/null; then
        info "Téléchargement du modèle mistral:latest..."
        ollama pull mistral:latest
    else
        ok "mistral:latest déjà installé"
    fi
fi

echo ""

# ─── Étape 6 : Vérification syntaxe backend ──────────────────────────────────

echo "[6/7] Vérification du backend..."

ROUTE_COUNT=$(uv run python -c "
from backend.main import app
print(len([r for r in app.routes if hasattr(r, 'path')]))
" 2>/dev/null)

if [ $? -ne 0 ]; then
    fail "Le backend ne se charge pas correctement. Vérifiez les logs."
fi
ok "Backend chargé correctement — $ROUTE_COUNT routes"

echo ""

# ─── Étape 7 : Tests ─────────────────────────────────────────────────────────

echo "[7/7] Tests unitaires..."

if uv run pytest backend/tests/ -q --tb=no 2>/dev/null; then
    ok "Tous les tests passent"
else
    warn "Certains tests ont échoué — l'application peut quand même démarrer"
fi

echo ""

# ─── Résumé final ─────────────────────────────────────────────────────────────

echo "  ════════════════════════════════════════════════════════"
echo "  Déploiement terminé avec succès !"
echo "  ════════════════════════════════════════════════════════"
echo ""
echo "  Pour démarrer l'application :"
echo "    ./start.sh"
echo ""
echo "  URLs :"
echo "    Frontend : http://localhost:5173"
echo "    Backend  : http://localhost:8001"
echo "    API docs : http://localhost:8001/docs"
echo ""
echo "  Identifiants par défaut : admin / admin"
echo "  (vous serez forcé de changer le mot de passe au 1er login)"
echo ""
