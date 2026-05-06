const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [/^chrome-extension:\/\//, 'https://visionsync-server.onrender.com'],
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Room structure: { roomId: { users: { socketId: { userName } }, state: { currentTime, isPlaying, lastUpdated } } }
const rooms = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Heartbeat to keep Render awake
  socket.on('ping', () => socket.emit('pong'));

  socket.on('join-room', (roomId, userName, options = {}, callback) => {
    // If it's a JOIN request (not create) and room doesn't exist, block it
    if (!options.isCreate && !rooms[roomId]) {
      if (typeof callback === 'function') callback({ error: 'Room does not exist!' });
      return;
    }

    socket.join(roomId);
    
    if (!rooms[roomId]) {
      rooms[roomId] = {
        users: {},
        state: { currentTime: 0, isPlaying: false, lastUpdated: Date.now() }
      };
    }

    rooms[roomId].users[socket.id] = { userName };
    
    // Tell the new user the current state of the movie
    socket.emit('room-state', rooms[roomId].state);

    // Send existing users list to the newcomer
    const existingUsers = {};
    Object.keys(rooms[roomId].users).forEach(id => {
      if (id !== socket.id) existingUsers[id] = rooms[roomId].users[id].userName;
    });
    socket.emit('existing-users', existingUsers);

    // Notify others
    socket.to(roomId).emit('user-joined', { socketId: socket.id, userName });
    
    if (typeof callback === 'function') callback({ success: true });
    console.log(`${userName} joined ${roomId} (isCreate: ${!!options.isCreate})`);
  });

  // HIGH-SPEED SYNC: Now includes a server-side timestamp for latency compensation
  socket.on('playback-sync', (data) => {
    const { roomId, type, time, isPlaying } = data;
    if (rooms[roomId]) {
      rooms[roomId].state = { 
        currentTime: time, 
        isPlaying, 
        lastUpdated: Date.now(),
        serverTimestamp: Date.now() // Attach server time for sync calculation
      };
      // Relay with the server timestamp
      socket.to(roomId).emit('playback-sync', { ...data, serverTimestamp: Date.now() });
    }
  });

  // SERVER-SIDE CHAT: Much more stable than P2P for groups
  socket.on('chat-message', (data) => {
    const { roomId, text, sender } = data;
    socket.to(roomId).emit('chat-message', data);
  });

  // EMOJI REACTIONS
  socket.on('emoji-reaction', (data) => {
    const { roomId, emoji } = data;
    socket.to(roomId).emit('emoji-reaction', data);
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms[roomId] && rooms[roomId].users[socket.id]) {
        const userName = rooms[roomId].users[socket.id].userName;
        delete rooms[roomId].users[socket.id];
        socket.to(roomId).emit('user-left', { socketId: socket.id, userName });
        
        // Cleanup empty rooms
        if (Object.keys(rooms[roomId].users).length === 0) {
          delete rooms[roomId];
        }
      }
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('/', (req, res) => {
  res.send('VisionSync Signaling Server is Running');
});

server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
