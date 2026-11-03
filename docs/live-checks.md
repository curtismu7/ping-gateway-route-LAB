# Live checks

Two kinds. **Automated experiments** are unauthenticated GET requests that change nothing on the gateway: the lab sends them in Live mode (`ROUTE_LAB_LIVE=1`, see the README) and shows the answer beside the simulator's prediction. **Owner-only writes** need a change to a gateway you control and stay instructions: nothing in this repo runs them.

Never run any of this against a shared or production gateway, and never paste a real host, token or tenant id into this repo. A real gateway's answers can carry host names; the results below show `<host>` instead.

## Automated experiments (Live mode)

The data is `server/data/live-experiments.json`; the Request simulator tab shows them under "Live experiments" with a **Fill the request** button; `docs/talk-track.md` lists them (generated, with a drift test). Each is a plain `GET` with no header, so it cannot carry a credential.

| Id | Request | Settles |
| --- | --- | --- |
| LX1 | `GET /health` | nothing: a baseline for a route with an exact path condition |
| LX2 | `GET /no-such-route` | what a request no route claims gets back (item 4 touches it, see below) |
| LX3 | `GET /mcp/x` | the no-credentials 401 and its challenge (item 12, only the no-credentials case) |
| LX4 | `GET /x/../health` | item 7: are dot-segments removed before routing |
| LX5 | `GET /%68ealth` | item 7: is the path decoded before a condition reads it |

Item numbers are those of the UNVERIFIED list in `docs/safety.md`.

### Recorded result: 2026-11-01, one local PingGateway

PingGateway 2026.6.0 (build 20260629), a local container, HTTPS with a self-signed certificate, reached on its loopback port from the lab host-run in Live mode. Ten requests in total went to it: these five through the lab, and the same five again with `curl -sk --path-as-is` as an independent check (curl agreed on every status, header shape and body). The `Host` header was the gateway's own `localhost:<port>`. The seed route table was unchanged, so it is a scrubbed copy of this deployment's routes, not the same table.

| Id | Predicted (simulator) | Actual (real gateway) | Agree |
| --- | --- | --- | --- |
| LX1 `/health` | 200, route `health`, no token check | 200, `content-type: application/json`, body `{"ready":true}` | yes |
| LX2 `/no-such-route` | bare 404, empty body | 404, `content-length: 0`, empty body | yes |
| LX3 `/mcp/x` | 401, route `mcp-main-primary`, challenge `Bearer realm="...", resource_metadata="..."` | 401, `www-authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource/mcp"`, empty body | yes on status and "challenge present"; the text differs (the real one has no realm); the real challenge lints clean (0 errors, 0 warnings) |
| LX4 `/x/../health` | 404 (raw path, no route) | 404, empty body | yes: dot-segments are not removed before routing |
| LX5 `/%68ealth` | 404 (raw path, no route) | 200, `{"ready":true}` | **NO**: the gateway matched the decoded path |

What this does and does not show:

- It is one gateway, one version, one run. Our notes, not a Ping statement.
- LX5 is a real disagreement: the simulator keeps `request.uri.path` raw and is wrong for a percent-encoded unreserved character. It is recorded as a known gap in `docs/safety.md` item 7 and not changed in this branch.
- LX2's body is empty here; whether other "no route" cases differ (a route that is not loaded, a parse error) is not measured, so item 4 stays UNVERIFIED for them.
- LX3 settles only the no-credentials case of item 12. An inactive token, a wrong audience, a missing scope and an unreachable introspection endpoint were not tried (they need a token and, for the last, a change to the gateway).

## Owner-only writes (instructions, not automated)

All of them change a gateway you control.

1. Put a route with `'^host\.example'` in a condition on a scratch IG and read its startup log. Record the exact wording, and whether other routes still load. Settles items 4 and 5 in `docs/safety.md`.
2. Put two routes that both match one request and see which answers. Settles route order (item 2).
3. Add a route with no `condition`. Settles item 3.
4. Evaluate `find(null, 'x')` in a condition and see whether the route errors or does not match. Settles item 6.
5. Percent-encoded reserved characters and double encoding: `/mcp%2Fweather`, `/%252e%252e/health`. These are also unauthenticated GETs and could be added as experiments; they were left out of this run to keep the number of requests to the real gateway small. Extends item 7.
6. Stop the introspection endpoint and note the status a client sees (item 12).
7. Check the licence terms of the image you used before telling anyone it is free to run. UNVERIFIED until you have read them.

Record the result next to the item and change the text in `docs/safety.md` from UNVERIFIED only when you have the evidence.

Before you screen-share a Live run: the gateway's own answer is shown as it came back, so its real host name (for example in the LX3 challenge) is on screen. These docs show it as `<host>`; the page does not.
