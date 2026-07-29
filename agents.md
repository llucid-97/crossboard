# Crossboard agents

- **Rookery** — primary builder and integrator; game engine, UI, testing, and release.
- **Rulesmith** — four-player rules and casual minimax review.
- **Meshkeeper** — peer-to-peer replication and host-migration review.
- **Boardlight** — lobby, board experience, accessibility, and QA review.

The primary agent coordinates all file changes. Review agents return implementation
notes through the shared Codex task so they do not overwrite one another.
