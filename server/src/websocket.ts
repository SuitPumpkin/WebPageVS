import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

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
  ws?: WebSocket;
}

export type Phase = 'waiting' | 'voting' | 'tiebreak' | 'podium' | 'ended';

export interface RoomState {
  phase: Phase;
  candidates: Candidate[];
  currentIndex: number;
  votes: Vote[];
  rankings: Ranking[];
  students: Student[];
  timerEnd: number | null;
  roundDuration: number;
  adminWs: WebSocket | null;
}

export const rooms = new Map<string, RoomState>();

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function calculateScores(candidates: Candidate[], votes: Vote[]): Map<string, number> {
  const scores = new Map<string, number>();
  candidates.forEach(c => scores.set(c.id, 0));
  
  votes.forEach(vote => {
    const total = vote.scores.coherence + vote.scores.effort + vote.scores.originality;
    scores.set(vote.candidateId, (scores.get(vote.candidateId) || 0) + total);
  });
  
  return scores;
}

function getTiedCandidates(candidates: Candidate[], scores: Map<string, number>): Candidate[][] {
  const scoreGroups = new Map<number, Candidate[]>();
  
  candidates.forEach(c => {
    const score = scores.get(c.id) || 0;
    if (!scoreGroups.has(score)) scoreGroups.set(score, []);
    scoreGroups.get(score)!.push(c);
  });
  
  return Array.from(scoreGroups.values()).filter(group => group.length > 1);
}

function getSortedCandidates(candidates: Candidate[], scores: Map<string, number>): Candidate[] {
  return [...candidates].sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
}

export function createRoom(adminWs: WebSocket | null, roundDuration: number): { roomCode: string; state: RoomState } {
  const roomCode = generateRoomCode();
  const state: RoomState = {
    phase: 'waiting',
    candidates: [],
    currentIndex: 0,
    votes: [],
    rankings: [],
    students: [],
    timerEnd: null,
    roundDuration: roundDuration * 60 * 1000,
    adminWs: adminWs || null,
  };
  rooms.set(roomCode, state);
  return { roomCode, state };
}

export function getRoom(roomCode: string): RoomState | undefined {
  return rooms.get(roomCode);
}

export function deleteRoom(roomCode: string): void {
  rooms.delete(roomCode);
}

export function addCandidate(roomCode: string, name: string, html: string, css: string): Candidate | null {
  const room = rooms.get(roomCode);
  if (!room) return null;
  
  const candidate: Candidate = {
    id: generateId(),
    name,
    html,
    css,
  };
  room.candidates.push(candidate);
  broadcastState(roomCode);
  return candidate;
}

export function removeCandidate(roomCode: string, candidateId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.candidates = room.candidates.filter(c => c.id !== candidateId);
  broadcastState(roomCode);
}

export function startVoting(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room || room.candidates.length === 0) return;
  
  room.phase = 'voting';
  room.currentIndex = 0;
  room.votes = [];
  room.students.forEach(s => s.hasVoted = false);
  startTimer(roomCode);
  broadcastState(roomCode);
}

export function startTimer(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.timerEnd = Date.now() + room.roundDuration;
  broadcastState(roomCode);
}

export function pauseTimer(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room || !room.timerEnd) return;
  
  const remaining = room.timerEnd - Date.now();
  room.roundDuration = remaining;
  room.timerEnd = null;
  broadcastState(roomCode);
}

export function nextCandidate(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  if (room.currentIndex < room.candidates.length - 1) {
    room.currentIndex++;
    room.students.forEach(s => s.hasVoted = false);
    startTimer(roomCode);
  } else {
    endVoting(roomCode);
  }
  broadcastState(roomCode);
}

export function skipCandidate(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.students.forEach(s => s.hasVoted = false);
  nextCandidate(roomCode);
}

export function endVoting(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.timerEnd = null;
  
  const scores = calculateScores(room.candidates, room.votes);
  const tiedGroups = getTiedCandidates(room.candidates, scores);
  
  if (tiedGroups.length > 0) {
    room.phase = 'tiebreak';
    const tiedCandidates = tiedGroups.flat();
    room.candidates = tiedCandidates;
    room.currentIndex = 0;
    room.rankings = [];
    room.students.forEach(s => s.hasRanked = false);
    startTimer(roomCode);
  } else {
    room.phase = 'podium';
  }
  broadcastState(roomCode);
}

export function submitVote(roomCode: string, studentId: string, candidateId: string, scores: Vote['scores']): boolean {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'voting') return false;
  
  const student = room.students.find(s => s.id === studentId);
  if (!student || student.hasVoted) return false;
  
  room.votes.push({ studentId, candidateId, scores });
  student.hasVoted = true;
  broadcastState(roomCode);
  return true;
}

export function submitRanking(roomCode: string, studentId: string, order: string[]): boolean {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'tiebreak') return false;
  
  const student = room.students.find(s => s.id === studentId);
  if (!student || student.hasRanked) return false;
  
  room.rankings.push({ studentId, order });
  student.hasRanked = true;
  broadcastState(roomCode);
  return true;
}

export function addStudent(roomCode: string, name: string, studentId?: string): Student | null {
  const room = rooms.get(roomCode);
  if (!room) return null;
  
  const existing = room.students.find(s => studentId && s.id === studentId);
  if (existing) return existing;
  
  const student: Student = {
    id: studentId || generateId(),
    name,
    hasVoted: false,
    hasRanked: false,
  };
  room.students.push(student);
  broadcastState(roomCode);
  return student;
}

export function endTiebreak(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'tiebreak') return;
  
  room.timerEnd = null;
  
  const pointsMap = new Map<string, number>();
  room.candidates.forEach(c => pointsMap.set(c.id, 0));
  
  room.rankings.forEach(ranking => {
    const n = ranking.order.length;
    ranking.order.forEach((candidateId, index) => {
      const points = n - index;
      pointsMap.set(candidateId, (pointsMap.get(candidateId) || 0) + points);
    });
  });
  
  const tiedGroups = getTiedCandidates(room.candidates, pointsMap);
  
  if (tiedGroups.length > 0) {
    tiedGroups.forEach(group => {
      group.forEach(c => {
        pointsMap.set(c.id, (pointsMap.get(c.id) || 0) + Math.random());
      });
    });
  }
  
  const allScores = calculateScores(room.candidates, room.votes);
  room.candidates.forEach(c => {
    allScores.set(c.id, (allScores.get(c.id) || 0) + (pointsMap.get(c.id) || 0));
  });
  
  room.phase = 'podium';
  broadcastState(roomCode);
}

function broadcastState(roomCode: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const state = {
    type: 'state',
    payload: {
      phase: room.phase,
      currentIndex: room.currentIndex,
      candidates: room.candidates,
      votes: room.votes,
      rankings: room.rankings,
      students: room.students.map(s => ({ id: s.id, name: s.name, hasVoted: s.hasVoted, hasRanked: s.hasRanked })),
      timerEnd: room.timerEnd,
      roundDuration: room.roundDuration,
    },
  };
  
  const message = JSON.stringify(state);
  
  if (room.adminWs && room.adminWs.readyState === WebSocket.OPEN) {
    room.adminWs.send(message);
  }
  
  room.students.forEach(student => {
    if (student.ws && student.ws.readyState === WebSocket.OPEN) {
      student.ws.send(message);
    }
  });
}

export function handleAdminMessage(roomCode: string, message: any): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  switch (message.type) {
    case 'add_candidate':
      addCandidate(roomCode, message.payload.name, message.payload.html, message.payload.css);
      break;
    case 'remove_candidate':
      removeCandidate(roomCode, message.payload.candidateId);
      break;
    case 'start_voting':
      startVoting(roomCode);
      break;
    case 'pause_timer':
      pauseTimer(roomCode);
      break;
    case 'next_candidate':
      nextCandidate(roomCode);
      break;
    case 'skip_candidate':
      skipCandidate(roomCode);
      break;
    case 'end_voting':
      endVoting(roomCode);
      break;
    case 'end_tiebreak':
      endTiebreak(roomCode);
      break;
    case 'save_queue':
      break;
    case 'load_queue':
      break;
  }
}

export function handleStudentMessage(roomCode: string, studentId: string, message: any, ws?: WebSocket): void {
  switch (message.type) {
    case 'join':
      const student = addStudent(roomCode, message.payload.name, studentId);
      if (student && ws) {
        student.ws = ws;
      }
      break;
    case 'vote':
      submitVote(roomCode, studentId, message.payload.candidateId, message.payload.scores);
      break;
    case 'rank':
      submitRanking(roomCode, studentId, message.payload.order);
      break;
  }
}

export function setStudentWs(roomCode: string, studentId: string, ws: WebSocket): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  const student = room.students.find(s => s.id === studentId);
  if (student) {
    (student as any).ws = ws;
  }
}

export function removeStudent(roomCode: string, studentId: string): void {
  const room = rooms.get(roomCode);
  if (!room) return;
  
  room.students = room.students.filter(s => s.id !== studentId);
  broadcastState(roomCode);
}