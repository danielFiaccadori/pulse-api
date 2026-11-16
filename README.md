# Pulse Back-end (Signaling & Salas)

Servidor leve em **Node.js + TypeScript + WebSocket (`ws`)** para gerenciar salas, presença, convites instantâneos e troca de sinalização WebRTC (`WEBRTC_OFFER`, `WEBRTC_ANSWER`, `ICE_CANDIDATE`) para o app desktop **Pulse**.

## Rodar localmente

```bash
npm install
npm run dev
```

O servidor sobe por padrão em:
- WebSocket: `ws://localhost:8080/ws/pulse`
- Healthcheck: `http://localhost:8080/health`

## Deploy rápido (Railway / Render / Fly.io / Docker)

- **Build command:** `npm install && npm run build`
- **Start command:** `npm start`
- **Healthcheck path:** `/health`
- **Porta:** lê automaticamente `process.env.PORT` (padrão `8080`)
- No front-end, após o deploy, basta apontar a URL para `wss://seu-dominio/ws/pulse`.

