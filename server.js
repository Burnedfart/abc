const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });

console.log(`Signaling server running on port ${PORT}`);

// In-memory rooms - start with Public room always available
const rooms = {
  'Public': { public: true, peers: {} } // Public room always exists
};

// ---------------- Utility functions ----------------
function broadcastPublicRooms() {
  const otherPublicRooms = Object.entries(rooms)
    .filter(([id, room]) => room.public && id !== 'Public')
    .map(([id, room]) => ({ 
      id, 
      count: Object.keys(room.peers).length 
    }));

  const publicRoomData = {
    publicRoomCount: Object.keys(rooms['Public'].peers).length,
    otherPublicRooms: otherPublicRooms
  };

  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ 
        type: 'publicRooms', 
        ...publicRoomData
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
  // "Public" room is always public and always exists
  if (roomId === 'Public') {
    rooms['Public'].peers[uid] = { socket, nickname };
    broadcastRoomPeers('Public');
    broadcastPublicRooms();
    return;
  }

  // Handle other rooms
  if (!rooms[roomId]) {
    rooms[roomId] = { public: isPublic, peers: {} };
  }

  rooms[roomId].peers[uid] = { socket, nickname };
  broadcastRoomPeers(roomId);
  broadcastPublicRooms();
}

function leaveRoom(uid) {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.peers[uid]) {
      delete room.peers[uid];
      broadcastRoomPeers(roomId);
      
      // Never delete the Public room
      if (roomId !== 'Public' && Object.keys(room.peers).length === 0) {
        delete rooms[roomId];
      }
      
      broadcastPublicRooms();
      break;
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
        
        // For Public room, always allow join
        if (roomId === 'Public') {
          currentRoom = roomId;
          currentUid = uid;
          joinRoom(socket, roomId, uid, nickname, true);
          break;
        }
        
        // For other rooms, check if they exist
        if (!rooms[roomId]) {
          socket.send(JSON.stringify({ 
            type: 'error', 
            message: `Room "${roomId}" doesn't exist. Create it first!` 
          }));
          break;
        }
        
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
        broadcastPublicRooms();
        break;

      case 'host': {
        const { roomId, uid, nickname, isPublic } = data;
        
        // Prevent hosting a room called "Public"
        if (roomId === 'Public') {
          socket.send(JSON.stringify({ 
            type: 'error', 
            message: `"Public" room is always available. Just click "Join Public Room"!` 
          }));
          break;
        }
        
        currentRoom = roomId;
        currentUid = uid;
        joinRoom(socket, roomId, uid, nickname, isPublic);
        break;
      }

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

// Periodic authoritative updates
setInterval(() => {
  Object.keys(rooms).forEach(roomId => {
    broadcastRoomPeers(roomId);
  });
  broadcastPublicRooms();
}, 1500);
