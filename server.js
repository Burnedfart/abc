const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const server = new WebSocket.Server({ port: PORT });
console.log(`Signaling server running on port ${PORT}`);

const rooms = {}; // rooms = { roomId: { public: true/false, peers: { uid: { nickname, socket } } } }

function broadcastPublicRooms() {
  const publicRooms = Object.entries(rooms)
    .filter(([_, room]) => room.public)
    .map(([id, room]) => ({ id, count: Object.keys(room.peers).length }));

  server.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: 'publicRooms', rooms: publicRooms }));
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
      socket.send(JSON.stringify({ type: 'roomPeers', peers: peerList }));
    }
  });
}

function joinRoom(socket, roomId, uid, nickname, isPublic) {
  if (!rooms[roomId]) {
    rooms[roomId] = { public: isPublic, peers: {} };
  }

  rooms[roomId].public = rooms[roomId].peers && Object.keys(rooms[roomId].peers).length > 0
    ? rooms[roomId].public
    : isPublic;

  rooms[roomId].peers[uid] = { socket, nickname };

  broadcastPublicRooms();
  broadcastRoomPeers(roomId);
}

function leaveRoom(uid) {
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.peers[uid]) {
      delete room.peers[uid];
      broadcastRoomPeers(roomId);
      if (Object.keys(room.peers).length === 0) {
        delete rooms[roomId];
      }
      broadcastPublicRooms();
    }
  }
}

server.on('connection', socket => {
  let currentRoom = null;
  let currentUid = null;

  socket.on('message', msg => {
    let data;
    try { data = JSON.parse(msg); } catch { return; }
    const { type } = data;

    switch (type) {
      case 'join':
        const { roomId, uid, nickname, isPublic } = data;
        currentRoom = roomId;
        currentUid = uid;
        joinRoom(socket, roomId, uid, nickname, isPublic);
        break;

      case 'signal':
        const { to, signal, from } = data;
        const room = rooms[currentRoom];
        if (room && room.peers[to]) {
          const targetSocket = room.peers[to].socket;
          if (targetSocket.readyState === WebSocket.OPEN) {
            targetSocket.send(JSON.stringify({ type: 'signal', from, signal }));
          }
        }
        break;

      case 'leave':
        leaveRoom(data.uid);
        break;

      default:
        console.warn('Unknown message type:', type);
    }
  });

  socket.on('close', () => leaveRoom(currentUid));
  socket.on('error', () => leaveRoom(currentUid));
});
