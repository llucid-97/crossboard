# Four-player checkers

## Product

- [x] Branch from the board-row sizing fix into an isolated worktree.
- [x] Add a game menu with Chess and Checkers as first-class choices.
- [x] Support free-for-all and opposite-seat teams.
- [x] Prevent teammates from capturing one another.
- [x] Offer American, International, and House presets plus custom toggles.
- [x] Support flying kings, backward captures, mandatory captures, longest
  capture, and continuing after crowning.
- [x] Support human and casual computer seats in both game types.

## Rules and state

- [x] Set up twelve checkers per color on the dark squares of each home arm.
- [x] Implement diagonal movement, capture chains, crowning, elimination, and
  team/FFA victory.
- [x] Include the selected game and checkers options in replicated snapshots
  and deterministic hashes.

## Release gate

- [x] Add focused checkers engine and AI tests.
- [x] Keep all existing chess, synchronization, and static-export tests green.
- [x] Pass lint, TypeScript, worker build, and GitHub Pages export.
- [x] Commit the completed feature on `agent/four-player-checkers`.
