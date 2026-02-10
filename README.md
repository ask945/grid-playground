## How It Works

Users connect to a shared 20×20 grid (400 cells). When someone clicks an unclaimed cell, they claim it and their color appears instantly for all users via WebSocket.

**Flow:**
1. User opens app → WebSocket connects to server
2. Server assigns unique ID + random HSL color
3. Server sends current grid state
4. User clicks cell → sends claim request to server
5. Server validates → updates grid → broadcasts to ALL users
6. Everyone's UI updates instantly

**Architecture:**
```
Frontend ←→ WebSocket (wss://) ←→ Backend 
                                  ↓
                              In-Memory Grid State
```

---

## How Real-Time Updates Were Handled

### WebSocket Communication
Used WebSocket for bidirectional, low-latency communication (~50ms updates).

**Key Events:**
- `claim_cell` - Client requests to claim a cell
- `cell_updated` - Server broadcasts ownership change to all clients
- `claim_rejected` - Server rejects duplicate claims
- `ping/pong` - Heartbeat to detect dead connections

### Conflict Resolution
**Problem:** Two users click same cell simultaneously.

**Solution:** First-come-first-served. Server rejects second claim.

This prevents race conditions and provides clear feedback.

### State Synchronization
- Server is single source of truth
- Clients never modify grid directly
- Server broadcasts updates

### Connection Health
Heartbeat mechanism detects crashed browsers and network failures:
- Frontend pings every 25 seconds
- Backend cleanup every 30 seconds
- Dead connections removed after 35 seconds without ping
- Prevents ghost users, ensures accurate user count

---

## Trade-offs Made

### 1. In-Memory State vs Database
**Choice:** In-memory (JavaScript Map/Array)

**Why:** Fast, simple, perfect for demo. Grid resets on restart, but adding Redis would be trivial.

### 2. Unlimited HSL Colors vs Fixed Palette
**Choice:** Generate random HSL colors dynamically

**Why:** Supports unlimited users without color exhaustion. Slight risk of similar colors, but 360° hue range minimizes this.

### 3. Cell Ownership Persistence
**Choice:** Claimed cells stay owned forever (until server restart)

**Why:** More engaging gameplay, shows collaborative aspect. Alternative was freeing cells on disconnect, but less interesting.

### 4. First-Come-First-Served vs Last-Write-Wins
**Choice:** First claim wins, reject duplicates

**Why:** Fair and deterministic. Last-write-wins caused confusing behavior when users saw their claims disappear.

### 5. Broadcast All vs Selective Updates
**Choice:** Broadcast every update to all users

**Why:** Simple, guaranteed consistency. With <100 users and 400 cells, bandwidth is negligible. Would add spatial partitioning for 1000+ users.
