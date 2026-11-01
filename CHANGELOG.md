# Changelog

## 0.5.0 (Live mode)
An opt-in Live mode: the Request simulator can send the request you composed to ONE gateway on this machine and show what actually answered (status, an allow-list of response headers, a bounded body preview) beside what the simulator predicted, and whether the two agree. Mock stays the default and makes zero network calls.

- Opt-in keys in the shared settings file: `ROUTE_LAB_LIVE=1` and `ROUTE_LAB_LIVE_TARGET` (one loopback origin, no override). Off by default; refused with a reason otherwise (`GET /api/info`, the toggle note, the doctor).
- `POST /api/live/send` (confirm gate, rate limit, one at a time) and `GET /api/live/experiments`. New server files `live.js`, `liveTarget.js`, `liveClient.js` (the only outbound HTTP client), `liveSanitize.js`, `liveExperiments.js`; netguard gains `withPermit` (one address and port, released afterwards).
- Guards: resolve and re-check on every send (rebinding refused), peer check before any byte is written, TLS exception scoped to the one request, method/path/header allow-lists, no cookie, no body, no redirect followed, 5 s / 16 KB / 1024 characters, 10 sends per 30 s, secrets masked before the cut and a typed token never shown back.
- Page: the toggle now switches (when Live is on), the banner and mode chip say Live, the Request simulator gets the send button, a side-by-side result, a verdict, per-check pills, the real challenge linted with the same rules, and five one-click experiments.
- Five Live experiments (`server/data/live-experiments.json`), generated into the talk track with a drift test. One real run against a local PingGateway 2026.6.0 is recorded in `docs/live-checks.md`: 4 of 5 predictions agreed; `request.uri.path` is decoded by the real gateway (a percent-encoded letter), which the simulator does not do (known gap, `docs/safety.md` item 7).
- Doctor: `live` and `live-guards` checks (the doctor never contacts the target). Health reports `runtime: live` only while Live is allowed.
- Tests: a local fake HTTPS gateway with a self-signed certificate built at run time (no key or certificate committed); mutation checks for the Live guards.
- Verified on OrbStack: the image builds and is healthy on `127.0.0.1` only; in the compose container `POST /api/live/send` is a 403 (Live off: no settings file, no Live key). With Live forced on inside a container whose target is `https://localhost:PORT`, the send is a 502 `connection_refused`: `localhost` there is the container, not the host, so Live is a host-run feature.
- Last run on Node 26: 178 server tests, 50 web tests, 33 repo and script tests, 87 of 87 mutants killed (the mutation runner now checks that the unmutated copy passes first, and copies `docs/` and `web/src` so the whole suite really runs on each mutant: before, every mutant looked killed because one test could not find its files).
- Known gaps, not changed: the simulator does not decode the path; the Docker form cannot reach a host gateway (Live is host-run).

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
