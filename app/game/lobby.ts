import { teamOf } from "./board";
import { updateLobby } from "./engine";
import {
  COLOR_LABELS,
  GameState,
  PlayerColor,
  PLAYER_COLORS,
  TeamId,
} from "./types";

interface CurrentGameRef {
  current: GameState | null;
}

export function runLobbyCommand(
  gameRef: CurrentGameRef,
  commit: (next: GameState) => void,
  command: (current: GameState) => GameState,
): GameState | null {
  const current = gameRef.current;
  if (!current || current.phase !== "lobby") {
    return null;
  }
  const next = command(current);
  if (next !== current) {
    commit(next);
  }
  return next;
}

export function configureFriendsVsComputers(
  state: GameState,
  localColor: PlayerColor,
  allowOpenTeammate: boolean,
): GameState {
  const opposite =
    localColor === "red"
      ? "yellow"
      : localColor === "yellow"
        ? "red"
        : localColor === "blue"
          ? "green"
          : "blue";
  const seats = { ...state.seats };
  const localTeam = teamOf(localColor, state.teamAssignments);
  const otherTeam: TeamId = localTeam === "warm" ? "cool" : "warm";
  const teamAssignments = { ...state.teamAssignments };

  PLAYER_COLORS.forEach((color) => {
    teamAssignments[color] =
      color === localColor || color === opposite ? localTeam : otherTeam;
    if (color === localColor) {
      return;
    }
    if (allowOpenTeammate && seats[color].controller === "human") {
      return;
    }
    const controller =
      allowOpenTeammate && color === opposite ? "open" : "computer";
    seats[color] = {
      color,
      controller,
      name:
        controller === "open"
          ? "Open seat"
          : `Computer ${COLOR_LABELS[color]}`,
    };
  });

  return updateLobby(
    state,
    { mode: "teams", seats, teamAssignments },
    allowOpenTeammate
      ? "preset-friends-v-computers"
      : "preset-local-team-v-computers",
  );
}
