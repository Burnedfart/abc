const WebSocket = require('ws');

const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

server.on('connection', (socket) => {
  socket.on('message', (msg) => {
    server.clients.forEach((client) => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
});

console.log("Signaling server running.");
