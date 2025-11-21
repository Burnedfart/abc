document.addEventListener('DOMContentLoaded', () => {
  const hostBtn = document.getElementById('hostBtn');
  const joinBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn');
  const nicknameInput = document.getElementById('nicknameInput');
  const roomIdInput = document.getElementById('roomId');
  const connectToRoomInput = document.getElementById('connectToRoom');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const chat = document.getElementById('chat');
  const publicToggle = document.getElementById('publicRoomToggle');
  const publicRoomList = document.getElementById('publicRoomList');
  const userList = document.getElementById('userList');

  const serverStatusEl = document.getElementById('serverStatus');
  const peersStatusEl = document.getElementById('peersStatus');

  const WS_ENDPOINT = "wss://p2pchat-r8so.onrender.com";
  let ws;
  let roomId = null;
  let uid = Math.random().toString(36).substring(2,10);
  let nickname = null;
  let isPublic = false;
  const peers = {};
  const signalQueue = {};

  function setServerStatus(connected) {
    serverStatusEl.textContent = `Connected to server: ${connected ? '✅ Success' : '❌ Fail'}`;
  }

  function setPeersStatus(allPeersConnected) {
    peersStatusEl.textContent = `Connected to other users: ${allPeersConnected ? '✅ Success' : '❌ Fail'}`;
  }

  function updatePeersStatus() {
    const peerCount = Object.values(peers).length;
    const anyConnected = Object.values(peers).some(p => p.peer.connected);
    setPeersStatus(anyConnected);
    
    if (peerCount === 0) {
      peersStatusEl.textContent = 'Connected to other users: ⏳ Waiting for another user for status';
    } else {
      setPeersStatus(anyConnected);
    }
  }

  function logSystemMessage(msg) {
    const div = document.createElement('div');
    div.textContent = msg;
    div.className = 'system-msg';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function logChatMessage(sender, msg, isLocal) {
    const div = document.createElement('div');
    div.textContent = `${sender}: ${msg}`;
    div.className = isLocal ? 'your-msg' : 'peer-msg';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function updateUserList(peersInRoom) {
    userList.innerHTML = '';
    peersInRoom.forEach(({ uid, nickname }) => {
      const li = document.createElement('li');
      li.textContent = `${nickname || 'No nickname'} (${uid})`;
      userList.appendChild(li);
    });
    // Update Public count
    if (roomId === 'Public') {
      const countEl = document.getElementById('count-public');
      const totalUsers = peersInRoom.length; 
      countEl.textContent = `Users: ${totalUsers}`;
    }
      updatePeersStatus();
    }

  function connectWebSocket() {
    ws = new WebSocket(WS_ENDPOINT);

    ws.onopen = () => {
      setServerStatus(true);
    };
    ws.onclose = () => setServerStatus(false);
    ws.onerror = () => setServerStatus(false);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch(msg.type) {
        case 'publicRooms':
          publicRoomList.innerHTML = '';
          msg.rooms.forEach(r => {
            if (r.count > 0) {
              const li = document.createElement('li');
              li.textContent = `${r.id}: ${r.count} users`;
              publicRoomList.appendChild(li);
            }
          });
          break;

        case 'roomPeers':
          updateUserList(msg.peers);
          msg.peers.forEach(p => {
            if (p.uid !== uid && !peers[p.uid]) {
              const initiator = uid < p.uid;
              createPeerConnection(p.uid, initiator);
              if (signalQueue[p.uid]) {
                signalQueue[p.uid].forEach(sig => peers[p.uid].peer.signal(sig));
                delete signalQueue[p.uid];
              }
            }
          });
          break;

        case 'signal':
          const { from, signal } = msg;
          if (!peers[from]) {
            if (!signalQueue[from]) signalQueue[from] = [];
            signalQueue[from].push(signal);
          } else {
            try { peers[from].peer.signal(signal); } catch (e) { console.error(e); }
          }
          break;

        case 'chat':
          logChatMessage(msg.from, msg.message, false);
          break;
      }
    };
  }

  function sendSignal(toUid, signalData) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', to: toUid, from: uid, signal: signalData }));
    }
  }

  function createPeerConnection(otherUid, initiator) {
    if (peers[otherUid]) return;
    const newPeer = new SimplePeer({ initiator, trickle: false });
    peers[otherUid] = { peer: newPeer, nickname: null };

    newPeer.on('signal', data => sendSignal(otherUid, data));

    newPeer.on('connect', () => {
      logSystemMessage(`Connected to peer ${otherUid}`);
      updatePeersStatus();
      newPeer.send(JSON.stringify({ type: 'nickname', nickname }));
    });

    newPeer.on('data', data => {
      let msgObj = null;
      try { msgObj = JSON.parse(data.toString()); } catch {}
      if (msgObj?.type === 'nickname') {
        peers[otherUid].nickname = msgObj.nickname;
        logSystemMessage(`Peer ${otherUid} set nickname: ${msgObj.nickname}`);
      } else {
        const senderName = peers[otherUid].nickname || otherUid;
        logChatMessage(senderName, data.toString(), false);
      }
      updatePeersStatus();
    });

    newPeer.on('close', () => {
      delete peers[otherUid];
      logSystemMessage(`Disconnected from peer ${otherUid}`);
      updatePeersStatus();
    });

    newPeer.on('error', err => console.error(err));
  }

  function joinRoom(isHost = false) {
    if (!nickname) nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    if (isHost) {
      roomId = roomIdInput.value.trim() || Math.random().toString(36).substring(2,10);
      isPublic = publicToggle.checked;
      roomIdInput.value = roomId;
    } else {
      roomId = connectToRoomInput.value.trim();
      isPublic = false;
    }

    if (!roomId) return alert('Enter a Room ID.');
    if (!ws || ws.readyState !== WebSocket.OPEN) return setTimeout(() => joinRoom(isHost), 100);

    ws.send(JSON.stringify({ type: 'join', uid, nickname, roomId, isPublic }));
    logSystemMessage(`${isHost ? 'Hosting' : 'Joining'} room: ${roomId}`);
    messageInput.disabled = false;
    sendBtn.disabled = false;
  }

  function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    logChatMessage('Me', msg, true);
    messageInput.value = '';
    Object.values(peers).forEach(({ peer }) => { if (peer.connected) peer.send(msg); });
  }

  function disconnectFromRoom() {
    Object.values(peers).forEach(({ peer }) => peer.destroy());
    for (const key in peers) delete peers[key];
    if (ws && ws.readyState === WebSocket.OPEN && roomId) {
      ws.send(JSON.stringify({ type: 'leave', uid, roomId }));
    }
    roomId = null;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    userList.innerHTML = '';
    updatePeersStatus();
    logSystemMessage('Disconnected from room manually.');
  }

  connectWebSocket();

  hostBtn.addEventListener('click', () => joinRoom(true));
  joinBtn.addEventListener('click', () => joinRoom(false));
  disconnectBtn.addEventListener('click', disconnectFromRoom);
  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtn.click(); });

  // Periodically update public room list
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) broadcastPublicRoomsRequest();
  }, 10000);

  function broadcastPublicRoomsRequest() {
    ws.send(JSON.stringify({ type: 'listRooms' }));
  }

  window.addEventListener('beforeunload', disconnectFromRoom);
});
