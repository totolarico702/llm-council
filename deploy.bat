@echo off
setlocal EnableDelayedExpansion

echo.
echo  ██╗     ██╗     ███╗   ███╗     ██████╗ ██████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗██╗
echo  ██║     ██║     ████╗ ████║    ██╔════╝██╔═══██╗██║   ██║████╗  ██║██╔════╝██║██║
echo  ██║     ██║     ██╔████╔██║    ██║     ██║   ██║██║   ██║██╔██╗ ██║██║     ██║██║
echo  ██║     ██║     ██║╚██╔╝██║    ██║     ██║   ██║██║   ██║██║╚██╗██║██║     ██║██║
echo  ███████╗███████╗██║ ╚═╝ ██║    ╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║╚██████╗██║███████╗
echo  ╚══════╝╚══════╝╚═╝     ╚═╝     ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝╚══════╝
echo.
echo  LLM Council — Script de deploiement Windows
echo  ============================================
echo.

:: ─── Étape 1 : Vérification des prérequis ───────────────────────────────────

echo [1/7] Verification des prerequis...

:: Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] Python n'est pas installe ou pas dans le PATH.
    echo  Telechargez Python 3.10+ sur https://www.python.org/downloads/
    pause & exit /b 1
)
for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PY_VER=%%v
echo  [OK] Python %PY_VER%

:: uv
uv --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] uv non trouve. Installation...
    pip install uv --quiet
    uv --version >nul 2>&1
    if errorlevel 1 (
        echo  [ERREUR] Echec installation uv.
        echo  Installez manuellement : pip install uv
        pause & exit /b 1
    )
)
for /f "tokens=2" %%v in ('uv --version 2^>^&1') do set UV_VER=%%v
echo  [OK] uv %UV_VER%

:: Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] Node.js n'est pas installe ou pas dans le PATH.
    echo  Telechargez Node.js 18+ sur https://nodejs.org/
    pause & exit /b 1
)
for /f %%v in ('node --version') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: npm
npm --version >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] npm n'est pas installe.
    pause & exit /b 1
)
for /f %%v in ('npm --version') do set NPM_VER=%%v
echo  [OK] npm %NPM_VER%

echo.

:: ─── Étape 2 : Fichier .env ──────────────────────────────────────────────────

echo [2/7] Configuration de l'environnement...

if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo  [INFO] Fichier .env cree depuis .env.example
        echo.
        echo  ╔══════════════════════════════════════════════════════════════╗
        echo  ║  ACTION REQUISE : Editez le fichier .env                    ║
        echo  ║  et renseignez votre OPENROUTER_API_KEY avant de continuer  ║
        echo  ╚══════════════════════════════════════════════════════════════╝
        echo.
        set /p CONTINUE="Appuyez sur ENTREE une fois le .env configure..."
    ) else (
        echo  [ERREUR] Ni .env ni .env.example trouve.
        pause & exit /b 1
    )
) else (
    echo  [OK] .env existant conserve
)

:: Vérifier que OPENROUTER_API_KEY est renseignée
findstr /C:"OPENROUTER_API_KEY=sk-or-" ".env" >nul 2>&1
if errorlevel 1 (
    echo  [AVERTISSEMENT] OPENROUTER_API_KEY ne semble pas configuree dans .env
    echo  L'application demarrera mais les appels LLM echoueront.
)

echo.

:: ─── Étape 3 : Dépendances Python ────────────────────────────────────────────

echo [3/7] Installation des dependances Python...

uv sync
if errorlevel 1 (
    echo  [ERREUR] Echec de uv sync
    pause & exit /b 1
)

uv add slowapi structlog >nul 2>&1
echo  [OK] Dependances Python installees

echo.

:: ─── Étape 4 : Dépendances Node.js ───────────────────────────────────────────

echo [4/7] Installation des dependances Node.js...

cd frontend
npm install --silent
if errorlevel 1 (
    echo  [ERREUR] Echec de npm install
    cd ..
    pause & exit /b 1
)
cd ..
echo  [OK] Dependances Node.js installees

echo.

:: ─── Étape 5 : Ollama (optionnel) ────────────────────────────────────────────

echo [5/7] Verification Ollama (optionnel)...

ollama --version >nul 2>&1
if errorlevel 1 (
    echo  [INFO] Ollama non installe - les modeles locaux ne seront pas disponibles
    echo  Pour installer Ollama : https://ollama.ai/
) else (
    for /f %%v in ('ollama --version') do set OLLAMA_VER=%%v
    echo  [OK] Ollama detecte
    ollama list | findstr "mistral" >nul 2>&1
    if errorlevel 1 (
        echo  [INFO] Telechargement du modele mistral:latest...
        ollama pull mistral:latest
    ) else (
        echo  [OK] mistral:latest deja installe
    )
)

echo.

:: ─── Étape 6 : Vérification syntaxe backend ──────────────────────────────────

echo [6/7] Verification du backend...

uv run python -c "from backend.main import app; print('  [OK] Backend charge correctement - ' + str(len([r for r in app.routes if hasattr(r, 'path')])) + ' routes')"
if errorlevel 1 (
    echo  [ERREUR] Le backend ne se charge pas correctement.
    echo  Verifiez les logs ci-dessus.
    pause & exit /b 1
)

echo.

:: ─── Étape 7 : Tests (optionnel) ─────────────────────────────────────────────

echo [7/7] Tests unitaires...

uv run pytest backend/tests/ -q --tb=no 2>nul
if errorlevel 1 (
    echo  [AVERTISSEMENT] Certains tests ont echoue - l'application peut quand meme demarrer
) else (
    echo  [OK] Tous les tests passent
)

echo.

:: ─── Résumé final ─────────────────────────────────────────────────────────────

echo  ════════════════════════════════════════════════════════
echo  Deploiement termine avec succes !
echo  ════════════════════════════════════════════════════════
echo.
echo  Pour demarrer l'application :
echo    start.bat
echo.
echo  URLs :
echo    Frontend : http://localhost:5173
echo    Backend  : http://localhost:8001
echo    API docs : http://localhost:8001/docs
echo.
echo  Identifiants par defaut : admin / admin
echo  (vous serez force de changer le mot de passe au 1er login)
echo.

pause
