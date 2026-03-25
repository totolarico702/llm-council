# BRIEF_DESIGN_COUNCIL — LLM Council Design System
## Direction : "Salle de Conseil — Édition de Luxe Sobre"

---

## Vision

LLM Council est un outil de délibération intellectuelle. Plusieurs cerveaux
artificiels débattent, un Chairman tranche. C'est sérieux, dense, sophistiqué.

L'esthétique cible : **publication financière haut de gamme**.
Références : The Economist, Bloomberg Terminal, rapport annuel UBS, Financial Times.

**Ce qui rend ce design INOUBLIABLE :**
La tension entre l'élégance sérielle (Playfair Display) et la densité technique
(JetBrains Mono). Un filet doré qui traverse l'interface comme une ligne éditoriale.
Sobre mais impossible à confondre avec un autre outil.

---

## Partie 1 — Variables CSS

```css
/* frontend/src/styles/variables.css */

@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700;900&family=JetBrains+Mono:wght@300;400;500;600&display=swap');

:root {
  /* ── Palette principale ─────────────────────────── */

  /* Noirs profonds — jamais noir pur */
  --color-bg:             #0a0a0a;
  --color-surface:        #111111;
  --color-surface-2:      #181818;
  --color-surface-raised: #1f1f1f;
  --color-surface-inset:  #080808;

  /* Bordures — subtiles, pas agressives */
  --color-border:         #2a2a2a;
  --color-border-muted:   #1e1e1e;
  --color-border-accent:  #b8941f;  /* filet doré */

  /* Texte */
  --color-text:           #f0ede6;  /* blanc cassé chaud */
  --color-text-muted:     #7a7570;
  --color-text-disabled:  #3a3835;
  --color-text-inverse:   #0a0a0a;

  /* Accent or/laiton — UN SEUL accent chaud */
  --color-gold:           #b8941f;
  --color-gold-light:     #d4aa2a;
  --color-gold-dim:       #6b5510;
  --color-gold-subtle:    rgba(184, 148, 31, 0.08);

  /* États */
  --color-success:        #2d6a3f;
  --color-success-text:   #6dbb87;
  --color-danger:         #6b1a1a;
  --color-danger-text:    #cc6666;
  --color-warning:        #6b4a0a;
  --color-warning-text:   #cc9944;

  /* ── Typographie ────────────────────────────────── */
  --font-display:   'Playfair Display', Georgia, serif;
  --font-main:      'JetBrains Mono', 'Fira Code', monospace;
  --font-mono:      'JetBrains Mono', monospace;

  --font-size-xs:   10px;
  --font-size-sm:   11px;
  --font-size-base: 13px;
  --font-size-md:   14px;
  --font-size-lg:   16px;
  --font-size-xl:   20px;
  --font-size-2xl:  28px;
  --font-size-3xl:  36px;

  --font-weight-light:    300;
  --font-weight-normal:   400;
  --font-weight-medium:   500;
  --font-weight-semibold: 600;
  --font-weight-bold:     700;
  --font-weight-black:    900;

  --letter-spacing-tight: -0.02em;
  --letter-spacing-normal: 0em;
  --letter-spacing-wide:  0.06em;
  --letter-spacing-wider: 0.12em;

  --line-height-tight:  1.2;
  --line-height-base:   1.55;
  --line-height-loose:  1.8;

  /* ── Spacing ────────────────────────────────────── */
  --spacing-xs:   4px;
  --spacing-sm:   8px;
  --spacing-md:   16px;
  --spacing-lg:   24px;
  --spacing-xl:   40px;
  --spacing-2xl:  64px;

  /* ── Radius — minimaliste, pas arrondi excessif ─── */
  --radius-sm:    2px;
  --radius-md:    4px;
  --radius-lg:    6px;
  --radius-xl:    8px;
  --radius-full:  9999px;

  /* ── Ombres — douces, profondes ─────────────────── */
  --shadow-sm:    0 1px 3px rgba(0,0,0,0.4);
  --shadow-md:    0 4px 16px rgba(0,0,0,0.5);
  --shadow-lg:    0 8px 32px rgba(0,0,0,0.6);
  --shadow-gold:  0 0 20px rgba(184,148,31,0.12);
  --shadow-inset: inset 0 1px 3px rgba(0,0,0,0.5);

  /* ── Layout ─────────────────────────────────────── */
  --sidebar-width:              240px;
  --pipeline-assistant-width:   260px;
  --pipeline-nodeconfig-width:  300px;
  --header-height:              48px;

  /* ── Transitions ────────────────────────────────── */
  --transition-fast:    0.12s ease;
  --transition-normal:  0.22s ease;
  --transition-slow:    0.4s ease;
}
```

---

## Partie 2 — Composants

### 2.1 Typographie — La tension serif/mono

```css
/* Titres — Playfair Display, élégance éditoriale */
h1, h2, .display-title {
  font-family: var(--font-display);
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  letter-spacing: var(--letter-spacing-tight);
  line-height: var(--line-height-tight);
}

/* Sous-titres — Playfair italic */
h3, .section-title {
  font-family: var(--font-display);
  font-style: italic;
  font-weight: var(--font-weight-normal);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
}

/* Corps — JetBrains Mono, précision technique */
body, p, span, input, button {
  font-family: var(--font-mono);
  font-weight: var(--font-weight-light);
  font-size: var(--font-size-base);
  color: var(--color-text);
  line-height: var(--line-height-base);
}

/* Labels techniques — uppercase espacé */
.label, .tag, .badge {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
}

/* Nom des modèles LLM — Playfair, mis en valeur */
.model-name {
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--font-size-md);
  color: var(--color-gold-light);
}
```

### 2.2 Le Filet Doré — élément signature

```css
/* Séparateur doré horizontal — signature visuelle */
.gold-rule {
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--color-gold-dim) 20%,
    var(--color-gold) 50%,
    var(--color-gold-dim) 80%,
    transparent 100%
  );
  border: none;
  margin: var(--spacing-lg) 0;
}

/* Filet vertical — séparateur de colonnes */
.gold-rule-vertical {
  width: 1px;
  background: linear-gradient(
    180deg,
    transparent 0%,
    var(--color-gold-dim) 15%,
    var(--color-gold) 50%,
    var(--color-gold-dim) 85%,
    transparent 100%
  );
}

/* Accent gauche doré — mise en avant d'un bloc */
.gold-accent-left {
  border-left: 2px solid var(--color-gold);
  padding-left: var(--spacing-md);
}
```

### 2.3 Boutons

```css
/* Bouton primaire — or sur noir */
.btn-primary {
  background: var(--color-gold);
  color: var(--color-text-inverse);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
  padding: 8px 20px;
  border-radius: var(--radius-sm);
  border: none;
  cursor: pointer;
  transition: var(--transition-fast);
  box-shadow: var(--shadow-gold);
}

.btn-primary:hover {
  background: var(--color-gold-light);
  box-shadow: 0 0 28px rgba(184,148,31,0.25);
}

/* Bouton secondaire — bordure dorée */
.btn-secondary {
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
  padding: 7px 18px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  cursor: pointer;
  transition: var(--transition-fast);
}

.btn-secondary:hover {
  border-color: var(--color-gold-dim);
  color: var(--color-gold-light);
}

/* Bouton ghost — texte seul */
.btn-ghost {
  background: transparent;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
  padding: 6px 12px;
  border: none;
  cursor: pointer;
  transition: var(--transition-fast);
}

.btn-ghost:hover {
  color: var(--color-text);
}

/* Bouton danger */
.btn-danger {
  background: transparent;
  color: var(--color-danger-text);
  border: 1px solid var(--color-danger);
  /* même structure que btn-secondary */
}
```

### 2.4 Sidebar — "Le Journal de Bord"

```css
.sidebar {
  background: var(--color-surface);
  border-right: 1px solid var(--color-border);
  width: var(--sidebar-width);
  display: flex;
  flex-direction: column;
}

/* Logo — grand, Playfair, impact */
.sidebar-logo {
  font-family: var(--font-display);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-black);
  color: var(--color-text);
  letter-spacing: var(--letter-spacing-tight);
  padding: var(--spacing-lg) var(--spacing-md);
  border-bottom: 1px solid var(--color-border-accent);
}

.sidebar-logo span {
  color: var(--color-gold);
}

/* Sections */
.sidebar-section-title {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
  color: var(--color-text-disabled);
  padding: var(--spacing-md) var(--spacing-md) var(--spacing-xs);
}

/* Items */
.sidebar-item {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-light);
  color: var(--color-text-muted);
  padding: 7px var(--spacing-md);
  border-radius: var(--radius-md);
  margin: 1px var(--spacing-xs);
  cursor: pointer;
  transition: var(--transition-fast);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-item:hover {
  background: var(--color-surface-2);
  color: var(--color-text);
}

.sidebar-item.active {
  background: var(--color-gold-subtle);
  color: var(--color-gold-light);
  border-left: 2px solid var(--color-gold);
  padding-left: calc(var(--spacing-md) - 2px);
}
```

### 2.5 Zone de chat — "La Tribune"

```css
/* Conteneur messages */
.chat-messages {
  background: var(--color-bg);
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-xl) var(--spacing-lg);
}

/* Message user */
.message-user .message-content {
  font-family: var(--font-display);
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-normal);
  color: var(--color-text);
  font-style: italic;
  line-height: var(--line-height-loose);
}

/* Header message user */
.message-user .message-header {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wider);
  color: var(--color-text-disabled);
  margin-bottom: var(--spacing-xs);
}

/* Message assistant — réponse LLM */
.message-assistant {
  border-left: 2px solid var(--color-border);
  padding-left: var(--spacing-lg);
  margin-left: var(--spacing-lg);
}

.message-assistant.chairman {
  border-left-color: var(--color-gold);
  box-shadow: -4px 0 20px rgba(184,148,31,0.06);
}

/* Nom du modèle */
.message-model-name {
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--font-size-sm);
  color: var(--color-gold-light);
  margin-bottom: var(--spacing-xs);
}

/* Input de chat */
.chat-input-container {
  background: var(--color-surface);
  border-top: 1px solid var(--color-border);
  padding: var(--spacing-md);
}

.chat-input {
  background: var(--color-surface-inset);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
  width: 100%;
  resize: none;
  transition: var(--transition-fast);
}

.chat-input:focus {
  border-color: var(--color-gold-dim);
  box-shadow: 0 0 0 3px rgba(184,148,31,0.08);
  outline: none;
}
```

### 2.6 Cards & Panels — "Les Dossiers"

```css
.card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
}

.card-header {
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-title {
  font-family: var(--font-display);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text);
}
```

### 2.7 Badges & Statuts

```css
/* Badge modèle actif */
.badge-active {
  background: var(--color-success);
  color: var(--color-success-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

/* Badge gold — Chairman, premium */
.badge-gold {
  background: var(--color-gold-subtle);
  color: var(--color-gold-light);
  border: 1px solid var(--color-gold-dim);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
}

/* Indicateur de statut — point animé */
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  display: inline-block;
}

.status-dot.active {
  background: var(--color-success-text);
  box-shadow: 0 0 6px var(--color-success-text);
  animation: pulse-green 2s ease-in-out infinite;
}

.status-dot.gold {
  background: var(--color-gold);
  box-shadow: 0 0 6px var(--color-gold);
}
```

### 2.8 Pipeline Editor — "La Salle des Machines"

```css
/* Canvas — fond texturé sombre */
.react-flow__background {
  background-color: var(--color-bg);
  background-image:
    radial-gradient(circle, var(--color-border-muted) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* Nœuds — cartes éditoriales */
.react-flow__node {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  font-family: var(--font-mono);
  min-width: 160px;
  transition: var(--transition-fast);
}

.react-flow__node:hover {
  border-color: var(--color-border-accent);
  box-shadow: var(--shadow-md), var(--shadow-gold);
}

.react-flow__node.selected {
  border-color: var(--color-gold);
  box-shadow: var(--shadow-md), 0 0 0 1px var(--color-gold);
}

/* Header nœud */
.node-header {
  padding: 6px 12px;
  border-bottom: 1px solid var(--color-border);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: var(--letter-spacing-wide);
  color: var(--color-text-muted);
}

/* Nœud Chairman — doré */
.node-chairman .node-header {
  border-bottom-color: var(--color-gold-dim);
  color: var(--color-gold-light);
}

/* Connexions — lignes or subtiles */
.react-flow__edge path {
  stroke: var(--color-border-accent);
  stroke-width: 1.5;
  opacity: 0.6;
}

.react-flow__edge.selected path,
.react-flow__edge:hover path {
  stroke: var(--color-gold-light);
  opacity: 1;
}
```

### 2.9 Login Page — "L'Entrée du Conseil"

```css
.login-page {
  background: var(--color-bg);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Pattern diagonal subtil */
  background-image:
    repeating-linear-gradient(
      45deg,
      transparent,
      transparent 40px,
      rgba(184,148,31,0.015) 40px,
      rgba(184,148,31,0.015) 41px
    );
}

.login-card {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-top: 2px solid var(--color-gold);
  border-radius: var(--radius-lg);
  padding: var(--spacing-2xl);
  width: 380px;
  box-shadow: var(--shadow-lg), var(--shadow-gold);
}

.login-title {
  font-family: var(--font-display);
  font-size: var(--font-size-3xl);
  font-weight: var(--font-weight-black);
  color: var(--color-text);
  text-align: center;
  letter-spacing: var(--letter-spacing-tight);
  margin-bottom: var(--spacing-xs);
}

.login-subtitle {
  font-family: var(--font-display);
  font-style: italic;
  font-size: var(--font-size-sm);
  color: var(--color-gold-light);
  text-align: center;
  margin-bottom: var(--spacing-xl);
}
```

---

## Partie 3 — Micro-interactions

```css
/* Apparition messages — fade + slide subtil */
@keyframes message-appear {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.message-new {
  animation: message-appear 0.25s ease forwards;
}

/* Pulsation statut actif */
@keyframes pulse-green {
  0%, 100% { opacity: 1; box-shadow: 0 0 4px var(--color-success-text); }
  50%       { opacity: 0.7; box-shadow: 0 0 10px var(--color-success-text); }
}

/* Lueur dorée — hover bouton primaire */
@keyframes gold-pulse {
  0%, 100% { box-shadow: 0 0 10px rgba(184,148,31,0.15); }
  50%       { box-shadow: 0 0 24px rgba(184,148,31,0.3); }
}

/* Skeleton loading — pendant les appels LLM */
@keyframes shimmer {
  from { background-position: -400px 0; }
  to   { background-position: 400px 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--color-surface) 0%,
    var(--color-surface-raised) 50%,
    var(--color-surface) 100%
  );
  background-size: 800px 100%;
  animation: shimmer 1.5s infinite;
  border-radius: var(--radius-sm);
}

/* Scroll custom — fin, doré */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: var(--color-bg); }
::-webkit-scrollbar-thumb {
  background: var(--color-gold-dim);
  border-radius: var(--radius-full);
}
::-webkit-scrollbar-thumb:hover {
  background: var(--color-gold);
}
```

---

## Partie 4 — Google Fonts + Instructions d'implémentation

### Dans `index.html`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,600&family=JetBrains+Mono:wght@300;400;500;600&display=swap" rel="stylesheet">
```

### Ordre d'implémentation

1. Remplacer `variables.css` avec ce fichier
2. Ajouter `animations.css` avec les keyframes
3. Restyler dans l'ordre :
   - `LoginPage.css` — première impression
   - `Sidebar.css` — navigation permanente
   - `ChatInterface.css` — cœur de l'app
   - `AdminPanel.css` — back-office
   - `PipelineEditor.css` — éditeur de pipelines
4. Vérifier chaque composant avant de passer au suivant

### Ce qu'il ne faut PAS faire
- Pas de violet, pas de dégradés bleu→violet
- Pas d'Inter, Roboto, ou system-ui
- Pas de border-radius > 8px (sauf inputs)
- Pas de shadows colorées sauf or
- Pas de glassmorphisme
- La scrollbar DOIT être fine et dorée

---

## Critères de validation

- [ ] Playfair Display sur tous les titres, noms de modèles, messages user
- [ ] JetBrains Mono sur tous les corps, labels, boutons, inputs
- [ ] Filet doré présent comme séparateur dans sidebar et cards
- [ ] Bouton primaire or avec lueur subtile au hover
- [ ] Items sidebar actifs avec accent gauche doré
- [ ] Messages Chairman avec bordure gauche dorée
- [ ] Nœuds pipeline avec hover/selected doré
- [ ] Login card avec barre top dorée et pattern diagonal
- [ ] Scrollbar fine et dorée partout
- [ ] Skeleton loading sur les appels LLM en cours
- [ ] Status dots animés (pulsation verte pour actif)
- [ ] Zéro couleur violette ou bleue dans toute l'interface
