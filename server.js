const WebSocket = require('ws');

const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

const rooms = {}; // { roomId: { public: bool, peers: { uid: { nickname, socket } } } }

function broadcastToRoom(roomId, message, excludeSocket = null) {
  if (!rooms[roomId]) return;
  Object.values(rooms[roomId].peers).forEach(({ socket }) => {
    if (socket !== excludeSocket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  });
}

server.on('connection', (socket) => {
  let currentRoom = null;
  let uid = null;

  socket.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      case 'join':
        uid = msg.uid;
        currentRoom = msg.roomId;
        const nickname = msg.nickname || 'Anonymous';
        const isPublic = !!msg.public;

        if (!rooms[currentRoom]) rooms[currentRoom] = { public: isPublic, peers: {} };
        rooms[currentRoom].peers[uid] = { nickname, socket };
        rooms[currentRoom].public = isPublic;

        // Notify all peers in the room about the updated user list
        broadcastToRoom(currentRoom, {
          type: 'updateUsers',
          users: Object.entries(rooms[currentRoom].peers).map(([id, p]) => ({ uid: id, nickname: p.nickname }))
        });

        console.log(`${nickname} (${uid}) joined room ${currentRoom}`);
        break;

      case 'signal':
        // { type: 'signal', to: uid, from: uid, data: ... }
        if (currentRoom && rooms[currentRoom].peers[msg.to]) {
          const target = rooms[currentRoom].peers[msg.to].socket;
          if (target.readyState === WebSocket.OPEN) target.send(JSON.stringify({ type: 'signal', from: msg.from, data: msg.data }));
        }
        break;

      case 'chat':
        // { type: 'chat', message, from }
        if (currentRoom) {
          broadcastToRoom(currentRoom, { type: 'chat', message: msg.message, from: msg.from }, socket);
        }
        break;

      case 'listRooms':
        // return public rooms
        const publicRooms = Object.entries(rooms)
          .filter(([id, r]) => r.public)
          .map(([id, r]) => ({ id, count: Object.keys(r.peers).length }));
        socket.send(JSON.stringify({ type: 'publicRooms', rooms: publicRooms }));
        break;

      default:
        console.warn('Unknown message type:', msg.type);
    }
  });

  socket.on('close', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].peers[uid];
      // Notify remaining peers
      broadcastToRoom(currentRoom, {
        type: 'updateUsers',
        users: Object.entries(rooms[currentRoom].peers).map(([id, p]) => ({ uid: id, nickname: p.nickname }))
      });
      if (Object.keys(rooms[currentRoom].peers).length === 0) delete rooms[currentRoom];
      console.log(`${uid} disconnected from room ${currentRoom}`);
    }
  });
});

console.log('Multi-room signaling server running.');
