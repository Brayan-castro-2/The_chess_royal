/**
 * gameLogic.js — Shared game logic (Node.js + Browser)
 */
(function (exports) {
  'use strict';

  const PIECE_SYMBOLS = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };
  const PIECE_NAMES   = { K: 'Rey', Q: 'Dama', R: 'Torre', B: 'Alfil', N: 'Caballo' };

  function inBounds(r, c) { return r >= 0 && r < 3 && c >= 0 && c < 3; }
  function toIdx(r, c)    { return r * 3 + c; }
  function fromIdx(i)     { return [Math.floor(i / 3), i % 3]; }

  function getValidMoves(board, idx) {
    const piece = board[idx];
    if (!piece) return [];
    const [r, c] = fromIdx(idx);
    const moves = [];

    if (piece === 'K') {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr, nc = c + dc;
          if (inBounds(nr, nc) && !board[toIdx(nr, nc)]) moves.push(toIdx(nr, nc));
        }
    } else if (piece === 'N') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc) && !board[toIdx(nr, nc)]) moves.push(toIdx(nr, nc));
      }
    } else if (piece === 'R') {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const ni = toIdx(nr, nc);
          if (board[ni]) break;
          moves.push(ni); nr += dr; nc += dc;
        }
      }
    } else if (piece === 'B') {
      for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const ni = toIdx(nr, nc);
          if (board[ni]) break;
          moves.push(ni); nr += dr; nc += dc;
        }
      }
    } else if (piece === 'Q') {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const ni = toIdx(nr, nc);
          if (board[ni]) break;
          moves.push(ni); nr += dr; nc += dc;
        }
      }
    }
    return moves;
  }

  function applyTransform(board, type) {
    const b = [...board];
    const n = Array(9).fill(null);
    if (type === 'rot90') {
      for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / 3), c = i % 3;
        n[c * 3 + (2 - r)] = b[i];
      }
      return n;
    }
    if (type === 'rot-90') {
      for (let i = 0; i < 9; i++) {
        const r = Math.floor(i / 3), c = i % 3;
        n[(2 - c) * 3 + r] = b[i];
      }
      return n;
    }
    if (type === 'rot180') return [...b].reverse();
    if (type === 'mirH') {
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) n[r * 3 + (2 - c)] = b[r * 3 + c];
      return n;
    }
    if (type === 'mirV') {
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) n[(2 - r) * 3 + c] = b[r * 3 + c];
      return n;
    }
    return b;
  }

  function checkWin(board, goal) {
    return board.every((v, i) => v === goal[i]);
  }

  function boardToKey(board) {
    return board.map(p => p || '.').join('');
  }

  function bfsAll(start, maxDist = 9) {
    const startKey = boardToKey(start);
    const visited  = new Map();
    const queue    = [{ board: [...start], dist: 0 }];
    visited.set(startKey, { dist: 0, board: [...start] });
    while (queue.length > 0) {
      const { board, dist } = queue.shift();
      if (dist >= maxDist) continue;
      for (let i = 0; i < 9; i++) {
        if (!board[i]) continue;
        for (const j of getValidMoves(board, i)) {
          const nb = [...board]; nb[j] = nb[i]; nb[i] = null;
          const key = boardToKey(nb);
          if (!visited.has(key)) {
            visited.set(key, { dist: dist + 1, board: [...nb] });
            queue.push({ board: nb, dist: dist + 1 });
          }
        }
      }
    }
    return visited;
  }

  function bfsSolve(start, goal) {
    const goalKey = boardToKey(goal);
    if (boardToKey(start) === goalKey) return 0;
    const visited = new Set([boardToKey(start)]);
    const queue   = [{ board: [...start], dist: 0 }];
    while (queue.length > 0) {
      const { board, dist } = queue.shift();
      if (dist >= 15) continue;
      for (let i = 0; i < 9; i++) {
        if (!board[i]) continue;
        for (const j of getValidMoves(board, i)) {
          const nb = [...board]; nb[j] = nb[i]; nb[i] = null;
          const key = boardToKey(nb);
          if (key === goalKey) return dist + 1;
          if (!visited.has(key)) { visited.add(key); queue.push({ board: nb, dist: dist + 1 }); }
        }
      }
    }
    return -1;
  }

  /** Returns the sequence of {from, to} moves to go from start→goal, or null. */
  function findSolutionPath(start, goal) {
    const goalKey = boardToKey(goal);
    const startKey = boardToKey(start);
    if (startKey === goalKey) return [];
    const prev = new Map();
    const queue = [{ board: [...start], key: startKey }];
    prev.set(startKey, { from: null, move: null });
    while (queue.length > 0) {
      const { board, key } = queue.shift();
      for (let i = 0; i < 9; i++) {
        if (!board[i]) continue;
        for (const j of getValidMoves(board, i)) {
          const nb = [...board]; nb[j] = nb[i]; nb[i] = null;
          const nk = boardToKey(nb);
          if (prev.has(nk)) continue;
          prev.set(nk, { from: key, move: { from: i, to: j } });
          if (nk === goalKey) {
            const path = [];
            let cur = nk;
            while (prev.get(cur).move) { path.unshift(prev.get(cur).move); cur = prev.get(cur).from; }
            return path;
          }
          queue.push({ board: nb, key: nk });
        }
      }
    }
    return null;
  }

  exports.PIECE_SYMBOLS    = PIECE_SYMBOLS;
  exports.PIECE_NAMES      = PIECE_NAMES;
  exports.getValidMoves    = getValidMoves;
  exports.applyTransform   = applyTransform;
  exports.checkWin         = checkWin;
  exports.boardToKey       = boardToKey;
  exports.bfsAll           = bfsAll;
  exports.bfsSolve         = bfsSolve;
  exports.findSolutionPath = findSolutionPath;

})(typeof module !== 'undefined' ? module.exports : (window.GameLogic = {}));
