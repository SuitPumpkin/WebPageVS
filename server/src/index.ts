import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import QRCode from 'qrcode';
import { validateLogin } from './auth.js';
import { 
  createRoom, getRoom, deleteRoom, addCandidate, removeCandidate,
  startVoting, pauseTimer, nextCandidate, skipCandidate, endVoting,
  submitVote, submitRanking, addStudent, endTiebreak,
  handleAdminMessage, handleStudentMessage, setStudentWs, removeStudent,
  RoomState,
  rooms
} from './websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDistPath = path.join(__dirname, '../../client/dist');

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(clientDistPath));

// Catch-all route for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (validateLogin(username, password)) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Credenciales inválidas' });
  }
});

app.post('/api/create-room', async (req, res) => {
  const { roundDuration } = req.body;
  
  // Create room without requiring existing WebSocket
  // Admin will connect via WebSocket after getting roomCode
  const { roomCode, state } = createRoom(null as any, roundDuration || 5);
  const roomUrl = `${req.protocol}://${req.get('host')}/student/${roomCode}`;
  const qrCode = await QRCode.toDataURL(roomUrl);
  
  res.json({ success: true, roomCode, roomUrl, qrCode });
});

app.get('/api/room/:roomCode', (req, res) => {
  const room = getRoom(req.params.roomCode);
  if (!room) {
    return res.status(404).json({ success: false, message: 'Sala no encontrada' });
  }
  res.json({ success: true, room: getPublicRoomState(room) });
});

app.delete('/api/room/:roomCode', (req, res) => {
  deleteRoom(req.params.roomCode);
  res.json({ success: true });
});

function getPublicRoomState(room: RoomState) {
  return {
    phase: room.phase,
    currentIndex: room.currentIndex,
    candidates: room.candidates,
    votes: room.votes,
    rankings: room.rankings,
    students: room.students.map(s => ({ id: s.id, name: s.name, hasVoted: s.hasVoted, hasRanked: s.hasRanked })),
    timerEnd: room.timerEnd,
    roundDuration: room.roundDuration,
  };
}

const adminConnections = new Map<string, WebSocket>();
const studentConnections = new Map<string, { roomCode: string; studentId: string }>();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const roomCode = url.searchParams.get('room');
  const role = url.searchParams.get('role');
  const adminId = url.searchParams.get('adminId');
  const studentId = url.searchParams.get('studentId');

  if (role === 'admin' && adminId) {
    adminConnections.set(adminId, ws);
    const room = getRoom(roomCode || '');
    if (room) {
      room.adminWs = ws;
      // Send initial state to newly connected admin
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
      ws.send(JSON.stringify(state));
    }
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (roomCode) handleAdminMessage(roomCode, message);
      } catch (e) {
        console.error('Error parsing admin message:', e);
      }
    });
    
    ws.on('close', () => {
      adminConnections.delete(adminId);
      const room = getRoom(roomCode || '');
      if (room && room.adminWs === ws) {
        room.adminWs = null;
      }
    });
  } else if (role === 'student' && roomCode && studentId) {
    studentConnections.set(studentId, { roomCode, studentId });
    const room = getRoom(roomCode);
    if (room) {
      // Send initial state to newly connected student
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
      ws.send(JSON.stringify(state));
    }
    setStudentWs(roomCode, studentId, ws);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleStudentMessage(roomCode, studentId, message, ws);
      } catch (e) {
        console.error('Error parsing student message:', e);
      }
    });
    
    ws.on('close', () => {
      studentConnections.delete(studentId);
      removeStudent(roomCode, studentId);
    });
  }
});

setInterval(() => {
  rooms.forEach((room, roomCode) => {
    if (room.timerEnd && Date.now() >= room.timerEnd) {
      if (room.phase === 'voting') {
        nextCandidate(roomCode);
      } else if (room.phase === 'tiebreak') {
        endTiebreak(roomCode);
      }
    }
  });
}, 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});