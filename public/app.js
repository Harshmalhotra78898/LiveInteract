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
    timerLabel.innerHTML = `<i class="fas fa-clock"></i> ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
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
  // Remove welcome message if it exists
  const welcomeMsg = messagesEl.querySelector('.welcome-message');
  if (welcomeMsg) {
    welcomeMsg.remove();
  }

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
  }, 2000);
}

// Button actions
btnCreate.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/generate-pin', { method: 'POST' });
    const data = await res.json();
    currentPin = data.pin;
    roomLabel.innerHTML = `<i class="fas fa-key"></i> Room: ${currentPin}`;
    socket.emit('joinSession', currentPin);
    showScreen('chat');
    showToast('Session created and joined');
  } catch (error) {
    showToast('Failed to create session');
  }
});

btnJoin.addEventListener('click', async () => {
  const pin = pinInput.value.trim();
  if (pin.length !== 6) { 
    showToast('Please enter a 6-digit PIN'); 
    return; 
  }
  
  try {
    const res = await fetch(`/api/check-pin/${pin}`);
    const info = await res.json();
    if (!info.exists) { 
      showToast('PIN not found. Ask your friend to create a session.'); 
      return; 
    }
    currentPin = pin;
    socket.emit('joinSession', currentPin);
    showToast('Joining session...');
  } catch (error) {
    showToast('Failed to join session');
  }
});

btnLeave.addEventListener('click', () => {
  socket.emit('leaveSession');
  currentPin = null;
  messagesEl.innerHTML = `
    <div class="welcome-message">
      <i class="fas fa-comment-dots"></i>
      <p>Your chat session will begin when the second person joins...</p>
    </div>
  `;
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

// Enter key to send message
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    btnSend.click();
  }
});

// Socket events
socket.on('connect', () => {
  // If we already picked a PIN, rejoin after reconnect
  if (currentPin) socket.emit('joinSession', currentPin);
});

socket.on('sessionJoined', (info) => {
  roomLabel.innerHTML = `<i class="fas fa-key"></i> Room: ${currentPin}`;
  showScreen('chat');
  if (info.isActive && info.startTime) {
    startCountdown(info.startTime, 60 * 60 * 1000);
  }
});

socket.on('loadMessages', (msgs) => {
  messagesEl.innerHTML = '';
  if (msgs.length === 0) {
    messagesEl.innerHTML = `
      <div class="welcome-message">
        <i class="fas fa-comment-dots"></i>
        <p>Your chat session will begin when the second person joins...</p>
      </div>
    `;
  } else {
    msgs.forEach(appendMessage);
  }
});

socket.on('newMessage', appendMessage);

socket.on('sessionStarted', ({ startTime, duration }) => {
  startCountdown(startTime, duration);
  showToast('Session started! Timer is running.');
});

socket.on('sessionExpired', () => {
  appendMessage({ type: 'text', content: 'Session expired', sender: 'system', timestamp: Date.now() });
  disableChat();
  showToast('Session expired');
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
    showToast('PIN copied to clipboard!');
  } catch (_) {
    showToast('Copy failed - try manually');
  }
});


