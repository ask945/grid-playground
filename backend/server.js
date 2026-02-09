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
const GRID_SIZE = 400; // 20x20 = 400 cells
const GRID_COLS = 20;

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
  '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
  '#F72585', '#7209B7', '#3A0CA3', '#4361EE', '#4CC9F0',
  '#06FFA5', '#FF006E', '#8338EC', '#FFBE0B', '#FB5607'
];

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
  console.log(`Grid initialized with ${GRID_SIZE} cells`);
}

function getRandomColor() {
  const availableColors = COLORS.filter(c => !state.usedColors.has(c));
  
  if (availableColors.length === 0) {
    state.usedColors.clear();
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }
  
  const color = availableColors[Math.floor(Math.random() * availableColors.length)];
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
  return state.users.size;
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

wss.on('connection', (ws) => {
  const userId = generateUserId();
  const userColor = getRandomColor();

  state.users.set(userId, {
    color: userColor,
    connectedAt: Date.now(),
    ws: ws
  });

  console.log(`New connection: ${userId} (${getConnectedUsersCount()} total)`);

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

      switch (data.type) {
        case 'join':
          console.log(`User ${userId} joined`);
          break;

        case 'claim_cell':
          handleClaimCell(userId, data.cellId, ws);
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
    version: '1.0.0',
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
  console.log(`🌐 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}`);
  console.log(`📊 Grid Size: ${GRID_COLS}x${GRID_COLS} (${GRID_SIZE} cells)`);
  console.log(`🎨 Available Colors: ${COLORS.length}`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});