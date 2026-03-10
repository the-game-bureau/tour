# NoLaBound Scavenger Hunt Platform

A static-file web platform for hosting live Scavenger Hunt games with a **simulated iMessage-style text/reply format**. No backend — all state is localStorage. No build tools — raw HTML/CSS/JS files.

---

## Project Structure

Each game variant lives in its own folder and is self-contained:

| Folder | Purpose |
|---|---|
| `_wireframe/` | **Canonical template** — the most complete/up-to-date reference implementation. Use this as the source of truth when building new variants. |
| `oswald/` | Minimal variant (simpler stops.json) |
| `nofood/` | Full variant, mirrors _wireframe in sophistication |
| `360/` | 360insights company-specific game (no builder/engine, index+teams only) |
| `dt/` | DealerTire brand variant |
| `resources/` | Shared static assets: logos, game images |
| `marielle/` | Early dev / notes |
| `archive/` | Old backups |
| `GTM/` | Go-to-market reference version |
| `tours/` | Tour config (tours.xml) |
| `kk/` | Placeholder/empty |

---

## Files in Each Game Folder

| File | Role |
|---|---|
| `index.html` | Minimal shell (~26 lines). Just header, `#chat` div, and `#input-area`. All logic is in engine.js. |
| `engine.js` | Game runtime. Loads stops.json, manages state, renders chat bubbles, validates answers, handles progression. |
| `index.css` | iMessage-style chat UI. Custom CSS only (no frameworks). Handles bubbles, animations, layout. |
| `stops.json` | Game data. Array of stop objects. This is the content file authors edit via builder.html. |
| `builder.html` | Browser-based authoring tool. Form UI to add/edit stops and save to stops.json. ~45-64KB standalone. |
| `teams.html` | "Team Cipher" puzzle mini-game. Players pick 4 names from 16 to identify their team before the main game. |

---

## How the Game Works

### Game Flow
1. **(Optional) teams.html** — Players solve a puzzle to discover which of 4 teams they're on.
2. **index.html** — Main game. Chat messages appear one by one (with typing indicators).
3. Player types an answer → correct = advance to next stop; incorrect = shake animation + hint.
4. Progress saved to localStorage (survives reload). `?reset` clears it. `?reveal` shows entire game.

### Stops Data Structure (`stops.json`)
```json
{
  "id": "unique-stop-id",
  "messages": [
    { "html": "Message to Player text or HTML shown to player", "callToAction": true, "forAnswer": "optionalAnswerKey" }
  ],
  "playerReply": {
    "type": "text | button | any | win",
    "answers": ["correct", "answers"],
    "correct": [{ "html": "Feedback shown on correct answer", "forAnswer": "optionalKey" }],
    "incorrect": [{ "html": "Hint shown on wrong answer" }]
  }
}
```

### Answer Validation (`norm()`)
Answers are lowercased and stripped of punctuation/spaces before comparison. "LAFAYETTE" matches "lafayette". Answer-specific feedback is possible using `forAnswer` keys.

### Variable Interpolation
`{{teamName}}` in HTML strings gets replaced at runtime from `state.vars`. Allows personalizing messages per team.

---

## The 4 Teams (consistent across all variants)

| Team | Color | Hex |
|---|---|---|
| Beignet | Blue | `#6aaef7` |
| Lagniappe | Orange | `#f5a623` |
| Rougarou | Red | `#e85568` |
| Tchoupitoulas | Green | `#4ecf98` |

---

## Design Conventions

### CSS
- **No frameworks** — all custom CSS
- **System fonts** for game UI: `-apple-system, BlinkMacSystemFont, Segoe UI, Roboto`
- **Google Fonts** for builder/teams: `JetBrains Mono`, `Bebas Neue`, `DM Sans`, `DM Mono`
- Game bubbles: `#1a73e8` (blue, left-aligned = game), `#e5e7eb` (gray, right-aligned = player)
- Call-to-action bubbles: `#cc0000` red
- Safe area insets used for notched phones: `env(safe-area-inset-*)`
- Animations: `slideIn`, `shake`, `typingBounce`, `popIn`

### JavaScript
- No frameworks, no bundling — vanilla ES5/ES6
- IIFE used for isolated scopes
- State object: `{ step: 0, team: null, vars: {} }`
- Key functions in engine.js: `norm()`, `showBubbles()`, `renderInput()`, `doAdvance()`

---

## Creating a New Game Variant

1. Copy the `_wireframe/` folder and rename it.
2. Edit `stops.json` (directly or via `builder.html`) with new stop content.
3. Update team names/colors in `teams.html` if needed.
4. Update any hardcoded resource paths (logos, images) in `index.html` / `index.css`.
5. No code changes needed to engine.js or index.css for standard games.

---

## External Dependencies

- **Google Fonts** (builder/teams UI only)
- **what3words** links embedded in stops.json for physical location clues
- **GitHub Pages / static CDN** for image hosting (`resources/` folder)
- **Gumroad** — account: https://tgb.gumroad.com — default product: `https://tgb.gumroad.com/l/jluvvn` — product URLs follow the pattern `https://tgb.gumroad.com/l/[product-id]`
- No npm, no node, no build step required

---

## Key Things to Know When Editing

- `_wireframe/` is the template — changes to core game mechanics should start there and propagate to other variants.
- `builder.html` is a standalone tool (self-contained HTML file, no external deps beyond fonts).
- `stops.json` is the content — non-technical authors edit this; keep the schema stable.
- The chat UI should always feel like iMessage/SMS — timing, bubbles, tails, and animations matter.
- Mobile-first: games are played on phones while walking around.
