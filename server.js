const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [/^chrome-extension:\/\//, 'https://visionsync-server-production.up.railway.app'],
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Store room metadata
// Room structure: { roomId: { users: { socketId: { userName, ready } } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // When a user joins or creates a room
  socket.on('join-room', (roomId, userName, options = {}, callback) => {
    if (typeof roomId !== 'string' || roomId.length > 50 || !roomId.startsWith('vsync-')) {
       if (typeof callback === 'function') callback({ error: 'Invalid room format' });
       return;
    }
    if (typeof userName !== 'string' || userName.length > 30) {
       if (typeof callback === 'function') callback({ error: 'Invalid username' });
       return;
    }

    if (!options.isCreate && !rooms[roomId]) {
       if (typeof callback === 'function') callback({ error: 'Room does not exist! Please check the link or code.' });
       return;
    }

    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = { users: {} };
    } else {
      // PROACTIVE CLEANUP: Zombie Session & Mesh Repair
      Object.keys(rooms[roomId].users).forEach(oldId => {
        if (rooms[roomId].users[oldId].userName === userName && oldId !== socket.id) {
          console.log(`[VisionSync Server] Cleaning up stale session for ${userName} (oldId: ${oldId})`);
          const oldSocket = io.sockets.sockets.get(oldId);
          if (oldSocket) {
            oldSocket.leave(roomId);
          }
          delete rooms[roomId].users[oldId];
          socket.to(roomId).emit('user-left', oldId);
        } else if (oldId === socket.id) {
          // Seamless Socket.IO reconnect: Force clients to tear down broken P2P tunnels
          socket.to(roomId).emit('user-left', oldId);
        }
      });
    }

    if (!rooms[roomId]) rooms[roomId] = { users: {} };
    rooms[roomId].users[socket.id] = { userName };

    console.log(`User ${socket.id} (${userName}) joined room: ${roomId}`);
    
    // Notify others in the room
    socket.to(roomId).emit('user-joined', socket.id, userName);

    // Send the list of existing users to the new user
    const existingUsers = Object.keys(rooms[roomId].users)
      .filter((id) => id !== socket.id)
      .map((id) => ({ id, userName: rooms[roomId].users[id].userName }));
      
    socket.emit('room-users', existingUsers);

    // INITIAL SYNC: If there are others, ask the first one for the state
    if (existingUsers.length > 0) {
      const hostId = existingUsers[0].id; // The first in the list
      socket.to(hostId).emit('request-host-state', socket.id);
    }
    
    if (typeof callback === 'function') callback({ success: true });
  });

  // Host sends their current state to the newcomer
  socket.on('send-state-to-peer', (targetId, state) => {
    socket.to(targetId).emit('initial-sync', state);
  });



  const inSameRoom = (socketId, targetId) => {
    return Object.values(rooms).some(room => room.users[socketId] && room.users[targetId]);
  };

  // WebRTC Signaling: Offer
  socket.on('signal-offer', (targetId, offer) => {
    if (inSameRoom(socket.id, targetId)) socket.to(targetId).emit('signal-offer', socket.id, offer);
  });

  // WebRTC Signaling: Answer
  socket.on('signal-answer', (targetId, answer) => {
    if (inSameRoom(socket.id, targetId)) socket.to(targetId).emit('signal-answer', socket.id, answer);
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('signal-ice-candidate', (targetId, candidate) => {
    if (inSameRoom(socket.id, targetId)) socket.to(targetId).emit('signal-ice-candidate', socket.id, candidate);
  });

  const handleUserLeave = (socket) => {
    for (const roomId in rooms) {
      if (rooms[roomId].users[socket.id]) {
        delete rooms[roomId].users[socket.id];
        
        io.to(roomId).emit('user-left', socket.id);
        socket.leave(roomId);
        
        if (rooms[roomId] && Object.keys(rooms[roomId].users).length === 0) {
          delete rooms[roomId];
        }
      }
    }
  };

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    handleUserLeave(socket);
  });

  socket.on('leave-room', () => {
    console.log(`User left room explicitly: ${socket.id}`);
    handleUserLeave(socket);
  });
});

server.listen(PORT, () => {
  console.log(`VisionSync Elite Signaling Server running on port ${PORT}`);
});
