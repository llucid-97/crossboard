"use client";

import { KeyboardEvent, useMemo } from "react";
import {
  BOARD_SIZE,
  getLegalMovesForPiece,
  isPlayableSquare,
  sameSquare,
  squareKey,
  squareName,
} from "../game/engine";
import {
  COLOR_LABELS,
  Coord,
  GameState,
  PIECE_GLYPHS,
  PIECE_LABELS,
  PlayerColor,
} from "../game/types";

interface GameBoardProps {
  game: GameState;
  orientation: PlayerColor;
  selected: Coord | null;
  interactive: boolean;
  onSquarePress: (coord: Coord) => void;
}

function boardCoordForDisplay(
  displayRow: number,
  displayCol: number,
  orientation: PlayerColor,
): Coord {
  switch (orientation) {
    case "red":
      return { row: displayRow, col: displayCol };
    case "yellow":
      return {
        row: BOARD_SIZE - 1 - displayRow,
        col: BOARD_SIZE - 1 - displayCol,
      };
    case "blue":
      return {
        row: displayCol,
        col: BOARD_SIZE - 1 - displayRow,
      };
    case "green":
      return {
        row: BOARD_SIZE - 1 - displayCol,
        col: displayRow,
      };
  }
}

function focusDisplaySquare(row: number, col: number): void {
  let nextRow = row;
  let nextCol = col;
  for (let attempts = 0; attempts < BOARD_SIZE; attempts += 1) {
    const target = document.querySelector<HTMLButtonElement>(
      `[data-display-square="${nextRow}-${nextCol}"]`,
    );
    if (target) {
      target.focus();
      return;
    }
    nextRow = Math.max(0, Math.min(BOARD_SIZE - 1, nextRow));
    nextCol = Math.max(0, Math.min(BOARD_SIZE - 1, nextCol));
  }
}

export function GameBoard({
  game,
  orientation,
  selected,
  interactive,
  onSquarePress,
}: GameBoardProps) {
  const legalMoves = useMemo(
    () => (selected ? getLegalMovesForPiece(game, selected) : []),
    [game, selected],
  );
  const lastMove = game.history.at(-1);

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    displayRow: number,
    displayCol: number,
  ) => {
    const directions: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    };
    const direction = directions[event.key];
    if (direction) {
      event.preventDefault();
      focusDisplaySquare(
        Math.max(0, Math.min(BOARD_SIZE - 1, displayRow + direction[0])),
        Math.max(0, Math.min(BOARD_SIZE - 1, displayCol + direction[1])),
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.currentTarget.click();
    }
  };

  return (
    <div
      className="game-board"
      role="grid"
      aria-label={`Crossboard game board, oriented for ${COLOR_LABELS[orientation]}`}
    >
      {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
        const displayRow = Math.floor(index / BOARD_SIZE);
        const displayCol = index % BOARD_SIZE;
        const coord = boardCoordForDisplay(displayRow, displayCol, orientation);
        if (!isPlayableSquare(coord.row, coord.col)) {
          return (
            <span
              className="board-corner"
              aria-hidden="true"
              key={`corner-${displayRow}-${displayCol}`}
            />
          );
        }

        const piece = game.board[squareKey(coord)];
        const selectedSquare = selected ? sameSquare(selected, coord) : false;
        const legalMove = legalMoves.find((move) => sameSquare(move.to, coord));
        const latest =
          !!lastMove &&
          (sameSquare(lastMove.from, coord) || sameSquare(lastMove.to, coord));
        const label = piece
          ? `${COLOR_LABELS[piece.color]} ${PIECE_LABELS[piece.type]} on ${squareName(coord)}`
          : `Empty ${squareName(coord)}`;
        const classes = [
          "board-square",
          (coord.row + coord.col) % 2 === 0 ? "square-light" : "square-dark",
          selectedSquare ? "is-selected" : "",
          legalMove ? "is-legal" : "",
          legalMove && (piece || legalMove.capturedSquare) ? "is-capture" : "",
          latest ? "is-latest" : "",
        ]
          .filter(Boolean)
          .join(" ");

        return (
          <button
            className={classes}
            data-display-square={`${displayRow}-${displayCol}`}
            key={`${displayRow}-${displayCol}`}
            role="gridcell"
            aria-label={`${label}${selectedSquare ? ", selected" : ""}${
              legalMove ? ", legal destination" : ""
            }`}
            aria-selected={selectedSquare}
            tabIndex={selectedSquare ? 0 : -1}
            disabled={!interactive && !selectedSquare}
            onClick={() => onSquarePress(coord)}
            onKeyDown={(event) => handleKeyDown(event, displayRow, displayCol)}
          >
            {piece && (piece.type === "man" || piece.type === "crowned") ? (
              <span
                className={`checker-piece piece-${piece.color}${
                  piece.type === "crowned" ? " is-crowned" : ""
                }`}
                aria-hidden="true"
              >
                {piece.type === "crowned" ? <span>♛</span> : null}
              </span>
            ) : piece ? (
              <span
                className={`chess-piece piece-${piece.color}`}
                aria-hidden="true"
              >
                {PIECE_GLYPHS[piece.type]}
              </span>
            ) : null}
            {legalMove && !piece ? (
              <span className="move-dot" aria-hidden="true" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
