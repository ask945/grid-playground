const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 8080;
const GRID_SIZE = 400; // 20x20 = 400 cells
const GRID_COLS = 20;

// State management
const state = {
  grid: [],
  users: new Map(), // userId -> { color, connectedAt, ws }
  usedColors: new Set() // Track colors to prevent duplicates
};

// Initialize grid
function initializeGrid() {
  state.grid = Array.from({ length: GRID_SIZE }, (_, i) => ({
    id: i,
    ownerId: null,
    color: null,
    updatedAt: null
  }));
  console.log(`✅ Grid initialized with ${GRID_SIZE} cells`);
}

// Generate unique, visually appealing colors using HSL
// This ensures unlimited colors with good contrast and vibrancy
function generateNiceColor() {
  let color;
  let attempts = 0;
  const maxAttempts = 50;
  
  // Try to generate a unique color
  do {
    const hue = Math.floor(Math.random() * 360); // 0-360 degrees
    const saturation = 65 + Math.floor(Math.random() * 25); // 65-90% (vibrant)
    const lightness = 45 + Math.floor(Math.random() * 20); // 45-65% (not too dark/light)
    color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    attempts++;
  } while (state.usedColors.has(color) && attempts < maxAttempts);
  
  return color;
}

// Get random color for new user
function getRandomColor() {
  const color = generateNiceColor();
  state.usedColors.add(color);
  return color;
}

// Generate unique user ID
function generateUserId() {
  return `u_${uuidv4().substring(0, 8)}`;
}

// Broadcast to all connected clients
function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  
  state.users.forEach((user) => {
    if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  });
}

// Send message to specific client
function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

// Get connected users count
function getConnectedUsersCount() {
  return state.users.size;
}

// Handle cell claim
function handleClaimCell(userId, cellId, ws) {
  // Validate cellId
  if (cellId < 0 || cellId >= GRID_SIZE) {
    sendToClient(ws, {
      type: 'error',
      message: 'Invalid cell ID'
    });
    return;
  }

  const cell = state.grid[cellId];
  const user = state.users.get(userId);

  if (!user) {
    sendToClient(ws, {
      type: 'error',
      message: 'User not found'
    });
    return;
  }

  // Check if cell is already owned by this user
  if (cell.ownerId === userId) {
    return; // Already owned, do nothing
  }

  // IMPROVED: Reject if cell is already claimed by someone else
  // This prevents race conditions and makes ownership clear
  if (cell.ownerId !== null && cell.ownerId !== userId) {
    sendToClient(ws, {
      type: 'claim_rejected',
      cellId: cellId,
      reason: 'already_claimed',
      message: 'Cell already claimed by another user'
    });
    console.log(`❌ Cell ${cellId} claim rejected for ${userId} (owned by ${cell.ownerId})`);
    return;
  }

  // Update cell ownership
  cell.ownerId = userId;
  cell.color = user.color;
  cell.updatedAt = Date.now();

  // Broadcast update to all clients
  broadcast({
    type: 'cell_updated',
    cellId: cell.id,
    ownerId: cell.ownerId,
    color: cell.color,
    updatedAt: cell.updatedAt
  });

  console.log(`📍 Cell ${cellId} claimed by ${userId}`);
}

// Handle user disconnection
function handleDisconnect(userId) {
  const user = state.users.get(userId);
  
  if (user) {
    state.usedColors.delete(user.color);
    state.users.delete(userId);
    
    console.log(`👋 User ${userId} disconnected`);
    
    // Broadcast updated user count
    broadcast({
      type: 'users_count',
      count: getConnectedUsersCount()
    });
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  const userId = generateUserId();
  const userColor = getRandomColor();
  
  // Store user
  state.users.set(userId, {
    color: userColor,
    connectedAt: Date.now(),
    ws: ws
  });

  console.log(`🔗 New connection: ${userId} (${getConnectedUsersCount()} total)`);

  // Send initial state to the new user
  sendToClient(ws, {
    type: 'init_state',
    you: {
      userId: userId,
      color: userColor
    },
    grid: state.grid,
    connectedUsers: getConnectedUsersCount()
  });

  // Broadcast updated user count to all others
  broadcast({
    type: 'users_count',
    count: getConnectedUsersCount()
  }, ws);

  // Handle incoming messages
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'join':
          // Join is implicit on connection, but we can log it
          console.log(`✋ User ${userId} joined`);
          break;

        case 'claim_cell':
          handleClaimCell(userId, data.cellId, ws);
          break;

        default:
          console.log(`⚠️  Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
      sendToClient(ws, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  });

  // Handle disconnection
  ws.on('close', () => {
    handleDisconnect(userId);
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error(`❌ WebSocket error for ${userId}:`, error);
  });
});

// REST API endpoints (optional, for debugging/monitoring)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    connectedUsers: getConnectedUsersCount(),
    gridSize: GRID_SIZE,
    uptime: process.uptime()
  });
});

app.get('/api/stats', (req, res) => {
  const claimedCells = state.grid.filter(cell => cell.ownerId !== null).length;
  const unclaimedCells = GRID_SIZE - claimedCells;
  
  res.json({
    totalCells: GRID_SIZE,
    claimedCells,
    unclaimedCells,
    connectedUsers: getConnectedUsersCount(),
    users: Array.from(state.users.keys())
  });
});

app.get('/api/grid', (req, res) => {
  res.json({
    grid: state.grid,
    gridSize: GRID_SIZE,
    gridCols: GRID_COLS
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Pixel Board WebSocket Server',
    version: '2.0.0',
    features: {
      colorSystem: 'HSL (unlimited unique colors)',
      conflictResolution: 'First-come-first-served',
      gridSize: `${GRID_COLS}x${GRID_COLS}`,
      totalCells: GRID_SIZE
    },
    endpoints: {
      websocket: 'ws://localhost:' + PORT,
      health: '/api/health',
      stats: '/api/stats',
      grid: '/api/grid'
    }
  });
});

// Initialize and start server
initializeGrid();

server.listen(PORT, () => {
  console.log(`🌐 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`📊 Grid Size: ${GRID_COLS}x${GRID_COLS} (${GRID_SIZE} cells)`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n📴 SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});