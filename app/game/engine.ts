import {
  BoardState,
  ChessPieceType,
  CheckersRules,
  COLOR_LABELS,
  Coord,
  DEFAULT_TEAM_ASSIGNMENTS,
  GameKind,
  GameMode,
  GameState,
  Move,
  MoveRecord,
  Piece,
  PieceType,
  PlayerColor,
  PLAYER_COLORS,
  SeatMap,
  TeamAssignments,
  TEAM_LABELS,
  UndoFrame,
} from "./types";
import {
  areAllies,
  isPlayableSquare,
  sameSquare,
  squareKey,
  squareName,
  teamOf,
} from "./board";
import {
  DEFAULT_CHECKERS_RULES,
  createInitialCheckersBoard,
  getAllCheckersLegalMoves,
  getCheckersLegalMovesForPiece,
  isCheckersPromotionSquare,
} from "./checkers";

export {
  areAllies,
  BOARD_SIZE,
  isPlayableSquare,
  sameSquare,
  squareKey,
  squareName,
  teamOf,
} from "./board";

export { playerAppearance } from "./board";

const MAX_UNDO_FRAMES = 8;

const BACK_RANK: ChessPieceType[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

const REVERSED_BACK_RANK: ChessPieceType[] = [
  "rook",
  "knight",
  "bishop",
  "king",
  "queen",
  "bishop",
  "knight",
  "rook",
];

const ORTHOGONAL_DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

const DIAGONAL_DIRECTIONS = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
] as const;

const KNIGHT_OFFSETS = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
] as const;

function placePiece(
  board: BoardState,
  color: PlayerColor,
  type: PieceType,
  row: number,
  col: number,
): void {
  board[`${row},${col}`] = {
    id: `${color}-${type}-${row}-${col}`,
    color,
    type,
    hasMoved: false,
  };
}

export function createInitialBoard(): BoardState {
  const board: BoardState = {};

  BACK_RANK.forEach((type, index) => {
    const axis = index + 3;
    placePiece(board, "red", type, 13, axis);
    placePiece(board, "blue", type, axis, 0);
  });

  REVERSED_BACK_RANK.forEach((type, index) => {
    const axis = index + 3;
    placePiece(board, "yellow", type, 0, axis);
    placePiece(board, "green", type, axis, 13);
  });

  for (let axis = 3; axis <= 10; axis += 1) {
    placePiece(board, "red", "pawn", 12, axis);
    placePiece(board, "yellow", "pawn", 1, axis);
    placePiece(board, "blue", "pawn", axis, 1);
    placePiece(board, "green", "pawn", axis, 12);
  }

  return board;
}

export function createSeats(localName = "You"): SeatMap {
  return {
    red: { color: "red", controller: "human", name: localName },
    blue: { color: "blue", controller: "computer", name: "Computer Blue" },
    yellow: { color: "yellow", controller: "open", name: "Open seat" },
    green: { color: "green", controller: "computer", name: "Computer Green" },
  };
}

export function createGameState(
  roomCode: string,
  mode: GameMode = "teams",
  localName = "You",
  gameKind: GameKind = "chess",
): GameState {
  const state: GameState = {
    schemaVersion: 3,
    ruleset:
      gameKind === "checkers"
        ? "crossboard-checkers-v1"
        : "crossboard-capture-v1",
    gameKind,
    roomCode,
    mode,
    teamAssignments: { ...DEFAULT_TEAM_ASSIGNMENTS },
    checkersRules: { ...DEFAULT_CHECKERS_RULES },
    phase: "lobby",
    board: {},
    seats: createSeats(localName),
    turn: "red",
    revision: 0,
    round: 1,
    history: [],
    eliminated: [],
    winners: null,
    continuationFrom: null,
    pendingCapturedSquares: [],
    undoStack: [],
    lastActionId: `room-${roomCode}`,
    parentHash: "genesis",
    stateHash: "",
    lineage: [],
  };
  return { ...state, stateHash: calculateStateHash(state) };
}

export function startGame(state: GameState): GameState {
  if (PLAYER_COLORS.some((color) => state.seats[color].controller === "open")) {
    return state;
  }
  if (
    state.mode === "teams" &&
    new Set(
      PLAYER_COLORS.map((color) =>
        teamOf(color, state.teamAssignments),
      ),
    ).size < 2
  ) {
    return state;
  }
  return stampState(state, {
    ...state,
    phase: "playing",
    board:
      gameKindOf(state) === "checkers"
        ? createInitialCheckersBoard()
        : createInitialBoard(),
    turn: "red",
    revision: state.revision + 1,
    round: 1,
    history: [],
    eliminated: [],
    winners: null,
    continuationFrom: null,
    pendingCapturedSquares: [],
    undoStack: [],
    lastActionId: `start-${state.revision + 1}`,
  });
}

export function gameKindOf(state: GameState): GameKind {
  return state.gameKind ??
    (state.ruleset === "crossboard-checkers-v1" ? "checkers" : "chess");
}

function canLandOn(state: GameState, piece: Piece, coord: Coord): boolean {
  if (!isPlayableSquare(coord.row, coord.col)) {
    return false;
  }
  const occupant = state.board[squareKey(coord)];
  return (
    !occupant ||
    !areAllies(
      piece.color,
      occupant.color,
      state.mode,
      state.teamAssignments,
    )
  );
}

function rayMoves(
  state: GameState,
  piece: Piece,
  from: Coord,
  directions: readonly (readonly [number, number])[],
): Move[] {
  const moves: Move[] = [];
  for (const [rowStep, colStep] of directions) {
    let row = from.row + rowStep;
    let col = from.col + colStep;
    while (isPlayableSquare(row, col)) {
      const to = { row, col };
      const occupant = state.board[squareKey(to)];
      if (!occupant) {
        moves.push({ from, to });
      } else {
        if (
          !areAllies(
            piece.color,
            occupant.color,
            state.mode,
            state.teamAssignments,
          )
        ) {
          moves.push({ from, to });
        }
        break;
      }
      row += rowStep;
      col += colStep;
    }
  }
  return moves;
}

function pawnVector(color: PlayerColor): readonly [number, number] {
  switch (color) {
    case "red":
      return [-1, 0];
    case "yellow":
      return [1, 0];
    case "blue":
      return [0, 1];
    case "green":
      return [0, -1];
  }
}

function pawnMoves(state: GameState, piece: Piece, from: Coord): Move[] {
  const moves: Move[] = [];
  const [rowStep, colStep] = pawnVector(piece.color);
  const one = { row: from.row + rowStep, col: from.col + colStep };
  if (isPlayableSquare(one.row, one.col) && !state.board[squareKey(one)]) {
    moves.push({ from, to: one });
    const two = { row: from.row + rowStep * 2, col: from.col + colStep * 2 };
    if (
      !piece.hasMoved &&
      isPlayableSquare(two.row, two.col) &&
      !state.board[squareKey(two)]
    ) {
      moves.push({ from, to: two });
    }
  }

  const captureOffsets: readonly (readonly [number, number])[] =
    rowStep === 0
      ? [
          [-1, colStep],
          [1, colStep],
        ]
      : [
          [rowStep, -1],
          [rowStep, 1],
        ];

  for (const [captureRow, captureCol] of captureOffsets) {
    const to = { row: from.row + captureRow, col: from.col + captureCol };
    if (!isPlayableSquare(to.row, to.col)) {
      continue;
    }
    const occupant = state.board[squareKey(to)];
    if (
      occupant &&
      !areAllies(
        piece.color,
        occupant.color,
        state.mode,
        state.teamAssignments,
      )
    ) {
      moves.push({ from, to });
    }
  }
  return moves;
}

export function getLegalMovesForPiece(state: GameState, from: Coord): Move[] {
  if (gameKindOf(state) === "checkers") {
    return getCheckersLegalMovesForPiece(state, from);
  }
  const piece = state.board[squareKey(from)];
  if (!piece || state.eliminated.includes(piece.color)) {
    return [];
  }

  switch (piece.type) {
    case "pawn":
      return pawnMoves(state, piece, from);
    case "rook":
      return rayMoves(state, piece, from, ORTHOGONAL_DIRECTIONS);
    case "bishop":
      return rayMoves(state, piece, from, DIAGONAL_DIRECTIONS);
    case "queen":
      return rayMoves(state, piece, from, [
        ...ORTHOGONAL_DIRECTIONS,
        ...DIAGONAL_DIRECTIONS,
      ]);
    case "knight":
      return KNIGHT_OFFSETS.map(([rowStep, colStep]) => ({
        from,
        to: { row: from.row + rowStep, col: from.col + colStep },
      })).filter((move) => canLandOn(state, piece, move.to));
    case "king":
      return [...ORTHOGONAL_DIRECTIONS, ...DIAGONAL_DIRECTIONS]
        .map(([rowStep, colStep]) => ({
          from,
          to: { row: from.row + rowStep, col: from.col + colStep },
        }))
        .filter((move) => canLandOn(state, piece, move.to));
    case "man":
    case "crowned":
      return [];
  }
}

export function getAllLegalMoves(state: GameState, color: PlayerColor): Move[] {
  if (gameKindOf(state) === "checkers") {
    return getAllCheckersLegalMoves(state, color);
  }
  if (state.eliminated.includes(color)) {
    return [];
  }
  const moves: Move[] = [];
  for (const [key, piece] of Object.entries(state.board)) {
    if (piece.color !== color) {
      continue;
    }
    const [row, col] = key.split(",").map(Number);
    moves.push(...getLegalMovesForPiece(state, { row, col }));
  }
  return moves;
}

export function isPromotionSquare(color: PlayerColor, coord: Coord): boolean {
  switch (color) {
    case "red":
      return coord.row <= 3;
    case "yellow":
      return coord.row >= 10;
    case "blue":
      return coord.col >= 10;
    case "green":
      return coord.col <= 3;
  }
}

export function nextActiveColor(
  current: PlayerColor,
  eliminated: PlayerColor[],
): PlayerColor {
  const start = PLAYER_COLORS.indexOf(current);
  for (let step = 1; step <= PLAYER_COLORS.length; step += 1) {
    const candidate = PLAYER_COLORS[(start + step) % PLAYER_COLORS.length];
    if (!eliminated.includes(candidate)) {
      return candidate;
    }
  }
  return current;
}

function determineWinners(
  mode: GameMode,
  eliminated: PlayerColor[],
  teamAssignments: TeamAssignments,
): PlayerColor[] | null {
  const active = PLAYER_COLORS.filter((color) => !eliminated.includes(color));
  if (mode === "ffa") {
    return active.length <= 1 ? active : null;
  }
  const activeTeams = new Set(
    active.map((color) => teamOf(color, teamAssignments)),
  );
  if (activeTeams.size !== 1) {
    return null;
  }
  const winningTeam = [...activeTeams][0];
  return PLAYER_COLORS.filter(
    (color) => teamOf(color, teamAssignments) === winningTeam,
  );
}

function matchingLegalMove(state: GameState, move: Move): Move | undefined {
  return getLegalMovesForPiece(state, move.from).find((candidate) =>
    sameSquare(candidate.to, move.to),
  );
}

function appendUndoFrame(
  state: GameState,
  actor: PlayerColor,
): UndoFrame[] {
  const frame: UndoFrame = {
    actor,
    phase: state.phase,
    board: { ...state.board },
    turn: state.turn,
    round: state.round,
    historyLength: state.history.length,
    eliminated: [...state.eliminated],
    winners: state.winners ? [...state.winners] : null,
    continuationFrom: state.continuationFrom
      ? { ...state.continuationFrom }
      : null,
    pendingCapturedSquares: state.pendingCapturedSquares.map((square) => ({
      ...square,
    })),
  };
  return [...(state.undoStack ?? []), frame].slice(-MAX_UNDO_FRAMES);
}

function undoStackAfterMove(
  state: GameState,
  actor: PlayerColor,
  recordUndo: boolean,
  beginsTurn = true,
): UndoFrame[] | undefined {
  if (!recordUndo) {
    return [];
  }
  if (state.seats[actor].controller !== "human" || !beginsTurn) {
    return state.undoStack;
  }
  return appendUndoFrame(state, actor);
}

function applyChessMove(
  state: GameState,
  move: Move,
  recordUndo: boolean,
): GameState {
  const movingPiece = state.board[squareKey(move.from)];
  if (
    state.phase !== "playing" ||
    !movingPiece ||
    movingPiece.color !== state.turn ||
    !matchingLegalMove(state, move)
  ) {
    return state;
  }

  const destinationKey = squareKey(move.to);
  const captured = state.board[destinationKey];
  const revision = state.revision + 1;
  const board: BoardState = { ...state.board };
  delete board[squareKey(move.from)];

  const eliminated = [...state.eliminated];
  let eliminatedColor: PlayerColor | undefined;
  if (captured?.type === "king") {
    eliminatedColor = captured.color;
    if (!eliminated.includes(captured.color)) {
      eliminated.push(captured.color);
    }
    for (const [key, piece] of Object.entries(board)) {
      if (piece.color === captured.color) {
        delete board[key];
      }
    }
  }

  const promoted =
    movingPiece.type === "pawn" && isPromotionSquare(movingPiece.color, move.to);
  board[destinationKey] = {
    ...movingPiece,
    type: promoted ? "queen" : movingPiece.type,
    hasMoved: true,
  };

  const nextTurn = nextActiveColor(state.turn, eliminated);
  const wrapped =
    PLAYER_COLORS.indexOf(nextTurn) <= PLAYER_COLORS.indexOf(state.turn);
  const notation = `${squareName(move.from)} ${captured ? "×" : "→"} ${squareName(move.to)}${promoted ? "=Q" : ""}`;
  const record: MoveRecord = {
    ...move,
    id: `${revision}-${movingPiece.color}-${squareKey(move.from)}-${squareKey(move.to)}`,
    revision,
    round: state.round,
    color: movingPiece.color,
    piece: movingPiece.type,
    captured: captured?.type,
    capturedColor: captured?.color,
    eliminated: eliminatedColor,
    eliminatedColors: eliminatedColor ? [eliminatedColor] : undefined,
    notation,
    promotion: promoted ? "queen" : undefined,
  };
  const winners =
    state.mode === "teams" && eliminatedColor
      ? PLAYER_COLORS.filter(
          (color) =>
            teamOf(color, state.teamAssignments) ===
            teamOf(movingPiece.color, state.teamAssignments),
        )
      : determineWinners(
          state.mode,
          eliminated,
          state.teamAssignments,
        );

  return stampState(state, {
    ...state,
    board,
    turn: nextTurn,
    revision,
    round: state.round + (wrapped ? 1 : 0),
    history: [...state.history, record],
    undoStack: undoStackAfterMove(
      state,
      movingPiece.color,
      recordUndo,
    ),
    eliminated,
    winners,
    phase: winners ? "finished" : "playing",
    continuationFrom: null,
    lastActionId: record.id,
  });
}

function applyCheckersMove(
  state: GameState,
  requestedMove: Move,
  recordUndo: boolean,
): GameState {
  const movingPiece = state.board[squareKey(requestedMove.from)];
  const move = matchingLegalMove(state, requestedMove);
  if (
    state.phase !== "playing" ||
    !movingPiece ||
    movingPiece.color !== state.turn ||
    !move
  ) {
    return state;
  }

  const revision = state.revision + 1;
  const board: BoardState = { ...state.board };
  delete board[squareKey(move.from)];

  const deferredCaptureRemoval =
    state.checkersRules.deferredCaptureRemoval;
  const deferredPromotion = state.checkersRules.deferredPromotion;
  const captured = move.capturedSquare
    ? board[squareKey(move.capturedSquare)]
    : undefined;
  if (move.capturedSquare && !deferredCaptureRemoval) {
    delete board[squareKey(move.capturedSquare)];
  }

  const immediatelyPromoted =
    !deferredPromotion &&
    movingPiece.type === "man" &&
    isCheckersPromotionSquare(movingPiece.color, move.to);
  board[squareKey(move.to)] = {
    ...movingPiece,
    type: immediatelyPromoted ? "crowned" : movingPiece.type,
    hasMoved: true,
  };

  const pendingCapturedSquares =
    deferredCaptureRemoval && move.capturedSquare
      ? [...state.pendingCapturedSquares, move.capturedSquare]
      : [];
  const canContinueAfterPromotion =
    !immediatelyPromoted || state.checkersRules.continueAfterCrowning;
  const continuationState: GameState = {
    ...state,
    board,
    continuationFrom: move.to,
    pendingCapturedSquares,
  };
  const continuationMoves =
    move.capturedSquare && canContinueAfterPromotion
      ? getCheckersLegalMovesForPiece(continuationState, move.to)
      : [];
  const continued = continuationMoves.length > 0;

  if (!continued) {
    if (deferredCaptureRemoval) {
      pendingCapturedSquares.forEach((square) => {
        delete board[squareKey(square)];
      });
    }
    const pieceAtDestination = board[squareKey(move.to)];
    if (
      deferredPromotion &&
      pieceAtDestination?.type === "man" &&
      isCheckersPromotionSquare(pieceAtDestination.color, move.to)
    ) {
      board[squareKey(move.to)] = {
        ...pieceAtDestination,
        type: "crowned",
      };
    }
  }

  const promoted =
    movingPiece.type === "man" &&
    board[squareKey(move.to)]?.type === "crowned";
  const eliminated = [...state.eliminated];
  if (!continued) {
    for (const color of PLAYER_COLORS) {
      if (
        !eliminated.includes(color) &&
        !Object.values(board).some((piece) => piece.color === color)
      ) {
        eliminated.push(color);
      }
    }
  }
  const eliminatedColors = eliminated.filter(
    (color) => !state.eliminated.includes(color),
  );
  const eliminatedColor =
    captured &&
    eliminated.includes(captured.color) &&
    !state.eliminated.includes(captured.color)
      ? captured.color
      : undefined;
  const winners = continued
    ? null
    : determineWinners(
        state.mode,
        eliminated,
        state.teamAssignments,
      );
  const nextTurn = continued
    ? state.turn
    : nextActiveColor(state.turn, eliminated);
  const wrapped =
    !continued &&
    PLAYER_COLORS.indexOf(nextTurn) <= PLAYER_COLORS.indexOf(state.turn);
  const notation = `${squareName(move.from)} ${captured ? "×" : "→"} ${squareName(move.to)}${promoted ? "=K" : ""}`;
  const record: MoveRecord = {
    ...move,
    id: `${revision}-${movingPiece.color}-${squareKey(move.from)}-${squareKey(move.to)}`,
    revision,
    round: state.round,
    color: movingPiece.color,
    piece: movingPiece.type,
    captured: captured?.type,
    capturedColor: captured?.color,
    eliminated: eliminatedColor,
    eliminatedColors: eliminatedColors.length
      ? eliminatedColors
      : undefined,
    continued,
    notation,
    promotion: promoted ? "crowned" : undefined,
  };

  return stampState(state, {
    ...state,
    board,
    turn: nextTurn,
    revision,
    round: state.round + (wrapped ? 1 : 0),
    history: [...state.history, record],
    undoStack: undoStackAfterMove(
      state,
      movingPiece.color,
      recordUndo,
      state.continuationFrom === null,
    ),
    eliminated,
    winners,
    phase: winners ? "finished" : "playing",
    continuationFrom: continued ? move.to : null,
    pendingCapturedSquares: continued ? pendingCapturedSquares : [],
    lastActionId: record.id,
  });
}

export function applyMove(
  state: GameState,
  move: Move,
  recordUndo = true,
): GameState {
  return gameKindOf(state) === "checkers"
    ? applyCheckersMove(state, move, recordUndo)
    : applyChessMove(state, move, recordUndo);
}

export function passTurn(state: GameState, color: PlayerColor): GameState {
  if (
    state.phase !== "playing" ||
    state.turn !== color ||
    state.eliminated.includes(color)
  ) {
    return state;
  }

  let board = state.board;
  let eliminated = state.eliminated;
  let winners = state.winners;
  if (gameKindOf(state) === "checkers") {
    if (getAllLegalMoves(state, color).length) {
      return state;
    }
    board = { ...state.board };
    for (const [key, piece] of Object.entries(board)) {
      if (piece.color === color) {
        delete board[key];
      }
    }
    eliminated = state.eliminated.includes(color)
      ? state.eliminated
      : [...state.eliminated, color];
    winners = determineWinners(
      state.mode,
      eliminated,
      state.teamAssignments,
    );
  }

  const nextTurn = nextActiveColor(color, eliminated);
  const revision = state.revision + 1;
  const wrapped =
    PLAYER_COLORS.indexOf(nextTurn) <= PLAYER_COLORS.indexOf(color);
  return stampState(state, {
    ...state,
    board,
    turn: nextTurn,
    revision,
    round: state.round + (wrapped ? 1 : 0),
    eliminated,
    winners,
    phase: winners ? "finished" : "playing",
    continuationFrom: null,
    lastActionId: `pass-${revision}-${color}`,
  });
}

export function getUndoActionCount(state: GameState): number {
  return state.undoStack?.length ? 1 : 0;
}

export function undoLastTurn(state: GameState): GameState {
  if (state.phase === "lobby") {
    return state;
  }
  const stack = state.undoStack ?? [];
  if (!getUndoActionCount(state)) {
    return state;
  }

  const frameIndex = stack.length - 1;
  const frame = stack[frameIndex];
  const revision = state.revision + 1;
  return stampState(state, {
    ...state,
    phase: frame.phase,
    board: { ...frame.board },
    turn: frame.turn,
    revision,
    round: frame.round,
    history: state.history.slice(0, frame.historyLength),
    undoStack: stack.slice(0, frameIndex),
    eliminated: [...frame.eliminated],
    winners: frame.winners ? [...frame.winners] : null,
    continuationFrom: frame.continuationFrom
      ? { ...frame.continuationFrom }
      : null,
    pendingCapturedSquares: (frame.pendingCapturedSquares ?? []).map(
      (square) => ({ ...square }),
    ),
    lastActionId: `undo-${revision}-${frame.actor}`,
  });
}

export function updateLobby(
  state: GameState,
  updates: Partial<
    Pick<
      GameState,
      "mode" | "seats" | "teamAssignments" | "checkersRules"
    >
  >,
  action: string,
): GameState {
  if (state.phase !== "lobby") {
    return state;
  }
  const revision = state.revision + 1;
  return stampState(state, {
    ...state,
    ...updates,
    revision,
    lastActionId: `${action}-${revision}`,
  });
}

export function createPracticeGame(
  mode: GameMode,
  localName = "You",
  gameKind: GameKind = "chess",
): GameState {
  const initial = createGameState("PRACTICE", mode, localName, gameKind);
  const seats = { ...initial.seats };
  PLAYER_COLORS.forEach((color) => {
    if (color !== "red") {
      seats[color] = {
        color,
        controller: "computer",
        name: `Computer ${COLOR_LABELS[color]}`,
      };
    }
  });
  return startGame(
    updateLobby(
      initial,
      {
        mode,
        seats,
      },
      `practice-${gameKind}-${mode}`,
    ),
  );
}

export function describeWinner(state: GameState): string {
  if (!state.winners?.length) {
    return "Game over";
  }
  if (state.mode === "teams") {
    const team = teamOf(state.winners[0], state.teamAssignments);
    return `${TEAM_LABELS[team]} team wins`;
  }
  return `${COLOR_LABELS[state.winners[0]]} wins`;
}

export function getStateSignature(state: GameState): string {
  return `${state.revision}:${state.stateHash}`;
}

function stableBoardPayload(boardState: BoardState) {
  return Object.entries(boardState)
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([square, piece]) => [
      square,
      piece.id,
      piece.color,
      piece.type,
      piece.hasMoved ? 1 : 0,
    ]);
}

function stableSeatsPayload(state: GameState) {
  return PLAYER_COLORS.map((color) => {
    const seat = state.seats[color];
    return [color, seat.controller, seat.name, seat.peerId ?? ""];
  });
}

function legacyHistoryPayload(historyState: MoveRecord[]) {
  return historyState.map((move) => [
    move.id,
    move.revision,
    move.color,
    move.piece,
    move.from.row,
    move.from.col,
    move.to.row,
    move.to.col,
    move.captured ?? "",
    move.eliminated ?? "",
  ]);
}

function legacyStatePayload(state: GameState): string {
  const payload = {
    schemaVersion: (state as unknown as { schemaVersion: number })
      .schemaVersion,
    ruleset: state.ruleset,
    roomCode: state.roomCode,
    mode: state.mode,
    phase: state.phase,
    board: stableBoardPayload(state.board),
    seats: stableSeatsPayload(state),
    turn: state.turn,
    revision: state.revision,
    round: state.round,
    history: legacyHistoryPayload(state.history),
    eliminated: state.eliminated,
    winners: state.winners,
    lastActionId: state.lastActionId,
    parentHash: state.parentHash,
    lineage: state.lineage,
  };
  const undoStack = state.undoStack?.map((frame) => [
    frame.actor,
    frame.phase,
    stableBoardPayload(frame.board),
    frame.turn,
    frame.round,
    frame.historyLength,
    frame.eliminated,
    frame.winners,
  ]);
  return JSON.stringify(
    undoStack === undefined ? payload : { ...payload, undoStack },
  );
}

function stableStatePayload(state: GameState): string {
  const schemaVersion = (
    state as unknown as { schemaVersion: number }
  ).schemaVersion;
  if (schemaVersion < 3) {
    return legacyStatePayload(state);
  }

  const board = stableBoardPayload(state.board);
  const seats = PLAYER_COLORS.map((color) => {
    const seat = state.seats[color];
    return [color, seat.controller, seat.name, seat.peerId ?? ""];
  });
  const history = state.history.map((move) => {
    return [
      move.id,
      move.revision,
      move.round,
      move.color,
      move.piece,
      move.from.row,
      move.from.col,
      move.to.row,
      move.to.col,
      move.captured ?? "",
      move.eliminated ?? "",
      move.eliminatedColors ?? [],
      move.capturedColor ?? "",
      move.capturedSquare?.row ?? "",
      move.capturedSquare?.col ?? "",
      move.promotion ?? "",
      move.continued ? 1 : 0,
      move.notation,
    ];
  });
  const payload = {
    schemaVersion: state.schemaVersion,
    ruleset: state.ruleset,
    gameKind: state.gameKind,
    roomCode: state.roomCode,
    mode: state.mode,
    teamAssignments: state.teamAssignments,
    checkersRules: state.checkersRules,
    phase: state.phase,
    board,
    seats,
    turn: state.turn,
    revision: state.revision,
    round: state.round,
    history,
    eliminated: state.eliminated,
    winners: state.winners,
    continuationFrom: state.continuationFrom,
    pendingCapturedSquares: state.pendingCapturedSquares,
    lastActionId: state.lastActionId,
    parentHash: state.parentHash,
    lineage: state.lineage,
  };
  const undoStack = state.undoStack?.map((frame) => [
    frame.actor,
    frame.phase,
    stableBoardPayload(frame.board),
    frame.turn,
    frame.round,
    frame.historyLength,
    frame.eliminated,
    frame.winners,
    frame.continuationFrom,
    frame.pendingCapturedSquares,
  ]);
  return JSON.stringify(
    undoStack === undefined ? payload : { ...payload, undoStack },
  );
}

export function calculateStateHash(state: GameState): string {
  const input = stableStatePayload(state);
  let first = 2166136261;
  let second = 2246822507;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489909);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function hasCurrentCheckersRules(value: unknown): value is CheckersRules {
  if (!value || typeof value !== "object") {
    return false;
  }
  const rules = value as Record<string, unknown>;
  return (
    typeof rules.preset === "string" &&
    ["american", "international", "house", "custom"].includes(
      rules.preset,
    ) &&
    [
      "flyingKings",
      "backwardCaptures",
      "mandatoryCapture",
      "maximumCapture",
      "continueAfterCrowning",
      "deferredCaptureRemoval",
      "deferredPromotion",
    ].every((field) => typeof rules[field] === "boolean")
  );
}

export function normalizeGameState(value: unknown): GameState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const schemaVersion = candidate.schemaVersion;
  if (
    typeof schemaVersion !== "number" ||
    ![1, 2, 3].includes(schemaVersion)
  ) {
    return null;
  }

  if (schemaVersion === 3) {
    if (
      (candidate.gameKind !== "chess" &&
        candidate.gameKind !== "checkers") ||
      (candidate.ruleset !== "crossboard-capture-v1" &&
        candidate.ruleset !== "crossboard-checkers-v1") ||
      (candidate.gameKind === "chess" &&
        candidate.ruleset !== "crossboard-capture-v1") ||
      (candidate.gameKind === "checkers" &&
        candidate.ruleset !== "crossboard-checkers-v1") ||
      !candidate.teamAssignments ||
      typeof candidate.teamAssignments !== "object" ||
      !hasCurrentCheckersRules(candidate.checkersRules) ||
      !Array.isArray(candidate.pendingCapturedSquares) ||
      !Array.isArray(candidate.undoStack) ||
      !(candidate.undoStack as unknown[]).every(
        (frame) =>
          !!frame &&
          typeof frame === "object" &&
          Array.isArray(
            (frame as { pendingCapturedSquares?: unknown })
              .pendingCapturedSquares,
          ),
      )
    ) {
      return null;
    }
    const current = candidate as unknown as GameState;
    try {
      return calculateStateHash(current) === current.stateHash
        ? current
        : null;
    } catch {
      return null;
    }
  }

  if (
    candidate.ruleset !== "crossboard-capture-v1" ||
    (schemaVersion === 2 && !Array.isArray(candidate.undoStack))
  ) {
    return null;
  }
  const legacy = candidate as unknown as GameState;
  try {
    if (calculateStateHash(legacy) !== legacy.stateHash) {
      return null;
    }
  } catch {
    return null;
  }

  const undoStack =
    schemaVersion === 2
      ? (legacy.undoStack ?? []).map((frame) => ({
          ...frame,
          continuationFrom: null,
          pendingCapturedSquares: [],
        }))
      : [];
  const revision = legacy.revision + 1;
  const migrated: GameState = {
    ...legacy,
    schemaVersion: 3,
    ruleset: "crossboard-capture-v1",
    gameKind: "chess",
    teamAssignments: { ...DEFAULT_TEAM_ASSIGNMENTS },
    checkersRules: { ...DEFAULT_CHECKERS_RULES },
    continuationFrom: null,
    pendingCapturedSquares: [],
    undoStack,
    revision,
    lastActionId: `upgrade-v${schemaVersion}-to-v3-${revision}`,
  };
  return stampState(legacy, migrated);
}

function stampState(previous: GameState, next: GameState): GameState {
  const stamped = {
    ...next,
    parentHash: previous.stateHash,
    stateHash: "",
    lineage: [
      ...previous.lineage,
      {
        revision: previous.revision,
        stateHash: previous.stateHash,
        lastActionId: previous.lastActionId,
      },
    ].slice(-64),
  };
  return { ...stamped, stateHash: calculateStateHash(stamped) };
}
