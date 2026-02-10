const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const GRID_SIZE = 400;
const GRID_COLS = 20;
const HEARTBEAT_INTERVAL = 30000;
const CONNECTION_TIMEOUT = 35000;

const state = {
  grid: [],
  users: new Map(),
  usedColors: new Set()
};

function initializeGrid() {
  state.grid = Array.from({ length: GRID_SIZE }, (_, i) => ({
    id: i,
    ownerId: null,
    color: null,
    updatedAt: null
  }));
  console.log(`✅ Grid initialized with ${GRID_SIZE} cells`);
}

function generateNiceColor() {
  let color;
  let attempts = 0;
  const maxAttempts = 50;
  
  do {
    const hue = Math.floor(Math.random() * 360);
    const saturation = 65 + Math.floor(Math.random() * 25);
    const lightness = 45 + Math.floor(Math.random() * 20);
    color = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
    attempts++;
  } while (state.usedColors.has(color) && attempts < maxAttempts);
  
  return color;
}

function getRandomColor() {
  const color = generateNiceColor();
  state.usedColors.add(color);
  return color;
}

function generateUserId() {
  return `u_${uuidv4().substring(0, 8)}`;
}

function broadcast(message, excludeWs = null) {
  const data = JSON.stringify(message);
  
  state.users.forEach((user) => {
    if (user.ws !== excludeWs && user.ws.readyState === WebSocket.OPEN) {
      user.ws.send(data);
    }
  });
}

function sendToClient(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getConnectedUsersCount() {
  let count = 0;
  state.users.forEach((user) => {
    if (user.ws.readyState === WebSocket.OPEN) {
      count++;
    }
  });
  return count;
}

function handleClaimCell(userId, cellId, ws) {
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

  if (cell.ownerId === userId) {
    return;
  }

  if (cell.ownerId !== null && cell.ownerId !== userId) {
    sendToClient(ws, {
      type: 'claim_rejected',
      cellId: cellId,
      reason: 'already_claimed',
      message: 'Cell already claimed by another user'
    });
    console.log(`Cell ${cellId} claim rejected for ${userId} (owned by ${cell.ownerId})`);
    return;
  }

  cell.ownerId = userId;
  cell.color = user.color;
  cell.updatedAt = Date.now();

  broadcast({
    type: 'cell_updated',
    cellId: cell.id,
    ownerId: cell.ownerId,
    color: cell.color,
    updatedAt: cell.updatedAt
  });

  console.log(`Cell ${cellId} claimed by ${userId}`);
}

function handleDisconnect(userId) {
  const user = state.users.get(userId);
  
  if (user) {
    state.usedColors.delete(user.color);
    state.users.delete(userId);
    
    console.log(`User ${userId} disconnected`);
    
    broadcast({
      type: 'users_count',
      count: getConnectedUsersCount()
    });
  }
}

function cleanupDeadConnections() {
  const now = Date.now();
  const disconnected = [];
  
  state.users.forEach((user, userId) => {
    if (user.ws.readyState !== WebSocket.OPEN || (now - user.lastHeartbeat) > CONNECTION_TIMEOUT) {
      disconnected.push(userId);
    }
  });
  
  disconnected.forEach(userId => {
    console.log(`Cleaning up dead connection: ${userId}`);
    handleDisconnect(userId);
  });
}

setInterval(cleanupDeadConnections, HEARTBEAT_INTERVAL);

wss.on('connection', (ws) => {
  const userId = generateUserId();
  const userColor = getRandomColor();
  
  state.users.set(userId, {
    color: userColor,
    connectedAt: Date.now(),
    lastHeartbeat: Date.now(),
    ws: ws
  });

  console.log(`New connection: ${userId} with color ${userColor} (${getConnectedUsersCount()} total)`);

  sendToClient(ws, {
    type: 'init_state',
    you: {
      userId: userId,
      color: userColor
    },
    grid: state.grid,
    connectedUsers: getConnectedUsersCount()
  });

  broadcast({
    type: 'users_count',
    count: getConnectedUsersCount()
  }, ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      const user = state.users.get(userId);
      if (user) {
        user.lastHeartbeat = Date.now();
      }

      switch (data.type) {
        case 'join':
          console.log(`User ${userId} joined`);
          break;

        case 'claim_cell':
          handleClaimCell(userId, data.cellId, ws);
          break;
          
        case 'ping':
          sendToClient(ws, { type: 'pong' });
          break;

        default:
          console.log(`Unknown message type: ${data.type}`);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
      sendToClient(ws, {
        type: 'error',
        message: 'Invalid message format'
      });
    }
  });

  ws.on('close', () => {
    handleDisconnect(userId);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${userId}:`, error);
    handleDisconnect(userId);
  });
});

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

initializeGrid();

server.listen(PORT, () => {
  console.log(`HTTP Server: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}`);
  console.log(`Grid Size: ${GRID_COLS}x${GRID_COLS} (${GRID_SIZE} cells)`);
});