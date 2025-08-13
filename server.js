// ========================================
// TIMED CHAT APP - SERVER FILE
// ========================================

// Import required packages
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// ========================================
// SETUP EXPRESS SERVER AND SOCKET.IO
// ========================================

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);

// Setup Socket.IO with CORS enabled
const io = socketIo(server, {
  cors: {
    origin: "*",        // Allow all origins (for development)
    methods: ["GET", "POST"]
  }
});

// ========================================
// MIDDLEWARE SETUP
// ========================================

app.use(cors());  // Enable CORS for all routes
app.use(express.json({ limit: '50mb' }));  // Allow large JSON (for images)
app.use(express.static(path.join(__dirname, 'public')));  // Serve static files

// ========================================
// DATA STORAGE (IN MEMORY)
// ========================================

// Store all active chat sessions
const activeSessions = new Map();

// Store timers for each session (to auto-expire after 1 hour)
const sessionTimers = new Map();

// ========================================
// HELPER FUNCTIONS
// ========================================

// Generate a random 6-digit PIN
function generatePIN() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Create a new chat session
function createSession(pin) {
  const session = {
    pin: pin,           // The 6-digit PIN
    users: [],          // Array of connected users
    messages: [],       // Array of chat messages
    startTime: null,    // When session started (when 2nd user joins)
    isActive: false     // Whether session is active
  };
  
  activeSessions.set(pin, session);
  return session;
}

// End a session after 1 hour
function endSession(pin) {
  const session = activeSessions.get(pin);
  if (session) {
    session.isActive = false;
    
    // Notify all users that session expired
    io.to(pin).emit('sessionExpired');
    
    // Clean up
    activeSessions.delete(pin);
    sessionTimers.delete(pin);
  }
}

// ========================================
// SOCKET.IO CONNECTION HANDLING
// ========================================

io.on('connection', (socket) => {
  console.log('New user connected:', socket.id);

  // ========================================
  // JOIN SESSION WITH PIN
  // ========================================
  socket.on('joinSession', (pin) => {
    let session = activeSessions.get(pin);
    
    // Create session if it doesn't exist
    if (!session) {
      session = createSession(pin);
    }

    // Check if session is full (max 2 users)
    if (session.users.length >= 2) {
      socket.emit('error', 'Session is full');
      return;
    }

    // Add user to session
    session.users.push({
      id: socket.id,
      name: `User ${session.users.length + 1}`
    });

    // Join the Socket.IO room for this session
    socket.join(pin);
    socket.sessionPin = pin;  // Remember which session this socket belongs to

    // If this is the second user, start the 1-hour timer
    if (session.users.length === 2) {
      session.isActive = true;
      session.startTime = Date.now();
      
      // Set timer for 1 hour (60 minutes = 60 * 60 * 1000 milliseconds)
      const timer = setTimeout(() => endSession(pin), 60 * 60 * 1000);
      sessionTimers.set(pin, timer);
      
      // Notify both users that session is now active
      io.to(pin).emit('sessionStarted', {
        startTime: session.startTime,
        duration: 60 * 60 * 1000
      });
    }

    // Send session info to the user
    socket.emit('sessionJoined', {
      pin: pin,
      userCount: session.users.length,
      isActive: session.isActive,
      startTime: session.startTime
    });

    // Send existing messages if any
    if (session.messages.length > 0) {
      socket.emit('loadMessages', session.messages);
    }

    console.log(`User ${socket.id} joined session ${pin}`);
  });

  // ========================================
  // HANDLE TEXT MESSAGES
  // ========================================
  socket.on('sendMessage', (data) => {
    const session = activeSessions.get(socket.sessionPin);
    
    // Only allow messages if session exists and is active
    if (session && session.isActive) {
      const message = {
        id: Date.now(),
        type: 'text',
        content: data.content,
        sender: socket.id,
        timestamp: Date.now()
      };
      
      // Save message and send to all users in session
      session.messages.push(message);
      io.to(socket.sessionPin).emit('newMessage', message);
    }
  });

  // ========================================
  // HANDLE IMAGE MESSAGES
  // ========================================
  socket.on('sendImage', (data) => {
    const session = activeSessions.get(socket.sessionPin);
    
    // Only allow images if session exists and is active
    if (session && session.isActive) {
      const message = {
        id: Date.now(),
        type: 'image',
        content: data.imageData,  // Base64 encoded image
        sender: socket.id,
        timestamp: Date.now()
      };
      
      // Save message and send to all users in session
      session.messages.push(message);
      io.to(socket.sessionPin).emit('newMessage', message);
    }
  });

  // ========================================
  // HANDLE USER DISCONNECTION
  // ========================================
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    if (socket.sessionPin) {
      const session = activeSessions.get(socket.sessionPin);
      if (session) {
        // Remove user from session
        session.users = session.users.filter(user => user.id !== socket.id);
        
        // If no users left, clean up the session
        if (session.users.length === 0) {
          activeSessions.delete(socket.sessionPin);
          
          // Clear the timer if it exists
          const timer = sessionTimers.get(socket.sessionPin);
          if (timer) {
            clearTimeout(timer);
            sessionTimers.delete(socket.sessionPin);
          }
        }
      }
    }
  });

  // ========================================
  // HANDLE EXPLICIT LEAVE (user clicks Leave button)
  // ========================================
  socket.on('leaveSession', () => {
    if (!socket.sessionPin) return;
    const pin = socket.sessionPin;
    const session = activeSessions.get(pin);
    if (!session) return;

    // Remove user from session
    session.users = session.users.filter((user) => user.id !== socket.id);

    // Leave room
    socket.leave(pin);
    socket.sessionPin = null;

    // If no users left, clean up the session and timer
    if (session.users.length === 0) {
      activeSessions.delete(pin);
      const timer = sessionTimers.get(pin);
      if (timer) {
        clearTimeout(timer);
        sessionTimers.delete(pin);
      }
    }

    // Notify remaining user about participant leaving
    io.to(pin).emit('participantLeft');
  });
});

// ========================================
// API ENDPOINTS
// ========================================

// Generate a new PIN for a session
app.post('/api/generate-pin', (req, res) => {
  let pin;
  
  // Generate unique PIN (make sure it doesn't already exist)
  do {
    pin = generatePIN();
  } while (activeSessions.has(pin));
  
  // Create the session and return the PIN
  createSession(pin);
  res.json({ pin: pin });
});

// Check if a PIN exists and get session info
app.get('/api/check-pin/:pin', (req, res) => {
  const pin = req.params.pin;
  const session = activeSessions.get(pin);
  
  if (session) {
    res.json({ 
      exists: true, 
      userCount: session.users.length,
      isActive: session.isActive 
    });
  } else {
    res.json({ exists: false });
  }
});

// ========================================
// START THE SERVER
// ========================================

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Open http://localhost:${PORT} in your browser`);
  console.log(`📱 Chat app ready for connections!`);
});
