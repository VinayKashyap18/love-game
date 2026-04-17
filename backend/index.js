const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const localtunnel = require('localtunnel');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const rooms = {};

const QUESTIONS = {
  1: ["What was your first impression of me?", "What do you think I noticed about you first?", "What is something we have in common?", "What do you think I am naturally good at?", "What vibe do I give off?", "What stood out about me early?", "What makes me happy instantly?", "What do I overthink?", "One word for me?", "What do I value most?", "What do I struggle with?", "What makes me different?"],
  2: ["When do you feel closest to me?", "What makes you feel safe?", "What makes you feel loved?", "What should I understand better?", "When do you miss me?", "What matters most?", "What do you need more?", "When distant?", "What did you hide?", "What we do well?", "What reassures you?", "What keeps us strong?"],
  3: ["What attracted you first?", "When did you like me more?", "When most attracted?", "Fav voice thing?", "Best compliment?", "Tease or sweet?", "Butterflies moment?", "Fav feature?", "Secretly love?", "When feel wanted?", "Fav memory?", "Smile instantly?"],
  4: ["If alone now?", "Missed touch?", "Imagine meeting?", "Fav kisses?", "Slow or intense?", "Hidden thought?", "Ideal date?", "Next meet wish?", "Soft or bold?", "First minutes?", "Feel irresistible?", "Wanted vibe?"],
  5: ["Never told me?", "Fear about us?", "Hardest to show?", "Love shaped by?", "Struggle to ask?", "Misunderstood?", "Most vulnerable?", "Healing from?", "Commitment?", "Fear in love?", "Emotional need?", "Need more from me?"],
  6: ["What I taught you?", "How I changed you?", "What you appreciate?", "Future with me?", "What you love most?", "Never change?", "Improve?", "Strength?", "Excited for?", "Remember always?", "Why choose me?", "What is us?"]
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('create-room', () => {
    const roomId = Math.floor(100000 + Math.random() * 900000).toString();
    rooms[roomId] = {
      players: {},
      gameState: {
        level: 1,
        turn: 1,
        currentPlayer: 1, // 1 or 2
        usedNumbers: [],
        scores: { 1: [], 2: [] },
        allScores: [], // History of averages
        phase: 'lobby', // lobby, picking, answering, rating, level-summary, finished
        currentQuestion: null,
      }
    };
    socket.join(roomId);
    socket.emit('room-created', { roomId, gameState: rooms[roomId].gameState });
    console.log('Room created:', roomId);
  });

  socket.on('join-room', (roomId) => {
    if (rooms[roomId]) {
      socket.join(roomId);
      // Send current players (mapped to their roles)
      const playerRoles = {};
      Object.entries(rooms[roomId].players).forEach(([pid, data]) => {
        playerRoles[data.socketId] = data.role;
      });
      socket.emit('room-joined', { roomId, gameState: rooms[roomId].gameState, players: playerRoles });
      console.log('User joined room:', roomId);
    } else {
      socket.emit('error', 'Room not found');
    }
  });

  socket.on('rejoin-room', ({ roomId, playerId }) => {
    if (rooms[roomId] && rooms[roomId].players[playerId]) {
      const player = rooms[roomId].players[playerId];
      player.socketId = socket.id; // Update socket ID
      socket.join(roomId);
      
      const playerRoles = {};
      Object.entries(rooms[roomId].players).forEach(([pid, data]) => {
        playerRoles[data.socketId] = data.role;
      });

      socket.emit('room-joined', { 
        roomId, 
        gameState: rooms[roomId].gameState, 
        players: playerRoles,
        role: player.role 
      });
      console.log(`User ${playerId} rejoined room ${roomId} as role ${player.role}`);
    } else {
      socket.emit('error', 'Could not rejoin room');
    }
  });

  socket.on('select-role', ({ roomId, role, playerId }) => {
    if (rooms[roomId]) {
      // Use playerId as primary key
      rooms[roomId].players[playerId] = { role, socketId: socket.id };
      
      const playerRoles = {};
      Object.entries(rooms[roomId].players).forEach(([pid, data]) => {
        playerRoles[data.socketId] = data.role;
      });
      
      io.to(roomId).emit('player-update', playerRoles);
      
      // If both roles are filled, start the game
      const roles = Object.values(rooms[roomId].players).map(p => p.role);
      if (roles.includes('1') && roles.includes('2')) {
        rooms[roomId].gameState.phase = 'picking';
        io.to(roomId).emit('state-update', rooms[roomId].gameState);
      }
    }
  });

  socket.on('pick-number', ({ roomId, number }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    room.gameState.usedNumbers.push(number);
    room.gameState.currentQuestion = QUESTIONS[room.gameState.level][number - 1];
    room.gameState.phase = 'answering';
    io.to(roomId).emit('state-update', room.gameState);
  });

  socket.on('finish-answering', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    room.gameState.phase = 'rating';
    io.to(roomId).emit('state-update', room.gameState);
  });

  socket.on('submit-rating', ({ roomId, rating }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    const { gameState } = room;
    gameState.scores[gameState.currentPlayer].push(parseFloat(rating));
    
    // Switch player and increment turn
    gameState.currentPlayer = gameState.currentPlayer === 1 ? 2 : 1;
    gameState.turn++;
    
    if (gameState.turn > 10) {
      // Level complete
      const p1Avg = gameState.scores[1].reduce((a, b) => a + b, 0) / gameState.scores[1].length || 0;
      const p2Avg = gameState.scores[2].reduce((a, b) => a + b, 0) / gameState.scores[2].length || 0;
      
      gameState.allScores.push({ level: gameState.level, p1: p1Avg, p2: p2Avg });
      
      if (gameState.level >= 6) {
        gameState.phase = 'finished';
      } else {
        gameState.phase = 'level-summary';
      }
    } else {
      gameState.phase = 'picking';
    }
    
    io.to(roomId).emit('state-update', gameState);
  });

  socket.on('next-level', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;
    
    room.gameState.level++;
    room.gameState.turn = 1;
    room.gameState.usedNumbers = [];
    room.gameState.scores = { 1: [], 2: [] };
    room.gameState.phase = 'picking';
    io.to(roomId).emit('state-update', room.gameState);
  });

  socket.on('webrtc-signal', ({ roomId, signal, to }) => {
    // Relays WebRTC signal to the specific peer or other members in room
    socket.to(roomId).emit('webrtc-signal', { signal, from: socket.id });
  });

  socket.on('webrtc-end-call', ({ roomId }) => {
    socket.to(roomId).emit('webrtc-end-call');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  if (process.env.LT) {
    try {
      const tunnel = await localtunnel({ port: PORT, subdomain: 'love-game-' + Math.random().toString(36).substring(7) });
      console.log('Public URL:', tunnel.url);
    } catch (err) {
      console.error('Localtunnel error:', err);
    }
  }
});
