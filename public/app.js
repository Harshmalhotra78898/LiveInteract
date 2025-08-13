// Frontend logic for Timed Chat App
const socket = io();

// Elements
const screens = {
  welcome: document.getElementById('screen-welcome'),
  chat: document.getElementById('screen-chat'),
};

const btnCreate = document.getElementById('btn-create');
const btnJoin = document.getElementById('btn-join');
const btnLeave = document.getElementById('btn-leave');
const pinInput = document.getElementById('pin-input');
const roomLabel = document.getElementById('room-label');
const timerLabel = document.getElementById('timer');
const messagesEl = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const imageInput = document.getElementById('image-input');
const btnSend = document.getElementById('btn-send');
const toastEl = document.getElementById('toast');

let currentPin = null;
let countdownInterval = null;

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function startCountdown(startTime, duration) {
  const end = startTime + duration;
  function tick() {
    const remaining = Math.max(0, end - Date.now());
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    timerLabel.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (remaining === 0) {
      clearInterval(countdownInterval);
      disableChat();
    }
  }
  clearInterval(countdownInterval);
  countdownInterval = setInterval(tick, 1000);
  tick();
}

function appendMessage(message) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${message.sender === socket.id ? 'me' : ''}`;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = new Date(message.timestamp).toLocaleTimeString();
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (message.type === 'image') {
    const img = document.createElement('img');
    img.src = message.content;
    bubble.appendChild(img);
  } else {
    bubble.textContent = message.content;
  }
  wrapper.appendChild(meta);
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function disableChat() {
  messageInput.disabled = true;
  imageInput.disabled = true;
  btnSend.disabled = true;
}

function showToast(text) {
  if (!toastEl) return;
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  toastEl.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove('show');
    toastEl.classList.add('hidden');
  }, 1500);
}

// Button actions
btnCreate.addEventListener('click', async () => {
  const res = await fetch('/api/generate-pin', { method: 'POST' });
  const data = await res.json();
  currentPin = data.pin;
  roomLabel.textContent = `Room: ${currentPin}`;
  socket.emit('joinSession', currentPin);
  showScreen('chat');
  showToast('Session created and joined');
});

btnJoin.addEventListener('click', async () => {
  const pin = pinInput.value.trim();
  if (pin.length !== 6) { alert('Please enter a 6-digit PIN'); return; }
  const res = await fetch(`/api/check-pin/${pin}`);
  const info = await res.json();
  if (!info.exists) { alert('PIN not found. Ask your friend to create a session.'); return; }
  currentPin = pin;
  socket.emit('joinSession', currentPin);
  showToast('Joined session');
});

btnLeave.addEventListener('click', () => {
  socket.emit('leaveSession');
  currentPin = null;
  messagesEl.innerHTML = '';
  messageInput.disabled = false;
  imageInput.disabled = false;
  btnSend.disabled = false;
  showScreen('welcome');
  showToast('You left the session');
});

btnSend.addEventListener('click', async () => {
  const text = messageInput.value.trim();
  if (text) {
    socket.emit('sendMessage', { content: text });
    messageInput.value = '';
  }
  if (imageInput.files && imageInput.files[0]) {
    const file = imageInput.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('sendImage', { imageData: reader.result });
      imageInput.value = '';
    };
    reader.readAsDataURL(file);
  }
});

// Socket events
socket.on('connect', () => {
  // If we already picked a PIN, rejoin after reconnect
  if (currentPin) socket.emit('joinSession', currentPin);
});

socket.on('sessionJoined', (info) => {
  roomLabel.textContent = `Room: ${currentPin}`;
  showScreen('chat');
  if (info.isActive && info.startTime) {
    startCountdown(info.startTime, 60 * 60 * 1000);
  }
});

socket.on('loadMessages', (msgs) => {
  messagesEl.innerHTML = '';
  msgs.forEach(appendMessage);
});

socket.on('newMessage', appendMessage);

socket.on('sessionStarted', ({ startTime, duration }) => {
  startCountdown(startTime, duration);
});

socket.on('sessionExpired', () => {
  appendMessage({ type: 'text', content: 'Session expired', sender: 'system', timestamp: Date.now() });
  disableChat();
});

socket.on('participantLeft', () => {
  appendMessage({ type: 'text', content: 'Other participant left the session.', sender: 'system', timestamp: Date.now() });
  showToast('Other participant left');
});

// Initial screen
showScreen('welcome');

// Copy PIN on room label click
roomLabel.addEventListener('click', async () => {
  if (!currentPin) return;
  try {
    await navigator.clipboard.writeText(currentPin);
    showToast('PIN copied');
  } catch (_) {
    showToast('Copy failed');
  }
});


