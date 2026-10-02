// WebSocket connection with automatic reconnect (phones drop connections when
// the screen locks or you switch to Messages) and server clock sync.

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = {};
    this.session = null; // { code, id, token } once we're in a room
    this.pendingJoin = null; // first message to send after connecting
    this.offset = 0; // serverTime - localTime
    this.samples = [];
    this.active = false;
    this.retry = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.active && !this.isOpen()) this.open();
    });
    window.addEventListener('online', () => this.active && !this.isOpen() && this.open());
  }

  on(type, fn) {
    this.handlers[type] = fn;
  }

  emit(type, msg) {
    this.handlers[type]?.(msg);
  }

  isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  connect(joinMsg) {
    this.pendingJoin = joinMsg;
    this.session = null;
    this.active = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.open();
  }

  // Pick up a seat we already had (page reload, or the phone dropped the connection).
  resume(session) {
    this.session = session;
    this.pendingJoin = null;
    this.active = true;
    this.open();
  }

  open() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = (this.ws = new WebSocket(`${proto}://${location.host}/ws`));
    ws.onopen = () => {
      this.retry = 0;
      this.emit('status', 'online');
      if (this.session) {
        this.send({ t: 'rejoin', ...this.session });
      } else if (this.pendingJoin) {
        this.send(this.pendingJoin);
      }
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 2000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'pong') {
        const now = Date.now();
        const rtt = now - msg.c;
        this.samples.push({ rtt, offset: msg.s + rtt / 2 - now });
        if (this.samples.length > 10) this.samples.shift();
        const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
        this.offset = best.offset;
        this.rtt = best.rtt;
        return;
      }
      if (msg.t === 'welcome') {
        this.session = { code: msg.code, id: msg.id, token: msg.token };
        try {
          sessionStorage.setItem('kc-session', JSON.stringify(this.session));
        } catch {}
      }
      this.emit(msg.t, msg);
    };
    ws.onclose = () => {
      clearInterval(this.pingTimer);
      if (this.ws !== ws) return;
      this.emit('status', 'offline');
      if (!this.active) return;
      const delay = Math.min(4000, 400 * 2 ** this.retry++);
      setTimeout(() => this.active && this.open(), delay);
    };
  }

  ping() {
    this.send({ t: 'ping', c: Date.now() });
  }

  send(msg) {
    if (this.isOpen()) this.ws.send(JSON.stringify(msg));
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  leave() {
    this.send({ t: 'leave' });
    this.active = false;
    this.session = null;
    try {
      sessionStorage.removeItem('kc-session');
    } catch {}
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
