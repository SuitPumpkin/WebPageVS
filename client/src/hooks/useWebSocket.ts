import { useEffect, useRef, useState, useCallback } from 'react';

export interface Candidate {
  id: string;
  name: string;
  html: string;
  css: string;
}

export interface Vote {
  studentId: string;
  candidateId: string;
  scores: {
    coherence: number;
    effort: number;
    originality: number;
  };
}

export interface Ranking {
  studentId: string;
  order: string[];
}

export interface Student {
  id: string;
  name: string;
  hasVoted: boolean;
  hasRanked: boolean;
}

export type Phase = 'waiting' | 'voting' | 'tiebreak' | 'podium' | 'ended';

export interface RoomState {
  phase: Phase;
  currentIndex: number;
  candidates: Candidate[];
  votes: Vote[];
  rankings: Ranking[];
  students: Student[];
  timerEnd: number | null;
  roundDuration: number;
}

export interface WebSocketMessage {
  type: string;
  payload: any;
}

interface UseWebSocketOptions {
  roomCode?: string;
  role: 'admin' | 'student';
  studentId?: string;
  adminId?: string;
  onMessage?: (message: WebSocketMessage) => void;
  onStateChange?: (state: RoomState) => void;
}

export function useWebSocket({
  roomCode,
  role,
  studentId,
  adminId,
  onMessage,
  onStateChange,
}: UseWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const shouldReconnectRef = useRef(true);
  
  // Use refs to avoid recreating connect on every render
  const callbacksRef = useRef<{ onMessage?: (message: WebSocketMessage) => void; onStateChange?: (state: RoomState) => void }>({});
  callbacksRef.current.onMessage = onMessage;
  callbacksRef.current.onStateChange = onStateChange;

  const connect = useCallback(() => {
    if (!roomCode) return;
    if (role === 'student' && !studentId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (reconnectCountRef.current >= 10) return;

    reconnectCountRef.current++;
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?room=${roomCode}&role=${role}${studentId ? `&studentId=${studentId}` : ''}${adminId ? `&adminId=${adminId}` : ''}`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectCountRef.current = 0;
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);
        
        if (message.type === 'state') {
          setState(message.payload);
          callbacksRef.current.onStateChange?.(message.payload);
        }
        
        callbacksRef.current.onMessage?.(message);
      } catch (e) {
        console.error('Error parsing message:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (shouldReconnectRef.current && reconnectCountRef.current < 10) {
        const delay = Math.min(1000 * Math.pow(1.5, reconnectCountRef.current), 10000);
        reconnectTimeoutRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = () => {
      console.error('WebSocket error');
    };
  }, [roomCode, role, studentId, adminId]);

  const send = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    shouldReconnectRef.current = true;
    if (roomCode && (role === 'admin' || studentId)) {
      connect();
    }
    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, [connect, roomCode, studentId]);

  return { isConnected, state, send };
}