# Changelog

## 0.4.0 (move to the -LAB standard)
New repo `ping-gateway-route-LAB`, a single clean commit made from the old repo's `origin/main` (6de01df), which already holds everything on `docs/claude-md-tier` plus the relative shelf `composeFile` and the dropped npm cache. No new features.

- README in the 12-section standard with Tier, Repo and Catalog lines (catalog id A19 carried over, a placeholder); CLAUDE.md rewritten.
- Node 26 only: `engines`, `node:26-alpine` Dockerfile, hosted-runner CI (build, test, doctor, the history-scan job, gitleaks).
- The shared stylesheet is vendored byte-for-byte and the app CSS is tokens only (no colour literals, no dark-mode media query, breakpoints 600/900).
- Mock | Live switch in the header of every page. Live is refused for now with an honest message (`GET /api/info`); nothing turns it on. Banner and mode label say Mock.
- Presenter mode on P and Esc (the banner stays).
- The diagram is `diagram-studio/1` data (`server/diagrams/request-path.json`) loaded by name from `GET /api/diagram`; Reset restores the boxes.
- Talk track generated from the story data (`npm run talk-track`) with a drift test.
- Settings from the one shared file `~/Development/.env` (`ROUTE_LAB_MODE`, via `util.parseEnv`); the per-app `.env` loading is gone.
- Netguard also refuses a UDP connect to a non-loopback host (7 self-test attempts, up from 6). Fixed JSON 404 for anything outside `/api`.
- Doctor: Node 26, mode, shared settings file, diagram data checks.

## 0.3.0 (step RL2)
Integration and docs: `.dockerignore`, Docker image built and booted on a loopback port, shelf entry with a placeholder `composeFile` (tested portably), README true as run.

## 0.2.0 (step RL1)
Web UI: React + Vite SPA with six tabs (Routes with an inline condition editor and the `\.` trap demo, Request simulator with a per-route match explanation, WWW-Authenticate linter with rule explanations, Introspection with a mock AS and virtual clock, a ReactFlow Diagram with movable boxes, Simulate, Reset and speed, Raw with traceparent), story player with persona picker and `{{cast}}` tokens, presenter mode, Reset lab, dark and light, inert text rendering. The simulated banner is on every tab. Server: `PUT /api/routes/:name/condition` edits one route's condition in place.

## 0.1.0 (step RL0)
Core: simulated IG condition evaluator (hand-written, bounded, regex-guarded), route loader and matcher with 14 scrubbed seed routes, WWW-Authenticate and RFC 9728 linter with rules as data, RFC 7662 mock AS and simulated handler on a virtual clock, 17 stories in three verticals, trace envelope, netguard, doctor, health (demo-health/1), reset, content pack, shelf entry, CI, tests and a mutation check. The web UI is a placeholder until RL1.
