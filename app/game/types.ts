export const PLAYER_COLORS = ["red", "blue", "yellow", "green"] as const;

export type PlayerColor = (typeof PLAYER_COLORS)[number];
export type GameKind = "chess" | "checkers";
export type GameMode = "ffa" | "teams";
export type TeamId = "warm" | "cool";
export type TeamAssignments = Record<PlayerColor, TeamId>;
export type GamePhase = "lobby" | "playing" | "finished";
export type SeatController = "human" | "open" | "computer";
export type PlayerId = string;
export type ChessPieceType =
  | "pawn"
  | "knight"
  | "bishop"
  | "rook"
  | "queen"
  | "king";
export type CheckersPieceType = "man" | "crowned";
export type PieceType = ChessPieceType | CheckersPieceType;
export type CheckersPreset =
  | "american"
  | "international"
  | "house"
  | "custom";

export interface CheckersRules {
  preset: CheckersPreset;
  flyingKings: boolean;
  backwardCaptures: boolean;
  mandatoryCapture: boolean;
  maximumCapture: boolean;
  continueAfterCrowning: boolean;
  deferredCaptureRemoval: boolean;
  deferredPromotion: boolean;
}

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
  capturedSquare?: Coord;
  promotion?: "queen" | "crowned";
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
  eliminatedColors?: PlayerColor[];
  continued?: boolean;
  notation: string;
}

export interface Seat {
  color: PlayerColor;
  controller: SeatController;
  name: string;
  peerId?: string;
  playerId?: PlayerId;
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
  continuationFrom: Coord | null;
  pendingCapturedSquares: Coord[];
}

export const DEFAULT_TEAM_ASSIGNMENTS: TeamAssignments = {
  red: "warm",
  blue: "cool",
  yellow: "warm",
  green: "cool",
};

export interface GameState {
  schemaVersion: 4;
  ruleset: "crossboard-capture-v1" | "crossboard-checkers-v1";
  gameKind: GameKind;
  roomCode: string;
  mode: GameMode;
  teamAssignments: TeamAssignments;
  checkersRules: CheckersRules;
  phase: GamePhase;
  board: BoardState;
  seats: SeatMap;
  turn: PlayerColor;
  revision: number;
  round: number;
  history: MoveRecord[];
  eliminated: PlayerColor[];
  winners: PlayerColor[] | null;
  continuationFrom: Coord | null;
  pendingCapturedSquares: Coord[];
  undoStack?: UndoFrame[];
  lastActionId: string;
  parentHash: string;
  stateHash: string;
  lineage: Array<{
    revision: number;
    stateHash: string;
    lastActionId?: string;
  }>;
}

export const PLAYER_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const PLAYER_ID_PATTERN =
  /^CB-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/;

export function isPlayerId(value: unknown): value is PlayerId {
  return typeof value === "string" && PLAYER_ID_PATTERN.test(value);
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

export const POSITION_LABELS: Record<PlayerColor, string> = {
  red: "South",
  blue: "West",
  yellow: "North",
  green: "East",
};

export const TEAM_LABELS: Record<TeamId, string> = {
  warm: "Warm",
  cool: "Cool",
};

export const PIECE_LABELS: Record<PieceType, string> = {
  pawn: "Pawn",
  knight: "Knight",
  bishop: "Bishop",
  rook: "Rook",
  queen: "Queen",
  king: "King",
  man: "Checker",
  crowned: "King",
};

export const PIECE_GLYPHS: Record<PieceType, string> = {
  pawn: "♟",
  knight: "♞",
  bishop: "♝",
  rook: "♜",
  queen: "♛",
  king: "♚",
  man: "●",
  crowned: "♛",
};
