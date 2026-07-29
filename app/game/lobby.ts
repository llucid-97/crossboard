import { GameState } from "./types";

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
