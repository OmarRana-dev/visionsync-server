const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Store room metadata
// Room structure: { roomId: { users: { socketId: { readyState, etc } } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a user joins or creates a room
  socket.on('join-room', (roomId, userName) => {
    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = { users: {} };
    }
    rooms[roomId].users[socket.id] = { userName, ready: true };

    console.log(`User ${socket.id} (${userName}) joined room: ${roomId}`);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.id, userName);

    // Send the list of existing users to the new user
    const existingUsers = Object.keys(rooms[roomId].users)
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, userName: rooms[roomId].users[id].userName }));
      
    socket.emit('room-users', existingUsers);
  });

  // WebRTC Signaling: Offer
  socket.on('signal-offer', (targetId, offer) => {
    socket.to(targetId).emit('signal-offer', socket.id, offer);
  });

  // WebRTC Signaling: Answer
  socket.on('signal-answer', (targetId, answer) => {
    socket.to(targetId).emit('signal-answer', socket.id, answer);
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('signal-ice-candidate', (targetId, candidate) => {
    socket.to(targetId).emit('signal-ice-candidate', socket.id, candidate);
  });

  // Disconnect handler
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    // Clean up room state and notify others
    for (const roomId in rooms) {
      if (rooms[roomId].users[socket.id]) {
        delete rooms[roomId].users[socket.id];
        
        // Notify others
        socket.to(roomId).emit('user-left', socket.id);
        
        // Cleanup empty rooms
        if (Object.keys(rooms[roomId].users).length === 0) {
          delete rooms[roomId];
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`VisionSync Elite Signaling Server running on port ${PORT}`);
});
