const socket = io();

let myId = null;
let isHost = false;
let roomCode = null;
let myRole = null;
let myTasks = [];
let taskDefs = [];
let latestState = null;
let walls = [];
let killCooldownUntil = 0;

const PLAYER_RADIUS = 14;
const KILL_RANGE = 46;
const TASK_RANGE = 44;
const REPORT_RANGE = 60;

// ---------- Screen helpers ----------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ---------- Home screen ----------
const nameInput = document.getElementById('nameInput');
const codeInput = document.getElementById('codeInput');
document.getElementById('btnCreate').onclick = () => {
  const name = nameInput.value.trim() || 'Player';
  socket.emit('createRoom', { name });
};
document.getElementById('btnJoin').onclick = () => {
  const name = nameInput.value.trim() || 'Player';
  const code = codeInput.value.trim().toUpperCase();
  if (!code) { setHomeError('Enter a room code.'); return; }
  socket.emit('joinRoom', { name, code });
};
function setHomeError(msg) { document.getElementById('homeError').textContent = msg; }

socket.on('errorMsg', (msg) => setHomeError(msg));

socket.on('joined', (data) => {
  myId = data.you;
  roomCode = data.code;
  isHost = data.isHost;
  document.getElementById('roomCodeLabel').textContent = roomCode;
  showScreen('screen-lobby');
});

// ---------- Lobby ----------
document.getElementById('btnStart').onclick = () => socket.emit('startGame');

function renderLobby(state) {
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  state.players.forEach(p => {
    const li = document.createElement('li');
    li.innerHTML = `<span><span class="dot" style="background:${p.color === '#ccc' ? '#789' : p.color}"></span>${escapeHtml(p.name)}</span>${p.id === state.hostId ? '<span>👑</span>' : ''}`;
    list.appendChild(li);
  });
  const startBtn = document.getElementById('btnStart');
  const hint = document.getElementById('lobbyHint');
  if (isHost) {
    startBtn.classList.remove('hidden');
    hint.classList.add('hidden');
  } else {
    startBtn.classList.add('hidden');
    hint.classList.remove('hidden');
  }
}

// ---------- Role reveal ----------
socket.on('role', (data) => {
  myRole = data.role;
  myTasks = data.tasks;
  taskDefs = data.taskDefs;
  const title = document.getElementById('roleTitle');
  const desc = document.getElementById('roleDesc');
  const card = document.getElementById('roleCard');
  if (myRole === 'possessed') {
    title.textContent = '👹 YOU ARE POSSESSED';
    desc.textContent = 'Blend in, fake your tasks, and kill off the guests one by one. Survive until only one guest remains.';
    card.style.borderColor = '#e74c3c';
  } else {
    title.textContent = '🧍 You are a Guest';
    desc.textContent = 'Complete your tasks and find out who is possessed before they pick everyone off.';
    card.style.borderColor = '#6fcf97';
  }
  showScreen('screen-role');
  setTimeout(() => {
    showScreen('screen-game');
    updateRoleBadge();
    renderTaskList();
  }, 3200);
});

function updateRoleBadge() {
  const badge = document.getElementById('roleBadge');
  badge.textContent = myRole === 'possessed' ? 'POSSESSED' : 'GUEST';
  badge.className = myRole;
}

// ---------- Map / walls ----------
fetch('/walls.json').then(r => r.json()).then(w => walls = w);

// ---------- Canvas / movement ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
let localPos = { x: 500, y: 340 };
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'e' || e.key === 'E') tryInteract();
});
window.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

let lastFrame = performance.now();
function loop() {
  const now = performance.now();
  const dt = (now - lastFrame) / 1000;
  lastFrame = now;

  if (latestState && latestState.phase === 'playing') {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    if (dx !== 0 || dy !== 0) {
      socket.emit('move', { dx, dy, dt });
    }
    updateActionPrompt();
    updateCooldownDisplay();
  }

  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // floor
  ctx.fillStyle = '#1a2330';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // room floor tint (simple room rects, cosmetic only — must match server WALLS layout)
  drawRooms();
  // walls
  ctx.fillStyle = '#3a4a5c';
  walls.forEach(w => ctx.fillRect(w.x, w.y, w.w, w.h));

  // tasks
  taskDefs.forEach(t => {
    const mine = myTasks.find(mt => mt.id === t.id);
    ctx.beginPath();
    ctx.arc(t.x, t.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = mine && mine.done ? '#355b45' : '#ffd166';
    ctx.fill();
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#cde';
    ctx.textAlign = 'center';
    ctx.fillText(t.name, t.x, t.y - 16);
  });

  if (!latestState) return;

  // bodies
  latestState.bodies.forEach(b => {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 12, 0, Math.PI * 2);
    ctx.fillStyle = '#7a1f1f';
    ctx.fill();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#f66';
    ctx.textAlign = 'center';
    ctx.fillText('💀 ' + b.name, b.x, b.y - 18);
  });

  // players
  latestState.players.forEach(p => {
    if (!p.alive) return;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = p.color === '#ccc' ? '#789' : p.color;
    ctx.fill();
    ctx.strokeStyle = p.id === myId ? '#fff' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = p.id === myId ? 2 : 1;
    ctx.stroke();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#eef3f8';
    ctx.textAlign = 'center';
    ctx.fillText(p.name, p.x, p.y - 20);
  });
}

function drawRooms() {
  // purely cosmetic floor tinting matching the server's open floor plan:
  // four corner rooms joined by a wide open cross-shaped hallway.
  const tint = (x, y, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  tint(16, 16, 364, 214, '#202b3a');    // living room (top-left)
  tint(620, 16, 348, 214, '#24303f');   // kitchen (top-right)
  tint(16, 466, 364, 218, '#202b3a');   // bedroom (bottom-left)
  tint(620, 466, 348, 218, '#24303f');  // study (bottom-right)
  tint(0, 230, 1000, 220, '#17202b');   // horizontal hallway strip
  tint(380, 0, 240, 700, '#17202b');    // vertical hallway strip
}

// ---------- Interactions (tasks, report, kill) ----------
let nearestTask = null;
let nearestBody = null;
let nearestVictim = null;

function myPlayer() {
  if (!latestState) return null;
  return latestState.players.find(p => p.id === myId);
}

function updateActionPrompt() {
  const me = myPlayer();
  const prompt = document.getElementById('actionPrompt');
  if (!me || !me.alive) { prompt.classList.add('hidden'); return; }

  nearestTask = taskDefs.find(t => {
    const mt = myTasks.find(x => x.id === t.id);
    return mt && !mt.done && dist(me, t) <= TASK_RANGE;
  }) || null;

  nearestBody = latestState.bodies.find(b => dist(me, b) <= REPORT_RANGE) || null;

  nearestVictim = null;
  if (myRole === 'possessed') {
    nearestVictim = latestState.players.find(p => p.id !== myId && p.alive && dist(me, p) <= KILL_RANGE) || null;
  }

  if (nearestVictim && Date.now() >= killCooldownUntil) {
    prompt.textContent = `Press F to kill ${nearestVictim.name}`;
    prompt.classList.remove('hidden');
  } else if (nearestBody) {
    prompt.textContent = `Press E to report ${nearestBody.name}'s body`;
    prompt.classList.remove('hidden');
  } else if (nearestTask) {
    prompt.textContent = `Press E to ${nearestTask.name}`;
    prompt.classList.remove('hidden');
  } else {
    prompt.classList.add('hidden');
  }
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function tryInteract() {
  if (nearestBody) { socket.emit('report', { bodyId: nearestBody.id }); return; }
  if (nearestTask) { openTaskModal(nearestTask); return; }
}

window.addEventListener('keydown', (e) => {
  if ((e.key === 'f' || e.key === 'F') && nearestVictim && Date.now() >= killCooldownUntil) {
    socket.emit('kill', { targetId: nearestVictim.id });
  }
});

socket.on('killCooldown', (ms) => { killCooldownUntil = Date.now() + ms; });

function updateCooldownDisplay() {
  const el = document.getElementById('killCooldown');
  if (myRole !== 'possessed') { el.classList.add('hidden'); return; }
  const remaining = Math.ceil((killCooldownUntil - Date.now()) / 1000);
  if (remaining > 0) {
    el.classList.remove('hidden');
    document.getElementById('cooldownVal').textContent = remaining;
  } else {
    el.classList.add('hidden');
  }
}

// ---------- Task minigames ----------
const taskModal = document.getElementById('taskModal');
function openTaskModal(task) {
  taskModal.classList.remove('hidden');
  document.getElementById('taskModalTitle').textContent = task.name;
  const body = document.getElementById('taskModalBody');
  body.innerHTML = '';

  if (task.type === 'mash') {
    let clicks = 0, needed = 12;
    const bar = document.createElement('div'); bar.className = 'progressBar';
    const fill = document.createElement('div'); bar.appendChild(fill);
    const btn = document.createElement('button'); btn.textContent = 'Click rapidly!';
    btn.onclick = () => {
      clicks++;
      fill.style.width = Math.min(100, (clicks / needed) * 100) + '%';
      if (clicks >= needed) completeTask(task);
    };
    body.appendChild(bar); body.appendChild(btn);
  } else if (task.type === 'hold') {
    const bar = document.createElement('div'); bar.className = 'progressBar';
    const fill = document.createElement('div'); bar.appendChild(fill);
    const btn = document.createElement('button'); btn.textContent = 'Hold to complete';
    body.appendChild(bar); body.appendChild(btn);
    let holding = false, progress = 0, raf;
    const tick = () => {
      if (holding) {
        progress += 1.6;
        fill.style.width = Math.min(100, progress) + '%';
        if (progress >= 100) { completeTask(task); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    btn.onmousedown = () => { holding = true; };
    btn.onmouseup = btn.onmouseleave = () => { holding = false; };
    tick();
    taskModal._cleanup = () => cancelAnimationFrame(raf);
  } else if (task.type === 'sequence') {
    const seq = [];
    for (let i = 0; i < 4; i++) seq.push(Math.floor(Math.random() * 4));
    const labels = ['⬆️', '⬇️', '⬅️', '➡️'];
    const display = document.createElement('div');
    display.style.fontSize = '22px';
    display.style.margin = '10px 0';
    display.textContent = seq.map(s => labels[s]).join(' ');
    body.appendChild(display);
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Click the arrows in order shown.';
    body.appendChild(hint);
    const row = document.createElement('div');
    let step = 0;
    labels.forEach((lab, idx) => {
      const b = document.createElement('button');
      b.textContent = lab;
      b.onclick = () => {
        if (idx === seq[step]) {
          step++;
          display.textContent = seq.map((s, i) => i < step ? '✅' : labels[s]).join(' ');
          if (step >= seq.length) completeTask(task);
        } else {
          step = 0;
          display.textContent = seq.map(s => labels[s]).join(' ');
        }
      };
      row.appendChild(b);
    });
    body.appendChild(row);
  }

  const cancel = document.createElement('button');
  cancel.textContent = 'Cancel';
  cancel.style.marginTop = '10px';
  cancel.onclick = closeTaskModal;
  body.appendChild(cancel);
}

function completeTask(task) {
  socket.emit('doTask', { taskId: task.id });
  closeTaskModal();
}
function closeTaskModal() {
  if (taskModal._cleanup) { taskModal._cleanup(); taskModal._cleanup = null; }
  taskModal.classList.add('hidden');
}

socket.on('taskUpdate', (tasks) => {
  myTasks = tasks;
  renderTaskList();
});

function renderTaskList() {
  const panel = document.getElementById('taskListPanel');
  panel.innerHTML = '<strong>Your tasks</strong>';
  myTasks.forEach(mt => {
    const def = taskDefs.find(t => t.id === mt.id);
    const div = document.createElement('div');
    div.className = mt.done ? 'done' : '';
    div.textContent = (mt.done ? '✔ ' : '• ') + (def ? def.name : mt.id);
    panel.appendChild(div);
  });
}

// ---------- Chat ----------
const chatInput = document.getElementById('chatInput');
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim()) {
    socket.emit('chat', { text: chatInput.value.trim() });
    chatInput.value = '';
  }
});
const meetingChatInput = document.getElementById('meetingChatInput');
meetingChatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && meetingChatInput.value.trim()) {
    socket.emit('chat', { text: meetingChatInput.value.trim() });
    meetingChatInput.value = '';
  }
});
socket.on('chat', ({ from, color, text }) => {
  const line = `<div><strong style="color:${color}">${escapeHtml(from)}:</strong> ${escapeHtml(text)}</div>`;
  const log = document.getElementById('chatLog');
  log.insertAdjacentHTML('beforeend', line);
  log.scrollTop = log.scrollHeight;
  const mlog = document.getElementById('meetingChatLog');
  mlog.insertAdjacentHTML('beforeend', line);
  mlog.scrollTop = mlog.scrollHeight;
});

// ---------- Meeting ----------
document.getElementById('btnMeeting').onclick = () => socket.emit('callMeeting');

let meetingTimerInterval = null;
function renderMeeting(state) {
  showScreen('screen-meeting');
  const m = state.meeting;
  const title = document.getElementById('meetingTitle');
  const timer = document.getElementById('meetingTimer');
  const resultEl = document.getElementById('meetingResult');
  resultEl.textContent = m.result || '';

  title.textContent = m.subPhase === 'discussion' ? 'Discussion' : (m.result ? 'Result' : 'Voting');

  clearInterval(meetingTimerInterval);
  meetingTimerInterval = setInterval(() => {
    const remaining = Math.max(0, Math.ceil((m.endsAt - Date.now()) / 1000));
    timer.textContent = m.result ? '' : `${remaining}s remaining`;
    if (remaining <= 0) clearInterval(meetingTimerInterval);
  }, 250);

  const grid = document.getElementById('voteGrid');
  grid.innerHTML = '';
  if (m.subPhase === 'voting' && !m.result) {
    const me = myPlayer();
    const alive = state.players.filter(p => p.alive);
    alive.forEach(p => {
      const btn = document.createElement('button');
      btn.textContent = p.name + (p.id === myId ? ' (you)' : '');
      if (m.votes[myId] === p.id) btn.classList.add('voted');
      btn.disabled = !me || !me.alive;
      btn.onclick = () => socket.emit('vote', { targetId: p.id });
      grid.appendChild(btn);
    });
    const skip = document.createElement('button');
    skip.textContent = 'Skip Vote';
    if (m.votes[myId] === 'skip') skip.classList.add('voted');
    skip.disabled = !me || !me.alive;
    skip.onclick = () => socket.emit('vote', { targetId: 'skip' });
    grid.appendChild(skip);
  }
}

// ---------- Game over ----------
socket.on('gameOver', ({ winner, roles }) => {
  showScreen('screen-over');
  document.getElementById('overTitle').textContent = winner === 'possessed'
    ? '👹 The Possessed Wins'
    : '🎉 The Guests Win';
  const list = document.getElementById('roleReveal');
  list.innerHTML = '';
  roles.forEach(r => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(r.name)} ${r.alive ? '' : '(dead)'}</span><span>${r.role === 'possessed' ? '👹 Possessed' : 'Guest'}</span>`;
    list.appendChild(li);
  });
  const btn = document.getElementById('btnPlayAgain');
  const hint = document.getElementById('overHint');
  if (isHost) { btn.classList.remove('hidden'); hint.classList.add('hidden'); }
  else { btn.classList.add('hidden'); hint.classList.remove('hidden'); }
});
document.getElementById('btnPlayAgain').onclick = () => socket.emit('playAgain');

// ---------- Central state handler ----------
socket.on('state', (state) => {
  latestState = state;
  if (state.phase === 'lobby') {
    if (document.getElementById('screen-lobby').classList.contains('hidden') &&
        document.getElementById('screen-home').classList.contains('hidden')) {
      showScreen('screen-lobby');
    }
    renderLobby(state);
  } else if (state.phase === 'playing') {
    if (!document.getElementById('screen-game').classList.contains('hidden') === false) {
      // no-op guard
    }
    if (document.getElementById('screen-meeting').classList.contains('hidden') === false) {
      showScreen('screen-game');
    }
    document.getElementById('taskCount').textContent = `${state.tasksDone}/${state.tasksTotal}`;
  } else if (state.phase === 'meeting') {
    renderMeeting(state);
  } else if (state.phase === 'ended') {
    // handled by gameOver event, but ensure screen if state arrives first
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
