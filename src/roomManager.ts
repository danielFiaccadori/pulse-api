import { WebSocket } from 'ws';
import type {
  ClientToServerMessage,
  RoomInfo,
  RoomMember,
  ServerToClientEvent,
  StreamInvite,
} from './types.js';

interface ConnectedClient {
  socket: WebSocket;
  userId: string;
  userName: string;
  roomCode: string;
  isViewerOnly: boolean;
  avatarHue: string;
}

interface ActiveStream {
  invite: StreamInvite;
  viewers: Set<string>;
}

interface RoomState {
  id: string;
  name: string;
  code: string;
  clients: Map<string, ConnectedClient>;
  activeStreams: Map<string, ActiveStream>;
}

const AVATAR_HUES = [
  'from-sky-400 to-indigo-500',
  'from-emerald-400 to-cyan-500',
  'from-fuchsia-400 to-purple-600',
  'from-amber-400 to-orange-500',
  'from-rose-400 to-pink-600',
];

function pickAvatarHue(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

function sendJson(socket: WebSocket, event: ServerToClientEvent) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(event));
  }
}

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  private socketToUser = new Map<WebSocket, { roomCode: string; userId: string }>();

  getStats() {
    let totalClients = 0;
    let totalStreams = 0;
    for (const room of this.rooms.values()) {
      totalClients += room.clients.size;
      totalStreams += room.activeStreams.size;
    }
    return {
      rooms: this.rooms.size,
      clients: totalClients,
      activeStreams: totalStreams,
    };
  }

  handleMessage(socket: WebSocket, message: ClientToServerMessage) {
    switch (message.type) {
      case 'ROOM_JOIN': {
        this.joinRoom(
          socket,
          message.payload.roomCode,
          message.payload.userId,
          message.payload.userName
        );
        break;
      }

      case 'STREAM_START': {
        const meta = this.socketToUser.get(socket);
        const room = this.findRoom(message.payload.roomId) ?? (meta ? this.rooms.get(meta.roomCode) : undefined);
        if (!room) return;

        const invite: StreamInvite = {
          streamId: message.payload.streamId,
          roomId: room.id,
          hostId: message.payload.hostId,
          hostName: message.payload.hostName,
          startedAt: Date.now(),
          preset: message.payload.preset,
        };

        room.activeStreams.set(invite.streamId, {
          invite,
          viewers: new Set(),
        });

        this.broadcastRoomSync(room);
        this.broadcastToRoom(room, { type: 'STREAM_INVITE', payload: invite }, invite.hostId);
        break;
      }

      case 'STREAM_STOP': {
        const meta = this.socketToUser.get(socket);
        const room = this.findRoom(message.payload.roomId) ?? (meta ? this.rooms.get(meta.roomCode) : undefined);
        if (!room) return;

        if (room.activeStreams.delete(message.payload.streamId)) {
          this.broadcastRoomSync(room);
          this.broadcastToRoom(room, {
            type: 'STREAM_ENDED',
            payload: { streamId: message.payload.streamId, roomId: room.id },
          });
        }
        break;
      }

      case 'STREAM_JOIN': {
        const meta = this.socketToUser.get(socket);
        if (!meta) return;
        const room = this.rooms.get(meta.roomCode);
        if (!room) return;

        const stream = room.activeStreams.get(message.payload.streamId);
        if (!stream) {
          sendJson(socket, {
            type: 'STREAM_ENDED',
            payload: { streamId: message.payload.streamId, roomId: room.id },
          });
          return;
        }

        stream.viewers.add(message.payload.viewerId);
        const hostClient = room.clients.get(stream.invite.hostId);
        if (hostClient) {
          sendJson(hostClient.socket, {
            type: 'VIEWER_JOINED',
            payload: message.payload,
          });
        }
        break;
      }

      case 'STREAM_LEAVE': {
        const meta = this.socketToUser.get(socket);
        if (!meta) return;
        const room = this.rooms.get(meta.roomCode);
        if (!room) return;

        const stream = room.activeStreams.get(message.payload.streamId);
        if (stream && stream.viewers.delete(message.payload.viewerId)) {
          const hostClient = room.clients.get(stream.invite.hostId);
          if (hostClient) {
            sendJson(hostClient.socket, {
              type: 'VIEWER_LEFT',
              payload: message.payload,
            });
          }
        }
        break;
      }

      case 'WEBRTC_OFFER':
      case 'WEBRTC_ANSWER':
      case 'ICE_CANDIDATE': {
        const meta = this.socketToUser.get(socket);
        if (!meta) return;
        const room = this.rooms.get(meta.roomCode);
        if (!room) return;

        const target = room.clients.get(message.payload.toUserId);
        if (target) {
          sendJson(target.socket, message as ServerToClientEvent);
        }
        break;
      }
    }
  }

  handleDisconnect(socket: WebSocket) {
    const meta = this.socketToUser.get(socket);
    if (!meta) return;
    this.socketToUser.delete(socket);

    const room = this.rooms.get(meta.roomCode);
    if (!room) return;

    const existing = room.clients.get(meta.userId);
    if (existing?.socket === socket) {
      room.clients.delete(meta.userId);
    }

    // Encerra streams caso o host tenha caído/desconectado
    for (const [streamId, stream] of room.activeStreams.entries()) {
      if (stream.invite.hostId === meta.userId) {
        room.activeStreams.delete(streamId);
        this.broadcastToRoom(room, {
          type: 'STREAM_ENDED',
          payload: { streamId, roomId: room.id },
        });
      } else if (stream.viewers.delete(meta.userId)) {
        const hostClient = room.clients.get(stream.invite.hostId);
        if (hostClient) {
          sendJson(hostClient.socket, {
            type: 'VIEWER_LEFT',
            payload: { streamId, viewerId: meta.userId },
          });
        }
      }
    }

    if (room.clients.size === 0) {
      this.rooms.delete(room.code);
      return;
    }

    this.broadcastRoomSync(room);
  }

  private joinRoom(
    socket: WebSocket,
    rawRoomCode: string,
    userId: string,
    userName: string
  ) {
    const previous = this.socketToUser.get(socket);
    if (previous && previous.roomCode !== this.normalizeCode(rawRoomCode)) {
      this.handleDisconnect(socket);
    }

    const code = this.normalizeCode(rawRoomCode);
    const room = this.getOrCreateRoom(code);
    const isViewerOnly = userId.startsWith('viewer-');

    const prevClient = room.clients.get(userId);
    if (prevClient && prevClient.socket !== socket) {
      this.socketToUser.delete(prevClient.socket);
      prevClient.socket.close(1000, 'Substituído por nova conexão');
    }

    room.clients.set(userId, {
      socket,
      userId,
      userName: userName.trim() || 'Usuário',
      roomCode: code,
      isViewerOnly,
      avatarHue: pickAvatarHue(userId),
    });

    this.socketToUser.set(socket, { roomCode: code, userId });

    this.broadcastRoomSync(room);

    // Se já houver stream ativa na sala, envia o convite para quem acabou de entrar
    if (!isViewerOnly) {
      for (const stream of room.activeStreams.values()) {
        if (stream.invite.hostId !== userId) {
          sendJson(socket, { type: 'STREAM_INVITE', payload: stream.invite });
        }
      }
    }
  }

  private getOrCreateRoom(code: string): RoomState {
    let room = this.rooms.get(code);
    if (!room) {
      room = {
        id: code,
        name: `Sala ${code}`,
        code,
        clients: new Map(),
        activeStreams: new Map(),
      };
      this.rooms.set(code, room);
    }
    return room;
  }

  private findRoom(roomIdOrCode: string): RoomState | undefined {
    const normalized = this.normalizeCode(roomIdOrCode);
    return this.rooms.get(normalized) ?? this.rooms.get(roomIdOrCode);
  }

  private normalizeCode(raw: string): string {
    const trimmed = raw.trim().toUpperCase();
    return trimmed || 'PULSE-742';
  }

  private buildRoomInfo(room: RoomState): RoomInfo {
    const streamingHosts = new Set(
      Array.from(room.activeStreams.values()).map((s) => s.invite.hostId)
    );

    const members: RoomMember[] = Array.from(room.clients.values())
      .filter((c) => !c.isViewerOnly)
      .map((c) => ({
        id: c.userId,
        name: c.userName,
        avatarHue: c.avatarHue,
        online: true,
        isStreaming: streamingHosts.has(c.userId),
      }));

    return {
      id: room.id,
      name: room.name,
      code: room.code,
      members,
    };
  }

  private broadcastRoomSync(room: RoomState) {
    const payload = this.buildRoomInfo(room);
    this.broadcastToRoom(room, { type: 'ROOM_SYNC', payload });
  }

  private broadcastToRoom(
    room: RoomState,
    event: ServerToClientEvent,
    excludeUserId?: string
  ) {
    for (const client of room.clients.values()) {
      if (excludeUserId && client.userId === excludeUserId) continue;
      if (event.type === 'ROOM_SYNC' && client.isViewerOnly) continue;
      sendJson(client.socket, event);
    }
  }
}

