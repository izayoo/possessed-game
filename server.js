const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ---------- Game constants ----------
const PLAYER_SPEED = 180; // px/sec
const PLAYER_RADIUS = 14;
const KILL_RANGE = 46;
const KILL_COOLDOWN_MS = 25000;
const MEETING_DISCUSSION_MS = 25000;
const MEETING_VOTING_MS = 20000;
const MIN_PLAYERS = 4;
const MAX_PLAYERS = 10;
const REPORT_RANGE = 60;
const TASK_RANGE = 44;

// Map walls (axis-aligned rectangles) in world space, 0,0 top-left.
// World is 1000x700. Open floor plan: four corner rooms (Living Room,
// Kitchen, Bedroom, Study) joined by a wide open cross-shaped hallway
// (x 380-620 vertical strip, y 230-450 horizontal strip). All gaps are
// at least 240px wide — far more than the 28px player diameter — so
// there is no way for a player to get wedged against a wall.
const WALLS = [
    // outer bounds
  { x: 0, y: 0, w: 1000, h: 16 },
  { x: 0, y: 684, w: 1000, h: 16 },
  { x: 0, y: 0, w: 16, h: 700 },
  { x: 984, y: 0, w: 16, h: 700 },
    // top dividers (gap x380-620 stays open for the vertical hallway)
  { x: 16, y: 230, w: 364, h: 16 },
  { x: 620, y: 230, w: 364, h: 16 },
    // bottom dividers (same gap)
  { x: 16, y: 450, w: 364, h: 16 },
  { x: 620, y: 450, w: 364, h: 16 },
  ];

const TASKS = [
  { id: 'wood', name: 'Chop Wood', x: 120, y: 120, type: 'mash' },
  { id: 'kettle', name: 'Boil Water', x: 850, y: 120, type: 'sequence' },
  { id: 'fuse', name: 'Fix Fuse Box', x: 870, y: 580, type: 'sequence' },
  { id: 'book', name: 'Read Ritual Book', x: 130, y: 580, type: 'hold' },
  { id: 'radio', name: 'Fix Radio Signal', x: 500, y: 120, type: 'mash' },
  { id: 'logs', name: 'Stack Firewood', x: 500, y: 600, type: 'hold' },
  ];

function makeRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
    constructor(code, hostId) {
          this.code = code;
          this.hostId = hostId;
          this.players = new Map(); // id -> player state
      this.phase = 'lobby'; // lobby | playing | meeting | ended
      this.bodies = []; // {id (victim id), x, y}
      this.meeting = null;
          this.winner = null;
          this.tasksTotal = 0;
          this.tasksDone = 0;
    }

  broadcastState() {
        io.to(this.code).emit('state', this.publicState());
  }

  publicState() {
        return {
                code: this.code,
                hostId: this.hostId,
                phase: this.phase,
                players: Array.from(this.players.values()).map(p => ({
                          id: p.id, name: p.name, x: p.x, y: p.y, alive: p.alive, color: p.color,
                })),
                bodies: this.bodies,
                meeting: this.meeting ? {
                          subPhase: this.meeting.subPhase,
                          endsAt: this.meeting.endsAt,
                          votes: this.meeting.votes,
                          reporterId: this.meeting.reporterId,
                          result: this.meeting.result || null,
                } : null,
                winner: this.winner,
                tasksTotal: this.tasksTotal,
                tasksDone: this.tasksDone,
        };
  }

  alivePlayers() {
        return Array.from(this.players.values()).filter(p => p.alive);
  }
}

function colorFor(index) {
    const palette = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ecf0f1', '#95a5a6', '#d35400'];
    return palette[index % palette.length];
}

function rectsOverlapCircle(rect, cx, cy, r) {
    const closestX = Math.max(rect.x, Math.min(cx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(cy, rect.y + rect.h));
    const dx = cx - closestX, dy = cy - closestY;
    return (dx * dx + dy * dy) < (r * r);
}

function collides(x, y) {
    for (const wall of WALLS) {
          if (rectsOverlapCircle(wall, x, y, PLAYER_RADIUS)) return true;
    }
    return false;
}

function startGame(room) {
    const ids = Array.from(room.players.keys());
    const possessedId = ids[Math.floor(Math.random() * ids.length)];
    let i = 0;
    for (const p of room.players.values()) {
          p.alive = true;
          p.role = (p.id === possessedId) ? 'possessed' : 'guest';
          p.color = colorFor(i++);
          p.x = 500 + (Math.random() * 40 - 20);
          p.y = 340 + (Math.random() * 40 - 20);
          p.lastKillAt = 0;
          p.tasks = p.role === 'guest'
            ? TASKS.map(t => ({ id: t.id, done: false }))
                  : TASKS.map(t => ({ id: t.id, done: false })); // possessed gets fake tasks too
    }
    room.phase = 'playing';
    room.bodies = [];
    room.meeting = null;
    room.winner = null;
    room.tasksTotal = TASKS.length * room.alivePlayers().filter(p => p.role === 'guest').length;
    room.tasksDone = 0;

  for (const p of room.players.values()) {
        io.to(p.id).emit('role', { role: p.role, tasks: p.tasks, taskDefs: TASKS });
  }
    room.broadcastState();
}

function checkWin(room) {
    if (room.phase !== 'playing' && room.phase !== 'meeting') return;
    const alive = room.alivePlayers();
    const aliveGuests = alive.filter(p => p.role === 'guest');
    const possessedAlive = alive.some(p => p.role === 'possessed');

  if (!possessedAlive) {
        room.winner = 'guests';
        room.phase = 'ended';
  } else if (aliveGuests.length <= 1) {
        room.winner = 'possessed';
        room.phase = 'ended';
  } else if (room.tasksDone >= room.tasksTotal && room.tasksTotal > 0) {
        room.winner = 'guests';
        room.phase = 'ended';
  }
    if (room.phase === 'ended') {
          io.to(room.code).emit('gameOver', {
                  winner: room.winner,
                  roles: Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, role: p.role, alive: p.alive })),
          });
          room.broadcastState();
    }
}

function startMeeting(room, reporterId) {
    room.phase = 'meeting';
    room.meeting = {
          subPhase: 'discussion',
          endsAt: Date.now() + MEETING_DISCUSSION_MS,
          votes: {},
          reporterId,
    };
    room.bodies = [];
    room.broadcastState();
    setTimeout(() => {
          if (!room.meeting || room.phase !== 'meeting') return;
          room.meeting.subPhase = 'voting';
          room.meeting.endsAt = Date.now() + MEETING_VOTING_MS;
          room.broadcastState();
          setTimeout(() => resolveMeeting(room), MEETING_VOTING_MS);
    }, MEETING_DISCUSSION_MS);
}

function resolveMeeting(room) {
    if (!room.meeting || room.phase !== 'meeting') return;
    const tally = {};
    for (const voterId of Object.keys(room.meeting.votes)) {
          const target = room.meeting.votes[voterId]; // player id or 'skip'
      tally[target] = (tally[target] || 0) + 1;
    }
    let ejectedId = null, max = 0, tie = false;
    for (const [target, count] of Object.entries(tally)) {
          if (target === 'skip') continue;
          if (count > max) { max = count; ejectedId = target; tie = false; }
          else if (count === max) { tie = true; }
    }
    if (tie || max === 0) ejectedId = null;

  let resultText = 'No one was ejected.';
    if (ejectedId && room.players.has(ejectedId)) {
          const ejected = room.players.get(ejectedId);
          ejected.alive = false;
          resultText = `${ejected.name} was ejected. They were ${ejected.role === 'possessed' ? 'THE POSSESSED' : 'not possessed'}.`;
    }
    room.meeting.result = resultText;
    room.broadcastState();

  setTimeout(() => {
        room.meeting = null;
        if (room.phase !== 'ended') room.phase = 'playing';
        checkWin(room);
        room.broadcastState();
  }, 5000);

  checkWin(room);
}

io.on('connection', (socket) => {
    socket.on('createRoom', ({ name }) => {
          let code;
          do { code = makeRoomCode(); } while (rooms.has(code));
          const room = new Room(code, socket.id);
          rooms.set(code, room);
          joinRoom(room, socket, name);
    });

        socket.on('joinRoom', ({ name, code }) => {
              const room = rooms.get((code || '').toUpperCase());
              if (!room) { socket.emit('errorMsg', 'Room not found.'); return; }
              if (room.phase !== 'lobby') { socket.emit('errorMsg', 'Game already in progress.'); return; }
              if (room.players.size >= MAX_PLAYERS) { socket.emit('errorMsg', 'Room is full.'); return; }
              joinRoom(room, socket, name);
        });

        function joinRoom(room, socket, name) {
              socket.join(room.code);
              socket.data.roomCode = room.code;
              room.players.set(socket.id, {
                      id: socket.id,
                      name: (name || 'Player').slice(0, 16),
                      x: 500, y: 340,
                      alive: true,
                      role: null,
                      color: '#ccc',
                      lastKillAt: 0,
                      tasks: [],
              });
              socket.emit('joined', { code: room.code, you: socket.id, isHost: room.hostId === socket.id });
              room.broadcastState();
        }

        socket.on('startGame', () => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.hostId !== socket.id || room.phase !== 'lobby') return;
              if (room.players.size < MIN_PLAYERS) { socket.emit('errorMsg', `Need at least ${MIN_PLAYERS} players.`); return; }
              startGame(room);
        });

        socket.on('move', ({ dx, dy, dt }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'playing') return;
              const p = room.players.get(socket.id);
              if (!p || !p.alive) return;
              const len = Math.hypot(dx, dy) || 1;
              const nx = dx / len, ny = dy / len;
              const dist = PLAYER_SPEED * Math.min(dt, 0.1);
              let newX = p.x + nx * dist;
              let newY = p.y + ny * dist;
              if (!collides(newX, p.y)) p.x = newX;
              if (!collides(p.x, newY)) p.y = newY;
        });

        socket.on('doTask', ({ taskId }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'playing') return;
              const p = room.players.get(socket.id);
              if (!p || !p.alive) return;
              const taskDef = TASKS.find(t => t.id === taskId);
              const pt = p.tasks.find(t => t.id === taskId);
              if (!taskDef || !pt || pt.done) return;
              if (Math.hypot(p.x - taskDef.x, p.y - taskDef.y) > TASK_RANGE) return;
              pt.done = true;
              if (p.role === 'guest') {
                      room.tasksDone++;
                      checkWin(room);
              }
              socket.emit('taskUpdate', p.tasks);
              room.broadcastState();
        });

        socket.on('kill', ({ targetId }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'playing') return;
              const p = room.players.get(socket.id);
              const target = room.players.get(targetId);
              if (!p || !p.alive || p.role !== 'possessed' || !target || !target.alive) return;
              const now = Date.now();
              if (now - p.lastKillAt < KILL_COOLDOWN_MS) return;
              if (Math.hypot(p.x - target.x, p.y - target.y) > KILL_RANGE) return;
              target.alive = false;
              p.lastKillAt = now;
              room.bodies.push({ id: target.id, name: target.name, x: target.x, y: target.y });
              socket.emit('killCooldown', KILL_COOLDOWN_MS);
              checkWin(room);
              room.broadcastState();
        });

        socket.on('report', ({ bodyId }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'playing') return;
              const p = room.players.get(socket.id);
              if (!p || !p.alive) return;
              const body = room.bodies.find(b => b.id === bodyId);
              if (!body) return;
              if (Math.hypot(p.x - body.x, p.y - body.y) > REPORT_RANGE) return;
              startMeeting(room, socket.id);
        });

        socket.on('callMeeting', () => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'playing') return;
              const p = room.players.get(socket.id);
              if (!p || !p.alive) return;
              startMeeting(room, socket.id);
        });

        socket.on('vote', ({ targetId }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.phase !== 'meeting' || !room.meeting || room.meeting.subPhase !== 'voting') return;
              const p = room.players.get(socket.id);
              if (!p || !p.alive) return;
              room.meeting.votes[socket.id] = targetId;
              room.broadcastState();
        });

        socket.on('chat', ({ text }) => {
              const room = rooms.get(socket.data.roomCode);
              if (!room) return;
              const p = room.players.get(socket.id);
              if (!p) return;
              if (room.phase === 'meeting' && !p.alive) return; // dead can't speak in meeting (optional rule)
                      io.to(room.code).emit('chat', { from: p.name, color: p.color, text: String(text).slice(0, 200) });
        });

        socket.on('playAgain', () => {
              const room = rooms.get(socket.data.roomCode);
              if (!room || room.hostId !== socket.id) return;
              room.phase = 'lobby';
              room.winner = null;
              room.bodies = [];
              room.meeting = null;
              room.broadcastState();
        });

        socket.on('disconnect', () => {
              const room = rooms.get(socket.data.roomCode);
              if (!room) return;
              room.players.delete(socket.id);
              if (room.players.size === 0) {
                      rooms.delete(room.code);
                      return;
              }
              if (room.hostId === socket.id) {
                      room.hostId = Array.from(room.players.keys())[0];
              }
              checkWin(room);
              room.broadcastState();
        });
});

// Broadcast live positions at ~20fps while a room is actively playing.
// (All other state changes — join, task, kill, meeting — already
// broadcast immediately on their own; this tick only covers movement,
// which otherwise would never reach other clients.)
setInterval(() => {
    for (const room of rooms.values()) {
          if (room.phase === 'playing') room.broadcastState();
    }
}, 50);

app.get('/walls.json', (req, res) => res.json(WALLS));
app.get('/tasks.json', (req, res) => res.json(TASKS));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Possessed running on :${PORT}`));
