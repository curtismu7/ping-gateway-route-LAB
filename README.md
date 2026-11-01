# Ping Gateway Route LAB

An interactive lab for how PingGateway (IG) routes behave: which route a request matches and why, the `WWW-Authenticate` shapes that break clients, and token introspection. A simulated evaluator, not real PingGateway: no gateway, no tenant, no network.

Tier: Tester
Repo: https://github.com/ping-sandbox/ping-gateway-route-LAB
Catalog: A19

The catalog id A19 is carried over from the old `ping-gateway-route-lab` repo (the shelf catalog row "PingGateway route lab"). Treat it as a placeholder until the owner confirms the row for this repo. The GitHub repo above is created only when the owner approves it; until then, run from a local folder.

## What is simulated

**Simulated evaluator, not real PingGateway.** Everything on screen comes from a small hand-written interpreter, a mock authorization server and a linter, all in one local process. The banner says so on every tab, presenter mode included.

**Mock mode** (the only mode, and the default): the condition evaluator, the 14 scrubbed example routes, the `WWW-Authenticate` and RFC 9728 linter, an RFC 7662 introspection stub with a virtual clock, 17 stories in three verticals. Mock-issued tokens are labelled (`mock-tok-...`) and nothing is signed.

**Live mode** is refused for now. There is no live lane in this build: nothing here can reach a real PingGateway. The Live button in the header answers with a message saying so, and the page stays in Mock. Adding a live lane would be new work and is owner-run.

What you can do:

1. **Route conditions.** Paste an IG expression such as `${find(request.uri.path, '^/mcp(?!/invest|/weather)') and ...}` and see whether a request matches and why, clause by clause. The known trap is reproduced: a `\.` inside a condition string cannot be parsed, so the route is not loaded and its requests get a bare 404.
2. **Route table.** Send a request and see which route answers, which ones it also matched (shadowed), and the reason each one did or did not match.
3. **WWW-Authenticate linter.** Catches client-breaking shapes, notably the empty first param (`Bearer , resource_metadata=...`) that broke one MCP client, plus the `resource_metadata` URL, `scope`, `error` shapes and the 401 versus 403 contract. Also lints an RFC 9728 metadata document.
4. **Introspection.** A mock authorization server (`active`, `scope`, `aud`, `exp`, `client_id`) with a virtual clock. A simulated route handler consults it and answers 200, 401 or 403.

Read `docs/safety.md` first: it lists what is simulated, what only a real IG shows, and what is UNVERIFIED (including whether PingGateway runs without a licence).

### Boundaries

This lab is about route matching, header shapes and introspection. The identity-aware side-band route, the tool-argument guard and the agent gateway inspector's stub decisions are other apps. Nothing here imports from them.

## Run from a clone

Prerequisites: Node 26 or newer. Docker is needed only for the Docker form.

```
git clone https://github.com/ping-sandbox/ping-gateway-route-LAB.git
cd ping-gateway-route-LAB
npm ci
npm run build
npm start
```

Then open http://localhost:5050/ . Or run `./scripts/run.sh`, which installs if needed, builds the UI if needed, runs the doctor and starts the app.

Everything works in Mock mode with no setup at all: no settings file, no tenant, no credentials, no network. For UI work, `npm start` and `npm run dev -w web` give http://localhost:5051/ with the API proxied.

## Settings file

All standalone apps read one optional settings file, `~/Development/.env` (mode 600). Set `STANDALONE_ENV` to use another path. The file is parsed with `util.parseEnv` and this app takes only the key below; every other key in it is ignored and never printed. There is no per-app `.env`, and a bare `MODE` is never read.

| Key | Meaning |
| --- | --- |
| `ROUTE_LAB_MODE` | Optional. The mode the page opens in: `mock` (default) or `live`. `live` is refused for now, so the page still opens in Mock and says why. Anything else stops the start. |

Per-run settings are set in the shell, not in the shared file: `PORT` (5050-5099), `LAB_BIND` (opt in to a non-loopback bind; the container sets it), `VITE_PORT` and `HOST_PORT` (below).

## Ports, and what to do if the port is taken

```
Ports: Ping Gateway Route LAB listens on 5050 (set with PORT, default 5050).
The Vite dev server uses 5051 (VITE_PORT). The Docker host port is HOST_PORT, default 5050.
Port range for this app: 5050-5099.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:5050 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, either stop it or start this app on another port:
   PORT=<other port> npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.
   Those are taken by other demos or other tools.
```

## Mock and live modes

The header of every page, including the loading and error states, has a **Mock | Live** switch and a mode label. The banner names the same mode ("Mock mode. Simulated evaluator, not real PingGateway.").

- **Mock** is pressed and works fully offline.
- **Live** is refused for now. Pressing it shows the reason next to the switch and changes nothing: the switch stays on Mock, the banner stays on Mock, and no request is sent. `GET /api/info` carries the same message for scripts.

Presenter mode (the **Present** button, or `P`; `Esc` leaves it) hides the explanatory text and keeps the banner and the mode switch. The talk track is `docs/talk-track.md`, generated from the story data with `npm run talk-track`; a test fails if the file drifts from the data.

## Health, doctor and reset

```
npm run doctor   # node, mode, bind, port, settings file, routes, evaluator, linter, stories, diagram data, netguard, scenarios, port free
npm run reset    # clears run state (edited routes, issued tokens, AS fault, virtual clock); use PORT=5059 npm run reset if you changed the port
```

The app answers `GET /api/health` with `demo-health/1`. **Reset lab** in the header does the same through `POST /api/reset` and also puts the diagram boxes back where they started; the Diagram tab has its own Reset (boxes and walkthrough).

### API

`GET /api/health`, `GET /api/info`, `GET /api/diagram`, `GET /api/catalog`, `GET /api/rules`, `GET/PUT /api/routes`, `PUT /api/routes/:name/condition`, `POST /api/condition`, `POST /api/match`, `POST /api/handle`, `POST /api/lint/www-authenticate`, `POST /api/lint/metadata`, `POST /api/as/issue`, `POST /api/as/introspect`, `POST /api/clock/advance`, `POST /api/run`, `POST /api/run-all`, `POST /api/reset`.

The diagram is `diagram-studio/1` data (`server/diagrams/request-path.json`) loaded by name from `GET /api/diagram?name=request-path` and checked with a copy of the studio validator; the page draws what the data says.

```
curl -s -X POST http://localhost:5050/api/lint/www-authenticate -H 'content-type: application/json' \
  -d '{"header":"Bearer , resource_metadata=\"https://mcp.gw-lab.example/.well-known/oauth-protected-resource\"","status":401}'
```

## Docker (optional)

```
HOST_PORT=5050 docker compose up --build -d
```

It publishes to 127.0.0.1 only (a test pins this). The image is `node:26-alpine`, runs as the `node` user with a read-only filesystem, no capabilities and no new privileges. Stop with `docker compose down`. On a Mac use OrbStack, never Docker Desktop.

## Tests

```
npm test
```

On Node 26 a good run is 138 server tests, 44 web tests and 30 repo and script tests, all passing. The conformance script, `check-drift.sh` and `check-css.sh` live in other repos and are run by hand before a PR; they are not part of CI.

`npm run mutation-check` breaks each key behaviour in a throwaway copy of `server/` and requires the server tests to fail (it starts node as a child process on those copies; it is a development tool and is not run by CI).

Some tests exercise refusals on purpose (a 400 or 404 from the API); a browser console shows those as messages.

## Troubleshooting

- **Port is taken:** see "Ports, and what to do if the port is taken" above.
- **`npm test` or `npm start` says Node is too old:** this app needs Node 26 or newer (`node -v`).
- **The page says "Could not reach the lab server":** start the server (`npm start`), and open the same port it printed.
- **The page is blank or old after a change:** run `npm run build` again; the server serves `web/dist`.
- **Pressing Live does nothing:** that is correct. Live is refused for now; the message beside the switch says so.

## Ownership

- Owner: the Ping demo team (standalone family).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

Files: `docs/architecture.md`, `docs/safety.md`, `docs/talk-track.md`, `docs/live-checks.md`, `content-pack.json` (Learning Hub pack, validated by `npm run content-pack`), `docs/shelf-entry.json`, `scripts/run.sh`, `.env.example`.
