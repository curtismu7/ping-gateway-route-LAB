# ping-gateway-route-LAB (Tester tier, catalog A19 carried over: a placeholder until the owner confirms it)

A simulated PingGateway route evaluator: route conditions, a route table with shadowing, a WWW-Authenticate linter and a mock introspection server. It is not real PingGateway and never claims to be. Mock mode only; Live is refused for now (no live lane).

## Run and test
- `./scripts/run.sh` installs, builds, runs the doctor and starts the app on http://localhost:5050 (UI dev server on 5051). `npm run doctor`, `npm run reset`. Docker: `HOST_PORT=5050 docker compose up --build -d` (127.0.0.1 only).
- `npm test` runs server (`node --test test/*.test.js`, a glob, never a directory), web (vitest, against the real Express app) and `scripts/*.test.mjs`. Node 26 only.
- `npm run talk-track` regenerates `docs/talk-track.md` from the story data (a test fails on drift). `npm run content-pack` rebuilds and validates the Learning Hub pack. `npm run mutation-check` runs the mutation proof (spawns node on throwaway copies of `server/`; dev tool only).
- By hand, from outside this repo: `node ~/Development/demo-kit-base-rule18-warn/scripts/conformance.mjs . --new` (0 failed; the two rule 18 warnings are expected under the Docker-only decision), `bash ~/Development/AI-DEMO-Standalone/scripts/check-drift.sh .`, `check-css.sh .`.

## Rules that bite
- Every output says what is simulated. Anything about real PingGateway behaviour needs a source, or is labelled UNVERIFIED in `docs/safety.md`.
- Mock | Live switch in the header of EVERY page (also while loading or when the server is down). Live is refused with the server's message; nothing may turn it on. Banner and mode label say Mock. Presenter mode (P / Esc) keeps the banner.
- The diagram is `diagram-studio/1` data in `server/diagrams/`, loaded by name (`GET /api/diagram`) and checked with `diagramStudioValidate.js` (a copy of the studio's validator: re-copy to update, never import). No hand-built nodes or edges in the web code. Reset restores the boxes.
- Settings: only the shared `~/Development/.env` (or `STANDALONE_ENV`), parsed with `util.parseEnv`, one key `ROUTE_LAB_MODE`. No per-app `.env`, never a bare `MODE`, no k8s/SE code (deferred by the owner, 2026-10-31).
- UI: `web/src/styles/standalone-ui.css` is vendored byte-for-byte from `AI-DEMO-Standalone/shared/` and loaded first; `app.css` uses tokens only (no colour literals, no `prefers-color-scheme`, no `!important`, breakpoints 600/900, no restyling of the shared controls).
- Netguard refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect, with a self-test (7 attempts) and a test that asserts zero attempts.
- Ports 5050-5099 only, never 8080, 5173, 3000 or 4000. Only `.example` / `.invalid` hosts. The family history scan must print 0 and gitleaks must be clean; never print or embed the forbidden list.
- Never `crypto.generateKeyPairSync('ec')` or async EC `generateKeyPair` (SIGABRT on Node 20 CI). Use `createECDH` + `createPrivateKey` or fixtures. This lab has no key material at all.
- Loopback-only bind, Host check, same-origin writes; Docker publishes `127.0.0.1:` only.
- One writer per repo; PR and merge on green. Commits end with the Co-Authored-By line from the session's attribution reminder.
