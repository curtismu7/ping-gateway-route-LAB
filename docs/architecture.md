# Architecture

Everything is in one process. Nothing leaves the machine.

```
 browser ──same origin──▶ Express (server/src/app.js)
                             │  Host check, same-origin writes, simulated-label header, traceparent
                             ├── el.js ──────── tokenizer, parser, interpreter (the EL subset), the \. trap simulation
                             │     └ regexguard.js   static ReDoS analysis before any regex is built
                             ├── routes.js ──── request model, route loading, matcher, explanations
                             ├── wwwauth.js ─── challenge parser, linter (rules in data/wwwauth-rules.json), RFC 9728 document lint
                             ├── introspect.js  virtual clock, mock authorization server (RFC 7662), simulated route handler
                             ├── runner.js ──── scenario runner (stories as data), trace envelope
                             ├── doctor.js / health.js   preflight checks, GET /api/health (demo-health/1)
                             ├── diagramData.js  loads the diagram-studio/1 data in server/diagrams by name (validator copy: diagramStudioValidate.js)
                             ├── config.js / settings.js  ROUTE_LAB_MODE from the shared ~/Development/.env; Live is refused
                             ├── talkTrack.js ─ docs/talk-track.md generated from the story data
                             └── netguard.js ── refuses every non-loopback socket, DNS, fetch, UDP send and UDP connect
```

## Web UI

`web/` is a React + Vite app served by the same Express process from `web/dist`. It talks only to its own origin under `/api`. The header of every page (also while loading, or when the server is down) carries the Mock | Live switch; Live is refused with the reason from `GET /api/info`. P and Esc toggle presenter mode. The diagram boxes, arrows and the built-in walk come from the diagram-studio/1 file served by `GET /api/diagram` (`lib/diagram.js` only turns it into what React Flow draws). State that spans tabs (the request builder, issued mock tokens, the story on screen, diagram box positions) lives in `App.jsx`; tabs are `web/src/tabs/*`. Every string from a user or the server is rendered as a React text node through `Inert` (control and bidi characters become visible `[U+XXXX]` chips). The banner is rendered by the shell before anything else and is never hidden by presenter mode, which only hides elements marked `data-admin-only`. Web tests run the real Express app on a loopback port, so they exercise the real evaluator, linter and mock AS.

## Data

| File | What it is |
| --- | --- |
| `server/data/routes/*.json` | 14 scrubbed, IG-shaped example routes (`.example` hosts, `LAB_` environment names). Shape kept, identifiers replaced |
| `server/data/wwwauth-rules.json` | Lint rules as data: id, severity, explanation, fix, which client breaks, basis |
| `server/data/scenarios.json` | 17 stories: steps with expectations and `{{cast}}` tokens |
| `server/data/verticals.json` | The cast packs (travel, banking, retail): hosts, scopes, audience, client name |
| `server/data/talk-track.json` | The opening and closing lines of `docs/talk-track.md` (the story lines come from `scenarios.json`) |
| `server/diagrams/request-path.json` | The request-path diagram, `diagram-studio/1`: five boxes, four arrows, the built-in walk |

## A request through the lab

1. `normalizeRequest` turns the JSON request into `Map`-backed values (`request.uri`, `request.headers` case-insensitive, `request.queryParams`, `env`).
2. `matchRequest` evaluates every route's condition (so a shadowed second match is visible), explains each result, and the first match **by route name** wins. No match is a bare 404.
3. `handleRequest` then, if the route has an `OAuth2ResourceServerFilter`, reads the Bearer token, asks the mock AS, and applies audience then scope. It builds the `WWW-Authenticate` the route's `lab.challengeStyle` says and lints its own output.

A condition that cannot be parsed makes its route **not loaded** (the documented simulation of the `\.` trap): it is skipped and listed under `notLoaded`.

## Route files

IG-shaped: `name`, `condition`, `handler` (type and filter list), `heap` (named objects), `baseURI`, `comment`. One lab-only extension, `lab`, carries what a real deployment keeps elsewhere: `audience`, `metadataUrl`, `challengeStyle` (`space` is correct, `comma-bug` reproduces the bad shape) and `realm`.

## Scenarios

A scenario is data: `routes` (`"seed"` or a list), then `steps` with an `op` (`match`, `condition`, `lint`, `issue`, `revoke`, `advance`, `fault`, `handle`) and an `expect` that the runner compares. `{{tokens}}` come from the chosen vertical; adding a vertical needs no code. A wrong expectation fails the run (tested).

## Time

The clock is virtual. `advance` moves it; nothing sleeps. A run starts at a fixed instant so it is repeatable.

## API

`GET /api/health`, `GET /api/info`, `GET /api/diagram`, `GET /api/catalog`, `GET /api/rules`, `GET/PUT /api/routes`, `PUT /api/routes/:name/condition`, `POST /api/condition`, `POST /api/match`, `POST /api/handle`, `POST /api/lint/www-authenticate`, `POST /api/lint/metadata`, `POST /api/as/issue`, `POST /api/as/revoke`, `POST /api/as/introspect` (JSON or form), `POST /api/as/fault`, `GET /api/clock`, `POST /api/clock/advance`, `POST /api/run`, `POST /api/run-all`, `POST /api/reset`, `GET /api/safety-scan`.

## Ports

5050-5099 only. Default 5050.
