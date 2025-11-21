const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

console.log(`Signaling server running on port ${PORT}`);

// In-memory rooms
const rooms = {};

// ---------------- Utility functions ----------------
function broadcastPublicRooms() {
  const publicRooms = Object.entries(rooms)
    .filter(([_, room]) => room.public)
    .map(([id, room]) => ({ 
      id, 
      count: Object.keys(room.peers).length 
    }));

  // Broadcast to ALL connected clients, not just room members
  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ 
        type: 'publicRooms', 
        rooms: publicRooms 
      }));
    }
  });
}

function broadcastRoomPeers(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const peerList = Object.entries(room.peers).map(([uid, info]) => ({
    uid,
    nickname: info.nickname
  }));

  // Broadcast only to clients in this specific room
  Object.values(room.peers).forEach(({ socket }) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ 
        type: 'roomPeers', 
        peers: peerList 
      }));
    }
  });
}

// ---------------- Room management ----------------
function joinRoom(socket, roomId, uid, nickname, isPublic) {
  if (!rooms[roomId]) {
    // Create new room with the specified public/private status
    rooms[roomId] = { public: isPublic, peers: {} };
  } else {
    // CRITICAL FIX: If room exists and is named "Public", ensure it's public
    if (roomId === 'Public') {
      rooms[roomId].public = true;
    }
  }

  rooms[roomId].peers[uid] = { socket, nickname };

  // Broadcast updates to all affected clients
  broadcastRoomPeers(roomId);
  broadcastPublicRooms(); // Update ALL clients with new room counts
}

function leaveRoom(uid) {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.peers[uid]) {
      delete room.peers[uid];
      
      // Update room members about the new peer list
      broadcastRoomPeers(roomId);
      
      // Clean up empty rooms
      if (Object.keys(room.peers).length === 0) {
        delete rooms[roomId];
      }
      
      // Update ALL clients with new public room counts
      broadcastPublicRooms();
      break; // User can only be in one room at a time
    }
  }
}

// ---------------- WebSocket signaling ----------------
server.on('connection', socket => {
  let currentRoom = null;
  let currentUid = null;

  socket.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }

    const { type } = data;

    switch (type) {
      case 'join': {
        const { roomId, uid, nickname, isPublic } = data;
        currentRoom = roomId;
        currentUid = uid;
        joinRoom(socket, roomId, uid, nickname, isPublic);
        break;
      }

      case 'leave':
        leaveRoom(data.uid);
        break;

      case 'signal': {
        const { to, signal, from } = data;
        const room = rooms[currentRoom];
        if (room && room.peers[to]) {
          const targetSocket = room.peers[to].socket;
          if (targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({ 
              type: 'signal', 
              from, 
              signal 
            }));
          }
        }
        break;
      }

      case 'listRooms':
        // Send current public rooms to this client
        broadcastPublicRooms();
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  });

  socket.on('close', () => {
    if (currentUid) {
      leaveRoom(currentUid);
    }
  });

  socket.on('error', () => {
    if (currentUid) {
      leaveRoom(currentUid);
    }
  });
});

// Periodic authoritative update of rooms and peers every 1.5 seconds
setInterval(() => {
  // Update room peers for each room (sent only to room members)
  Object.keys(rooms).forEach(roomId => {
    broadcastRoomPeers(roomId);
  });
  
  // Update public room list for ALL connected clients
  broadcastPublicRooms();
}, 1500);
