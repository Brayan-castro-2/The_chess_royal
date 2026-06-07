// localGame.js - Handles Solo and CPU Offline modes
let localTimer = null;
let localTick = null;

function localStartSolo() {
  state.isSolo = true; state.isCpu = false; state.roomCode = null;
  state.phase = 'solo_playing';
  state.puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
  state.boardState = [...state.puzzle.start];
  state.currentGoal = [...state.puzzle.goal];
  state.moveCount = 0;
  
  showScreen('game');
  updateHeader();
  renderBoard(state.boardState, false);
  renderGoal(state.currentGoal);
  setDiffMode(state.difficulty);
  
  setBadge('playing', '▶ Modo Solitario');
  setStatus(`Resuelve en ≤ ${state.puzzle.minMoves} movs.`, 'info');
  updateMoveCounter(0, state.puzzle.minMoves);
  showPanel('move');
}

function localSoloNext() {
  let next = null;
  const map = GL.bfsAll(state.boardState, 9);
  const reachable = Array.from(map.values()).filter(x => x.dist >= 3);
  if (reachable.length > 0) {
    const target = reachable[Math.floor(Math.random() * reachable.length)];
    next = { start: [...state.boardState], goal: [...target.board], minMoves: target.dist };
  } else {
    next = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
  }
  
  state.puzzle = next;
  state.currentGoal = [...next.goal];
  state.moveCount = 0;
  state.lastFrom = null; state.lastTo = null;
  
  renderBoard(state.boardState, false);
  renderGoal(state.currentGoal);
  updateMoveCounter(0, next.minMoves);
  setStatus(`Resuelve en ≤ ${next.minMoves} movs.`, 'info');
}

// ── CPU MODE ──
function localStartCpu() {
  state.isSolo = false; state.isCpu = true; state.roomCode = null;
  state.myId = 'player'; state.cpuScore = 0;
  state.players = [{ id: 'player', name: state.myName, score: 0 }];
  
  setTimeout(localNextCpuRound, 500);
}

function localNextCpuRound() {
  state.puzzle = PUZZLES[Math.floor(Math.random() * PUZZLES.length)];
  state.boardState = [...state.puzzle.start];
  state.currentGoal = [...state.puzzle.goal];
  state.phase = 'analyzing';
  state.bidSubmitted = false;
  state.myBid = 5;
  
  showScreen('game');
  updateHeader();
  renderBoard(state.boardState, false);
  renderGoal(state.currentGoal);
  setDiffMode(state.difficulty);
  
  setBadge('analyzing', '🔍 Analizando');
  setStatus('Estudia el tablero y propón cuántos movimientos necesitas.', 'info');
  
  showPanel('bid');
  q('#bid-value').textContent = state.myBid;
  q('#btn-submit-bid').disabled = false;
  q('#btn-submit-bid').textContent = 'Confirmar predicción';
  showTransformPanel(false);
  
  localStartTimer(35, () => {
    // Timeout in bidding
    if (!state.bidSubmitted) {
      state.myBid = 5; state.bidSubmitted = true;
    }
    localRevealBids();
  });
  showOverlay('analyzing');
}

function localSubmitBid() {
  state.bidSubmitted = true;
  q('#btn-submit-bid').disabled = true;
  q('#btn-submit-bid').textContent = `✓ Enviado: ${state.myBid} movimientos`;
  setStatus(`Predicción de ${state.myBid} movimientos enviada. Esperando a CPU…`, 'info');
  
  setTimeout(() => {
    clearTimeout(localTimer);
    clearInterval(localTick);
    localRevealBids();
  }, 800 + Math.random() * 1000); // CPU responds fast
}

function localRevealBids() {
  state.phase = 'bid_reveal';
  hideOverlay('analyzing');
  
  const pBid = state.myBid;
  // CPU logic: always bids minMoves + 0 to 2
  const cpuBid = state.puzzle.minMoves + Math.floor(Math.random() * 3);
  
  let activeId, activeBid;
  if (pBid < cpuBid) { activeId = 'player'; activeBid = pBid; }
  else if (cpuBid < pBid) { activeId = 'cpu'; activeBid = cpuBid; }
  else {
    activeId = Math.random() < 0.5 ? 'player' : 'cpu';
    activeBid = pBid;
  }
  
  state.activePlayerId = activeId;
  state.activePlayerBid = activeBid;
  
  const bids = { 'player': pBid, 'cpu': cpuBid };
  const names = { 'player': state.myName, 'cpu': 'CPU' };
  
  renderBidReveal(bids, activeId, names);
  setBadge('bid_reveal', '⚔️ Predicciones');
  showOverlay('bids');
  
  setTimeout(() => localStartPlaying(), 4500);
}

function localStartPlaying(isSteal = false) {
  state.phase = isSteal ? 'stealing' : 'playing';
  state.moveCount = 0;
  state.selectedIdx = null; state.legalMoves = [];
  state.lastFrom = null; state.lastTo = null;
  state.boardState = [...state.puzzle.start];
  state.currentGoal = [...state.puzzle.goal];
  
  hideOverlay('bids');
  const myTurn = state.activePlayerId === 'player';
  const name = myTurn ? 'Tú' : 'CPU ♟';
  
  if (isSteal) {
    setBadge('stealing', myTurn ? '⚔️ ¡TU ROBO!' : `⚔️ CPU roba`);
    setStatus(myTurn ? `¡Tu oportunidad! Resuelve en ≤ ${state.activePlayerBid} movs.` : `CPU intenta robar…`, myTurn ? 'danger' : 'info');
  } else {
    setBadge('playing', myTurn ? '▶ Tu turno' : '🤖 CPU jugando');
    setStatus(myTurn ? `Tienes 120s para resolver en ≤ ${state.activePlayerBid} movs.` : `CPU está jugando…`, myTurn ? 'ok' : 'info');
  }
  
  updateMoveCounter(0, state.activePlayerBid);
  showTransformPanel(myTurn);
  showPanel('move');
  renderBoard(state.boardState, false);
  
  if (myTurn) {
    localStartTimer(120, () => {
      // Timeout
      if (!isSteal) {
        state.activePlayerId = 'cpu'; // CPU tries to steal
        setTimeout(() => localStartPlaying(true), 2500);
      } else {
        localEndRound(null);
      }
    });
  } else {
    // CPU plays!
    setTimeout(() => localCpuPlay(isSteal), 1500);
  }
}

function localCpuPlay(isSteal) {
  const path = GL.findSolutionPath([...state.boardState], state.currentGoal);
  if (!path || path.length === 0) { localEndRound(null); return; }
  
  let step = 0;
  const maxSteps = state.activePlayerBid;
  
  function nextMove() {
    if (state.phase !== 'playing' && state.phase !== 'stealing') return;
    if (step >= path.length || step >= maxSteps) {
      if (!GL.checkWin(state.boardState, state.currentGoal)) {
        if (!isSteal) {
          state.activePlayerId = 'player';
          setTimeout(() => localStartPlaying(true), 2500);
        } else {
          localEndRound(null);
        }
      }
      return;
    }
    
    const { from, to } = path[step++];
    state.boardState[to] = state.boardState[from];
    state.boardState[from] = null;
    state.moveCount++;
    state.lastFrom = from; state.lastTo = to;
    
    const won = GL.checkWin(state.boardState, state.currentGoal);
    renderBoard(state.boardState, false);
    updateMoveCounter(state.moveCount, state.activePlayerBid);
    
    if (won) {
      localEndRound('cpu');
    } else {
      setTimeout(nextMove, 900 + Math.random() * 400);
    }
  }
  
  nextMove();
}

function localMakeMove(from, to) {
  if (!isMyTurn()) return;
  state.boardState[to] = state.boardState[from];
  state.boardState[from] = null;
  state.moveCount++;
  state.lastFrom = from; state.lastTo = to;
  
  const won = GL.checkWin(state.boardState, state.currentGoal);
  renderBoard(state.boardState, false);
  updateMoveCounter(state.moveCount, state.activePlayerBid);
  
  if (won) {
    clearTimeout(localTimer); clearInterval(localTick);
    localEndRound('player');
  } else if (state.moveCount >= state.activePlayerBid) {
    clearTimeout(localTimer); clearInterval(localTick);
    if (state.phase === 'stealing') {
      localEndRound(null);
    } else {
      toast('Límite excedido. ¡Robo de CPU!');
      state.activePlayerId = 'cpu';
      setTimeout(() => localStartPlaying(true), 2500);
    }
  }
}

function localEndRound(winnerId) {
  clearTimeout(localTimer); clearInterval(localTick);
  
  if (winnerId === 'player') state.players[0].score++;
  else if (winnerId === 'cpu') state.cpuScore++;
  
  const isWin = winnerId === 'player';
  const name = winnerId === 'cpu' ? 'CPU' : 'Tú';
  
  q('#result-icon').textContent = '';
  q('#result-title').textContent = !winnerId ? 'Sin punto' : isWin ? '¡Lo lograste!' : 'Punto para el rival';
  q('#result-sub').textContent = !winnerId ? 'Nadie resolvió este turno.' : isWin ? `Resolviste en ${state.moveCount} movs.` : `${name} resolvió en ${state.moveCount} movs.`;
  q('#result-moves').textContent = state.moveCount || '—';
  
  q('#res-p1-name').textContent = state.myName;
  q('#res-p1-score').textContent = state.players[0].score;
  q('#res-p2-name').textContent = 'CPU';
  q('#res-p2-score').textContent = state.cpuScore;
  
  showScreen('result');
  
  if (state.players[0].score >= 3 || state.cpuScore >= 3) {
    setTimeout(() => {
      showGameOver(state.players[0].score >= 3 ? 'player' : 'cpu', state.players[0].score >= 3 ? state.myName : 'CPU', [
        { id: 'player', name: state.myName, score: state.players[0].score },
        { id: 'cpu', name: 'CPU', score: state.cpuScore }
      ]);
    }, 4000);
  } else {
    setTimeout(localNextCpuRound, 4000);
  }
}

function localStartTimer(seconds, onTimeout) {
  clearTimeout(localTimer); clearInterval(localTick);
  state.timerMax = seconds; state.timerLeft = seconds;
  updateTimerUI(seconds, seconds);
  
  localTick = setInterval(() => {
    state.timerLeft--;
    updateTimerUI(state.timerLeft, state.timerMax);
    if (state.timerLeft <= 0) {
      clearInterval(localTick);
    }
  }, 1000);
  
  localTimer = setTimeout(onTimeout, seconds * 1000);
}
