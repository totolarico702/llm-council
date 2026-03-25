# BRIEF_DESIGN_RETRO80 — LLM Council Aesthetic Direction

## Direction artistique — "Rétro Computing 1980-1984"

### Vision

LLM Council devient la seule interface d'IA qui ressemble à un ordinateur de 1982.
Références : Atari 800 (beige sable, touches ambre), TRS-80 (gris plastique, phosphore vert),
Philips MSX (industriel gris/beige, rouge accent).

L'effet recherché : dépaysement total. Un utilisateur habitué aux SaaS sombres violets
se retrouve dans un monde de plastique ivoire, de touches mécaniques et de phosphore vert.
C'est MÉMORABLE. C'est l'identité.

**Ce qui rend ce design INOUBLIABLE :**
Un outil d'intelligence artificielle de pointe habillé comme un Atari 800.
La tension entre la technologie 2026 et l'esthétique 1982 EST le concept.

---

## Partie 1 — Variables CSS (remplacer variables.css)

```css
/* frontend/src/styles/variables.css */
/* LLM Council — Rétro Computing 1980-1984 */

@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Courier+Prime:wght@400;700&display=swap');

:root {
  /* ── Palette Rétro ──────────────────────────────── */

  /* Fond principal — beige sable Atari 800 */
  --color-bg:             #ddd8c4;

  /* Surfaces — plastique ivoire légèrement jauni */
  --color-surface:        #e8e3d0;
  --color-surface-2:      #f0ece0;
  --color-surface-raised: #ede9d8;  /* surface surélevée — boutons, cards */
  --color-surface-inset:  #c8c4b4;  /* surface enfoncée — inputs, textareas */

  /* Bordures — ombres portées dures style skeuomorphe */
  --color-border:         #a8a498;
  --color-border-dark:    #787060;
  --color-border-light:   #f8f4e8;  /* highlight haut-gauche */

  /* Texte */
  --color-text:           #1a1814;  /* quasi-noir chaud */
  --color-text-muted:     #5a5648;
  --color-text-disabled:  #9a9488;
  --color-text-phosphore: #33cc44;  /* vert phosphore — statuts actifs */

  /* Accents */
  --color-accent:         #c8760a;  /* orange ambre Atari — actions primaires */
  --color-accent-hover:   #a86008;
  --color-accent-amber:   #ffb000;  /* ambre clair — highlights */
  --color-phosphore:      #33cc44;  /* vert phosphore TRS-80 */
  --color-phosphore-dim:  #1a6622;  /* vert sombre */
  --color-danger:         #cc2200;  /* rouge unique — erreurs, destructif */
  --color-warning:        #c8760a;  /* même que accent */
  --color-success:        #33cc44;  /* phosphore */

  /* ── Typographie ────────────────────────────────── */
  --font-main:            'IBM Plex Mono', 'Courier Prime', monospace;
  --font-mono:            'IBM Plex Mono', monospace;
  --font-display:         'Courier Prime', 'IBM Plex Mono', monospace;

  --font-size-xs:         10px;
  --font-size-sm:         11px;
  --font-size-base:       13px;
  --font-size-lg:         15px;
  --font-size-xl:         18px;
  --font-size-2xl:        24px;

  --font-weight-normal:   400;
  --font-weight-medium:   500;
  --font-weight-bold:     700;

  --line-height-tight:    1.2;
  --line-height-base:     1.5;
  --line-height-loose:    1.8;

  /* ── Spacing ────────────────────────────────────── */
  --spacing-xs:           3px;
  --spacing-sm:           6px;
  --spacing-md:           12px;
  --spacing-lg:           20px;
  --spacing-xl:           32px;
  --spacing-2xl:          48px;

  /* ── Radius — coins arrondis massifs style 80s ──── */
  --radius-sm:            3px;
  --radius-md:            6px;
  --radius-lg:            10px;
  --radius-xl:            16px;
  --radius-full:          9999px;

  /* ── Ombres portées DURES — skeuomorphisme 80s ──── */
  /* Style embossé — surface surélevée */
  --shadow-raised:
    inset 1px 1px 0px var(--color-border-light),
    inset -1px -1px 0px var(--color-border-dark),
    2px 2px 0px var(--color-border-dark);

  /* Style enfoncé — bouton pressé, input actif */
  --shadow-inset:
    inset 1px 1px 0px var(--color-border-dark),
    inset -1px -1px 0px var(--color-border-light);

  /* Fenêtre / card principale */
  --shadow-window:
    3px 3px 0px var(--color-border-dark),
    4px 4px 0px rgba(0,0,0,0.15);

  /* Ombre légère */
  --shadow-sm:
    1px 1px 0px var(--color-border-dark);

  /* ── Transitions ────────────────────────────────── */
  --transition-fast:      0.1s ease;
  --transition-normal:    0.2s ease;

  /* ── Layout ─────────────────────────────────────── */
  --sidebar-width:        240px;
  --pipeline-assistant-width: 260px;
  --pipeline-nodeconfig-width: 300px;

  /* ── Texture — grain subtil plastique ───────────── */
  --texture-noise: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
}
```

---

## Partie 2 — Composants clés à restyler

### 2.1 Boutons

```css
/* Bouton primaire — orange ambre Atari */
.btn-primary {
  background: var(--color-accent);
  color: #fff8e8;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 6px 16px;
  border-radius: var(--radius-sm);
  border: none;
  box-shadow: var(--shadow-raised);
  cursor: pointer;
  transition: var(--transition-fast);
}

.btn-primary:hover {
  background: var(--color-accent-hover);
}

.btn-primary:active {
  box-shadow: var(--shadow-inset);
  transform: translate(1px, 1px);
}

/* Bouton secondaire — plastique ivoire */
.btn-secondary {
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 6px 14px;
  border-radius: var(--radius-sm);
  border: none;
  box-shadow: var(--shadow-raised);
  cursor: pointer;
  transition: var(--transition-fast);
}

.btn-secondary:active {
  box-shadow: var(--shadow-inset);
  transform: translate(1px, 1px);
}

/* Bouton danger — rouge unique */
.btn-danger {
  background: var(--color-danger);
  color: #fff;
  /* même structure que btn-primary */
}
```

### 2.2 Inputs & Textareas

```css
input, textarea, select {
  background: var(--color-surface-inset);
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--font-size-base);
  border: none;
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  box-shadow: var(--shadow-inset);
  outline: none;
}

input:focus, textarea:focus {
  box-shadow:
    var(--shadow-inset),
    0 0 0 2px var(--color-accent);
}

/* Textarea chat — style terminal */
.chat-input {
  background: #1a1814;
  color: var(--color-phosphore);
  font-family: var(--font-mono);
  caret-color: var(--color-phosphore);
  border-radius: var(--radius-md);
  box-shadow:
    inset 0 0 20px rgba(0,0,0,0.5),
    var(--shadow-inset);
}

/* Curseur clignotant style terminal */
.chat-input::placeholder {
  color: var(--color-phosphore-dim);
}
```

### 2.3 Cards & Fenêtres

```css
.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-window);
  /* Texture grain plastique */
  background-image: var(--texture-noise);
}

/* Barre de titre style MacOS System 6 */
.card-header, .panel-title {
  background: repeating-linear-gradient(
    90deg,
    var(--color-border-dark) 0px,
    var(--color-border-dark) 1px,
    var(--color-surface-raised) 1px,
    var(--color-surface-raised) 4px
  );
  padding: 4px 10px;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
```

### 2.4 Sidebar

```css
.sidebar {
  background: var(--color-surface);
  background-image: var(--texture-noise);
  border-right: 2px solid var(--color-border-dark);
  box-shadow: 2px 0 0 var(--color-border-light) inset;
}

/* Logo LLM Council */
.sidebar-logo {
  font-family: var(--font-display);
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--color-text);
  text-transform: uppercase;
  letter-spacing: 0.15em;
  /* Effet texte embossé */
  text-shadow:
    1px 1px 0 var(--color-border-light),
    -1px -1px 0 var(--color-border-dark);
}

/* Items sidebar */
.sidebar-item {
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  padding: 6px 12px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.sidebar-item.active {
  background: var(--color-accent);
  color: #fff8e8;
  box-shadow: var(--shadow-inset);
}
```

### 2.5 Badges & Tags statut

```css
/* Badge phosphore — modèle actif, connecté */
.badge-active {
  background: #0a1a0a;
  color: var(--color-phosphore);
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-phosphore-dim);
  /* Lueur phosphore */
  box-shadow: 0 0 6px rgba(51, 204, 68, 0.3);
}

/* Badge orange — warning, en cours */
.badge-warning {
  background: var(--color-accent);
  color: #fff8e8;
}

/* Badge rouge — erreur */
.badge-error {
  background: var(--color-danger);
  color: #fff;
}
```

### 2.6 Zone de chat — écran CRT

```css
.chat-messages {
  background: #111008;
  /* Scanlines subtiles */
  background-image:
    repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.08) 2px,
      rgba(0,0,0,0.08) 4px
    );
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 0 40px rgba(0,0,0,0.6),
    var(--shadow-inset);
}

/* Messages user */
.message-user {
  color: var(--color-amber);
  font-family: var(--font-mono);
}

/* Messages LLM — phosphore vert */
.message-assistant {
  color: var(--color-phosphore);
  font-family: var(--font-mono);
  /* Légère lueur */
  text-shadow: 0 0 8px rgba(51, 204, 68, 0.2);
}
```

### 2.7 Pipeline Editor — nœuds

```css
/* Nœud générique */
.react-flow__node {
  background: var(--color-surface-raised);
  border: none;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-window);
  font-family: var(--font-mono);
  font-size: var(--font-size-sm);
  background-image: var(--texture-noise);
}

/* Nœud sélectionné */
.react-flow__node.selected {
  box-shadow:
    var(--shadow-window),
    0 0 0 2px var(--color-accent);
}

/* Canvas pipeline — fond grille style papier millimétré */
.react-flow__background {
  background-color: var(--color-bg);
  background-image:
    linear-gradient(var(--color-border) 1px, transparent 1px),
    linear-gradient(90deg, var(--color-border) 1px, transparent 1px);
  background-size: 20px 20px;
  opacity: 0.3;
}

/* Connexions — fils orange */
.react-flow__edge path {
  stroke: var(--color-accent);
  stroke-width: 2;
}
```

---

## Partie 3 — Micro-interactions

```css
/* Clic bouton — effet touche mécanique */
button:active {
  transform: translate(1px, 1px);
  transition: transform 0.05s ease;
}

/* Hover item sidebar — highlight discret */
.sidebar-item:hover {
  background: var(--color-surface-inset);
  box-shadow: var(--shadow-inset);
}

/* Apparition messages chat — style machine à écrire */
@keyframes typewriter-appear {
  from { opacity: 0; transform: translateY(2px); }
  to   { opacity: 1; transform: translateY(0); }
}

.message-new {
  animation: typewriter-appear 0.15s ease forwards;
}

/* Curseur phosphore clignotant */
@keyframes phosphore-blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}

.cursor-phosphore {
  display: inline-block;
  width: 8px;
  height: 14px;
  background: var(--color-phosphore);
  animation: phosphore-blink 1s step-end infinite;
  box-shadow: 0 0 6px rgba(51, 204, 68, 0.5);
}

/* Lueur phosphore sur les statuts actifs */
@keyframes phosphore-glow {
  0%, 100% { box-shadow: 0 0 4px rgba(51, 204, 68, 0.3); }
  50%       { box-shadow: 0 0 10px rgba(51, 204, 68, 0.6); }
}

.status-active {
  animation: phosphore-glow 2s ease-in-out infinite;
}
```

---

## Partie 4 — Instructions d'implémentation pour Claude Code

### Ordre d'exécution

1. **Remplacer `variables.css`** avec le nouveau fichier ci-dessus
2. **Mettre à jour chaque fichier CSS** du projet pour utiliser les nouvelles variables
3. **Restyler les composants** dans l'ordre : Sidebar → LoginPage → ChatInterface → AdminPanel → PipelineEditor
4. **Ajouter les micro-interactions** (keyframes) dans un fichier `animations.css`
5. **Tester visuellement** chaque page après chaque composant

### Priorités

- La zone de chat DOIT ressembler à un terminal CRT (fond noir, texte phosphore, scanlines)
- Les boutons DOIVENT avoir l'effet enfoncé au clic (transform + shadow-inset)
- La sidebar DOIT avoir la texture grain plastique
- Les nœuds du PipelineEditor DOIVENT avoir les ombres portées dures

### Ce qu'il ne faut PAS faire
- Pas de dégradés violets ou bleus — on est en 1982
- Pas de glassmorphisme
- Pas de border-radius > 16px
- Pas de shadows douces (box-shadow: 0 4px 20px rgba...) — ombres DURES uniquement
- Pas de fonts Inter, Roboto, ou system-ui

### Google Fonts à ajouter dans `index.html`

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Courier+Prime:wght@400;700&display=swap" rel="stylesheet">
```

---

## Critères de validation

- [ ] Palette beige/sable/ivoire appliquée partout — plus de fond sombre générique
- [ ] Zone chat : fond noir + texte phosphore vert + scanlines
- [ ] Boutons : effet touche mécanique au clic (transform + shadow-inset)
- [ ] Sidebar : texture grain plastique + ombres portées dures
- [ ] Nœuds PipelineEditor : style skeuomorphe avec shadow-window
- [ ] Badges statut : fond noir + texte phosphore avec lueur
- [ ] Typographie 100% IBM Plex Mono / Courier Prime — zéro Inter/Roboto
- [ ] Micro-interactions : curseur phosphore clignotant dans le chat
- [ ] Canvas pipeline : grille papier millimétré + connexions orange ambre
- [ ] Login page : style terminal CRT complet
