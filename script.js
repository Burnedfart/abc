document.addEventListener('DOMContentLoaded', () => {
  const hostBtn = document.getElementById('hostBtn');
  const joinBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn'); // new button
  const nicknameInput = document.getElementById('nicknameInput');
  const roomIdInput = document.getElementById('roomId');
  const connectToRoomInput = document.getElementById('connectToRoom');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const connectionStatus = document.getElementById('connection-status');
  const chat = document.getElementById('chat');
  const copyRoomIdBtn = document.getElementById('copyRoomId');
  const publicToggle = document.getElementById('publicRoomToggle');
  const publicRoomList = document.getElementById('publicRoomList');
  const userList = document.getElementById('userList');

  const WS_ENDPOINT = "wss://p2pchat-r8so.onrender.com"; // replace with your Render WebSocket
  let ws;
  let roomId = null;
  let uid = null;
  let nickname = null;
  let isPublic = false;

  const peers = {};

  function setStatus(connected) {
    connectionStatus.textContent = connected ? '🟢 Connected' : '🔴 Disconnected';
    connectionStatus.classList.toggle('connected', connected);
    connectionStatus.classList.toggle('disconnected', !connected);
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
    for (const { uid, nickname } of peersInRoom) {
      const li = document.createElement('li');
      li.textContent = `${nickname || 'No nickname'} (${uid})`;
      userList.appendChild(li);
    }
  }

  function connectWebSocket() {
    ws = new WebSocket(WS_ENDPOINT);

    ws.onopen = () => setStatus(true);

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
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
          break;

        case 'signal':
          const { from, signal } = msg;
          if (!peers[from]) createPeerConnection(from, false);
          try { peers[from].peer.signal(signal); } catch (e) { console.error('Signal error', e); }
          break;
      }
    };

    ws.onclose = () => setStatus(false);
    ws.onerror = (err) => console.error('WebSocket error:', err);
  }

  function sendSignal(toUid, signalData) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', to: toUid, signal: signalData }));
    }
  }

  function createPeerConnection(otherUid, initiator) {
    if (peers[otherUid]) return;
    const newPeer = new SimplePeer({ initiator, trickle: false });
    peers[otherUid] = { peer: newPeer, nickname: null };

    newPeer.on('signal', data => sendSignal(otherUid, data));

    newPeer.on('connect', () => {
      logSystemMessage(`Connected to peer ${otherUid}`);
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
    });

    newPeer.on('close', () => {
      const peerNickname = peers[otherUid]?.nickname || 'Unknown';
      logSystemMessage(`Disconnected from peer ${otherUid} (${peerNickname})`);
      delete peers[otherUid];
    });

    newPeer.on('error', err => console.error('Peer error:', err));
  }

  function joinRoomAsHost() {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    const inputRoomId = roomIdInput.value.trim();
    roomId = inputRoomId || Math.random().toString(36).substring(2,10);
    roomIdInput.value = roomId;

    isPublic = publicToggle.checked;

    ws.send(JSON.stringify({ type: 'join', roomId, uid, nickname, isPublic }));
    logSystemMessage(`Hosting room: ${roomId} (${isPublic ? 'Public' : 'Private'})`);
  }

  function joinRoomAsPeer() {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    roomId = connectToRoomInput.value.trim();
    if (!roomId) return alert('Enter a Room ID to connect.');

    ws.send(JSON.stringify({ type: 'join', roomId, uid, nickname, isPublic: false }));
    logSystemMessage(`Joining room: ${roomId} as ${nickname}`);
  }

  function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    logChatMessage('Me', msg, true);
    messageInput.value = '';

    Object.values(peers).forEach(({ peer }) => {
      if (peer.connected) peer.send(msg);
    });
  }

  function disconnectFromRoom() {
    // Close all peer connections
    Object.values(peers).forEach(({ peer }) => peer.destroy());
    for (const key in peers) delete peers[key];

    // Notify server
    if (ws && ws.readyState === WebSocket.OPEN && roomId && uid) {
      ws.send(JSON.stringify({ type: 'leave', uid, roomId }));
    }

    logSystemMessage('Disconnected from room manually.');
    setStatus(false);
    roomId = null;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    userList.innerHTML = '';
  }

  // ---------------- Setup ----------------
  uid = Math.random().toString(36).substring(2,10); // lightweight UID

  connectWebSocket();

  hostBtn.addEventListener('click', () => {
    joinRoomAsHost();
    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  joinBtn.addEventListener('click', () => {
    joinRoomAsPeer();
    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  disconnectBtn.addEventListener('click', disconnectFromRoom);

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtn.click(); });

  copyRoomIdBtn.addEventListener('click', () => {
    if (!roomId) return alert('No Room ID to copy.');
    navigator.clipboard.writeText(roomId).then(() => alert(`Copied Room ID: ${roomId}`));
  });

  setStatus(false);
  messageInput.disabled = true;
  sendBtn.disabled = true;

  window.addEventListener('beforeunload', disconnectFromRoom);
});
