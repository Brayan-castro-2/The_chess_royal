/**
 * app.js — The Royal Study client
 * Drag & drop · CPU mode · Transforms · Full game flow
 */
'use strict';

const GL = window.GameLogic;

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
const state = {
  myId: null, myName: 'Jugador',
  roomCode: null, isSolo: false, isCpu: false,
  difficulty: 1,          // room mode: 1=moves only, 2=+rotations, 3=+mirrors
  players: [],
  puzzle: null,
  boardState: Array(9).fill(null),
  phase: 'home',
  selectedIdx: null, legalMoves: [],
  lastFrom: null, lastTo: null,
  moveCount: 0,
  myBid: 5, bidSubmitted: false,
  activePlayerId: null, activePlayerBid: 0,
  timerMax: 35, timerLeft: 35,
  timerInterval: null,
  cpuScore: 0,
};

// Drag state
const drag = { active: false, fromIdx: null, ghost: null };

// ─────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────
const q  = sel => document.querySelector(sel);
const qq = sel => [...document.querySelectorAll(sel)];

function isMyTurn() {
  if (state.isSolo) return state.phase === 'solo_playing';
  return ['playing','stealing'].includes(state.phase) &&
         state.activePlayerId === state.myId;
}

// ─────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────
const socket = io();
socket.on('connect', () => { state.myId = socket.id; });

// ── ROOM ──
socket.on('room_created', ({ roomCode, playerName }) => {
  state.roomCode = roomCode; state.myName = playerName;
  q('#display-room-code').textContent = roomCode;
  q('#slot-host-name').textContent    = playerName;
  showScreen('waiting');
});

socket.on('player_joined', ({ player, players }) => {
  state.players = players;
  updateWaitingSlots(players);
  toast(`${player.name} se unió a la partida!`);
});

socket.on('room_joined', ({ roomCode, playerName, players }) => {
  state.roomCode = roomCode; state.myName = playerName; state.players = players;
  showScreen('game');
  setStatus('Sala unida. El juego comenzará en segundos…', 'info');
});

socket.on('join_error', ({ message }) => showLobbyError(message));

socket.on('opponent_disconnected', () => {
  toast('⚠️ Oponente desconectado'); setStatus('Oponente desconectado.', 'danger'); stopTimer();
});

// ── CPU GAME ──
socket.on('cpu_game_started', ({ playerName, difficulty }) => {
  state.isCpu = true; state.difficulty = difficulty; state.myName = playerName;
  state.cpuScore = 0;
  state.players = [{ id: state.myId, name: playerName, score: 0 }];
  showScreen('game');
  updateHeader();
  setStatus('Preparando partida contra la CPU…', 'info');
});

// ── ANALYSIS PHASE ──
socket.on('phase_analyzing', ({ puzzle, timerSeconds, scores, roomDifficulty }) => {
  state.puzzle      = puzzle;
  state.boardState  = [...puzzle.start];
  state.currentGoal = [...puzzle.goal];
  state.phase       = 'analyzing';
  state.bidSubmitted = false;
  state.myBid       = 1;
  state.difficulty  = roomDifficulty ?? state.difficulty;
  state.players     = scores.filter(p => p.id !== 'cpu');
  state.selectedIdx = null; state.legalMoves = [];
  state.lastFrom = null; state.lastTo = null; state.moveCount = 0;

  if (!state.isSolo) showScreen('game');
  updateHeader();
  renderBoard(state.boardState, false);
  renderGoal(puzzle.goal);
  setDiffMode(state.difficulty);

  setBadge('analyzing', '🔍 Analizando');
  setStatus('Estudia el tablero y propón cuántos movimientos necesitas.', 'info');

  showPanel('bid');
  q('#bid-value').textContent  = state.myBid;
  q('#btn-submit-bid').disabled = false;
  q('#btn-submit-bid').textContent = 'Confirmar predicción';
  showTransformPanel(false);

  startTimer(timerSeconds);
  showOverlay('analyzing');
});

socket.on('bid_confirmed', ({ bid }) => {
  state.myBid = bid;
  q('#btn-submit-bid').disabled = true;
  q('#btn-submit-bid').textContent = `✓ Enviado: ${bid} movimientos`;
  setStatus(`Predicción de ${bid} movimientos enviada. Esperando…`, 'info');
});

socket.on('opponent_bid_in', () => toast('El rival ya hizo su predicción'));

// ── BID REVEAL ──
socket.on('phase_bid_reveal', ({ bids, activePlayerId, activePlayerBid, playerNames }) => {
  state.phase = 'bid_reveal'; state.activePlayerId = activePlayerId; state.activePlayerBid = activePlayerBid;
  stopTimer(); hideOverlay('analyzing');
  renderBidReveal(bids, activePlayerId, playerNames);
  setBadge('bid_reveal', '⚔️ Predicciones');
  showOverlay('bids');
});

// ── PLAYING PHASE ──
socket.on('phase_playing', ({ phase, activePlayerId, activePlayerBid, boardState, timerSeconds, playerNames }) => {
  state.phase          = phase === 'stealing' ? 'stealing' : 'playing';
  state.activePlayerId = activePlayerId;
  state.activePlayerBid = activePlayerBid;
  state.boardState     = [...boardState];
  state.currentGoal    = [...state.puzzle.goal];
  state.moveCount      = 0;
  state.selectedIdx    = null; state.legalMoves = [];
  state.lastFrom       = null; state.lastTo     = null;

  hideOverlay('bids');
  const myTurn  = activePlayerId === state.myId;
  const cpuTurn = activePlayerId === 'cpu';
  const name    = playerNames?.[activePlayerId] || (cpuTurn ? 'CPU ♟' : 'Rival');

  if (phase === 'stealing') {
    setBadge('stealing', myTurn ? '⚔️ ¡TU ROBO!' : `⚔️ ${name} roba`);
    setStatus(myTurn
      ? `¡Tu oportunidad! Resuelve en ≤ ${activePlayerBid} movimientos.`
      : `${name} intenta robar…`, myTurn ? 'danger' : 'info');
  } else {
    setBadge('playing', myTurn ? '▶ Tu turno' : (cpuTurn ? '🤖 CPU jugando' : `▶ ${name}`));
    setStatus(myTurn
      ? `Tu turno. Resuelve en ≤ ${activePlayerBid} movimientos.`
      : (cpuTurn ? '🤖 La CPU está resolviendo…' : `${name} está jugando…`), myTurn ? 'success' : 'info');
  }

  showPanel('move');
  updateMoveCounter(0, activePlayerBid);
  showTransformPanel(myTurn && state.difficulty >= 2);
  renderGoal(state.currentGoal);
  const gb = q('#goal-board'); if(gb) { gb.style.transition = 'none'; gb.style.transform = 'none'; }
  renderBoard(boardState, myTurn);
  if (myTurn) startTimer(timerSeconds);
});

// ── BOARD UPDATE ──
socket.on('board_update', ({ boardState, moveCount, won, exceededBid, currentGoal }) => {
  state.boardState = [...boardState];
  state.moveCount  = moveCount;
  if (currentGoal && !isAnimatingGoal) {
    if (JSON.stringify(state.currentGoal) !== JSON.stringify(currentGoal)) {
      state.currentGoal = [...currentGoal];
      renderGoal(state.currentGoal);
    }
  }
  const myTurn     = isMyTurn();
  renderBoard(boardState, myTurn && !won && !exceededBid);
  updateMoveCounter(moveCount, state.activePlayerBid);
  if (exceededBid && !won) { setStatus('❌ Superaste tu predicción.', 'danger'); addFlash(false); }
  if (won) { addFlash(true); }
});

// ── PLAYING FAILED ──
socket.on('playing_failed', ({ playerId, reason }) => {
  stopTimer();
  const isMe = playerId === state.myId;
  setStatus(isMe ? '❌ Fallaste. El rival puede intentarlo…' : '¡Puedes intentar robar!', isMe ? 'danger' : 'gold');
  renderBoard(state.boardState, false);
  showTransformPanel(false);
  toast(isMe ? 'Fallaste. El rival puede intentar robar…' : '¡Es tu turno de robar!');
});

// ── ROUND END ──
socket.on('round_end', ({ winnerId, winnerName, moveCount, minMoves, scores, gameOver }) => {
  stopTimer();
  state.players = scores.filter(p => p.id !== 'cpu');
  if (state.isCpu) state.cpuScore = (scores.find(p => p.id === 'cpu')?.score) || 0;
  if (!gameOver) showResult({ winnerId, winnerName, moveCount, minMoves, scores });
});

socket.on('game_over', ({ winnerId, winnerName, scores }) => {
  stopTimer(); showGameOver(winnerId, winnerName, scores);
});

// ── SOLO ──
socket.on('solo_started', ({ difficulty }) => {
  state.isSolo = true; state.difficulty = difficulty;
  state.players = [{ id: state.myId, name: state.myName, score: 0 }];
  showScreen('game');
  q('#btn-solo-reset').classList.remove('hidden');
  q('#btn-solo-next').classList.remove('hidden');
  q('#btn-quit-game').classList.remove('hidden');
  q('#p2-name').textContent = '—';
});

socket.on('solo_puzzle', ({ puzzle, completed, roomDifficulty }) => {
  state.puzzle      = puzzle;
  state.boardState  = [...puzzle.start];
  state.currentGoal = [...puzzle.goal];
  state.phase       = 'solo_playing';
  state.difficulty  = roomDifficulty ?? state.difficulty;
  state.selectedIdx = null; state.legalMoves = [];
  state.lastFrom    = null; state.lastTo     = null; state.moveCount = 0;
  state.activePlayerBid = 999;

  renderBoard(state.boardState, true);
  renderGoal(puzzle.goal);
  setDiffMode(state.difficulty);
  showPanel('move');
  updateMoveCounter(0, 999);
  setBadge('playing', '🧩 Solitario');
  setStatus(`¡A resolver!`, 'info');
  showTransformPanel(state.difficulty >= 2);
  stopTimer(); q('#timer-text').textContent = '∞';
  q('#p1-name').textContent = state.myName || 'Tú';
});

socket.on('solo_update', ({ boardState, moveCount, won, minMoves, currentGoal }) => {
  state.boardState = [...boardState];
  state.moveCount  = moveCount;
  if (currentGoal && !isAnimatingGoal) {
    if (JSON.stringify(state.currentGoal) !== JSON.stringify(currentGoal)) {
      state.currentGoal = [...currentGoal];
      renderGoal(state.currentGoal);
    }
  }
  renderBoard(boardState, !won);
  updateMoveCounter(moveCount, 999);
  if (won) {
    addFlash(true);
    const perfect = moveCount === minMoves;
    setStatus(`${perfect?'✨ ¡Perfecto!':'🎉 ¡Resuelto!'} ${moveCount} movimientos.`, 'success');
    toast(perfect ? '✨ ¡Solución perfecta!' : `🎉 Resuelto en ${moveCount}`);
  }
});

socket.on('move_invalid', () => { shakeBoard(); toast('Movimiento no válido'); });
socket.on('error', ({ message }) => toast('⚠️ ' + message));

// ─────────────────────────────────────────────
// BOARD RENDERING
// ─────────────────────────────────────────────
const SYMS = { K:'♚', Q:'♛', R:'♜', B:'♝', N:'♞' };

function renderBoard(board, interactive) {
  const el = q('#game-board');
  el.innerHTML = '';
  board.forEach((piece, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    const cell = document.createElement('div');
    cell.className = `board-cell ${(r+c)%2===0?'light':'dark'}`;
    cell.dataset.idx = i;
    if (i === state.lastFrom)    cell.classList.add('last-from');
    if (i === state.lastTo)      cell.classList.add('last-to');
    if (i === state.selectedIdx) cell.classList.add('selected');
    if (state.legalMoves.includes(i)) cell.classList.add('legal');

    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece';
      span.textContent = SYMS[piece];
      span.title = GL.PIECE_NAMES[piece] || piece;
      if (interactive) {
        span.style.cursor = 'grab';
        span.style.pointerEvents = 'auto';
        span.style.touchAction = 'none';
        span.addEventListener('pointerdown', e => { e.stopPropagation(); startDrag(e, i); });
      }
      cell.appendChild(span);
    }

    if (interactive) {
      cell.style.touchAction = 'none';
      cell.addEventListener('click', () => handleCellClick(i));
    }
    el.appendChild(cell);
  });
}

function renderGoal(goal) {
  const el = q('#goal-board');
  el.innerHTML = '';
  goal.forEach((piece, i) => {
    const r = Math.floor(i/3), c = i%3;
    const cell = document.createElement('div');
    cell.className = `goal-cell ${(r+c)%2===0?'light':'dark'}`;
    if (piece) {
      const span = document.createElement('span');
      span.className = 'piece'; span.textContent = SYMS[piece];
      cell.appendChild(span);
    }
    el.appendChild(cell);
  });
}

// ─────────────────────────────────────────────
// CLICK TO MOVE
// ─────────────────────────────────────────────
function handleCellClick(idx) {
  if (drag.active) return;
  if (!isMyTurn()) return;

  if (state.selectedIdx !== null && state.legalMoves.includes(idx)) {
    performMove(state.selectedIdx, idx);
  } else if (state.boardState[idx]) {
    state.selectedIdx = idx;
    state.legalMoves  = GL.getValidMoves(state.boardState, idx);
    renderBoard(state.boardState, true);
  } else {
    state.selectedIdx = null; state.legalMoves = [];
    renderBoard(state.boardState, true);
  }
}

// ─────────────────────────────────────────────
// DRAG & DROP (pointer events — works mouse + touch)
// ─────────────────────────────────────────────
function startDrag(e, idx) {
  if (drag.active) return;
  if (!isMyTurn()) return;
  if (!state.boardState[idx]) return;
  e.preventDefault();

  state.selectedIdx = idx;
  state.legalMoves  = GL.getValidMoves(state.boardState, idx);
  qq('.board-cell').forEach(c => {
    const i = parseInt(c.dataset.idx);
    c.classList.toggle('selected', i === idx);
    c.classList.toggle('legal', state.legalMoves.includes(i));
    if (i === idx) {
      const pieceSpan = c.querySelector('.piece');
      if (pieceSpan) pieceSpan.style.opacity = '0';
    }
  });

  // Ghost piece
  const ghost = document.createElement('div');
  ghost.className = 'drag-ghost';
  ghost.textContent = SYMS[state.boardState[idx]];
  ghost.style.left = (e.clientX - 38) + 'px';
  ghost.style.top  = (e.clientY - 38) + 'px';
  document.body.appendChild(ghost);

  drag.active  = true;
  drag.fromIdx = idx;
  drag.ghost   = ghost;

  document.addEventListener('pointermove',   onDragMove,   { passive: false });
  document.addEventListener('pointerup',     onDragEnd);
  document.addEventListener('pointercancel', cancelDrag);
}

function onDragMove(e) {
  if (!drag.active || !drag.ghost) return;
  e.preventDefault();
  drag.ghost.style.left = (e.clientX - 38) + 'px';
  drag.ghost.style.top  = (e.clientY - 38) + 'px';

  // Highlight hovered legal cell
  qq('.board-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
  const el   = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.('.board-cell');
  if (cell) {
    const toIdx = parseInt(cell.dataset.idx);
    if (state.legalMoves.includes(toIdx)) cell.classList.add('drag-over');
  }
}

function onDragEnd(e) {
  const startIdx = drag.fromIdx;
  cleanDrag();
  const el   = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest?.('.board-cell');
  if (cell) {
    const toIdx = parseInt(cell.dataset.idx);
    if (state.legalMoves.includes(toIdx)) { performMove(startIdx, toIdx); return; }
    if (toIdx === startIdx) {
      const c = qq('.board-cell')[startIdx];
      if (c) {
        const pieceSpan = c.querySelector('.piece');
        if (pieceSpan) pieceSpan.style.opacity = '1';
      }
      return;
    }
  }
  state.selectedIdx = null; state.legalMoves = [];
  renderBoard(state.boardState, true);
}

function cancelDrag() {
  cleanDrag();
  state.selectedIdx = null; state.legalMoves = [];
  renderBoard(state.boardState, true);
}

function cleanDrag() {
  document.removeEventListener('pointermove',   onDragMove);
  document.removeEventListener('pointerup',     onDragEnd);
  document.removeEventListener('pointercancel', cancelDrag);
  qq('.board-cell.drag-over').forEach(c => c.classList.remove('drag-over'));
  if (drag.ghost) { drag.ghost.remove(); drag.ghost = null; }
  drag.active = false;
  // drag.fromIdx kept for use in onDragEnd, cleared after
}

function performMove(fromIdx, toIdx) {
  state.lastFrom = fromIdx; state.lastTo = toIdx;
  drag.fromIdx   = fromIdx; // keep ref in case cleanDrag already ran
  state.selectedIdx = null; state.legalMoves = [];

  // Optimistic local update
  const nb = [...state.boardState];
  nb[toIdx] = nb[fromIdx]; nb[fromIdx] = null;
  renderBoard(nb, false); // disable while waiting server ack

  if (state.isSolo) socket.emit('solo_move',  { fromIdx, toIdx });
  else              socket.emit('make_move',   { fromIdx, toIdx });
}

// ─────────────────────────────────────────────
// TRANSFORMS
// ─────────────────────────────────────────────
let isAnimatingGoal = false;

function requestTransform(type) {
  if (!isMyTurn() || isAnimatingGoal) return;
  isAnimatingGoal = true;
  const cost = type === 'rot180' ? 2 : 1;

  const ng = GL.applyTransform(state.currentGoal, type);
  const el = q('#goal-board');
  el.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
  if (type === 'rot90') el.style.transform = 'rotate(90deg)';
  else if (type === 'rot180') el.style.transform = 'rotate(180deg)';
  else if (type === 'mirH') el.style.transform = 'scaleX(-1)';
  else if (type === 'mirV') el.style.transform = 'scaleY(-1)';

  setTimeout(() => {
    el.style.transition = 'none';
    el.style.transform = 'none';
    state.currentGoal = ng;
    renderGoal(ng);
    isAnimatingGoal = false;
  }, 400);

  if (state.isSolo) socket.emit('solo_transform', { type });
  else              socket.emit('apply_transform', { type });
  toast(`Objetivo transformado (+${cost} mov.)`);
}

// ─────────────────────────────────────────────
// TIMER
// ─────────────────────────────────────────────
const CIRC = 2 * Math.PI * 20; // r=20

function startTimer(seconds) {
  stopTimer();
  state.timerMax = seconds; state.timerLeft = seconds;
  updateTimerUI(seconds, seconds);
  state.timerInterval = setInterval(() => {
    state.timerLeft--;
    updateTimerUI(state.timerLeft, state.timerMax);
    if (state.timerLeft <= 0) stopTimer();
  }, 1000);
}

function stopTimer() {
  clearInterval(state.timerInterval); state.timerInterval = null;
}

socket.on('timer_tick', ({ seconds }) => {
  state.timerLeft = seconds;
  updateTimerUI(seconds, state.timerMax);
});

function updateTimerUI(left, max) {
  const el = q('#timer-text');
  if(el) el.textContent = Math.max(0, left);
  const frac = Math.max(0, left / max);
  const prog = q('#timer-prog');
  if(prog) {
    prog.style.strokeDashoffset = CIRC * (1 - frac);
    prog.classList.toggle('urgent', left <= 10);
  }
}

// ─────────────────────────────────────────────
// SCORE / HEADER
// ─────────────────────────────────────────────
function updateHeader() {
  const me    = state.players.find(p => p.id === state.myId);
  const other = state.isCpu
    ? { id: 'cpu', name: 'CPU', score: state.cpuScore }
    : state.players.find(p => p.id !== state.myId);

  const p1name = q('#p1-name'); if(p1name) p1name.textContent = (me?.name || 'Tú').slice(0, 12);
  const p2name = q('#p2-name'); if(p2name) p2name.textContent = (other?.name || '—').slice(0, 12);
  renderPips('#p1-pips', me?.score || 0);
  renderPips('#p2-pips', other?.score || 0);
}

function renderPips(sel, score) {
  qq(`${sel} .score-pip`).forEach((pip, i) => {
    pip.classList.toggle('filled', i < score);
  });
}

// ─────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────
function showScreen(name) {
  qq('.screen').forEach(s => s.classList.remove('active'));
  q(`#screen-${name}`)?.classList.add('active');
}

function setBadge(phase, label) {
  const b = q('#phase-badge');
  if(b) { b.textContent = label; b.className = `phase-badge ${phase}`; }
}

function setStatus(msg, type = '') {
  const el = q('#status-msg');
  if(el) { el.textContent = msg; el.className = `status-msg ${type}`; }
}

function showPanel(name) {
  q('#bid-panel')?.classList.add('hidden');
  q('#move-panel')?.classList.add('hidden');
  if (name === 'bid')  q('#bid-panel')?.classList.remove('hidden');
  if (name === 'move') q('#move-panel')?.classList.remove('hidden');
}

function showTransformPanel(show) {
  q('#transform-panel')?.classList.toggle('hidden', !show);
  if (show) {
    // Enable/disable individual buttons based on difficulty
    qq('.btn-transform[data-level="3"]').forEach(b => {
      b.disabled = state.difficulty < 3;
      b.title    = state.difficulty < 3 ? 'Solo disponible en Nivel 3' : '';
    });
  }
}

function showOverlay(name) { q(`#overlay-${name}`)?.classList.add('visible'); }
function hideOverlay(name) { q(`#overlay-${name}`)?.classList.remove('visible'); }

/** Shows game-mode level (1=moves, 2=+rot, 3=+mirror) */
function setDiffMode(diff) {
  const labels = ['', 'Solo movimientos', '+ Rotaciones', '+ Espejos'];
  q('#diff-mode-label').textContent = labels[diff] || '';
  q('#diff-stars').textContent      = '★'.repeat(diff) + '☆'.repeat(3 - diff);
}

function updateMoveCounter(count, bid) {
  q('#move-count').textContent = count;
  const left = bid >= 999 ? '∞' : Math.max(0, bid - count);
  const el   = q('#bid-remaining');
  el.textContent = left;
  el.className = 'bid-remaining ' + (left === '∞' ? 'ok' : left > 2 ? 'ok' : left > 0 ? 'warn' : 'danger');
}

function renderBidReveal(bids, activePlayerId, playerNames) {
  const ids = Object.keys(bids);
  ids.slice(0, 2).forEach((pid, i) => {
    const isActive = pid === activePlayerId;
    const name = playerNames?.[pid] || pid;
    const block = q(`#bid-block-${i}`);
    if (!block) return;
    q(`#bid-name-${i}`).textContent = pid === state.myId ? 'Tú' : name;
    q(`#bid-num-${i}`).textContent  = bids[pid] >= 99 ? '—' : bids[pid];
    block.classList.toggle('winner', isActive);
    q(`#bid-num-${i}`).classList.toggle('winner-num', isActive);
  });
  const isMe   = activePlayerId === state.myId;
  const active = playerNames?.[activePlayerId] || (activePlayerId === 'cpu' ? 'CPU ♟' : activePlayerId);
  q('#bid-reveal-msg').textContent = isMe
    ? `¡Vas primero con ${bids[activePlayerId]} movimientos!`
    : `${active} va primero con ${bids[activePlayerId]} movimientos.`;
}

function showLobbyError(msg) {
  const el = q('#lobby-error');
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function updateWaitingSlots(players) {
  const guest = players.find(p => !p.isHost);
  if (!guest) return;
  const slot = q('#slot-guest');
  slot.classList.add('filled');
  slot.querySelector('.player-slot-icon').textContent = '♚';
  slot.querySelector('.player-slot-name').textContent = guest.name;
}

function addFlash(success) {
  const div = document.createElement('div');
  div.className = 'win-flash';
  if (!success) div.style.background = 'rgba(232,64,64,.12)';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 700);
}

function shakeBoard() {
  const b = q('#game-board');
  b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
}

let toastT;
function toast(msg, ms = 2800) {
  const el = q('#toast');
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('show'), ms);
}

// ─────────────────────────────────────────────
// RESULT & GAME OVER
// ─────────────────────────────────────────────
function showResult({ winnerId, winnerName, moveCount, minMoves, scores }) {
  state.phase = 'round_end';

  // Update header scores
  const meScore    = scores.find(p => p.id === state.myId)?.score || 0;
  const otherScore = state.isCpu
    ? scores.find(p => p.id === 'cpu')?.score || state.cpuScore || 0
    : scores.find(p => p.id !== state.myId)?.score || 0;

  renderPips('#p1-pips', meScore);
  renderPips('#p2-pips', otherScore);

  const isWin = winnerId === state.myId;
  q('#result-icon').textContent  = !winnerId ? '' : isWin ? '' : '';
  q('#result-title').textContent = !winnerId ? 'Sin punto' : isWin ? '¡Lo lograste!' : 'Punto para el rival';
  q('#result-sub').textContent   = !winnerId
    ? 'Nadie resolvió este turno.'
    : isWin
      ? `Resolviste el puzzle en ${moveCount} movimientos.`
      : `${winnerName} resolvió en ${moveCount} movimientos.`;

  q('#result-moves').textContent = moveCount ?? '—';

  const me    = scores.find(p => p.id === state.myId);
  const other = state.isCpu
    ? scores.find(p => p.id === 'cpu') || { name:'CPU', score: state.cpuScore }
    : scores.find(p => p.id !== state.myId);

  q('#res-p1-name').textContent  = me ? me.name : 'Tú';
  q('#res-p1-score').textContent = me ? me.score : 0;
  q('#res-p2-name').textContent  = other ? other.name : 'Rival';
  q('#res-p2-score').textContent = other ? other.score : 0;

  showScreen('result');
}

function showGameOver(winnerId, winnerName, scores) {
  const isMe = winnerId === state.myId;
  q('#gameover-winner-msg').innerHTML = `El ganador es <strong>${isMe ? 'TÚ' : (winnerName || 'CPU')}</strong>`;
  const fs = q('#final-scores'); fs.innerHTML = '';
  scores.forEach(p => {
    const champ = p.id === winnerId;
    const d = document.createElement('div');
    d.className = `final-score-block${champ ? ' winner' : ''}`;
    d.innerHTML = `<div class="final-score-name">${p.id === state.myId ? 'Tú' : p.name}</div>
                   <div class="final-score-val${champ?' winner':''}">${p.score}</div>`;
    fs.appendChild(d);
  });
  showScreen('gameover');
}

// ─────────────────────────────────────────────
// BID CONTROLS
// ─────────────────────────────────────────────
function initBidControls() {
  q('#bid-minus').addEventListener('click', () => {
    if (state.bidSubmitted) return;
    state.myBid = Math.max(1, state.myBid - 1);
    q('#bid-value').textContent = state.myBid;
  });
  q('#bid-plus').addEventListener('click', () => {
    if (state.bidSubmitted) return;
    state.myBid = Math.min(20, state.myBid + 1);
    q('#bid-value').textContent = state.myBid;
  });
  q('#btn-submit-bid').addEventListener('click', () => {
    if (state.bidSubmitted) return;
    state.bidSubmitted = true;
    socket.emit('submit_bid', { bid: state.myBid });
  });
}

// ─────────────────────────────────────────────
// MENU WIRING
// ─────────────────────────────────────────────
function initMenu() {
  let selDiff = 3;

  // Difficulty tabs (used in lobby AND in home solo mode)
  qq('.diff-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qq('.diff-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      selDiff = parseInt(tab.dataset.diff);
      state.difficulty = selDiff;
    });
  });

  // Home → Matchmaking
  q('#btn-find-match').addEventListener('click', () => {
    state.isSolo = false; state.isCpu = false;
    const name = (q('#home-name')?.value?.trim()) || 'Jugador';
    state.myName = name; state.difficulty = selDiff;
    const diffNames = ['Básico', 'Rotaciones', 'Espejos'];
    const lbl = q('#match-diff-label'); if(lbl) lbl.textContent = `Nivel: ${diffNames[selDiff-1]} - Esperando...`;
    showScreen('matching');
    socket.emit('find_match', { playerName: name, difficulty: selDiff });
  });

  q('#btn-cancel-match').addEventListener('click', () => {
    socket.emit('cancel_match');
    showScreen('home');
  });

  // Home → Online (Room creation/join)
  q('#btn-play-online').addEventListener('click', () => {
    state.isSolo = false; state.isCpu = false;
    q('#lobby-error').classList.add('hidden');
    q('#lobby-name').value = state.myName !== 'Jugador' ? state.myName : '';
    showScreen('lobby');
  });

  // Home → Solo
  q('#btn-play-solo').addEventListener('click', () => {
    state.isSolo = true; state.isCpu = false;
    const name = (q('#home-name')?.value?.trim()) || 'Jugador';
    state.myName = name; state.difficulty = selDiff;
    socket.emit('start_solo', { difficulty: selDiff, playerName: name });
  });

  // Home → vs CPU
  q('#btn-play-cpu').addEventListener('click', () => {
    state.isSolo = false; state.isCpu = true;
    const name = (q('#home-name')?.value?.trim()) || 'Jugador';
    state.myName = name; state.difficulty = selDiff;
    socket.emit('start_vs_cpu', { playerName: name, difficulty: selDiff });
  });

  // Home → How to
  q('#btn-how-to').addEventListener('click', () => q('#how-to-overlay').classList.add('visible'));

  // Create room
  q('#btn-create-room').addEventListener('click', () => {
    const name = q('#lobby-name').value.trim() || 'Jugador';
    state.myName = name; state.difficulty = selDiff;
    socket.emit('create_room', { playerName: name, difficulty: selDiff });
  });

  // Join room
  q('#btn-join-room').addEventListener('click', joinRoom);
  q('#join-code').addEventListener('keydown', e => { if (e.key === 'Enter') joinRoom(); });

  function joinRoom() {
    const code = q('#join-code').value.trim();
    const name = q('#lobby-name').value.trim() || 'Jugador';
    if (!code || code.length < 4) return showLobbyError('Código de 4 letras requerido.');
    state.myName = name;
    socket.emit('join_room', { roomCode: code, playerName: name });
  }

  socket.on('match_found', ({ roomCode, players, difficulty, playerId, playerName }) => {
    state.difficulty = difficulty;
    state.myId = playerId;
    state.myName = playerName;
    state.roomCode = roomCode;
    
    const nameInput = q('#lobby-name'); if (nameInput) nameInput.value = playerName;
    const codeDisp = q('#display-room-code'); if (codeDisp) codeDisp.textContent = roomCode;
    
    // Simulate room join UI state so players see the room briefly before the game starts
    showScreen('waiting');
    qq('.player-slot').forEach(s => { s.classList.remove('filled'); s.querySelector('.player-slot-name').textContent = '—'; });
    players.forEach((p, i) => {
      const slot = q(i === 0 ? '#slot-host' : '#slot-guest');
      if (slot) {
        slot.classList.add('filled');
        slot.querySelector('.player-slot-icon').textContent = '';
        slot.querySelector('.player-slot-name').textContent = p.name;
      }
    });
  });

  q('#btn-back-home').addEventListener('click', () => showScreen('home'));

  q('#btn-cancel-wait').addEventListener('click', () => {
    socket.disconnect(); socket.connect(); showScreen('home');
  });

  q('#btn-close-analyzing').addEventListener('click', () => {
    hideOverlay('analyzing');
    renderBoard(state.boardState, false);
  });

  // Solo controls
  q('#btn-solo-reset').addEventListener('click', () => {
    state.selectedIdx = null; state.legalMoves = [];
    socket.emit('solo_reset');
  });
  q('#btn-solo-next').addEventListener('click', () => {
    state.selectedIdx = null; state.legalMoves = [];
    socket.emit('solo_next');
    setStatus('Cargando nuevo puzzle…', 'info');
  });
  q('#btn-quit-game').addEventListener('click', () => {
    socket.disconnect(); socket.connect();
    state.isSolo = false; state.isCpu = false; state.phase = 'home';
    qq('#btn-solo-reset, #btn-solo-next, #btn-quit-game').forEach(b => b.classList.add('hidden'));
    showScreen('home');
  });

  // Game over buttons
  q('#btn-play-again').addEventListener('click', () => {
    socket.disconnect(); socket.connect();
    showScreen('lobby');
    q('#lobby-name').value = state.myName;
  });
  q('#btn-home-from-over').addEventListener('click', () => {
    socket.disconnect(); socket.connect(); showScreen('home');
  });

  // Keyboard Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideOverlay('analyzing'); hideOverlay('bids');
      q('#how-to-overlay').classList.remove('visible');
    }
  });
}

// ─────────────────────────────────────────────
// HOW TO PLAY
// ─────────────────────────────────────────────
window.closeHowTo = () => q('#how-to-overlay').classList.remove('visible');

// ─────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initBidControls();

  // Init timer ring
  const prog = q('#timer-prog');
  if (prog) { prog.style.strokeDasharray = CIRC; prog.style.strokeDashoffset = 0; }

  // Dedup timer_tick listener (declared twice above by mistake)
  // Already handled by single socket.on('timer_tick') at top
});
