import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

const GRID_SIZE = 400; // 20x20 grid = 400 cells
const GRID_COLS = 20;
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';

function App() {
  const [grid, setGrid] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [connectedUsers, setConnectedUsers] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [hoveredCell, setHoveredCell] = useState(null);
  const wsRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to server');
      setIsConnected(true);
      // Send join event
      ws.send(JSON.stringify({ type: 'join' }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      switch (data.type) {
        case 'init_state':
          // Initialize user info and grid
          setCurrentUser(data.you);
          setGrid(data.grid);
          if (data.connectedUsers) {
            setConnectedUsers(data.connectedUsers);
          }
          break;

        case 'cell_updated':
          // Update specific cell
          setGrid(prevGrid => {
            const newGrid = [...prevGrid];
            const cell = newGrid.find(c => c.id === data.cellId);
            if (cell) {
              cell.ownerId = data.ownerId;
              cell.color = data.color;
              cell.updatedAt = data.updatedAt;
            }
            return newGrid;
          });
          break;

        case 'claim_rejected':
          // Cell claim was rejected (already owned by someone else)
          console.log(`Claim rejected for cell ${data.cellId}: ${data.reason}`);
          // Visual feedback could be added here (e.g., shake animation)
          break;

        case 'users_count':
          setConnectedUsers(data.count);
          break;

        default:
          console.log('Unknown message type:', data.type);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from server');
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  // Handle cell click
  const handleCellClick = useCallback((cellId) => {
    if (!isConnected || !wsRef.current) return;

    // Send claim request
    wsRef.current.send(JSON.stringify({
      type: 'claim_cell',
      cellId: cellId
    }));
  }, [isConnected]);

  // Get cell color
  const getCellColor = (cell) => {
    if (hoveredCell === cell.id && !cell.ownerId) {
      return currentUser?.color || '#ddd';
    }
    return cell.color || '#f5f5f5';
  };

  // Get cell class
  const getCellClass = (cell) => {
    const classes = ['cell'];
    if (cell.ownerId === currentUser?.userId) {
      classes.push('owned-by-you');
    } else if (cell.ownerId) {
      classes.push('owned-by-other');
    } else {
      classes.push('unclaimed');
    }
    return classes.join(' ');
  };

  if (!isConnected) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Connecting to server...</p>
      </div>
    );
  }

  if (!currentUser || grid.length === 0) {
    return (
      <div className="loading-container">
        <div className="loading-spinner"></div>
        <p>Loading grid...</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🎨 Pixel Board</h1>
        <div className="user-info">
          <div className="user-color" style={{ backgroundColor: currentUser.color }}></div>
          <span>You: {currentUser.userId}</span>
          <span className="divider">•</span>
          <span>👥 {connectedUsers} online</span>
        </div>
      </header>

      <div className="grid-container">
        <div 
          className="grid" 
          style={{ 
            gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)`,
            aspectRatio: '1/1'
          }}
        >
          {grid.map((cell) => (
            <div
              key={cell.id}
              className={getCellClass(cell)}
              style={{ 
                backgroundColor: getCellColor(cell),
                transition: 'all 0.2s ease'
              }}
              onClick={() => handleCellClick(cell.id)}
              onMouseEnter={() => setHoveredCell(cell.id)}
              onMouseLeave={() => setHoveredCell(null)}
              title={cell.ownerId ? `Owned by ${cell.ownerId}` : 'Unclaimed'}
            />
          ))}
        </div>
      </div>

      <div className="instructions">
        <p>Click any block to claim it! 🎯</p>
      </div>
    </div>
  );
}

export default App;