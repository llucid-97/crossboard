import { Coord, GameMode, PlayerColor } from "./types";

export const BOARD_SIZE = 14;

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
