# Possessed

A browser-based social deduction game. 4–10 players are snowed into a mountain
cabin. One of them is secretly possessed. Guests roam the cabin completing
tasks; the possessed player blends in and kills guests one at a time. Report
a body or call a meeting to discuss and vote someone out.

**Win conditions**
- Guests win if all tasks are completed, or the possessed player is voted out.
- The possessed wins once only one guest remains alive.

## Run locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a browser. Open it in a few tabs (or
have friends on the same network hit `http://<your-local-ip>:3000`) to test
with multiple players.

## Deploy so real players can join from anywhere

This is a Node.js + Socket.io app — it needs an always-on server, not a
static file host. Any of these work and have free tiers:

**Render.com** (easiest)
1. Push this folder to a GitHub repo.
2. On render.com → New → Web Service → connect the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Deploy — you'll get a public URL like `https://possessed-xxxx.onrender.com`.

**Railway.app**
1. Push to GitHub, then "New Project" → "Deploy from GitHub repo" on railway.app.
2. It auto-detects Node and runs `npm start`. Grab the generated public URL.

**Fly.io / Glitch** also work well for small Socket.io apps if you prefer those.

Once deployed, share the URL — each player opens it in their own browser,
picks a name, and either creates a room (share the 5-letter code) or joins
one.

## How to play (in-browser)

- **Move**: WASD or arrow keys.
- **Interact**: E — do a task, or report a body you're standing near.
- **Kill** (possessed only): F, when standing near a guest (has a cooldown).
- **Call meeting**: button in the bottom right, any time.
- **Chat**: type and press Enter, during free roam or in a meeting.

## Project structure

- `server.js` — authoritative game server (rooms, movement, tasks, kills,
  meetings/voting, win conditions). All real game logic lives here; clients
  are never trusted.
- `public/index.html`, `public/style.css`, `public/game.js` — the browser
  client: canvas rendering, input, task minigames, meeting/voting UI.

## Tuning

Most balance knobs are constants at the top of `server.js`: kill range and
cooldown, task range, meeting timer lengths, min/max players. The map layout
(`WALLS`) and task list/positions (`TASKS`) are there too if you want to
redesign the cabin or add more tasks.
