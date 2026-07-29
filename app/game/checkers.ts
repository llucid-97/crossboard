import {
  areAllies,
  BOARD_SIZE,
  isPlayableSquare,
  sameSquare,
  squareKey,
} from "./board";
import {
  BoardState,
  CheckersPreset,
  CheckersRules,
  Coord,
  GameState,
  Move,
  Piece,
  PlayerColor,
} from "./types";

const DIAGONAL_DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

export const CHECKERS_PRESETS: Record<
  Exclude<CheckersPreset, "custom">,
  CheckersRules
> = {
  american: {
    preset: "american",
    flyingKings: false,
    backwardCaptures: false,
    mandatoryCapture: true,
    maximumCapture: false,
    continueAfterCrowning: false,
    deferredCaptureRemoval: false,
    deferredPromotion: false,
  },
  international: {
    preset: "international",
    flyingKings: true,
    backwardCaptures: true,
    mandatoryCapture: true,
    maximumCapture: true,
    continueAfterCrowning: false,
    deferredCaptureRemoval: true,
    deferredPromotion: true,
  },
  house: {
    preset: "house",
    flyingKings: true,
    backwardCaptures: true,
    mandatoryCapture: true,
    maximumCapture: false,
    continueAfterCrowning: true,
    deferredCaptureRemoval: false,
    deferredPromotion: false,
  },
};

export const DEFAULT_CHECKERS_RULES: CheckersRules = {
  ...CHECKERS_PRESETS.house,
};

export function checkersRulesForPreset(
  preset: Exclude<CheckersPreset, "custom">,
): CheckersRules {
  return { ...CHECKERS_PRESETS[preset] };
}

function placeChecker(
  board: BoardState,
  color: PlayerColor,
  row: number,
  col: number,
): void {
  board[squareKey({ row, col })] = {
    id: `${color}-man-${row}-${col}`,
    color,
    type: "man",
    hasMoved: false,
  };
}

export function createInitialCheckersBoard(): BoardState {
  const board: BoardState = {};

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (!isPlayableSquare(row, col) || (row + col) % 2 === 0) {
        continue;
      }
      if (row <= 2) {
        placeChecker(board, "yellow", row, col);
      } else if (row >= 11) {
        placeChecker(board, "red", row, col);
      } else if (col <= 2) {
        placeChecker(board, "blue", row, col);
      } else if (col >= 11) {
        placeChecker(board, "green", row, col);
      }
    }
  }

  return board;
}

function forwardDirections(
  color: PlayerColor,
): readonly (readonly [number, number])[] {
  switch (color) {
    case "red":
      return [
        [-1, -1],
        [-1, 1],
      ];
    case "yellow":
      return [
        [1, -1],
        [1, 1],
      ];
    case "blue":
      return [
        [-1, 1],
        [1, 1],
      ];
    case "green":
      return [
        [-1, -1],
        [1, -1],
      ];
  }
}

export function isCheckersPromotionSquare(
  color: PlayerColor,
  coord: Coord,
): boolean {
  switch (color) {
    case "red":
      return coord.row === 0;
    case "yellow":
      return coord.row === BOARD_SIZE - 1;
    case "blue":
      return coord.col === BOARD_SIZE - 1;
    case "green":
      return coord.col === 0;
  }
}

function simpleMovesForPiece(
  state: GameState,
  piece: Piece,
  from: Coord,
): Move[] {
  const directions =
    piece.type === "crowned"
      ? DIAGONAL_DIRECTIONS
      : forwardDirections(piece.color);
  const moves: Move[] = [];

  for (const [rowStep, colStep] of directions) {
    let row = from.row + rowStep;
    let col = from.col + colStep;
    while (isPlayableSquare(row, col)) {
      const to = { row, col };
      if (state.board[squareKey(to)]) {
        break;
      }
      moves.push({ from, to });
      if (piece.type !== "crowned" || !state.checkersRules.flyingKings) {
        break;
      }
      row += rowStep;
      col += colStep;
    }
  }

  return moves;
}

function isPendingCapture(state: GameState, coord: Coord): boolean {
  return state.pendingCapturedSquares.some((square) =>
    sameSquare(square, coord),
  );
}

export function checkersCapturesForPiece(
  state: GameState,
  from: Coord,
): Move[] {
  const piece = state.board[squareKey(from)];
  if (!piece || (piece.type !== "man" && piece.type !== "crowned")) {
    return [];
  }

  const directions =
    piece.type === "crowned" || state.checkersRules.backwardCaptures
      ? DIAGONAL_DIRECTIONS
      : forwardDirections(piece.color);
  const captures: Move[] = [];

  for (const [rowStep, colStep] of directions) {
    if (piece.type === "crowned" && state.checkersRules.flyingKings) {
      let row = from.row + rowStep;
      let col = from.col + colStep;
      let capturedSquare: Coord | null = null;

      while (isPlayableSquare(row, col)) {
        const current = { row, col };
        const occupant = state.board[squareKey(current)];
        if (!capturedSquare) {
          if (!occupant) {
            row += rowStep;
            col += colStep;
            continue;
          }
          if (isPendingCapture(state, current)) {
            break;
          }
          if (
            areAllies(
              piece.color,
              occupant.color,
              state.mode,
              state.teamAssignments,
            )
          ) {
            break;
          }
          capturedSquare = current;
          row += rowStep;
          col += colStep;
          continue;
        }
        if (occupant) {
          break;
        }
        captures.push({ from, to: current, capturedSquare });
        row += rowStep;
        col += colStep;
      }
      continue;
    }

    const jumped = {
      row: from.row + rowStep,
      col: from.col + colStep,
    };
    const to = {
      row: from.row + rowStep * 2,
      col: from.col + colStep * 2,
    };
    if (
      !isPlayableSquare(jumped.row, jumped.col) ||
      !isPlayableSquare(to.row, to.col) ||
      state.board[squareKey(to)]
    ) {
      continue;
    }
    const occupant = state.board[squareKey(jumped)];
    if (
      occupant &&
      !isPendingCapture(state, jumped) &&
      !areAllies(
        piece.color,
        occupant.color,
        state.mode,
        state.teamAssignments,
      )
    ) {
      captures.push({ from, to, capturedSquare: jumped });
    }
  }

  return captures;
}

function simulateCapture(state: GameState, move: Move): GameState {
  const movingPiece = state.board[squareKey(move.from)];
  if (!movingPiece || !move.capturedSquare) {
    return state;
  }
  const board: BoardState = { ...state.board };
  delete board[squareKey(move.from)];
  const deferredCaptureRemoval =
    state.checkersRules.deferredCaptureRemoval;
  if (!deferredCaptureRemoval) {
    delete board[squareKey(move.capturedSquare)];
  }
  const promoted =
    !state.checkersRules.deferredPromotion &&
    movingPiece.type === "man" &&
    isCheckersPromotionSquare(movingPiece.color, move.to);
  board[squareKey(move.to)] = {
    ...movingPiece,
    type: promoted ? "crowned" : movingPiece.type,
    hasMoved: true,
  };
  return {
    ...state,
    board,
    continuationFrom: move.to,
    pendingCapturedSquares: deferredCaptureRemoval
      ? [...state.pendingCapturedSquares, move.capturedSquare]
      : [],
  };
}

function captureDepth(state: GameState, move: Move): number {
  const movingPiece = state.board[squareKey(move.from)];
  const next = simulateCapture(state, move);
  const nextPiece = next.board[squareKey(move.to)];
  const crownedNow =
    movingPiece?.type === "man" && nextPiece?.type === "crowned";
  if (crownedNow && !state.checkersRules.continueAfterCrowning) {
    return 1;
  }
  const continuations = checkersCapturesForPiece(next, move.to);
  if (!continuations.length) {
    return 1;
  }
  return (
    1 +
    Math.max(
      ...continuations.map((continuation) =>
        captureDepth(next, continuation),
      ),
    )
  );
}

function captureCandidates(
  state: GameState,
  color: PlayerColor,
): Move[] {
  if (state.continuationFrom) {
    const piece = state.board[squareKey(state.continuationFrom)];
    return piece?.color === color
      ? checkersCapturesForPiece(state, state.continuationFrom)
      : [];
  }

  return Object.entries(state.board).flatMap(([key, piece]) => {
    if (piece.color !== color) {
      return [];
    }
    const [row, col] = key.split(",").map(Number);
    return checkersCapturesForPiece(state, { row, col });
  });
}

function maximumCaptures(state: GameState, captures: Move[]): Move[] {
  if (!state.checkersRules.maximumCapture || captures.length < 2) {
    return captures;
  }
  const depths = captures.map((move) => captureDepth(state, move));
  const maximum = Math.max(...depths);
  return captures.filter((_, index) => depths[index] === maximum);
}

export function getCheckersLegalMovesForPiece(
  state: GameState,
  from: Coord,
): Move[] {
  const piece = state.board[squareKey(from)];
  if (
    !piece ||
    piece.color !== state.turn ||
    state.eliminated.includes(piece.color) ||
    (piece.type !== "man" && piece.type !== "crowned")
  ) {
    return [];
  }
  if (state.continuationFrom && !sameSquare(state.continuationFrom, from)) {
    return [];
  }

  const allCaptures = captureCandidates(state, piece.color);
  if (state.continuationFrom || (state.checkersRules.mandatoryCapture && allCaptures.length)) {
    return maximumCaptures(state, allCaptures).filter((move) =>
      sameSquare(move.from, from),
    );
  }

  return [
    ...simpleMovesForPiece(state, piece, from),
    ...checkersCapturesForPiece(state, from),
  ];
}

export function getAllCheckersLegalMoves(
  state: GameState,
  color: PlayerColor,
): Move[] {
  if (state.eliminated.includes(color) || color !== state.turn) {
    return [];
  }

  const captures = captureCandidates(state, color);
  if (state.continuationFrom || (state.checkersRules.mandatoryCapture && captures.length)) {
    return maximumCaptures(state, captures);
  }

  return Object.entries(state.board).flatMap(([key, piece]) => {
    if (piece.color !== color) {
      return [];
    }
    const [row, col] = key.split(",").map(Number);
    return [
      ...simpleMovesForPiece(state, piece, { row, col }),
      ...checkersCapturesForPiece(state, { row, col }),
    ];
  });
}
