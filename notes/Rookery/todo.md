# Rookery build log

## Product decisions

- [x] Brand the project **Crossboard**.
- [x] Build a 14×14 cross-shaped four-player board.
- [x] Support Free-for-all and configurable Warm/Cool Teams.
- [x] Let seats be local human, open for an online player, or computer-controlled.
- [x] Target a casual-but-thoughtful bot rather than expert strength.
- [x] Use deterministic replicated state so any connected human can become coordinator.

## Build

- [x] Initialize the Sites project and start the live preview.
- [x] Implement board geometry, pieces, move generation, elimination, and victory.
- [x] Implement a deterministic beam-limited, four-ply minimax computer player.
- [x] Implement the room lobby and full-mesh peer synchronization.
- [x] Add a 64-head hash lineage and deterministic partition reconciliation.
- [x] Persist a browser-local recovery copy after every accepted state.
- [x] Implement responsive board controls, move history, and connection notices.
- [x] Add unit tests for board, turns, AI, hashing, forks, and host election.

## Release

- [x] Build and resolve compile errors.
- [x] Pass the engine/render tests, lint, and TypeScript checks.
- [x] Generate and wire the Crossboard social-preview card.
- [x] Export the application for GitHub Pages and verify its `/crossboard`
  asset paths.
- [x] Publish the exact tested source through GitHub Actions and verify the
  public URL.
- [x] Remove the deployment heartbeat after the public site is healthy.

## Deliberate v1 limits

- PeerJS Cloud supplies discovery/signalling; game traffic remains peer to peer.
- The default STUN-only connection can fail between restrictive networks. TURN
  is the next production networking upgrade.
- Room-code possession grants casual-room access. Persistent signed player
  identities are a future hardening step.
- A room can recover while one human retains a snapshot. Cross-device cold
  recovery after everyone leaves would need a small persistence service.

## Quality-of-life follow-up

- [x] Add direct Teams practice with Yellow as the computer teammate.
- [x] Keep free-for-all practice against three computer rivals.
- [x] Add synchronized turn rewind with coordinator-serialized online requests.
- [x] Migrate verified v1 recovery copies into the v2 room protocol.
- [x] Publish and verify the controls on GitHub Pages.
- [x] Remove the follow-up heartbeat after the live deployment is healthy.

## Checkers integration

- [x] Merge current `main` without regressing direct chess practice or shared
  online undo.
- [x] Move saves and peer IDs to schema/protocol v3, with verified v1/v2 chess
  recovery migration.
- [x] Make a checkers undo checkpoint cover the whole human capture chain and
  following computer replies.
- [x] Keep automatic no-move elimination out of the undo stack.
- [x] Recheck both state hash and coordinator ownership inside delayed turns.
- [x] Serialize all lobby edits and Start from the latest state ref.
- [x] Implement FMJD-style deferred capture removal and promotion for the
  International preset.
- [x] Teach minimax to search through no-move elimination.
- [x] Add migration, undo, timer, lobby-race, International-rules, tactical-AI,
  and full hash-contract regressions.
- [x] Pass worker build/tests, GitHub Pages export, TypeScript, and lint.
