import {
  applyMove,
  gameKindOf,
  getAllLegalMoves,
  passTurn,
  squareKey,
  teamOf,
} from "./engine";
import {
  GameState,
  Move,
  PieceType,
  PlayerColor,
  PLAYER_COLORS,
} from "./types";

const PIECE_VALUES: Record<PieceType, number> = {
  pawn: 100,
  knight: 320,
  bishop: 335,
  rook: 510,
  queen: 920,
  king: 20_000,
  man: 100,
  crowned: 320,
};

function deterministicNoise(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 19) - 9;
}

function positionalValue(type: PieceType, row: number, col: number): number {
  const distanceFromCenter = Math.abs(6.5 - row) + Math.abs(6.5 - col);
  if (type === "knight" || type === "bishop") {
    return Math.round((8 - distanceFromCenter) * 3);
  }
  if (type === "pawn" || type === "man") {
    return Math.round((7 - distanceFromCenter) * 0.8);
  }
  if (type === "crowned") {
    return Math.round((8 - distanceFromCenter) * 1.8);
  }
  return 0;
}

function evaluate(state: GameState, perspective: PlayerColor): number {
  if (state.winners) {
    return state.winners.includes(perspective) ? 1_000_000 : -1_000_000;
  }
  if (state.eliminated.includes(perspective)) {
    return -900_000;
  }

  const totals: Record<PlayerColor, number> = {
    red: 0,
    blue: 0,
    yellow: 0,
    green: 0,
  };
  const pendingCaptured = new Set(
    state.pendingCapturedSquares.map(squareKey),
  );

  for (const [key, piece] of Object.entries(state.board)) {
    if (pendingCaptured.has(key)) {
      continue;
    }
    const [row, col] = key.split(",").map(Number);
    totals[piece.color] +=
      PIECE_VALUES[piece.type] + positionalValue(piece.type, row, col);
  }

  if (state.mode === "teams") {
    const ownTeam = teamOf(perspective, state.teamAssignments);
    return PLAYER_COLORS.reduce((score, color) => {
      return (
        score +
        totals[color] *
          (teamOf(color, state.teamAssignments) === ownTeam ? 1 : -1)
      );
    }, 0);
  }

  const opposition = PLAYER_COLORS.filter((color) => color !== perspective);
  const strongestOpponent = Math.max(...opposition.map((color) => totals[color]));
  const remainingOpposition = opposition.reduce(
    (sum, color) => sum + totals[color],
    0,
  );
  return totals[perspective] - strongestOpponent * 0.55 - remainingOpposition * 0.12;
}

function movePriority(state: GameState, move: Move, color: PlayerColor): number {
  const movingPiece = state.board[squareKey(move.from)];
  const captured = state.board[
    squareKey(move.capturedSquare ?? move.to)
  ];
  const captureScore = captured
    ? PIECE_VALUES[captured.type] * 10 - PIECE_VALUES[movingPiece.type]
    : 0;
  const center =
    20 - (Math.abs(6.5 - move.to.row) + Math.abs(6.5 - move.to.col));
  return (
    captureScore +
    center +
    deterministicNoise(
      `${state.roomCode}:${state.revision}:${color}:${squareKey(move.from)}:${squareKey(move.to)}`,
    )
  );
}

function orderedMoves(
  state: GameState,
  color: PlayerColor,
  limit: number,
): Move[] {
  return getAllLegalMoves(state, color)
    .sort(
      (first, second) =>
        movePriority(state, second, color) - movePriority(state, first, color),
    )
    .slice(0, limit);
}

function isFriendlyActor(
  state: GameState,
  actor: PlayerColor,
  perspective: PlayerColor,
): boolean {
  return (
    actor === perspective ||
    (state.mode === "teams" &&
      teamOf(actor, state.teamAssignments) ===
        teamOf(perspective, state.teamAssignments))
  );
}

function search(
  state: GameState,
  depth: number,
  perspective: PlayerColor,
  alpha: number,
  beta: number,
): number {
  if (depth <= 0 || state.phase === "finished") {
    return evaluate(state, perspective);
  }

  const actor = state.turn;
  const branchLimit = depth >= 3 ? 9 : depth === 2 ? 7 : 5;
  const moves = orderedMoves(state, actor, branchLimit);
  if (!moves.length) {
    if (gameKindOf(state) === "checkers") {
      const advanced = passTurn(state, actor);
      if (advanced !== state) {
        return search(
          advanced,
          depth - 1,
          perspective,
          alpha,
          beta,
        );
      }
    }
    return evaluate(state, perspective) - (actor === perspective ? 350 : 0);
  }

  if (isFriendlyActor(state, actor, perspective)) {
    let value = -Infinity;
    for (const move of moves) {
      value = Math.max(
        value,
        search(
          applyMove(state, move, false),
          depth - 1,
          perspective,
          alpha,
          beta,
        ),
      );
      alpha = Math.max(alpha, value);
      if (alpha >= beta) {
        break;
      }
    }
    return value;
  }

  let value = Infinity;
  for (const move of moves) {
    value = Math.min(
      value,
      search(
        applyMove(state, move, false),
        depth - 1,
        perspective,
        alpha,
        beta,
      ),
    );
    beta = Math.min(beta, value);
    if (alpha >= beta) {
      break;
    }
  }
  return value;
}

export function chooseComputerMove(
  state: GameState,
  color: PlayerColor,
): Move | null {
  const moves = orderedMoves(state, color, 18);
  if (!moves.length) {
    return null;
  }

  let bestMove = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const next = applyMove(state, move, false);
    const score =
      search(next, 3, color, -Infinity, Infinity) +
      deterministicNoise(`${next.lastActionId}:${color}`) * 0.7;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}
