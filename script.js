window.addEventListener('DOMContentLoaded', () => {
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
  const blockedWordsb64 = ['bmlnZ2Vy', 'bmlnZ2E=', 'Y29vbg==', 'ZmFnZ290', 'ZmFn'];
  const blockedWords = blockedWordsb64.map(b64 => atob(b64));

  let roomId = null;
  let peerId = null;
  let nickname = null;

  const peers = {}; // key: peerId, value: { peer: SimplePeer, nickname: string }

  function generateId() {
    return Math.random().toString(36).substring(2, 10);
  }

  function setStatus(connected) {
    if (connected) {
      connectionStatus.textContent = '🟢 Connected';
      connectionStatus.classList.remove('disconnected');
      connectionStatus.classList.add('connected');
    } else {
      connectionStatus.textContent = '🔴 Disconnected';
      connectionStatus.classList.remove('connected');
      connectionStatus.classList.add('disconnected');
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

  function sendSignal(toPeerId, signalData) {
    const signalRef = db.ref(`rooms/${roomId}/peers/${toPeerId}/signals/${peerId}`);
    signalRef.set(signalData);
  }

  function clearSignal(toPeerId) {
    const signalRef = db.ref(`rooms/${roomId}/peers/${toPeerId}/signals/${peerId}`);
    signalRef.remove();
  }

  function listenForSignals() {
    const signalsRef = db.ref(`rooms/${roomId}/peers/${peerId}/signals`);
    signalsRef.on('child_added', async (snapshot) => {
      const fromPeerId = snapshot.key;
      const signalData = snapshot.val();

      if (!peers[fromPeerId]) {
        createPeerConnection(fromPeerId, false);
      }

      const peerObj = peers[fromPeerId];
      if (peerObj && peerObj.peer) {
        try {
          peerObj.peer.signal(signalData);
        } catch (e) {
          console.error('Error signaling peer:', e);
        }
      }

      clearSignal(fromPeerId);
    });
  }

  function containsBlockedWord(text) {
    const lowerText = text.toLowerCase();
    return blockedWords.some(word => lowerText.includes(word));
  }

  function createPeerConnection(otherPeerId, initiator) {
    if (peers[otherPeerId]) {
      console.log(`Already connected to peer ${otherPeerId}`);
      return;
    }

    const newPeer = new SimplePeer({ initiator, trickle: false });

    peers[otherPeerId] = {
      peer: newPeer,
      nickname: null
    };

    newPeer.on('signal', (data) => {
      sendSignal(otherPeerId, data);
    });

    newPeer.on('connect', () => {
      console.log(`Connected to peer ${otherPeerId}`);
      setStatus(true);
      messageInput.disabled = false;
      sendBtn.disabled = false;
      logSystemMessage(`Connected to peer ${otherPeerId}${peers[otherPeerId].nickname ? ' (' + peers[otherPeerId].nickname + ')' : ''}`);

      // Send our nickname immediately
      newPeer.send(JSON.stringify({ type: 'nickname', nickname }));
    });

    newPeer.on('data', (data) => {
      const text = data.toString();
      let msgObj = null;

      try {
        msgObj = JSON.parse(text);
      } catch (e) {
        msgObj = null;
      }

      if (msgObj && msgObj.type === 'nickname') {
        peers[otherPeerId].nickname = msgObj.nickname;
        logSystemMessage(`Peer ${otherPeerId} set nickname: ${msgObj.nickname}`);
      } else {
        const senderName = peers[otherPeerId].nickname || otherPeerId;
        logChatMessage(senderName, text, false);
      }
    });

    newPeer.on('close', () => {
      console.log(`Connection to peer ${otherPeerId} closed`);
      logSystemMessage(`Disconnected from peer ${otherPeerId}${peers[otherPeerId].nickname ? ' (' + peers[otherPeerId].nickname + ')' : ''}`);
      delete peers[otherPeerId];

      if (Object.keys(peers).length === 0) {
        setStatus(false);
        messageInput.disabled = true;
        sendBtn.disabled = true;
      }
    });

    newPeer.on('error', (err) => {
      console.error('Peer error:', err);
    });
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

      Object.keys(peers).forEach(connectedPeerId => {
        if (!peersInRoom[connectedPeerId]) {
          peers[connectedPeerId].peer.destroy();
          delete peers[connectedPeerId];
        }
      });

      setStatus(Object.keys(peers).length > 0);
    });

    listenForSignals();
  }

  hostBtn.addEventListener('click', () => {
    nickname = nicknameInput.value.trim();
    if (!nickname) {
      alert('Please enter your nickname before hosting a room.');
      return;
    }

    const inputRoomId = roomIdInput.value.trim();
    roomId = inputRoomId || generateId();

    roomIdInput.value = roomId;
    logSystemMessage(`You began hosting room: ${roomId}`);

    peerId = generateId();

    const myPeerRef = db.ref(`rooms/${roomId}/peers/${peerId}`);
    myPeerRef.set({ nickname });
    myPeerRef.onDisconnect().remove();

    setupRoomListeners();

    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  joinBtn.addEventListener('click', () => {
    nickname = nicknameInput.value.trim();
    if (!nickname) {
      alert('Please enter your nickname before connecting to a room.');
      return;
    }

    roomId = connectToRoomInput.value.trim();
    if (!roomId) {
      alert('Please enter a Room ID to connect to.');
      return;
    }

    peerId = generateId();

    logSystemMessage(`Joining room: ${roomId} as ${nickname} (${peerId})`);

    const myPeerRef = db.ref(`rooms/${roomId}/peers/${peerId}`);
    myPeerRef.set({ nickname });
    myPeerRef.onDisconnect().remove();

    setupRoomListeners();

    messageInput.disabled = false;
    sendBtn.disabled = false;
  });

  sendBtn.addEventListener('click', () => {
    const msg = messageInput.value.trim();
    if (!msg) return;

    if (containsBlockedWord(msg)) {
      return;
    }

    logChatMessage('Me', msg, true);
    messageInput.value = '';

    Object.entries(peers).forEach(([id, { peer }]) => {
      if (peer.connected) {
        peer.send(msg);
      } else {
        console.warn(`Peer ${id} not connected yet`);
      }
    });

  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendBtn.click();
    }
  });

  document.getElementById('copyRoomId').addEventListener('click', () => {
    if (!roomId) {
      alert('No room ID to copy.');
      return;
    }
    navigator.clipboard.writeText(roomId)
      .then(() => alert(`Copied Room ID: ${roomId}`))
      .catch(() => alert('Failed to copy Room ID.'));
  });

  messageInput.disabled = true;
  sendBtn.disabled = true;
  setStatus(false);
});
