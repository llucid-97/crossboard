# Fault-tolerance overhaul

- [x] Map the current state, persistence, and peer-replication lifecycle.
- [x] Add a persistent local player identity and seat ownership token.
- [x] Replicate a timestamped state chain on every connected player.
- [x] Reconcile chains deterministically after reconnecting.
- [x] Restore a reconnecting player to their owned seat.
- [x] Migrate verified schema-v1/v2/v3 local recovery states to schema v4.
- [x] Cover chess and checkers recovery with tests.
- [x] Run the worker build, engine/render tests, typecheck, lint, and Pages gate.
- [ ] Play through two browser tabs, CPU turns, refresh, and rejoin.
  Blocked in this session: the managed shell cannot bind a local port, Computer
  Use cannot operate Terminal, and the in-app browser policy blocks both local
  test URLs and `file://` builds. Resume once the user starts the dev server in
  their terminal and provides an allowed URL.
- [x] Commit the implementation branch.
