# Rookery build log

## Product decisions

- [x] Brand the project **Crossboard**.
- [x] Build a 14×14 cross-shaped four-player board.
- [x] Support Free-for-all and opposite-seat Teams.
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
- [ ] Package, save, and deploy the exact tested source. Blocked because Sites
  is disabled for this workspace; GitHub Pages would require approval for a
  public repository/deployment.
- [x] Remove the build heartbeat after reaching the hosting decision point.

## Deliberate v1 limits

- PeerJS Cloud supplies discovery/signalling; game traffic remains peer to peer.
- The default STUN-only connection can fail between restrictive networks. TURN
  is the next production networking upgrade.
- Room-code possession grants casual-room access. Persistent signed player
  identities are a future hardening step.
- A room can recover while one human retains a snapshot. Cross-device cold
  recovery after everyone leaves would need a small persistence service.
