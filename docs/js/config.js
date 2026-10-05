// Servers that help phones find a route to each other.
//
// STUN servers tell each phone its public address; usually enough on home Wi-Fi.
// TURN servers relay the game when two phones can't reach each other directly (some
// cellular networks, guest Wi-Fi). PeerJS's free relay is included; it works but can be
// shaky under load. For a big game you can add your own relay below, e.g. from a free
// metered.ca account:
//   { urls: 'turn:global.relay.metered.ca:80', username: '...', credential: '...' },
//   { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '...', credential: '...' },
export const EXTRA_ICE_SERVERS = [];

export const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
  ...EXTRA_ICE_SERVERS,
];
