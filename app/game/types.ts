export const PLAYER_COLORS = ["red", "blue", "yellow", "green"] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type GameMode = "ffa" | "teams";
export type GamePhase = "lobby" | "playing" | "finished";
export type SeatController = "human" | "open" | "computer";
export type PieceType = "pawn" | "knight" | "bishop" | "rook" | "queen" | "king";

export interface Coord {
  row: number;
  col: number;
}

export interface Piece {
  id: string;
  color: PlayerColor;
  type: PieceType;
  hasMoved: boolean;
}

export interface Move {
  from: Coord;
  to: Coord;
  promotion?: "queen";
}

export interface MoveRecord extends Move {
  id: string;
  revision: number;
  round: number;
  color: PlayerColor;
  piece: PieceType;
  captured?: PieceType;
  capturedColor?: PlayerColor;
  eliminated?: PlayerColor;
  notation: string;
}

export interface Seat {
  color: PlayerColor;
  controller: SeatController;
  name: string;
  peerId?: string;
}

export type SeatMap = Record<PlayerColor, Seat>;
export type BoardState = Record<string, Piece>;

export interface UndoFrame {
  actor: PlayerColor;
  phase: GamePhase;
  board: BoardState;
  turn: PlayerColor;
  round: number;
  historyLength: number;
  eliminated: PlayerColor[];
  winners: PlayerColor[] | null;
}

export interface GameState {
  schemaVersion: 2;
  ruleset: "crossboard-capture-v1";
  roomCode: string;
  mode: GameMode;
  phase: GamePhase;
  board: BoardState;
  seats: SeatMap;
  turn: PlayerColor;
  revision: number;
  round: number;
  history: MoveRecord[];
  undoStack?: UndoFrame[];
  eliminated: PlayerColor[];
  winners: PlayerColor[] | null;
  lastActionId: string;
  parentHash: string;
  stateHash: string;
  lineage: Array<{
    revision: number;
    stateHash: string;
    lastActionId?: string;
  }>;
}

export const COLOR_LABELS: Record<PlayerColor, string> = {
  red: "Red",
  blue: "Blue",
  yellow: "Yellow",
  green: "Green",
};

export const COLOR_SYMBOLS: Record<PlayerColor, string> = {
  red: "●",
  blue: "▲",
  yellow: "◆",
  green: "■",
};

export const PIECE_LABELS: Record<PieceType, string> = {
  pawn: "Pawn",
  knight: "Knight",
  bishop: "Bishop",
  rook: "Rook",
  queen: "Queen",
  king: "King",
};

export const PIECE_GLYPHS: Record<PieceType, string> = {
  pawn: "♟",
  knight: "♞",
  bishop: "♝",
  rook: "♜",
  queen: "♛",
  king: "♚",
};
