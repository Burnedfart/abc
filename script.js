document.addEventListener('DOMContentLoaded', () => {
  const hostBtn = document.getElementById('hostBtn');
  const joinBtn = document.getElementById('connectBtn');
  const disconnectBtn = document.getElementById('disconnectBtn'); 
  const nicknameInput = document.getElementById('nicknameInput');
  const roomIdInput = document.getElementById('roomId');
  const connectToRoomInput = document.getElementById('connectToRoom');
  const messageInput = document.getElementById('messageInput');
  const sendBtn = document.getElementById('sendBtn');
  const connectionStatus = document.getElementById('connection-status');
  const chat = document.getElementById('chat');
  const publicToggle = document.getElementById('publicRoomToggle');
  const publicRoomList = document.getElementById('publicRoomList');
  const userList = document.getElementById('userList');

  const WS_ENDPOINT = "wss://p2pchat-r8so.onrender.com";
  let ws;
  let roomId = null;
  let uid = Math.random().toString(36).substring(2, 10);
  let nickname = null;
  let isPublic = false;
  const peers = {};
  const messageQueue = {}; // queue messages until peer connects

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
    peersInRoom.forEach(p => {
      const li = document.createElement('li');
      li.textContent = `${p.nickname || 'No nickname'} (${p.uid})`;
      userList.appendChild(li);
    });
  }

  function connectWebSocket() {
    ws = new WebSocket(WS_ENDPOINT);

    ws.onopen = () => {
      setStatus(true);
      logSystemMessage('Connected to signaling server.');
      if (roomId) joinRoomSendWS();
    };

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
          msg.peers.forEach(p => {
            if (p.uid !== uid && !peers[p.uid]) {
              const initiator = uid < p.uid;
              createPeerConnection(p.uid, initiator);
            }
          });
          break;

        case 'signal':
          const { from, signal } = msg;
          if (!peers[from]) createPeerConnection(from, uid < from);
          try { peers[from].peer.signal(signal); } catch (e) { console.error('Signal error', e); }
          break;
      }
    };

    ws.onclose = () => setStatus(false);
    ws.onerror = (err) => console.error('WebSocket error:', err);
  }

  function sendSignal(toUid, data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'signal', to: toUid, signal: data }));
    }
  }

  function createPeerConnection(otherUid, initiator) {
    if (peers[otherUid]) return;

    const peer = new SimplePeer({ initiator, trickle: false });
    peers[otherUid] = { peer, nickname: null, connected: false };

    messageQueue[otherUid] = [];

    peer.on('signal', data => sendSignal(otherUid, data));

    peer.on('connect', () => {
      peers[otherUid].connected = true;
      logSystemMessage(`Connected to peer ${otherUid}`);
      peer.send(JSON.stringify({ type: 'nickname', nickname }));

      // flush queued messages
      messageQueue[otherUid].forEach(msg => peer.send(msg));
      messageQueue[otherUid] = [];
    });

    peer.on('data', data => {
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

    peer.on('close', () => {
      const peerNickname = peers[otherUid]?.nickname || 'Unknown';
      logSystemMessage(`Disconnected from peer ${otherUid} (${peerNickname})`);
      delete peers[otherUid];
    });

    peer.on('error', err => console.error('Peer error:', err));
  }

  function joinRoomSendWS() {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setTimeout(joinRoomSendWS, 100);
      return;
    }
    ws.send(JSON.stringify({ type: 'join', uid, nickname, roomId, isPublic }));
  }

  function joinRoomAsHost() {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    roomId = roomIdInput.value.trim() || Math.random().toString(36).substring(2,10);
    roomIdInput.value = roomId;
    isPublic = publicToggle.checked;

    joinRoomSendWS();
    logSystemMessage(`Hosting room: ${roomId} (${isPublic ? 'Public' : 'Private'})`);
    messageInput.disabled = false;
    sendBtn.disabled = false;
  }

  function joinRoomAsPeer() {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    roomId = connectToRoomInput.value.trim();
    if (!roomId) return alert('Enter a Room ID.');
    isPublic = false;

    joinRoomSendWS();
    logSystemMessage(`Joining room: ${roomId} as ${nickname}`);
    messageInput.disabled = false;
    sendBtn.disabled = false;
  }

  function sendMessage() {
    const msg = messageInput.value.trim();
    if (!msg) return;
    logChatMessage('Me', msg, true);
    messageInput.value = '';

    Object.entries(peers).forEach(([peerUid, { peer, connected }]) => {
      if (connected) peer.send(msg);
      else messageQueue[peerUid].push(msg);
    });
  }

  function disconnectFromRoom() {
    Object.values(peers).forEach(({ peer }) => peer.destroy());
    for (const k in peers) delete peers[k];

    if (ws && ws.readyState === WebSocket.OPEN && roomId) {
      ws.send(JSON.stringify({ type: 'leave', uid, roomId }));
    }

    logSystemMessage('Disconnected from room manually.');
    setStatus(false);
    roomId = null;
    messageInput.disabled = true;
    sendBtn.disabled = true;
    userList.innerHTML = '';
  }

  connectWebSocket();

  hostBtn.addEventListener('click', joinRoomAsHost);
  joinBtn.addEventListener('click', joinRoomAsPeer);
  disconnectBtn.addEventListener('click', disconnectFromRoom);

  sendBtn.addEventListener('click', sendMessage);
  messageInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendBtn.click(); });

  setStatus(false);
  messageInput.disabled = true;
  sendBtn.disabled = true;

  // periodically request public room list
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'listRooms' }));
  }, 3000);

  window.addEventListener('beforeunload', disconnectFromRoom);
});
