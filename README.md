# 🏁 Kart Clash

A small 3D kart racer that runs in a phone's web browser. Create a race on your
iPhone, text the link to a friend, and they tap it on their Android (or any
phone) to join. There's nothing to install.

- 2–8 players per room, plus up to 6 CPU racers
- 2 tracks: **Sunny Speedway** and **Cactus Canyon**
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
Turn your phone sideways for the widest view. It works upright too.

## Inviting a friend

1. Tap **Create race**. You get a 4-letter room code.
2. Tap **💬 Invite a friend by text**. On iPhone this opens the share sheet, so
   pick Messages. You can also use **Open Messages** or **Copy link**.
3. Your friend taps the link, types a name, and taps **Join race**.
4. As host, pick the track, laps and CPU racers, then tap **Start race!**

## Putting it online (free, about 5 minutes)

The game needs a small Node.js server so the phones can talk to each other.
[Render](https://render.com) runs it for free:

1. Sign in to Render with your GitHub account.
2. Go to **New → Blueprint** and choose this repository. If the game code
   isn't on your default branch yet, pick the branch that has it.
3. Render reads `render.yaml` and deploys it. You get a URL like
   `https://kart-clash-xxxx.onrender.com`.
4. Open that URL on your phone. Tip: in Safari, use **Share → Add to Home
   Screen** for a full-screen, app-like experience.

On Render's free plan the server goes to sleep after 15 minutes of no
players. The first visit after that takes up to a minute to load.

Any other Node host that supports WebSockets also works (Railway, Fly.io, a
VPS). Just run `npm install` and `npm start`. The server listens on `$PORT`.

## Running it on your own computer

```bash
npm install
npm start            # http://localhost:3000
```

To play on phones on the same Wi‑Fi, open `http://<your-computer's-IP>:3000`
on each phone.

## Tests

```bash
npm test
```

## How it works

- `server.js` serves the game and runs the rooms over WebSockets. It tracks
  the lobby, a shared race start time, finish order and results, and relays
  each phone's kart position about 15 times a second.
- Each phone simulates its own kart, so steering feels instant. Other karts
  are smoothly interpolated. The host's phone drives the CPU racers. If the
  host drops out, another player takes them over.
- `public/js/` holds the client: Three.js rendering (`track.js`, `kart.js`),
  items (`items.js`), touch controls (`input.js`), networking (`net.js`) and
  game flow (`main.js`). Track layouts live in `public/js/tracks.js`. Add a
  new entry there to make a new track.
