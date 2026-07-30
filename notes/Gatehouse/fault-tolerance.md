# Fault-tolerance overhaul

- [x] Map the current state, persistence, and peer-replication lifecycle.
- [x] Add a persistent local player identity and seat ownership token.
- [x] Replicate a timestamped state chain on every connected player.
- [x] Reconcile chains deterministically after reconnecting.
- [x] Restore a reconnecting player to their owned seat.
- [x] Migrate verified schema-v1/v2/v3 local recovery states to schema v4.
- [x] Cover chess and checkers recovery with tests.
- [x] Run the worker build, engine/render tests, typecheck, lint, and Pages gate.
- [x] Play through two browser tabs, CPU turns, refresh, and rejoin.
  Completed against the deployed HTTPS site with three consecutive two-player
  sessions: checkers coordinator refresh, chess guest refresh, and checkers
  guest refresh. Every session included both human turns, both bot turns,
  recovery-chain restore, and a post-refresh move. The final delayed check
  reported `All connected` on both tabs with matching move 6 and state hash
  `829d69f876b65b30`.
- [x] Fix the failures found by the soak loop:
  use chunked binary transport for full recovery chains, tolerate background
  timer throttling, avoid duplicate pending handshakes, and replace obsolete
  half-open channels immediately when a stable seat ID refreshes.
- [x] Commit the implementation branch.
