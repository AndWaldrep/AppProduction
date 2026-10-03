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
