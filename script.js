document.addEventListener('DOMContentLoaded', () => {
  const db = firebase.database();

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

  let roomId = null;
  let peerId = null;
  let nickname = null;
  let isPublic = false;

  const peers = {};

  const DEFAULT_ROOMS = {
    'RoomOne': 'count-room1',
  };

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

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

  function sendSignal(toPeerId, signalData) {
    db.ref(`rooms/${roomId}/peers/${toPeerId}/signals/${peerId}`).set(signalData);
  }

  function clearSignal(toPeerId) {
    db.ref(`rooms/${roomId}/peers/${toPeerId}/signals/${peerId}`).remove();
  }

  function listenForSignals() {
    const signalsRef = db.ref(`rooms/${roomId}/peers/${peerId}/signals`);
    signalsRef.on('child_added', (snapshot) => {
      const fromPeerId = snapshot.key;
      const signalData = snapshot.val();

      if (!peers[fromPeerId]) {
        createPeerConnection(fromPeerId, false);
      }

      const peerObj = peers[fromPeerId];
      if (peerObj) {
        try {
          peerObj.peer.signal(signalData);
        } catch (e) {
          console.error('Error signaling peer:', e);
        }
      }

      clearSignal(fromPeerId);
    });
  }

  function createPeerConnection(otherPeerId, initiator) {
    if (peers[otherPeerId]) return;

    const newPeer = new SimplePeer({ initiator, trickle: false });

    peers[otherPeerId] = { peer: newPeer, nickname: null };

    newPeer.on('signal', (data) => sendSignal(otherPeerId, data));

    newPeer.on('connect', () => {
      setStatus(true);
      messageInput.disabled = false;
      sendBtn.disabled = false;
      logSystemMessage(`Connected to peer ${otherPeerId}`);

      newPeer.send(JSON.stringify({ type: 'nickname', nickname }));
    });

    newPeer.on('data', (data) => {
      const text = data.toString();
      let msgObj = null;

      try {
        msgObj = JSON.parse(text);
      } catch (e) {}

      if (msgObj && msgObj.type === 'nickname') {
        peers[otherPeerId].nickname = msgObj.nickname;
        logSystemMessage(`Peer ${otherPeerId} set nickname: ${msgObj.nickname}`);
      } else {
        const senderName = peers[otherPeerId].nickname || otherPeerId;
        logChatMessage(senderName, text, false);
      }
    });

    newPeer.on('close', () => {
      logSystemMessage(`Disconnected from peer ${otherPeerId}`);
      delete peers[otherPeerId];
      if (Object.keys(peers).length === 0) setStatus(false);
    });

    newPeer.on('error', (err) => console.error('Peer error:', err));
  }

  function setupRoomListeners() {
    const peersRef = db.ref(`rooms/${roomId}/peers`);
    peersRef.on('value', (snapshot) => {
      const peersInRoom = snapshot.val() || {};
      const otherPeers = Object.keys(peersInRoom).filter(id => id !== peerId);

      otherPeers.forEach(otherPeerId => {
        if (!peers[otherPeerId]) {
          const initiator = peerId < otherPeerId;
          createPeerConnection(otherPeerId, initiator);
        }
      });

      Object.keys(peers).forEach(id => {
        if (!peersInRoom[id]) {
          peers[id].peer.destroy();
          delete peers[id];
        }
      });

      // Clean up empty public rooms
      if (Object.keys(peersInRoom).length === 0) {
        db.ref(`rooms/${roomId}`).remove();
      }

      setStatus(Object.keys(peers).length > 0);
    });

    listenForSignals();
  }

  function updateRoomList() {
    const roomsRef = db.ref('rooms');
    roomsRef.on('value', (snapshot) => {
      const rooms = snapshot.val() || {};

      // Reset default room counts
      Object.entries(DEFAULT_ROOMS).forEach(([name, id]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = 'Users: 0';
      });

      const publicRooms = [];

      for (const [id, room] of Object.entries(rooms)) {
        const userCount = Object.keys(room.peers || {}).length;

        if (DEFAULT_ROOMS[id]) {
          const el = document.getElementById(DEFAULT_ROOMS[id]);
          if (el) el.textContent = `Users: ${userCount}`;
        } else if (room.public && userCount > 0) {
          publicRooms.push({ id, count: userCount });
        } else if (room.public && userCount === 0) {
          db.ref(`rooms/${id}`).remove(); // Clean up empty public rooms
        }
      }

      publicRoomList.innerHTML = '';
      publicRooms.forEach(({ id, count }) => {
        const li = document.createElement('li');
        li.textContent = `${id}: ${count} users`;
        publicRoomList.appendChild(li);
      });
    });
  }

  hostBtn.addEventListener('click', () => {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    const inputRoomId = roomIdInput.value.trim();
    roomId = inputRoomId || generateId();
    roomIdInput.value = roomId;

    isPublic = publicToggle.checked;

    peerId = generateId();
    const myPeerRef = db.ref(`rooms/${roomId}/peers/${peerId}`);
    myPeerRef.set({ nickname });
    myPeerRef.onDisconnect().remove();

    db.ref(`rooms/${roomId}/public`).set(isPublic);

    logSystemMessage(`Hosting room: ${roomId} (${isPublic ? 'Public' : 'Private'})`);

    setupRoomListeners();
    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  joinBtn.addEventListener('click', () => {
    nickname = nicknameInput.value.trim();
    if (!nickname) return alert('Enter a nickname.');

    roomId = connectToRoomInput.value.trim();
    if (!roomId) return alert('Enter a Room ID to connect.');

    peerId = generateId();
    const myPeerRef = db.ref(`rooms/${roomId}/peers/${peerId}`);
    myPeerRef.set({ nickname });
    myPeerRef.onDisconnect().remove();

    logSystemMessage(`Joining room: ${roomId} as ${nickname}`);

    setupRoomListeners();
    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  sendBtn.addEventListener('click', () => {
    const msg = messageInput.value.trim();
    if (!msg) return;

    logChatMessage('Me', msg, true);
    messageInput.value = '';

    Object.values(peers).forEach(({ peer }) => {
      if (peer.connected) peer.send(msg);
    });
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendBtn.click();
  });

  copyRoomIdBtn.addEventListener('click', () => {
    if (!roomId) return alert('No Room ID to copy.');
    navigator.clipboard.writeText(roomId).then(() => alert(`Copied Room ID: ${roomId}`));
  });

  setStatus(false);
  messageInput.disabled = true;
  sendBtn.disabled = true;

  updateRoomList();
});
