@echo off
title LLM Council
cd /d C:\Users\romua\OneDrive\Bureau\llm-council

echo.
echo  ╔══════════════════════════════════════╗
echo  ║         LLM Council - Start          ║
echo  ╚══════════════════════════════════════╝
echo.

:: Backend
echo  [1/2] Demarrage du backend...
start "LLM Council - Backend" cmd /k "cd /d C:\Users\romua\OneDrive\Bureau\llm-council && uv run python -m backend.main"

:: Attendre que le backend soit prêt
timeout /t 3 /nobreak >nul

:: Frontend
echo  [2/2] Demarrage du frontend...
start "LLM Council - Frontend" cmd /k "cd /d C:\Users\romua\OneDrive\Bureau\llm-council\frontend && npm run dev"

:: Attendre que le frontend soit prêt
timeout /t 4 /nobreak >nul

:: Ouvrir le navigateur
echo.
echo  Ouverture de http://localhost:5173
start http://localhost:5173

echo.
echo  Backend  : http://localhost:8001
echo  Frontend : http://localhost:5173
echo  Docs API : http://localhost:8001/docs
echo.
echo  Ferme cette fenetre pour arreter les serveurs.
echo  (les fenetres backend et frontend restent ouvertes)
pause >nul
