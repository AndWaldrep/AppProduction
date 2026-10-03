# 🏁 Kart Clash

A small 3D kart racer that runs in a phone's web browser. Create a race on your
iPhone, text the link to a friend, and they tap it on their Android (or any
phone) to join. There's nothing to install, and it runs on free GitHub Pages.

- 2–8 players per room, plus up to 6 CPU racers
- 3 tracks with hills, jump ramps over rivers and canyons, and rolling
  boulders: **Sunny Speedway**, **Cactus Canyon** and **Frosty Peaks**
- Miss a jump and you fall in, then get put back on the track. Tap DRIFT in
  mid-air to do a trick, which gives you a boost when you land
- Original music for each track (it speeds up on the final lap) and
  synthesized sound effects, with separate 🎵 and 🔊 toggles
- Drifting with blue and orange mini-turbo boosts, boost pads
- Item boxes: 🍌 banana, 🐢 shell, 🍄 mushroom, 🍄×3 triple mushroom, ⭐ star
  (racers further back get better items)
- Reconnects on its own if a phone locks or loses signal mid-race

## How to play

| | Phone | Keyboard |
|---|---|---|
| Steer | Put a thumb anywhere on the left half and drag left/right | ← → or A/D |
| Accelerate | Automatic | Automatic |
| Drift / hop | Hold **DRIFT** while turning, release for a boost | Space |
| Use item | **ITEM** | Shift, E or X |
| Brake / reverse | **BRAKE** | ↓ or S |

Drift longer to charge the sparks from blue to orange for a bigger boost.
Ramps give you a speed boost, and a trick in mid-air gives you another.
Turn your phone sideways for the widest view. It works upright too.

## Inviting a friend

1. Tap **Create race**. You get a 4-letter room code.
2. Tap **💬 Invite a friend by text**. On iPhone this opens the share sheet, so
   pick Messages. You can also use **Open Messages** or **Copy link**.
3. Your friend taps the link, types a name, and taps **Join race**.
4. As host, pick the track, laps and CPU racers, then tap **Start race!**

## Putting it online with GitHub Pages (free)

The whole game is static files in the `docs/` folder, so GitHub Pages can host it.

1. **Make the repo public.** Go to **Settings → General**, scroll to the
   **Danger Zone**, choose **Change visibility → Public**. Free GitHub Pages
   needs a public repo.
2. **Turn on Pages.** Go to **Settings → Pages**. Under *Build and
   deployment* set **Source: Deploy from a branch**, then pick the branch
   that has the game, choose the **/docs** folder, and click **Save**.
3. After a minute or two the game is live at
   **https://andwaldrep.github.io/AppProduction/**.
4. Open that link on your phone. Tip: in Safari, use **Share → Add to Home
   Screen** for a full-screen, app-like experience.

## Running it on your own computer

```bash
npm start            # http://localhost:3000
```

The preview server just serves `docs/`, so no install step is needed. Phones on
the same Wi‑Fi can open `http://<your-computer's-IP>:3000`. Run `npm install`
only for the tests, or to update the bundled libraries with `npm run vendor`.

## Tests

```bash
npm install
npm test
```

## How it works

- There's no game server. The host's phone runs the race room
  (`docs/js/room.js`), which handles the lobby, a shared start time, finish
  order and results. Friends' phones connect straight to it over WebRTC.
  [PeerJS](https://peerjs.com)'s free public service only introduces the
  phones to each other. It includes relay servers for phones on cellular
  networks that can't connect directly.
- Each phone simulates its own kart, so steering feels instant. Other karts
  are smoothly interpolated. The host's phone also drives the CPU racers.
- If a phone locks or you switch apps (say, to text the invite), it
  reconnects when you come back. A friend who taps the link while you're
  still in Messages waits until your game is open again. If the host leaves
  the race, it ends for everyone.
- `docs/js/` holds the client: Three.js rendering (`track.js`, `kart.js`),
  items (`items.js`), touch controls (`input.js`), networking (`net.js`) and
  game flow (`main.js`). Track layouts, including hills, jumps and
  obstacles, live in `docs/js/tracks.js`. Add an entry there to make a new
  track. Music is written as note patterns in `docs/js/audio.js`.

---

# 🎯 Pocket Ops

A first-person shooter for phones, in the same repo and on the same free
GitHub Pages site as Kart Clash. It lives in `docs/ops/`, so it's at
**https://andwaldrep.github.io/AppProduction/ops/** (Kart Clash stays at the
main address). Create a match, text the link, and friends drop right in, even
mid-match.

- 1–8 players plus bots (up to 12 soldiers), **Team Deathmatch** or
  **Free-for-all**
- 2 maps:
  - **Dust Yard**: a desert market town. A long building with a walkable
    roof (stairs at both ends, parapets to hide behind), a fountain plaza
    and a walled courtyard with doors on every side.
  - **Dockyard**: shipping containers at sunset. A warehouse with a raised
    catwalk, containers you can climb onto, a two-high stack in the middle
    and an open quay by the water.
- 4 loadouts: **Ranger AR**, **Viper SMG**, **Breacher** shotgun,
  **Longbow** sniper (with a scope). You can switch between lives.
- 2 grenades per life, regenerating health, headshots, spawn protection,
  kill feed, radar (enemies show up when they fire), and a UAV after 3 kills
  in a row
- Bots at three skill levels. They find their way around the map, chase
  gunfire, strafe, and take a moment to react, like people do.

## Controls

| | Phone (turn it sideways) | Keyboard + mouse |
|---|---|---|
| Move | Left thumb anywhere on the left side (a joystick appears) | WASD |
| Sprint | Push the left stick all the way up | Shift |
| Aim / look | Right thumb anywhere on the right side. Push further to turn faster | Mouse (click the game first) |
| Fire | **FIRE** (either side). Drag on it to aim while shooting | Left click |
| Aim down sights | **AIM** (tap to toggle) | Right click |
| Jump / crouch | **⤒** / **⤓** | Space / C |
| Reload / grenade | **↻** / **💣** | R / G |
| Scoreboard / menu | Tap the score / **☰** | Tab / Esc |

**Auto-fire** (on by default for touch) shoots when your crosshair is on an
enemy in range, and **aim assist** slows your aim slightly over enemies.
Turn either off, or change aim speed, under **⚙️ Controls** on the home
screen or in the in-match menu.

## How it works

- Same setup as Kart Clash: the host's phone runs the match room
  (`docs/ops/js/room.js`: teams, health, kills, spawns, the clock) and
  friends connect to it peer-to-peer.
- Each phone moves its own soldier and works out what its own bullets hit, so
  aiming feels instant. The room applies the damage and announces kills. The
  host's phone also runs the bots (`bot.js`).
- Maps are built from boxes on a 1 m grid (`maps.js`). That keeps collision,
  bullets, line of sight and bot pathfinding simple and fast (`grid.js`). To
  make a new map, add an entry to `maps.js`; the tests check that every spot
  is reachable and that no spawn can see the other team's spawns.
- `match.js` is the game without any drawing, which is how the tests play
  whole matches headless. `main.js` draws it with Three.js and runs the HUD.
- Debug aids: add `?debug` to the URL for a frame rate, ping and position
  readout, or `?autopilot` to have a bot play for you. In the browser
  console, `pocketOps` holds the game state.
