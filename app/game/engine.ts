import {
  BoardState,
  COLOR_LABELS,
  Coord,
  GameMode,
  GameState,
  Move,
  MoveRecord,
  Piece,
  PieceType,
  PlayerColor,
  PLAYER_COLORS,
  SeatMap,
  UndoFrame,
} from "./types";

export const BOARD_SIZE = 14;
const MAX_UNDO_FRAMES = 8;

const BACK_RANK: PieceType[] = [
  "rook",
  "knight",
  "bishop",
  "queen",
  "king",
  "bishop",
  "knight",
  "rook",
];

const REVERSED_BACK_RANK: PieceType[] = [
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

export function isPlayableSquare(row: number, col: number): boolean {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return false;
  }
  return (row >= 3 && row <= 10) || (col >= 3 && col <= 10);
}

export function squareKey(coord: Coord): string {
  return `${coord.row},${coord.col}`;
}

export function sameSquare(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

export function squareName(coord: Coord): string {
  return `${String.fromCharCode(97 + coord.col)}${BOARD_SIZE - coord.row}`;
}

export function teamOf(color: PlayerColor): 1 | 2 {
  return color === "red" || color === "yellow" ? 1 : 2;
}

export function areAllies(
  first: PlayerColor,
  second: PlayerColor,
  mode: GameMode,
): boolean {
  return first === second || (mode === "teams" && teamOf(first) === teamOf(second));
}

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
): GameState {
  const state: GameState = {
    schemaVersion: 2,
    ruleset: "crossboard-capture-v1",
    roomCode,
    mode,
    phase: "lobby",
    board: {},
    seats: createSeats(localName),
    turn: "red",
    revision: 0,
    round: 1,
    history: [],
    undoStack: [],
    eliminated: [],
    winners: null,
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
  return stampState(state, {
    ...state,
    phase: "playing",
    board: createInitialBoard(),
    turn: "red",
    revision: state.revision + 1,
    round: 1,
    history: [],
    undoStack: [],
    eliminated: [],
    winners: null,
    lastActionId: `start-${state.revision + 1}`,
  });
}

function canLandOn(state: GameState, piece: Piece, coord: Coord): boolean {
  if (!isPlayableSquare(coord.row, coord.col)) {
    return false;
  }
  const occupant = state.board[squareKey(coord)];
  return !occupant || !areAllies(piece.color, occupant.color, state.mode);
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
        if (!areAllies(piece.color, occupant.color, state.mode)) {
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
    if (occupant && !areAllies(piece.color, occupant.color, state.mode)) {
      moves.push({ from, to });
    }
  }
  return moves;
}

export function getLegalMovesForPiece(state: GameState, from: Coord): Move[] {
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
  }
}

export function getAllLegalMoves(state: GameState, color: PlayerColor): Move[] {
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
): PlayerColor[] | null {
  const active = PLAYER_COLORS.filter((color) => !eliminated.includes(color));
  if (mode === "ffa") {
    return active.length <= 1 ? active : null;
  }
  const activeTeams = new Set(active.map(teamOf));
  if (activeTeams.size !== 1) {
    return null;
  }
  const winningTeam = [...activeTeams][0];
  return PLAYER_COLORS.filter((color) => teamOf(color) === winningTeam);
}

function isMoveLegal(state: GameState, move: Move): boolean {
  return getLegalMovesForPiece(state, move.from).some((candidate) =>
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
  };
  return [...(state.undoStack ?? []), frame].slice(-MAX_UNDO_FRAMES);
}

export function applyMove(
  state: GameState,
  move: Move,
  recordUndo = true,
): GameState {
  const movingPiece = state.board[squareKey(move.from)];
  if (
    state.phase !== "playing" ||
    !movingPiece ||
    movingPiece.color !== state.turn ||
    !isMoveLegal(state, move)
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
    notation,
    promotion: promoted ? "queen" : undefined,
  };
  const winners =
    state.mode === "teams" && eliminatedColor
      ? PLAYER_COLORS.filter(
          (color) => teamOf(color) === teamOf(movingPiece.color),
        )
      : determineWinners(state.mode, eliminated);

  return stampState(state, {
    ...state,
    board,
    turn: nextTurn,
    revision,
    round: state.round + (wrapped ? 1 : 0),
    history: [...state.history, record],
    undoStack: recordUndo
      ? state.seats[movingPiece.color].controller === "human"
        ? appendUndoFrame(state, movingPiece.color)
        : state.undoStack
      : [],
    eliminated,
    winners,
    phase: winners ? "finished" : "playing",
    lastActionId: record.id,
  });
}

export function passTurn(state: GameState, color: PlayerColor): GameState {
  if (
    state.phase !== "playing" ||
    state.turn !== color ||
    state.eliminated.includes(color)
  ) {
    return state;
  }
  const nextTurn = nextActiveColor(color, state.eliminated);
  const revision = state.revision + 1;
  const wrapped =
    PLAYER_COLORS.indexOf(nextTurn) <= PLAYER_COLORS.indexOf(color);
  return stampState(state, {
    ...state,
    turn: nextTurn,
    revision,
    round: state.round + (wrapped ? 1 : 0),
    undoStack:
      state.seats[color].controller === "human"
        ? appendUndoFrame(state, color)
        : state.undoStack,
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
  const actionCount = getUndoActionCount(state);
  if (!actionCount) {
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
    lastActionId: `undo-${revision}-${frame.actor}`,
  });
}

export function updateLobby(
  state: GameState,
  updates: Partial<Pick<GameState, "mode" | "seats">>,
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
): GameState {
  const initial = createGameState("PRACTICE", mode, localName);
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
      `practice-${mode}`,
    ),
  );
}

export function describeWinner(state: GameState): string {
  if (!state.winners?.length) {
    return "Game over";
  }
  if (state.mode === "teams") {
    return `${state.winners.map((color) => COLOR_LABELS[color]).join(" + ")} win`;
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

function stableHistoryPayload(historyState: MoveRecord[]) {
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

function stableStatePayload(state: GameState): string {
  const board = stableBoardPayload(state.board);
  const seats = PLAYER_COLORS.map((color) => {
    const seat = state.seats[color];
    return [color, seat.controller, seat.name, seat.peerId ?? ""];
  });
  const history = stableHistoryPayload(state.history);
  const payload = {
    schemaVersion: state.schemaVersion,
    ruleset: state.ruleset,
    roomCode: state.roomCode,
    mode: state.mode,
    phase: state.phase,
    board,
    seats,
    turn: state.turn,
    revision: state.revision,
    round: state.round,
    history,
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

export function normalizeGameState(value: unknown): GameState | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Omit<GameState, "schemaVersion"> & {
    schemaVersion: number;
  };
  if (
    candidate.ruleset !== "crossboard-capture-v1" ||
    (candidate.schemaVersion !== 1 && candidate.schemaVersion !== 2)
  ) {
    return null;
  }

  try {
    if (calculateStateHash(candidate as GameState) !== candidate.stateHash) {
      return null;
    }
  } catch {
    return null;
  }

  if (candidate.schemaVersion === 2) {
    return Array.isArray(candidate.undoStack)
      ? (candidate as GameState)
      : null;
  }

  const legacy = candidate as unknown as GameState;
  const revision = legacy.revision + 1;
  return stampState(legacy, {
    ...legacy,
    schemaVersion: 2,
    revision,
    undoStack: [],
    lastActionId: `upgrade-${revision}`,
  });
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
