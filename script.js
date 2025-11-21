document.addEventListener('DOMContentLoaded', () => {
  const hostBtn = document.getElementById('hostBtn');
  const joinBtn = document.getElementById('connectBtn');
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

  const peers = {};
  const DEFAULT_ROOMS = { 'RoomOne': 'count-room1' };
  let ws = null;

  let uid = Math.random().toString(36).substring(2, 10); // simple uid
  let nickname = null;
  let roomId = null;
  let isPublic = false;

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
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    for (const [id, info] of Object.entries(peersInRoom)) {
      const li = document.createElement('li');
      li.textContent = `${info.nickname || 'No nickname'} (${id})`;
      userList.appendChild(li);
    }
  }

  function createPeerConnection(otherUid, initiator) {
    if (peers[otherUid]) return;

    const newPeer = new SimplePeer({ initiator, trickle: false });
    peers[otherUid] = { peer: newPeer, nickname: null };

    newPeer.on('signal', data => {
      ws.send(JSON.stringify({
        type: 'signal',
        from: uid,
        to: otherUid,
        data
      }));
    });

    newPeer.on('connect', () => {
      setStatus(true);
      messageInput.disabled = false;
      sendBtn.disabled = false;
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
      if (Object.keys(peers).length === 0) setStatus(false);
    });

    newPeer.on('error', err => console.error('Peer error:', err));
  }

  function connectWebSocket() {
    ws = new WebSocket('wss://p2pchat-r8so.onrender.com'); 

    ws.onopen = () => {
      setStatus(true);
      logSystemMessage('Connected to signaling server.');
      // join the room if roomId is already set
      if (roomId) {
        ws.send(JSON.stringify({
          type: 'join',
          uid,
          nickname,
          roomId,
          public: isPublic
        }));
      }
    };

    ws.onmessage = (event) => {
      let msg = null;
      try { msg = JSON.parse(event.data); } catch { return; }

      switch (msg.type) {
        case 'signal':
          if (!peers[msg.from]) createPeerConnection(msg.from, false);
          try { peers[msg.from].peer.signal(msg.data); } catch (e) { console.error('Error signaling:', e); }
          break;

        case 'chat':
          logChatMessage(msg.from, msg.message, false);
          break;

        case 'updateUsers':
          const peersInRoom = {};
          msg.users.forEach(u => {
            peersInRoom[u.uid] = { nickname: u.nickname };
          });
          updateUserList(peersInRoom);

          // connect to any new peers
          msg.users.forEach(u => {
            if (u.uid !== uid && !peers[u.uid]) {
              const initiator = uid < u.uid;
              createPeerConnection(u.uid, initiator);
            }
          });
          break;

        case 'publicRooms':
          publicRoomList.innerHTML = '';
          msg.rooms.forEach(r => {
            if (!DEFAULT_ROOMS[r.id]) {
              const li = document.createElement('li');
              li.textContent = `${r.id}: ${r.count} users`;
              publicRoomList.appendChild(li);
            }
          });
          break;

        default:
          console.warn('Unknown server message type:', msg.type);
      }
    };

    ws.onclose = () => setStatus(false);
    ws.onerror = (err) => console.error('WebSocket error:', err);
  }

  function joinOrHostRoom(isHost) {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    roomId = isHost ? (roomIdInput.value.trim() || Math.random().toString(36).substring(2,10))
                    : connectToRoomInput.value.trim();
    if (!roomId) return alert('Enter a Room ID.');

    isPublic = isHost ? publicToggle.checked : false;

    if (!ws || ws.readyState !== WebSocket.OPEN) connectWebSocket();

    // wait a bit for WS connection
    const joinMsg = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'join',
          uid,
          nickname,
          roomId,
          public: isPublic
        }));
        logSystemMessage(`${isHost ? 'Hosting' : 'Joining'} room: ${roomId} as ${nickname}`);
      } else {
        setTimeout(joinMsg, 100);
      }
    };
    joinMsg();

    messageInput.disabled = false;
    sendBtn.disabled = false;
  }

  hostBtn.addEventListener('click', () => joinOrHostRoom(true));
  joinBtn.addEventListener('click', () => joinOrHostRoom(false));

  sendBtn.addEventListener('click', () => {
    const msg = messageInput.value.trim();
    if (!msg) return;
    logChatMessage('Me', msg, true);
    messageInput.value = '';
    Object.values(peers).forEach(({ peer }) => {
      if (peer.connected) peer.send(msg);
    });
  });

  messageInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendBtn.click();
  });

  copyRoomIdBtn.addEventListener('click', () => {
    if (!roomId) return alert('No Room ID to copy.');
    navigator.clipboard.writeText(roomId).then(() => alert(`Copied Room ID: ${roomId}`));
  });

  setStatus(false);
  messageInput.disabled = true;
  sendBtn.disabled = true;

  // periodically request public room list
  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'listRooms' }));
    }
  }, 3000);

  window.addEventListener('beforeunload', () => {
    // no automatic cleanup needed on WS, server handles disconnect
    Object.values(peers).forEach(({ peer }) => peer.destroy());
  });
});
