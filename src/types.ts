export type StreamQualityPreset = '720p60' | '1080p60' | '1440p60';

export interface RoomMember {
  id: string;
  name: string;
  avatarHue: string;
  online: boolean;
  isStreaming: boolean;
}

export interface RoomInfo {
  id: string;
  name: string;
  code: string;
  members: RoomMember[];
}

export interface StreamInvite {
  streamId: string;
  roomId: string;
  hostId: string;
  hostName: string;
  startedAt: number;
  preset: StreamQualityPreset;
}

export interface SessionDescriptionPayload {
  type?: string;
  sdp?: string;
}

export interface IceCandidatePayload {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type ClientToServerMessage =
  | {
      type: 'ROOM_JOIN';
      payload: { roomCode: string; userId: string; userName: string };
    }
  | {
      type: 'STREAM_START';
      payload: {
        streamId: string;
        roomId: string;
        hostId: string;
        hostName: string;
        preset: StreamQualityPreset;
      };
    }
  | {
      type: 'STREAM_STOP';
      payload: { streamId: string; roomId: string; hostId: string };
    }
  | {
      type: 'STREAM_JOIN';
      payload: { streamId: string; viewerId: string; viewerName: string };
    }
  | {
      type: 'STREAM_LEAVE';
      payload: { streamId: string; viewerId: string };
    }
  | {
      type: 'WEBRTC_OFFER';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        sdp: SessionDescriptionPayload;
      };
    }
  | {
      type: 'WEBRTC_ANSWER';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        sdp: SessionDescriptionPayload;
      };
    }
  | {
      type: 'ICE_CANDIDATE';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        candidate: IceCandidatePayload;
      };
    };

export type ServerToClientEvent =
  | { type: 'ROOM_SYNC'; payload: RoomInfo }
  | { type: 'STREAM_INVITE'; payload: StreamInvite }
  | { type: 'STREAM_ENDED'; payload: { streamId: string; roomId: string } }
  | {
      type: 'VIEWER_JOINED';
      payload: { streamId: string; viewerId: string; viewerName: string };
    }
  | {
      type: 'VIEWER_LEFT';
      payload: { streamId: string; viewerId: string };
    }
  | {
      type: 'WEBRTC_OFFER';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        sdp: SessionDescriptionPayload;
      };
    }
  | {
      type: 'WEBRTC_ANSWER';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        sdp: SessionDescriptionPayload;
      };
    }
  | {
      type: 'ICE_CANDIDATE';
      payload: {
        streamId: string;
        fromUserId: string;
        toUserId: string;
        candidate: IceCandidatePayload;
      };
    };

