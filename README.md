# Ping Gateway Route LAB

An interactive lab for how PingGateway (IG) routes behave: which route a request matches and why, the `WWW-Authenticate` shapes that break clients, and token introspection. A simulated evaluator, not real PingGateway: no gateway, no tenant, and in Mock mode (the default) no network. An opt-in Live mode can send one request to your own local gateway and show its real answer beside the simulator's prediction.

Tier: Tester
Repo: https://github.com/ping-sandbox/ping-gateway-route-LAB
Catalog: A19

The catalog id A19 is carried over from the old `ping-gateway-route-lab` repo (the shelf catalog row "PingGateway route lab"). Treat it as a placeholder until the owner confirms the row for this repo. The GitHub repo above is created only when the owner approves it; until then, run from a local folder.

## What is simulated

**Simulated evaluator, not real PingGateway.** Everything on screen comes from a small hand-written interpreter, a mock authorization server and a linter, all in one local process. The banner says so on every tab, presenter mode included.

**Mock mode** (the default): the condition evaluator, the 14 scrubbed example routes, the `WWW-Authenticate` and RFC 9728 linter, an RFC 7662 introspection stub with a virtual clock, 17 stories in three verticals. Mock-issued tokens are labelled (`mock-tok-...`) and nothing is signed. Mock makes no network call at all (a test pins it).

**Live mode** is opt-in and owner-run. With it on, the Request simulator tab gains a **Send to the real gateway and compare** button: it sends the request you composed to ONE gateway on this machine and shows what actually answered (status, a short allow-list of response headers, a bounded body preview) next to what the simulator predicted, and whether the two agree. The predictions, and every other tab, stay simulated, and the banner says so. See "Mock and live modes" for the guards.

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

All standalone apps read one optional settings file, `~/Development/.env` (mode 600). Set `STANDALONE_ENV` to use another path. The file is parsed with `util.parseEnv` and this app takes only the keys below; every other key in it is ignored and never printed. There is no per-app `.env`, and a bare `MODE` is never read.

| Key | Meaning |
| --- | --- |
| `ROUTE_LAB_MODE` | Optional. The mode the page opens in: `mock` (default) or `live`. `live` opens in Live only when Live is also on (the two keys below); otherwise the page opens in Mock and says why. Anything else stops the start. |
| `ROUTE_LAB_LIVE` | Optional. Exactly `1` turns Live on. Anything else, or unset, leaves it off. |
| `ROUTE_LAB_LIVE_TARGET` | Needed for Live. One origin on this machine, for example `https://localhost:3036`: `localhost`, `127.x.x.x` or `[::1]`, https (or http, because it is loopback), no path, query or user name. There is no override for a non-loopback target. |

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

The header of every page, including the loading and error states, has a **Mock | Live** switch and a mode label. The banner names the same mode ("Mock mode. Simulated evaluator, not real PingGateway." or "Live mode. Predictions and every other tab are a simulated evaluator, not real PingGateway. ...").

- **Mock** (default) works fully offline and makes zero network calls.
- **Live** is off unless you set `ROUTE_LAB_LIVE=1` and `ROUTE_LAB_LIVE_TARGET` in the shared settings file and restart. While it is off, pressing Live shows the reason next to the switch and changes nothing (`GET /api/info` carries the same message for scripts). While it is on, pressing Live changes the banner and the mode label and adds the send button to the Request simulator tab; pressing Mock goes back.

What a Live send does, and the guards around it:

| Guard | What it is |
| --- | --- |
| Opt-in | Off by default. Refused unless `ROUTE_LAB_LIVE` is exactly `1` and the target is valid. Also refused on a non-loopback bind outside the container that publishes on `127.0.0.1` only. |
| Confirm | The button stays disabled until you tick "I confirm: send this request to the real gateway", and the server refuses a send without `confirm: true`. |
| One loopback target | The target comes only from `ROUTE_LAB_LIVE_TARGET`. The name is resolved on every send and every answer must be loopback (so a changing DNS answer is refused); the socket goes to that verified address and the connected peer is checked again before anything is written. IPv4-mapped loopback is accepted; `0.0.0.0` and every IPv6 form that merely carries an IPv4 address (NAT64, 6to4, compatible, Teredo) are refused. Ports 5050-5099 (this lab's own) are refused. |
| Netguard permit | While a send runs, the guard permits that one address and port and nothing else (not another loopback port, not `fetch`, not UDP, not the resolver); the permit is released afterwards, also on failure. |
| TLS | A self-signed gateway certificate is accepted for that one request only (never `NODE_TLS_REJECT_UNAUTHORIZED`, never the global agent). The answer shows the certificate fingerprint and says it was not verified. |
| Allow-lists | Methods GET, HEAD, OPTIONS and POST (POST sends no body). A path only (no absolute URL). Request headers: Host, Accept, Accept-Language, Authorization (Bearer only), Content-Type, Origin, User-Agent, traceparent, MCP-Protocol-Version; no cookie, ever. Response headers shown: content-type, content-length, www-authenticate, cache-control, allow, location, vary, retry-after, x-content-type-options, traceparent; the rest are counted, never shown (Set-Cookie among them). |
| Bounds | 5 s, at most 16 KB read, 1024 characters of preview, no redirect followed (a Location is shown, never visited), one send at a time, 10 sends per 30 seconds. |
| Secrets | A token you type is sent to the gateway and never shown, logged or stored: the page shows only its length (a `mock-tok-` token from the Introspection tab is shown raw and labelled). Text that comes back is masked before it is cut: JWTs, credential key/values, URL user info, private keys, long opaque values, and the token you sent if the gateway echoes it. Masking is a heuristic. |

**Docker and Live.** The container binds `0.0.0.0` inside, publishes on `127.0.0.1` only, has no settings file and its loopback is the container's own, so it cannot reach a gateway running on your host's loopback. Live is therefore a **host-run feature** (`npm start` or `./scripts/run.sh`); in the container it stays off, and the page says why.

**The comparison.** Agreement is judged on the two things the simulator models: the status, and whether the answer carries a `WWW-Authenticate` challenge (plus an empty body when it predicts the bare 404). Everything else is shown, not scored. The seed routes are a scrubbed copy of one deployment, so a disagreement can mean your gateway's routes differ, not that the simulator is wrong: edit the routes on the Routes tab to mirror yours.

**Live experiments.** Five unauthenticated GET requests that change nothing on the gateway ship as buttons that fill the request form (health, no route, a protected route, dot-segments, a percent-encoded letter). `docs/live-checks.md` lists them with the results of one real run; experiments that change a gateway stay owner-run instructions.

Presenter mode (the **Present** button, or `P`; `Esc` leaves it) hides the explanatory text and keeps the banner and the mode switch. The talk track is `docs/talk-track.md`, generated from the story data and the experiment data with `npm run talk-track`; a test fails if the file drifts from the data.

## Health, doctor and reset

```
npm run doctor   # node, mode, live, bind, port, settings file, routes, evaluator, linter, stories, diagram data, netguard, live guards, scenarios, port free (it never contacts the Live target)
npm run reset    # clears run state (edited routes, issued tokens, AS fault, virtual clock); use PORT=5059 npm run reset if you changed the port
```

The app answers `GET /api/health` with `demo-health/1`. **Reset lab** in the header does the same through `POST /api/reset` and also puts the diagram boxes back where they started; the Diagram tab has its own Reset (boxes and walkthrough).

### API

`GET /api/health`, `GET /api/info`, `GET /api/live/experiments`, `POST /api/live/send` (refused unless Live is on), `GET /api/diagram`, `GET /api/catalog`, `GET /api/rules`, `GET/PUT /api/routes`, `PUT /api/routes/:name/condition`, `POST /api/condition`, `POST /api/match`, `POST /api/handle`, `POST /api/lint/www-authenticate`, `POST /api/lint/metadata`, `POST /api/as/issue`, `POST /api/as/introspect`, `POST /api/clock/advance`, `POST /api/run`, `POST /api/run-all`, `POST /api/reset`.

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

On Node 26 a good run is the server, web and repo and script tests all passing (see `CHANGELOG.md` for the counts of the last run). Tests never touch a real gateway: Live is tested against a local fake HTTPS gateway with a self-signed certificate built at run time. The conformance script, `check-drift.sh` and `check-css.sh` live in other repos and are run by hand before a PR; they are not part of CI.

`npm run mutation-check` breaks each key behaviour (the Live guards included) in a throwaway copy of `server/` and requires the tests to fail (it starts node as a child process on those copies; it is a development tool and is not run by CI).

Some tests exercise refusals on purpose (a 400 or 404 from the API); a browser console shows those as messages.

## Troubleshooting

- **Port is taken:** see "Ports, and what to do if the port is taken" above.
- **`npm test` or `npm start` says Node is too old:** this app needs Node 26 or newer (`node -v`).
- **The page says "Could not reach the lab server":** start the server (`npm start`), and open the same port it printed.
- **The page is blank or old after a change:** run `npm run build` again; the server serves `web/dist`.
- **Pressing Live only shows a message:** Live is off. The message beside the switch says why: when you run the lab on your machine (`npm start`), set `ROUTE_LAB_LIVE=1` and `ROUTE_LAB_LIVE_TARGET` in the shared settings file and restart. In the Docker container Live always stays off.
- **A Live send says "connection refused" or "timeout":** nothing answers at the target. Check the gateway is running and that the target is its origin; the doctor does not contact it.
- **A Live send says the TLS handshake failed:** the scheme is probably wrong (https against a plain-http port, or the reverse).

## Ownership

- Owner: the Ping demo team (standalone family).
- License: MIT (see `LICENSE`).
- Found a problem? Open an issue on the repo.

Files: `docs/architecture.md`, `docs/safety.md`, `docs/talk-track.md`, `docs/live-checks.md`, `content-pack.json` (Learning Hub pack, validated by `npm run content-pack`), `docs/shelf-entry.json`, `scripts/run.sh`, `.env.example`.
