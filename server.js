/**
 * server.js — The Royal Study backend
 * Express + Socket.io · CPU mode · full game logic
 */
'use strict';

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const GL      = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
const PORT   = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/gameLogic.js', (req, res) => res.sendFile(path.join(__dirname, 'gameLogic.js')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─────────────────────────────────────────────
// PUZZLE GENERATION — completely random, no difficulty sorting
// ─────────────────────────────────────────────
const SEED_STATES = [
  ['K','Q','R',null,'B',null,'N',null,null],
  ['K',null,'N',null,'B',null,'R',null,'Q'],
  [null,'K',null,'R','Q','B',null,'N',null],
  ['R',null,'K',null,'Q',null,'N','B',null],
  [null,'R',null,'B','K','N',null,'Q',null],
  ['K',null,'R','N',null,'B',null,'Q',null],
  [null,'Q','R','K',null,null,null,'N','B'],
  [null,'K','B','R',null,'Q',null,'N',null],
  ['Q','B',null,null,'K',null,'N',null,'R'],
  [null,'R','K','B',null,'N',null,'Q',null],
  ['R','Q',null,null,'B',null,'K',null,'N'],
  [null,null,'K','Q','B','R','N',null,null],
  ['B',null,'R','K',null,null,null,'N','Q'],
  [null,'B',null,'K',null,'N','Q',null,'R'],
  ['N',null,'Q',null,'B',null,'K','R',null],
];

let PUZZLES = [];

function generatePuzzles() {
  console.log('⏳ Generating puzzles via BFS…');
  const map = new Map();
  for (const seed of SEED_STATES) {
    const reachable = GL.bfsAll(seed, 9);
    for (const [goalKey, { dist, board: goal }] of reachable) {
      if (dist < 2) continue;
      const k = GL.boardToKey(seed) + '|' + goalKey;
      if (!map.has(k)) map.set(k, { start: [...seed], goal: [...goal], minMoves: dist });
    }
  }
  const all = Array.from(map.values());
  // Shuffle
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const result = all.slice(0, 120).map((p, i) => ({ ...p, id: i + 1 }));
  console.log(`✅ ${result.length} puzzles ready`);
  return result;
}

PUZZLES = generatePuzzles();

// ─────────────────────────────────────────────
// ROOM MANAGEMENT
// ─────────────────────────────────────────────
const rooms       = new Map();
const playerRooms = new Map();

function genCode() {
  const ch = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code;
  do { code = Array.from({length:4}, () => ch[Math.floor(Math.random()*ch.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

/** Pick a random unused puzzle (no difficulty filter) */
function selectPuzzle(room) {
  const unused = PUZZLES.filter(p => !room.usedIds.has(p.id));
  if (unused.length === 0) { room.usedIds.clear(); return selectPuzzle(room); }
  const p = unused[Math.floor(Math.random() * unused.length)];
  room.usedIds.add(p.id);
  return p;
}

function makeRoom(hostId, hostName, difficulty, isSolo = false, isCpu = false) {
  const code = genCode();
  const room = {
    id: code, difficulty, isSolo, isCpu,
    players: [{ id: hostId, name: hostName, score: 0, isHost: true }],
    phase: 'waiting',
    currentPuzzle: null,
    round: null,
    usedIds: new Set(),
    timer: null, tick: null,
  };
  rooms.set(code, room);
  return room;
}

// ─────────────────────────────────────────────
// TIMERS
// ─────────────────────────────────────────────
function clearTimers(room) {
  clearTimeout(room.timer);
  clearInterval(room.tick);
}

function startTick(room, seconds) {
  clearInterval(room.tick);
  let s = seconds;
  room.tick = setInterval(() => {
    s--;
    io.to(room.id).emit('timer_tick', { seconds: s });
    if (s <= 0) clearInterval(room.tick);
  }, 1000);
}

// ─────────────────────────────────────────────
// GAME PHASES
// ─────────────────────────────────────────────
function startAnalysis(room) {
  clearTimers(room);
  const puzzle = selectPuzzle(room);
  room.currentPuzzle = puzzle;
  room.phase = 'analyzing';
  room.round = {
    bids: {},
    boardState: [...puzzle.start],
    moveCount: 0,
    activePlayerId: null,
    activePlayerBid: 99,
    stealAttempted: false,
  };

  const T = 60;
  io.to(room.id).emit('phase_analyzing', {
    puzzle: { start: puzzle.start, goal: puzzle.goal, minMoves: puzzle.minMoves },
    timerSeconds: T,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    roomDifficulty: room.difficulty,
  });
  startTick(room, T);
  room.timer = setTimeout(() => revealBids(room), T * 1000);

  // CPU submits its bid automatically after 3-6s
  if (room.isCpu) {
    const cpuDelay = 3000 + Math.random() * 3000;
    setTimeout(() => {
      if (room.phase !== 'analyzing') return;
      const cpuBid = Math.max(1, puzzle.minMoves + Math.floor(Math.random() * 3));
      room.round.bids['cpu'] = cpuBid;
      io.to(room.id).emit('opponent_bid_in', { isCpu: true });
      if (room.players.every(p => room.round.bids[p.id] !== undefined)) {
        clearTimers(room); revealBids(room);
      }
    }, cpuDelay);
  }
}

function revealBids(room) {
  clearTimers(room);
  if (room.phase !== 'analyzing') return;
  const rd = room.round;
  for (const p of room.players) if (rd.bids[p.id] === undefined) rd.bids[p.id] = 99;
  if (room.isCpu && rd.bids['cpu'] === undefined) {
    rd.bids['cpu'] = Math.max(1, room.currentPuzzle.minMoves + Math.floor(Math.random() * 3));
  }

  room.phase = 'bid_reveal';
  const [p0] = room.players;
  const cpuId = room.isCpu ? 'cpu' : null;
  const otherId = room.isCpu ? 'cpu' : (room.players[1]?.id);

  let activeId = p0.id;
  if (otherId && (rd.bids[otherId] ?? 99) < (rd.bids[p0.id] ?? 99)) activeId = otherId;

  rd.activePlayerId  = activeId;
  rd.activePlayerBid = rd.bids[activeId] ?? 5;

  const nameMap = Object.fromEntries(room.players.map(p => [p.id, p.name]));
  if (room.isCpu) nameMap['cpu'] = 'CPU ♟';

  io.to(room.id).emit('phase_bid_reveal', {
    bids: rd.bids,
    activePlayerId: rd.activePlayerId,
    activePlayerBid: rd.activePlayerBid,
    playerNames: nameMap,
  });

  room.timer = setTimeout(() => startPlaying(room, false), 3500);
}

function startPlaying(room, isSteal) {
  clearTimers(room);
  const rd = room.round;

  if (isSteal) {
    room.phase = 'stealing';
    const allIds = [...room.players.map(p => p.id), ...(room.isCpu ? ['cpu'] : [])];
    const other  = allIds.find(id => id !== rd.activePlayerId);
    if (!other) { endRound(room, null); return; }
    rd.activePlayerId  = other;
    rd.activePlayerBid = rd.bids[other] ?? 5;
  } else {
    room.phase = 'playing';
  }

  rd.boardState = [...room.currentPuzzle.start];
  rd.moveCount  = 0;

  const T = 120;
  const nameMap = Object.fromEntries(room.players.map(p => [p.id, p.name]));
  if (room.isCpu) nameMap['cpu'] = 'CPU ♟';

  io.to(room.id).emit('phase_playing', {
    phase: isSteal ? 'stealing' : 'playing',
    activePlayerId: rd.activePlayerId,
    activePlayerBid: rd.activePlayerBid,
    boardState: [...rd.boardState],
    timerSeconds: T,
    playerNames: nameMap,
  });

  // If CPU is the active player, animate the solution
  if (rd.activePlayerId === 'cpu') {
    cpuPlay(room);
    return;
  }

  startTick(room, T);
  room.timer = setTimeout(() => {
    if (isSteal || !room.isCpu) {
      endRound(room, null);
    } else {
      io.to(room.id).emit('playing_failed', { playerId: rd.activePlayerId, reason: 'timeout' });
      rd.stealAttempted = true;
      room.timer = setTimeout(() => startPlaying(room, true), 2500);
    }
  }, T * 1000);
}

/** CPU animates solving the puzzle step by step */
function cpuPlay(room) {
  const path = GL.findSolutionPath([...room.round.boardState], room.currentPuzzle.goal);
  if (!path || path.length === 0) { endRound(room, null); return; }

  let step = 0;
  const maxSteps = room.round.activePlayerBid;

  function nextMove() {
    if (!rooms.has(room.id)) return;
    if (step >= path.length || step >= maxSteps) {
      if (!GL.checkWin(room.round.boardState, room.currentPuzzle.goal)) endRound(room, null);
      return;
    }
    const { from, to } = path[step++];
    const board = room.round.boardState;
    board[to] = board[from]; board[from] = null;
    room.round.moveCount++;
    const won = GL.checkWin(board, room.currentPuzzle.goal);
    io.to(room.id).emit('board_update', {
      boardState: [...board], moveCount: room.round.moveCount, won, exceededBid: false,
    });
    if (won) { clearTimers(room); endRound(room, 'cpu'); }
    else setTimeout(nextMove, 900 + Math.random() * 400);
  }
  setTimeout(nextMove, 1600);
}

function handleMoveResult(room, socket, board, moveCount) {
  const rd = room.round;
  const won  = GL.checkWin(board, room.currentPuzzle.goal);
  const over = moveCount > rd.activePlayerBid;

  io.to(room.id).emit('board_update', { boardState: [...board], moveCount, won, exceededBid: over });

  if (won) {
    clearTimers(room); endRound(room, socket.id);
  } else if (over) {
    clearTimers(room);
    const canSteal = ['playing'].includes(room.phase) && !rd.stealAttempted &&
                     (room.players.length === 2 || room.isCpu);
    if (canSteal) {
      rd.stealAttempted = true;
      io.to(room.id).emit('playing_failed', { playerId: socket.id, reason: 'bid_exceeded' });
      room.timer = setTimeout(() => startPlaying(room, true), 2500);
    } else {
      endRound(room, null);
    }
  }
}

function endRound(room, winnerId) {
  clearTimers(room);
  room.phase = 'round_end';
  const winner = room.players.find(p => p.id === winnerId);
  if (winner) winner.score++;
  const cpuScore = room.isCpu ? (room.round?.cpuScore || 0) + (winnerId === 'cpu' ? 1 : 0) : 0;
  if (room.isCpu && !room.cpuScore) room.cpuScore = 0;
  if (room.isCpu && winnerId === 'cpu') room.cpuScore = (room.cpuScore || 0) + 1;

  const scores = [
    ...room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    ...(room.isCpu ? [{ id: 'cpu', name: 'CPU ♟', score: room.cpuScore || 0 }] : []),
  ];
  const gameOver = (winner && winner.score >= 6) || (room.isCpu && (room.cpuScore || 0) >= 6);

  io.to(room.id).emit('round_end', {
    winnerId,
    winnerName: winner ? winner.name : (winnerId === 'cpu' ? 'CPU ♟' : null),
    moveCount: room.round?.moveCount,
    minMoves: room.currentPuzzle.minMoves,
    scores, gameOver,
  });

  if (gameOver) {
    const champ = scores.reduce((a, b) => a.score > b.score ? a : b);
    room.phase = 'game_over';
    setTimeout(() => io.to(room.id).emit('game_over', { winnerId: champ.id, winnerName: champ.name, scores }), 4500);
  } else {
    room.timer = setTimeout(() => { if (rooms.has(room.id)) startAnalysis(room); }, 5500);
  }
}

// ─────────────────────────────────────────────
// SOLO MODE
// ─────────────────────────────────────────────
function soloStart(socket, room) {
  const puzzle = selectPuzzle(room);
  room.currentPuzzle = puzzle;
  room.phase = 'solo_playing';
  room.round = { boardState: [...puzzle.start], moveCount: 0 };
  socket.emit('solo_puzzle', {
    puzzle: { start: puzzle.start, goal: puzzle.goal, minMoves: puzzle.minMoves },
    completed: room.usedIds.size,
    roomDifficulty: room.difficulty,
  });
}

// ─────────────────────────────────────────────
// SOCKET EVENTS
// ─────────────────────────────────────────────
io.on('connection', socket => {
  console.log('+', socket.id);

  socket.on('create_room', ({ playerName = 'Jugador', difficulty = 1 }) => {
    const name = playerName.slice(0, 20);
    const room = makeRoom(socket.id, name, Number(difficulty));
    socket.join(room.id); playerRooms.set(socket.id, room.id);
    socket.emit('room_created', { roomCode: room.id, playerId: socket.id, playerName: name, difficulty });
  });

  socket.on('join_room', ({ roomCode = '', playerName = 'Jugador' }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);
    if (!room)                    return socket.emit('join_error', { message: 'Sala no encontrada.' });
    if (room.players.length >= 2) return socket.emit('join_error', { message: 'La sala está llena.' });
    if (room.phase !== 'waiting') return socket.emit('join_error', { message: 'La partida ya comenzó.' });
    const name = playerName.slice(0, 20);
    room.players.push({ id: socket.id, name, score: 0, isHost: false });
    socket.join(code); playerRooms.set(socket.id, code);
    socket.emit('room_joined', {
      roomCode: code, playerId: socket.id, playerName: name,
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });
    socket.to(code).emit('player_joined', {
      player: { id: socket.id, name, score: 0 },
      players: room.players.map(p => ({ id: p.id, name: p.name, score: p.score })),
    });
    clearTimeout(room.timer);
    room.timer = setTimeout(() => { if (rooms.has(code)) startAnalysis(room); }, 1800);
  });

  // ── VS CPU ──
  socket.on('start_vs_cpu', ({ playerName = 'Jugador', difficulty = 1 }) => {
    const name = playerName.slice(0, 20);
    const room = makeRoom(socket.id, name, Number(difficulty), false, true);
    room.cpuScore = 0;
    room.players.push({ id: 'cpu', name: 'CPU ♟', score: 0, isCpu: true });
    socket.join(room.id); playerRooms.set(socket.id, room.id);
    socket.emit('cpu_game_started', { roomCode: room.id, playerName: name, difficulty });
    setTimeout(() => { if (rooms.has(room.id)) startAnalysis(room); }, 1200);
  });

  // ── SUBMIT BID ──
  socket.on('submit_bid', ({ bid }) => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || room.phase !== 'analyzing') return;
    const b = Math.max(1, Math.min(20, parseInt(bid) || 5));
    room.round.bids[socket.id] = b;
    socket.emit('bid_confirmed', { bid: b });
    socket.to(room.id).emit('opponent_bid_in');
    if (room.players.every(p => room.round.bids[p.id] !== undefined) &&
        (!room.isCpu || room.round.bids['cpu'] !== undefined)) {
      clearTimers(room); revealBids(room);
    }
  });

  // ── MAKE MOVE ──
  socket.on('make_move', ({ fromIdx, toIdx }) => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || !['playing','stealing'].includes(room.phase)) return;
    if (room.round.activePlayerId !== socket.id) return;
    const board = room.round.boardState;
    if (!board[fromIdx] || !GL.getValidMoves(board, fromIdx).includes(toIdx)) {
      return socket.emit('move_invalid', { reason: 'Movimiento inválido.' });
    }
    board[toIdx] = board[fromIdx]; board[fromIdx] = null;
    room.round.moveCount++;
    handleMoveResult(room, socket, board, room.round.moveCount);
  });

  // ── APPLY TRANSFORM ──
  // rot90/mirH/mirV = +1 move · rot180 = +2 moves
  socket.on('apply_transform', ({ type }) => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || !['playing','stealing'].includes(room.phase)) return;
    if (room.round.activePlayerId !== socket.id) return;
    if (!['rot90','rot180','mirH','mirV'].includes(type)) return;
    if (room.difficulty < 2) return socket.emit('error', { message: 'No disponible en Nivel 1.' });
    if (room.difficulty < 3 && (type === 'mirH' || type === 'mirV'))
      return socket.emit('error', { message: 'Espejos disponibles desde Nivel 3.' });

    const cost = type === 'rot180' ? 2 : 1;
    const nb = GL.applyTransform(room.round.boardState, type);
    room.round.boardState = nb;
    room.round.moveCount += cost;
    handleMoveResult(room, socket, nb, room.round.moveCount);
  });

  // ── SOLO ──
  socket.on('start_solo', ({ difficulty = 1, playerName = 'Jugador' }) => {
    const room = makeRoom(socket.id, playerName.slice(0,20), Number(difficulty), true);
    socket.join(room.id); playerRooms.set(socket.id, room.id);
    socket.emit('solo_started', { roomCode: room.id, difficulty: Number(difficulty) });
    soloStart(socket, room);
  });

  socket.on('solo_move', ({ fromIdx, toIdx }) => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || room.phase !== 'solo_playing') return;
    const board = room.round.boardState;
    if (!board[fromIdx] || !GL.getValidMoves(board, fromIdx).includes(toIdx)) return;
    board[toIdx] = board[fromIdx]; board[fromIdx] = null;
    room.round.moveCount++;
    const won = GL.checkWin(board, room.currentPuzzle.goal);
    socket.emit('solo_update', { boardState: [...board], moveCount: room.round.moveCount, won, minMoves: room.currentPuzzle.minMoves });
  });

  socket.on('solo_transform', ({ type }) => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || room.phase !== 'solo_playing') return;
    if (!['rot90','rot180','mirH','mirV'].includes(type)) return;
    if (room.difficulty < 2) return;
    if (room.difficulty < 3 && (type === 'mirH' || type === 'mirV')) return;
    const cost = type === 'rot180' ? 2 : 1;
    const nb = GL.applyTransform(room.round.boardState, type);
    room.round.boardState = nb;
    room.round.moveCount += cost;
    const won = GL.checkWin(nb, room.currentPuzzle.goal);
    socket.emit('solo_update', { boardState: [...nb], moveCount: room.round.moveCount, won, minMoves: room.currentPuzzle.minMoves });
  });

  socket.on('solo_reset', () => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room || room.phase !== 'solo_playing') return;
    room.round.boardState = [...room.currentPuzzle.start];
    room.round.moveCount = 0;
    socket.emit('solo_update', { boardState: [...room.currentPuzzle.start], moveCount: 0, won: false, minMoves: room.currentPuzzle.minMoves });
  });

  socket.on('solo_next', () => {
    const room = rooms.get(playerRooms.get(socket.id));
    if (!room) return;
    soloStart(socket, room);
  });

  socket.on('disconnect', () => {
    const code = playerRooms.get(socket.id);
    if (code) {
      const room = rooms.get(code);
      if (room) {
        socket.to(code).emit('opponent_disconnected');
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) { clearTimers(room); rooms.delete(code); }
      }
      playerRooms.delete(socket.id);
    }
    console.log('-', socket.id);
  });
});

server.listen(PORT, () => console.log(`♟  The Royal Study → http://localhost:${PORT}`));
