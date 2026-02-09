import { use, useEffect, useRef, useState } from 'react'
import reactLogo from './assets/react.svg'
import viteLogo from '/vite.svg'
import './App.css'
import { useCallback } from 'react';

const COLUMNS=20;
const wsurl=process.env.wsurl || 'ws://localhost:8080';
const SIZE=400;

function App() {
  const[currentUser,setCurrentUser]=useState(null);
  const[currentUsers,setCurrentUsers]=useState(0);
  const[grid,setGrid]=useState([]);
  const[isConnected,setIsConnected]=useState(false);
  const wsref=useRef(null);
  const[hoveredCell,setHoveredCell]=useState(null);

  useEffect(()=>{
    const ws = new WebSocket();
    wsref.current=ws;

    ws.onopen=()=>{
      console.log('Connected to server');
      setIsConnected(true);
      ws.send(JSON.stringify({type:'join'}))
    };

    ws.onmessage=(event)=>{
      const data = JSON.stringify(event.data);
      switch(data.type){
        case 'init':
          setCurrentUser(data.user);
          setGrid(data.grid);
          if(data.connectedUsers){
            setCurrentUsers(data.connectedUsers);
          }
          break;

        case 'updatedcell':
          setGrid(prevGrid=>{
            const newGrid=[...prevGrid];
            const cell=newGrid.find(c=>c.id===data.cellId);
            if(cell){
              cell.ownerId=data.ownerId;
              cell.color=data.color;
              cell.updatedAt=data.updatedAt;
            }
            return newGrid;
          })
          break;

        case 'users_count':
          setConnectedUsers(data.count);
          break;

        default:
          console.log('Unknown message type:', data.type); 
      }
    }

    ws.onerror=(error)=>{
      console.error('Error ocurred:',error);
    }

    ws.onclose=()=>{
      console.log('Disconnected from server');
    }

    return()=>{
      if(ws.readyState===WebSocket.OPEN){
        ws.close();
      }
    }
  },[]);


  const handleCellClick=useCallback((cellId)=>{
    if(!isConnected || !wsref.current) return;
    wsref.current.send(JSON.stringify({
      type:'claimcell',
      cellId:cellId
    }));
  },[isConnected]);

  const getCellColor=(cell)=>{
    if(hoveredCell==cell.id && !cell.ownerId){
      return currentUser?.color;
    }
    return cell.color;
  }
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

  return(
    <div className='app'>
      <header className='header'>
        <h1>Pixel Board</h1>
          <div className='user-color' style={{background:currentUser.color}}></div>
          <span>You:{currentUser.id}</span>
          <span className='users'>.</span>
          <span>{currentUsers} online</span>
      </header>
      <div className='grid-container'>
        <div className='grid' style={{
          gridTemplateColumns:`repeat(${COLUMNS},1fr)`,
          aspectRatio:'1/1'
        }}>
          {grid.map((cell)=>(
            <div key={cell.id}
              className={getCellName(cell)}
              style={{
                backgroundColor:getCellColor(cell),
              }}
              onClick={()=>handleCellClick(cell.id)}
              onMouseEnter={()=>setHoveredCell(cell.id)}
              onMouseLeave={()=>setHoveredCell(null)}
              title={cell.ownerId ? `Owned by ${cell.ownerId}` : `Unclaimed`}
            />
          ))}
        </div>
      </div>
      <div className="instructions">
        <p>Click any block to claim it!</p>
      </div>
    </div>
  )
}

export default App
