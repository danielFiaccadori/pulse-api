import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { RoomManager } from './roomManager.js';
import type { ClientToServerMessage } from './types.js';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const WS_PATH = process.env.PULSE_WS_PATH || '/ws/pulse';

const roomManager = new RoomManager();

interface AliveWebSocket extends WebSocket {
  isAlive?: boolean;
}

function buildIceServers() {
  const iceServers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
  }> = [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    },
  ];

  const turnUrlsRaw = process.env.TURN_URLS?.trim();
  if (turnUrlsRaw) {
    const urls = turnUrlsRaw
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    if (urls.length > 0) {
      iceServers.push({
        urls,
        username: process.env.TURN_USERNAME || undefined,
        credential: process.env.TURN_CREDENTIAL || undefined,
      });
    }
  }

  return iceServers;
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/ice-servers') {
    const iceServers = buildIceServers();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ iceServers }));
    return;
  }

  if (req.url === '/health') {
    const stats = roomManager.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        service: 'pulse-signaling',
        uptimeSeconds: Math.floor(process.uptime()),
        ...stats,
      })
    );
    return;
  }

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'pulse-signaling',
        wsPath: WS_PATH,
        healthPath: '/health',
      })
    );
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

const wss = new WebSocketServer({ server, path: WS_PATH });

wss.on('connection', (ws: AliveWebSocket) => {
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    try {
      const parsed = JSON.parse(raw.toString()) as ClientToServerMessage;
      if (!parsed || typeof parsed.type !== 'string') return;
      roomManager.handleMessage(ws, parsed);
    } catch (err) {
      console.warn('[PulseServer] Mensagem JSON inválida:', err);
    }
  });

  ws.on('close', () => {
    roomManager.handleDisconnect(ws);
  });

  ws.on('error', () => {
    roomManager.handleDisconnect(ws);
  });
});

// Heartbeat para evitar timeout de proxies/load-balancers em produção
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    const sock = client as AliveWebSocket;
    if (sock.isAlive === false) {
      roomManager.handleDisconnect(sock);
      sock.terminate();
      continue;
    }
    sock.isAlive = false;
    sock.ping();
  }
}, 25_000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, HOST, () => {
  console.log(`[Pulse Signaling] HTTP/WS ativo em http://${HOST}:${PORT}${WS_PATH}`);
});

