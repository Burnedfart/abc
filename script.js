document.addEventListener('DOMContentLoaded', () => {
  const db = firebase.database();
  const auth = firebase.auth();

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
  let uid = null;
  let nickname = null;
  let isPublic = false;

  const peers = {};
  const DEFAULT_ROOMS = { 'RoomOne': 'count-room1' };

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

  function updateUserList(peersInRoom) {
    const userList = document.getElementById('userList');
    userList.innerHTML = '';
    for (const [id, info] of Object.entries(peersInRoom)) {
      const li = document.createElement('li');
      li.textContent = `${info.nickname || 'No nickname'} (${id})`;
      userList.appendChild(li);
    }
  }

  function logChatMessage(sender, msg, isLocal) {
    const div = document.createElement('div');
    div.textContent = `${sender}: ${msg}`;
    div.className = isLocal ? 'your-msg' : 'peer-msg';
    chat.appendChild(div);
    chat.scrollTop = chat.scrollHeight;
  }

  function sendSignal(toUid, signalData) {
    db.ref(`rooms/${roomId}/peers/${toUid}/signals/${uid}`).set(signalData);
  }

  function clearSignal(toUid) {
    db.ref(`rooms/${roomId}/peers/${toUid}/signals/${uid}`).remove();
  }

  function listenForSignals() {
    const signalsRef = db.ref(`rooms/${roomId}/peers/${uid}/signals`);
    signalsRef.on('child_added', snapshot => {
      const fromUid = snapshot.key;
      const signalData = snapshot.val();

      if (!peers[fromUid]) createPeerConnection(fromUid, false);

      try { peers[fromUid].peer.signal(signalData); } 
      catch (e) { console.error('Error signaling peer:', e); }

      clearSignal(fromUid);
    });
  }

  function createPeerConnection(otherUid, initiator) {
    if (peers[otherUid]) return;

    const newPeer = new SimplePeer({ initiator, trickle: false });
    peers[otherUid] = { peer: newPeer, nickname: null };

    newPeer.on('signal', data => sendSignal(otherUid, data));

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

  function setupRoomListeners() {
    const peersRef = db.ref(`rooms/${roomId}/peers`);
    peersRef.on('value', snapshot => {
      const peersInRoom = snapshot.val() || {};
      const otherPeers = Object.keys(peersInRoom).filter(id => id !== uid);

      otherPeers.forEach(otherUid => {
        if (!peers[otherUid]) {
          const initiator = uid < otherUid;
          createPeerConnection(otherUid, initiator);
        }
      });

      Object.keys(peers).forEach(id => {
        if (!peersInRoom[id]) {
          peers[id].peer.destroy();
          delete peers[id];
        }
      });

      if (Object.keys(peersInRoom).length === 0) db.ref(`rooms/${roomId}`).remove();
      setStatus(Object.keys(peers).length > 0);
      updateUserList(peersInRoom);
    });

    listenForSignals();
  }

  function updateRoomList() {
    const roomsRef = db.ref('rooms');
    roomsRef.on('value', snapshot => {
      const rooms = snapshot.val() || {};
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
        } else if (room.public && userCount > 0) publicRooms.push({ id, count: userCount });
        else if (room.public && userCount === 0) db.ref(`rooms/${id}`).remove();
      }

      publicRoomList.innerHTML = '';
      publicRooms.forEach(({ id, count }) => {
        const li = document.createElement('li');
        li.textContent = `${id}: ${count} users`;
        publicRoomList.appendChild(li);
      });
    });
  }

  // ---- Anonymous authentication before allowing chat ----
  auth.signInAnonymously().then(() => {
    uid = auth.currentUser.uid;
    console.log("Signed in anonymously. UID:", uid);

    hostBtn.addEventListener('click', () => {
      nickname = nicknameInput.value.trim();
      if (!nickname) return alert('Enter a nickname.');

      const inputRoomId = roomIdInput.value.trim();
      roomId = inputRoomId || Math.random().toString(36).substring(2,10);
      roomIdInput.value = roomId;

      isPublic = publicToggle.checked;

      const myPeerRef = db.ref(`rooms/${roomId}/peers/${uid}`);
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

      const myPeerRef = db.ref(`rooms/${roomId}/peers/${uid}`);
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

    updateRoomList();
  }).catch(err => {
    console.error("Anonymous auth failed:", err);
    alert("Could not sign in. Please refresh.");
  });

  window.addEventListener('beforeunload', () => {
    if (roomId && uid) db.ref(`rooms/${roomId}/peers/${uid}`).remove();
  });
});
