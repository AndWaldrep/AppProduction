// Peer-to-peer networking. The host's phone runs the race room (room.js) and
// guests connect straight to it with WebRTC. PeerJS's free public service only
// introduces the phones to each other, so the game can be hosted as plain files.
//
// Phones drop connections when the screen locks or you switch to Messages, so
// everything here reconnects on its own.

import { Room, makeCode } from './room.js';
import { congested } from './proto.js';
import { ICE_SERVERS } from './config.js';

const PREFIX = 'kartclash-v1-';
const GIVE_UP_MS = 90 * 1000; // stop looking for a race we never reached
const GIVE_UP_AFTER_PLAYING_MS = 5 * 60 * 1000; // ...or one we were in, after this long
const HOST_QUIET_MS = 7000; // no word from the host for this long: show "Reconnecting…"
const HOST_DEAD_MS = 15000; // ...and for this long: hang up and dial again
const CONNECT_TIMEOUT_MS = 9000;

function peerOptions() {
  // ?peerserver=host:port points at a self-run PeerJS server (used by the tests).
  const config = { iceServers: ICE_SERVERS, sdpSemantics: 'unified-plan' };
  const custom = new URLSearchParams(location.search).get('peerserver');
  if (!custom) return { debug: 1, config };
  const [host, port] = custom.split(':');
  return { host, port: Number(port) || 9000, path: '/', secure: false, debug: 1, config };
}

const clone = (m) => JSON.parse(JSON.stringify(m));

export class Net {
  constructor() {
    this.handlers = {};
    this.role = null; // 'host' | 'guest'
    this.peer = null;
    this.room = null; // host only
    this.local = null; // host's own connection into its room
    this.conn = null; // guest's connection to the host
    this.session = null; // { code, id, token, host, name, color } once we're in a room
    this.pendingJoin = null;
    this.profile = {};
    this.offset = 0; // hostTime - localTime
    this.stats = { drops: 0, redials: 0, skipped: 0 }; // for checking connection health
    this.samples = [];
    this.active = false;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.wake();
    });
    window.addEventListener('online', () => this.wake());
    // Keep our line to the matchmaking service open. Phones lose it when switching
    // between Wi-Fi and cellular; races already running don't need it, but new
    // players and reconnecting players do.
    setInterval(() => {
      const p = this.peer;
      if (this.active && p && !p.destroyed && p.disconnected) p.reconnect();
    }, 4000);
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, msg) {
    this.handlers[type]?.(msg);
  }

  isOpen() {
    return this.role === 'host' ? !!this.room : !!(this.conn && this.conn.open);
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  // joinMsg is { t: 'create' | 'join', name, color, code? }
  connect(joinMsg) {
    this.teardown();
    this.active = true;
    this.session = null;
    this.profile = { name: joinMsg.name, color: joinMsg.color, tv: !!joinMsg.tv };
    if (joinMsg.t === 'create') {
      this.startHost(makeCode(), joinMsg, false);
    } else {
      this.pendingJoin = joinMsg;
      this.startGuest(joinMsg.code);
    }
  }

  // Take back a seat we already had (the page was reloaded).
  resume(session) {
    this.teardown();
    this.active = true;
    this.profile = { name: session.name, color: session.color, tv: !!session.tv };
    if (session.host) {
      this.startHost(session.code, { t: 'create', name: session.name, color: session.color, id: session.id, token: session.token, tv: !!session.tv }, true);
    } else {
      this.session = session;
      this.startGuest(session.code);
    }
  }

  send(msg) {
    if (this.role === 'host') {
      const room = this.room;
      if (!room) return;
      const m = clone(msg);
      queueMicrotask(() => room.handle(this.local, m));
    } else if (this.conn && this.conn.open) {
      try {
        this.conn.send(msg);
      } catch {}
    }
  }

  // Kart positions: if the link is backed up, skip this one (a newer one follows shortly).
  sendState(msg) {
    if (this.role === 'guest' && congested(this.conn)) {
      this.stats.skipped++;
      return;
    }
    this.send(msg);
  }

  deliver(msg) {
    if (msg.t === 'pong') {
      const now = Date.now();
      const rtt = now - msg.c;
      this.samples.push({ rtt, offset: msg.s + rtt / 2 - now });
      if (this.samples.length > 10) this.samples.shift();
      const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
      this.offset = best.offset;
      return;
    }
    if (msg.t === 'welcome') {
      this.session = { code: msg.code, id: msg.id, token: msg.token, host: this.role === 'host', ...this.profile };
      try {
        sessionStorage.setItem('kc-session', JSON.stringify(this.session));
      } catch {}
    }
    this.emit(msg.t, msg);
  }

  leave() {
    if (this.active) this.send({ t: 'leave' });
    this.active = false;
    this.session = null;
    try {
      sessionStorage.removeItem('kc-session');
    } catch {}
    // Give the goodbye a moment to go out before hanging up.
    const peer = this.peer;
    const room = this.room;
    this.peer = null;
    this.room = null;
    this.conn = null;
    this.role = null;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    setTimeout(() => {
      room?.close();
      peer?.destroy();
    }, 300);
  }

  teardown() {
    clearTimeout(this.retryTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.pingTimer);
    this.room?.close();
    this.peer?.destroy();
    this.peer = null;
    this.room = null;
    this.conn = null;
    this.role = null;
    this.offset = 0;
    this.samples = [];
  }

  wake() {
    if (!this.active || !this.peer) return;
    if (this.peer.disconnected && !this.peer.destroyed) this.peer.reconnect();
    if (this.role === 'guest' && this.isOpen() && Date.now() - this.lastHeard > HOST_QUIET_MS) {
      // Back from the background and the link went stale while we were away.
      this.conn.close();
    }
    if (this.role === 'guest' && !this.isOpen()) {
      clearTimeout(this.retryTimer);
      this.dial();
    }
  }

  // ------------------------------------------------------------ host

  startHost(code, createMsg, restoring, attempt = 0) {
    this.role = 'host';
    this.offset = 0;
    const peer = (this.peer = new Peer(PREFIX + code, peerOptions()));
    peer.on('open', () => {
      if (this.peer !== peer) return;
      // 'open' fires again each time we get back onto the matchmaking service after a
      // network blip. The room (and everyone in it) carries on; only set it up once.
      if (this.room) return;
      this.room = new Room(code);
      this.local = { local: true, send: (m) => queueMicrotask(() => this.deliver(clone(m))), close() {} };
      this.room.attach(this.local);
      this.room.handle(this.local, createMsg);
      this.emit('status', 'online');
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => this.room && this.room.attach(dc));
      dc.on('data', (m) => this.room && this.room.handle(dc, m));
      dc.on('close', () => this.room && this.room.detach(dc));
      dc.on('error', () => this.room && this.room.detach(dc));
    });
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (this.room) {
        // The race is running. Losing the matchmaking service (or it still holding our old
        // line after a network switch, "unavailable-id") doesn't affect connected players,
        // so never tear the room down here; the reconnect loop gets the service back.
        return;
      }
      if (err.type === 'unavailable-id') {
        peer.destroy();
        if (restoring && attempt < 12) {
          // Our old room name is still held from before the reload; it frees up shortly.
          this.retryTimer = setTimeout(() => this.startHost(code, createMsg, true, attempt + 1), 2500);
        } else if (restoring) {
          this.emit('error', { code: 'hostgone', msg: 'That race ended. Start a new one!' });
        } else {
          this.startHost(makeCode(), createMsg, false);
        }
      } else if (!this.room && ['network', 'server-error', 'socket-error', 'socket-closed', 'browser-incompatible'].includes(err.type)) {
        peer.destroy();
        this.active = false;
        this.emit('error', {
          code: 'network',
          msg: err.type === 'browser-incompatible' ? 'This browser can’t play online games. Try Safari or Chrome.' : 'Couldn’t reach the game network. Check your internet and try again.',
        });
      }
    });
  }

  // ------------------------------------------------------------ guest

  startGuest(code) {
    this.role = 'guest';
    this.code = code;
    this.searchStart = Date.now();
    this.everConnected = false;
    this.attempts = 0;
    this.emit('status', 'searching');
    this.newGuestPeer();
  }

  newGuestPeer() {
    const peer = (this.peer = new Peer(peerOptions()));
    peer.on('open', () => this.peer === peer && !this.isOpen() && this.dial());
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id' && !this.isOpen()) {
        // The service still holds our old line. Guests don't need a fixed name: get a new one.
        const old = peer;
        setTimeout(() => old.destroy(), 0);
        this.newGuestPeer();
      } else if (err.type === 'peer-unavailable') {
        // The host's phone isn't online right now (maybe still in Messages). Keep looking.
        this.retry();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.emit('status', 'offline');
        this.retry();
      } else if (err.type === 'browser-incompatible') {
        this.active = false;
        this.emit('error', { code: 'network', msg: 'This browser can’t play online games. Try Safari or Chrome.' });
      }
    });
  }

  dial() {
    const peer = this.peer;
    if (!this.active || !peer || peer.destroyed || this.role !== 'guest') return;
    if (peer.disconnected || !peer.open) {
      if (peer.disconnected && !peer.destroyed) peer.reconnect();
      this.retry();
      return;
    }
    this.stats.redials++;
    const dc = peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (!dc.open) {
        dc.close();
        this.retry();
      }
    }, CONNECT_TIMEOUT_MS);
    dc.on('open', () => {
      if (this.peer !== peer) return;
      clearTimeout(this.connectTimer);
      if (this.conn && this.conn !== dc) this.conn.close();
      this.conn = dc;
      this.everConnected = true;
      this.attempts = 0;
      this.lastHeard = Date.now();
      this.quiet = false;
      this.emit('status', 'online');
      if (this.session) dc.send({ t: 'rejoin', code: this.session.code, id: this.session.id, token: this.session.token });
      else if (this.pendingJoin) dc.send(this.pendingJoin);
      const ping = () => {
        // The host answers every ping, so silence means the link is in trouble.
        const silent = Date.now() - this.lastHeard;
        if (silent > HOST_DEAD_MS) {
          dc.close();
          lost();
          return;
        }
        if (silent > HOST_QUIET_MS && !this.quiet) {
          this.quiet = true;
          this.emit('status', 'offline');
        }
        this.send({ t: 'ping', c: Date.now() });
      };
      ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(ping, 2000);
      this.watchLink(dc, lost);
    });
    dc.on('data', (m) => {
      if (this.conn !== dc) return;
      this.lastHeard = Date.now();
      if (this.quiet) {
        this.quiet = false;
        this.emit('status', 'online');
      }
      this.deliver(m);
    });
    const lost = () => {
      if (this.conn !== dc) return;
      this.stats.drops++;
      this.conn = null;
      clearInterval(this.pingTimer);
      this.searchStart = Date.now();
      this.emit('status', 'offline');
      this.retry();
    };
    dc.on('close', lost);
    dc.on('error', lost);
  }

  // Watch the phone-to-phone link itself. When it breaks the browser tells us within a
  // few seconds, much sooner than waiting for messages to stop, so we redial right away.
  watchLink(dc, lost) {
    const pc = dc.peerConnection;
    if (!pc) return;
    let downTimer = null;
    const state = () => pc.connectionState || pc.iceConnectionState;
    const check = () => {
      if (this.conn !== dc) return;
      const st = state();
      if (st === 'failed' || st === 'closed') {
        clearTimeout(downTimer);
        dc.close();
        lost();
      } else if (st === 'disconnected') {
        if (!this.quiet) {
          this.quiet = true;
          this.emit('status', 'offline');
        }
        // Often it comes back by itself within a moment; if not, start over.
        clearTimeout(downTimer);
        downTimer = setTimeout(() => {
          if (this.conn === dc && ['disconnected', 'failed'].includes(state())) {
            dc.close();
            lost();
          }
        }, 4000);
      } else if (st === 'connected' || st === 'completed') {
        clearTimeout(downTimer);
      }
    };
    pc.addEventListener('connectionstatechange', check);
    pc.addEventListener('iceconnectionstatechange', check);
    // Note whether we're linked directly or through a relay server (shown in the lobby).
    setTimeout(() => this.detectLinkType(pc, dc), 1500);
  }

  async detectLinkType(pc, dc) {
    try {
      const stats = await pc.getStats();
      let pair = null;
      stats.forEach((r) => {
        if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
      });
      if (!pair) stats.forEach((r) => r.type === 'candidate-pair' && r.state === 'succeeded' && (r.nominated || r.selected) && (pair = pair || r));
      if (!pair || this.conn !== dc) return;
      const local = stats.get(pair.localCandidateId);
      const remote = stats.get(pair.remoteCandidateId);
      const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
      this.linkType = relayed ? 'relay' : 'direct';
      this.emit('link', this.linkType);
    } catch {}
  }

  retry() {
    if (!this.active || this.role !== 'guest' || this.isOpen()) return;
    clearTimeout(this.retryTimer);
    if (Date.now() - this.searchStart > (this.everConnected ? GIVE_UP_AFTER_PLAYING_MS : GIVE_UP_MS)) {
      this.active = false;
      this.emit('error', this.everConnected
        ? { code: 'hostgone', msg: 'Lost the connection to the host’s phone.' }
        : { code: 'noroom', msg: 'Couldn’t find that race. Make sure your friend has the game open, then try the link again.' });
      return;
    }
    const delay = Math.min(3000, 500 * 2 ** this.attempts++);
    this.retryTimer = setTimeout(() => this.dial(), delay);
  }
}
