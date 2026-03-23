@echo off
chcp 65001 > nul
echo Installation spaCy - LLM Council
echo.

echo [1/2] Installation de spaCy + modele francais...
uv add spacy
uv add https://github.com/explosion/spacy-models/releases/download/fr_core_news_sm-3.8.0/fr_core_news_sm-3.8.0-py3-none-any.whl
if %errorlevel% neq 0 (
    echo Tentative version 3.7...
    uv add https://github.com/explosion/spacy-models/releases/download/fr_core_news_sm-3.7.0/fr_core_news_sm-3.7.0-py3-none-any.whl
)

echo.
echo [2/2] Verification...
uv run python -c "import spacy; nlp=spacy.load('fr_core_news_sm'); doc=nlp('Jean Dupont, jean@test.fr'); print('OK modele charge'); print('Entites:', [(e.text,e.label_) for e in doc.ents])"

echo.
echo Termine.
pause
