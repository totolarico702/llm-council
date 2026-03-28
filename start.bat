@echo off
title LLM Council - Launcher
color 0A

echo.
echo  ██╗     ██╗     ███╗   ███╗     ██████╗ ██████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗██╗
echo  ██║     ██║     ████╗ ████║    ██╔════╝██╔═══██╗██║   ██║████╗  ██║██╔════╝██║██║
echo  ██║     ██║     ██╔████╔██║    ██║     ██║   ██║██║   ██║██╔██╗ ██║██║     ██║██║
echo  ██║     ██║     ██║╚██╔╝██║    ██║     ██║   ██║██║   ██║██║╚██╗██║██║     ██║██║
echo  ███████╗███████╗██║ ╚═╝ ██║    ╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║╚██████╗██║███████╗
echo  ╚══════╝╚══════╝╚═╝     ╚═╝     ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝╚══════╝
echo.
echo  Demarrage de LLM Council...
echo.

:: Aller dans le dossier du script (racine du projet)
cd /d "%~dp0"

:: Vérifier que uv est disponible
where uv >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] 'uv' n'est pas installe ou pas dans le PATH.
    echo  Installez-le depuis https://docs.astral.sh/uv/
    pause
    exit /b 1
)

:: Vérifier que node/npm est disponible
where npm >nul 2>&1
if errorlevel 1 (
    echo  [ERREUR] 'npm' n'est pas installe ou pas dans le PATH.
    echo  Installez Node.js depuis https://nodejs.org/
    pause
    exit /b 1
)

echo  [1/2] Demarrage du backend (port 8001)...
start "LLM Council - Backend" cmd /k "cd /d "%~dp0" && uv run python -m backend.main"

:: Attendre que le backend soit pret
echo  Attente du backend...
timeout /t 3 /nobreak >nul

echo  [2/2] Demarrage du frontend (port 5173)...
start "LLM Council - Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

:: Attendre que le frontend soit pret
echo  Attente du frontend...
timeout /t 4 /nobreak >nul

echo.
echo  Ouverture du navigateur...
start http://localhost:5173

echo.
echo  LLM Council est demarre !
echo  - Backend :  http://localhost:8001
echo  - Frontend : http://localhost:5173
echo.
echo  Fermez les fenetres Backend et Frontend pour arreter.
echo.
pause
