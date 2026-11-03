# Safety, and what is simulated

**This lab is a simulated evaluator, not real PingGateway.** The banner says so on every page and every tab, presenter mode included, and every API answer carries the header `X-Simulated-Evaluator`. Mock mode (the default) has no real-IG lane at all. The opt-in **Live mode** can send one request to a gateway on this machine and shows its answer beside the simulator's prediction; the prediction stays simulated and the real answer is labelled as real.

## What is simulated, and what only a real IG shows

| Thing | In this lab | What only a real PingGateway shows |
| --- | --- | --- |
| Route conditions | A small hand-written interpreter for the expression subset real routes use (see `server/src/el.js`) | IG's own expression-language (EL) parse errors: its exact error messages, every function and operator it supports, its type coercion |
| The `\.` trap | Reproduced as a documented simulation: the condition is refused, the route is marked **not loaded**, a request only that route would serve gets a bare 404 | The real log line, the real startup behaviour, whether other routes keep loading, and what happens on a route reload |
| Route choice | Every route is tested; the first match **by route name** wins | IG's real ordering rule and its handling of ties |
| Handler chain | Only the resource-server filter is modelled (token introspection, audience, scope, 401/403) | Filter order, scripts (Groovy), token exchange, header filters, reverse proxying, audit |
| Introspection | A mock RFC 7662 authorization server in the same process, with a virtual clock | A real authorization server, network failure modes, caching, client authentication |
| WWW-Authenticate | The linter reads any header you give it; the handler builds the shapes its settings say | What a real filter or script actually emits (Live shows it, and lints it with the same rules) |
| Live answer | Nothing: Live is opt-in and the answer is the real gateway's, set beside the simulated prediction | Everything the gateway does. The lab shows only the status, a short allow-list of headers and a bounded body preview of ONE request |

## What this build does not do

- **Mock mode never contacts anything.** A runtime guard refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect, and the doctor proves it by trying (7 attempts, all refused). A test configures Live against a fake gateway, drives every Mock endpoint and asserts the gateway saw zero requests.
- **Live mode can reach ONE origin, on this machine.** It is off by default and needs `ROUTE_LAB_LIVE=1` plus `ROUTE_LAB_LIVE_TARGET` in the shared settings file, a confirm tick on every page load, and a loopback bind. What it can and cannot do:

| Guard | Detail |
| --- | --- |
| Target | One origin from the settings file only: `localhost`, `127.0.0.0/8`, `[::1]` or an IPv4-mapped loopback. `0.0.0.0`, `::`, private and public addresses and every IPv6 form that carries an IPv4 address (compatible, SIIT, NAT64, 6to4, Teredo) are refused. No path, query, user name or override. Not a port in 5050-5099 (this lab's own). |
| Rebinding | The name is resolved on every send and ALL answers must be loopback; the socket is opened to the verified address itself (no second lookup), and the peer address is checked again when the connection exists, before a byte of the request is written. |
| Netguard permit | Inside a send the guard permits that one address and port. Another loopback port, `fetch`, UDP and the resolver are refused and recorded as `permit:...`. The permit is counted while open, closed afterwards (also on error or timeout), and a socket that outlives it is refused. A send cannot start while the guard is not installed. |
| Redirects | Never followed. A `Location` is shown as text and never visited (a test runs a second server and asserts it saw nothing). |
| TLS | A self-signed certificate is accepted for that one request object only, for an https target only. `NODE_TLS_REJECT_UNAUTHORIZED` and the global agent are untouched (tested), and the answer shows the certificate fingerprint and "not verified". |
| Request | Methods GET, HEAD, OPTIONS, POST (POST sends `Content-Length: 0`, never a body). A path only, visible ASCII, 2048 characters. At most 12 headers from an allow-list (Host, Accept, Accept-Language, Authorization as Bearer only, Content-Type, Origin, User-Agent, traceparent, MCP-Protocol-Version). No cookie, no proxy or forwarding header. |
| Response | 5 s, at most 16 KB read, 1024 characters shown, response headers from an allow-list (the rest are counted, never shown: Set-Cookie among them), binary bodies not shown. |
| Rate | 10 sends per 30 seconds, one at a time. Reset does not clear it. |
| Secrets | A bearer token is sent but never echoed (not even its first or last characters), logged or stored: the page shows its length. This holds for the Send to the real gateway panel and, while Live is allowed, for the simulator too: `POST /api/handle`, `/api/match` and `/api/condition` hide the `Authorization` value (the Raw tab is built from that answer) and remove the exact token wherever else it appears in the same answer (`server/src/echoGuard.js`). With Live off nothing is hidden, because there is no real gateway to send a credential to. The input box itself shows what you type. Only a `mock-tok-` token is shown raw, labelled. Everything that comes back is NFKC-normalised, stripped of invisible characters and masked BEFORE it is cut (JWTs, credential key/values, URL user info, private keys, long opaque values, plain-language `password is ...`, and the exact token this request carried). Masking is a heuristic: a secret in a shape it does not know can still show. Error messages are fixed text and never repeat what was typed or configured. |
| Where | Host-run only. Refused on a non-loopback bind unless it is the container that publishes on `127.0.0.1` only; in that container there is no settings file and no route to the host's loopback, so it stays off (verified, see CHANGELOG). |

- The same-origin and Host guards cover `POST /api/live/send`; a cross-origin or foreign-Host post sends nothing (tested).
- It binds to loopback only, checks the `Host` header, and refuses cross-origin writes.
- It issues only mock tokens (`mock-tok-` plus hex). Nothing is signed; the lab holds no key material. The only key generation anywhere is an in-memory RSA key in `server/test/fakeGateway.js`, used to sign a throw-away certificate for the fake gateway in the tests; no key or certificate is committed.
- Seed routes use `.example` hosts and generic `LAB_` environment names. Every host in every shipped file must be `.invalid`, `.example` or loopback, and the tests and the doctor scan for it. A real gateway's answer can carry real host names; the page shows them to you and the lab stores none of them (the notes in `docs/live-checks.md` replace them).

## Hostile input

Conditions, headers, requests and route files can be written by a user, so they are bounded:

| Input | Limit |
| --- | --- |
| Condition length | 2000 characters, checked before any parsing |
| Tokens | 600 |
| Parser nesting | 24 levels (a parenthesis costs 2) |
| Tree depth | 48; `and` and `or` chains are flattened so they stay shallow |
| Evaluation steps | 5000 |
| Regex pattern | 200 characters, 20 groups, 30 alternations; no backreferences or lookbehind; nested quantifiers, a quantified alternation and more than 2 unbounded quantifiers are refused before the regex is built |
| Regex subject | 512 characters, and a work budget per evaluation |
| `WWW-Authenticate` | 8192 characters, 20 challenges, 50 params, linear scan |
| Route set | 60 routes, 16 KB per route |
| Request | 4096-character URL, 64 headers, 100 query parameters |

Object keys such as `__proto__` and `constructor` are plain missing keys: the evaluator reads only `Map`-backed values. There is no `eval`, no `Function`, no `vm`. Text from a condition or a header is shown as text, never as markup.

The regex guard is conservative on purpose: it refuses some safe patterns (for example a repeated group that holds any quantifier). A refusal names the rule that fired.

## UNVERIFIED

Each of these is a claim this lab does not know to be true. Do not repeat one as fact.

1. **Whether PingGateway runs without a licence is UNVERIFIED.** An earlier internal demo ran IG from a public image; the licence terms for that image were not checked. Do not tell a customer the lab or IG is free to run.
2. **Route order.** That IG tries routes in route-name order is an assumption; the seed notes relied on it.
3. **A route with no condition** matching every request is an assumption.
4. **Only the `\.` case was observed.** (Measured 2026-11-01, experiment LX2: a request no route claims got a bare 404 with `content-length: 0`, the shape the simulator predicts; that says nothing about parse errors.) One real deployment logged that a route was not valid and then answered 404 with no body. That every other parse error does the same, and the exact log wording, are UNVERIFIED.
5. **A parse error blocks only that route.** The lab keeps the other routes loaded. Whether real IG does is UNVERIFIED.
6. **`find(null, ...)` is an error here.** Whether IG errors or returns false is UNVERIFIED. The seed routes guard with `not empty ...` first, which is why the lab is strict.
7. **`request.uri.path`: partly measured, the simulator is wrong on one point.** Measured 2026-11-01 on one local PingGateway 2026.6.0 (build 20260629), unauthenticated GETs only (`docs/live-checks.md`, experiments LX4 and LX5): `/%68ealth` (a percent-encoded `h`) was answered by the route whose condition is `find(request.uri.path, '^/health$')`, so the gateway matched on the DECODED path; `/x/../health` was not (404), so dot-segments are NOT removed before routing. The simulator keeps the path raw, so it predicted a 404 for both and is wrong for the first. Not measured: reserved characters (`%2F`), `%2e%2e`, double encoding, other versions. This branch does not change the simulator; whether it should decode is an owner decision.
8. **`matches()` is a whole-string match** and `find()` a search. IG's regex engine is Java's; this lab uses JavaScript's, so rare syntax differs.
9. **Equality is strict** (a list never equals a string); IG's coercion may differ.
10. **The empty-first-param shape** (`Bearer , resource_metadata=...`): one real client (LM Studio's MCP bridge) rejected it, reported in an earlier demo and **not re-measured here**. Which other clients break is UNVERIFIED. Whether the leading comma is strictly illegal under the HTTP list rules is arguable and is stated as such.
11. **Every "client that breaks" note** in the lint rules is labelled UNVERIFIED unless the rule's `basis` is `observed` (only WA001). The RFC statements are written from memory and the RFCs are marked not-read in the content pack.
12. **How real IG answers** an inactive token, a wrong audience, a missing scope or an unreachable introspection endpoint (this lab: 401, 401, 403, 503) is UNVERIFIED. The 401/403 shapes follow the Bearer contract, not IG's behaviour. Only the no-credentials case was measured (2026-11-01, experiment LX3): a protected route answered 401 with a `Bearer resource_metadata="..."` challenge, no realm, and the linter finds it clean; the simulator predicted 401 with a challenge (which carries a realm the real one lacks).

## Overlaps and boundaries

This lab is about route matching, header shapes and introspection only. The authorization side-band for an identity-aware route (B11), tool-argument guarding (D32) and stub gateway decisions in the agent gateway inspector are other apps; nothing here imports or calls them.
