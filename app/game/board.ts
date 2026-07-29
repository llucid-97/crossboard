import {
  COLOR_LABELS,
  Coord,
  DEFAULT_TEAM_ASSIGNMENTS,
  GameMode,
  PlayerColor,
  PLAYER_COLORS,
  TeamAssignments,
  TeamId,
} from "./types";

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

export const TEAM_SHADE_LABELS: Record<
  TeamId,
  readonly [string, string, string]
> = {
  warm: ["Light red", "Dark red", "Orange"],
  cool: ["Light blue", "Dark blue", "Cyan"],
};

export interface PlayerAppearance {
  label: string;
  paletteClass: string;
  team: TeamId | null;
}

export function teamOf(
  color: PlayerColor,
  assignments: TeamAssignments = DEFAULT_TEAM_ASSIGNMENTS,
): TeamId {
  return assignments[color] ?? DEFAULT_TEAM_ASSIGNMENTS[color];
}

export function areAllies(
  first: PlayerColor,
  second: PlayerColor,
  mode: GameMode,
  assignments: TeamAssignments = DEFAULT_TEAM_ASSIGNMENTS,
): boolean {
  return (
    first === second ||
    (mode === "teams" &&
      teamOf(first, assignments) === teamOf(second, assignments))
  );
}

export function playerAppearance(
  color: PlayerColor,
  mode: GameMode,
  assignments: TeamAssignments = DEFAULT_TEAM_ASSIGNMENTS,
): PlayerAppearance {
  if (mode === "ffa") {
    return {
      label: COLOR_LABELS[color],
      paletteClass: `palette-${color}`,
      team: null,
    };
  }
  const team = teamOf(color, assignments);
  const members = PLAYER_COLORS.filter(
    (candidate) => teamOf(candidate, assignments) === team,
  );
  const shadeIndex = Math.min(2, Math.max(0, members.indexOf(color)));
  return {
    label: TEAM_SHADE_LABELS[team][shadeIndex],
    paletteClass: `palette-${team}-${shadeIndex}`,
    team,
  };
}
