# Safety, and what is simulated

**This lab is a simulated evaluator, not real PingGateway.** The banner says so on every page and every tab, presenter mode included, and every API answer carries the header `X-Simulated-Evaluator`. There is no real-IG lane in this build.

## What is simulated, and what only a real IG shows

| Thing | In this lab | What only a real PingGateway shows |
| --- | --- | --- |
| Route conditions | A small hand-written interpreter for the expression subset real routes use (see `server/src/el.js`) | IG's own expression-language (EL) parse errors: its exact error messages, every function and operator it supports, its type coercion |
| The `\.` trap | Reproduced as a documented simulation: the condition is refused, the route is marked **not loaded**, a request only that route would serve gets a bare 404 | The real log line, the real startup behaviour, whether other routes keep loading, and what happens on a route reload |
| Route choice | Every route is tested; the first match **by route name** wins | IG's real ordering rule and its handling of ties |
| Handler chain | Only the resource-server filter is modelled (token introspection, audience, scope, 401/403) | Filter order, scripts (Groovy), token exchange, header filters, reverse proxying, audit |
| Introspection | A mock RFC 7662 authorization server in the same process, with a virtual clock | A real authorization server, network failure modes, caching, client authentication |
| WWW-Authenticate | The linter reads any header you give it; the handler builds the shapes its settings say | What a real filter or script actually emits |

## What this build does not do

- It never contacts a real PingGateway, tenant, authorization server or any other host. A runtime guard refuses every non-loopback socket, DNS lookup, fetch, UDP send and UDP connect, and the doctor proves it by trying (7 attempts, all refused).
- Live mode is refused for now: the Mock | Live switch in the header leaves the page in Mock and says why. There is no live lane, so nothing here can reach a real PingGateway even if asked to.
- It binds to loopback only, checks the `Host` header, and refuses cross-origin writes.
- It issues only mock tokens (`mock-tok-` plus hex). Nothing is signed; there is no key material at all, so there is no key generation anywhere in the code.
- Seed routes use `.example` hosts and generic `LAB_` environment names. Every host in every shipped file must be `.invalid`, `.example` or loopback, and the tests and the doctor scan for it.

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
4. **Only the `\.` case was observed.** One real deployment logged that a route was not valid and then answered 404 with no body. That every other parse error does the same, and the exact log wording, are UNVERIFIED.
5. **A parse error blocks only that route.** The lab keeps the other routes loaded. Whether real IG does is UNVERIFIED.
6. **`find(null, ...)` is an error here.** Whether IG errors or returns false is UNVERIFIED. The seed routes guard with `not empty ...` first, which is why the lab is strict.
7. **`request.uri.path`** is the raw path as sent here (not decoded, dot-segments kept). Whether IG decodes it is UNVERIFIED.
8. **`matches()` is a whole-string match** and `find()` a search. IG's regex engine is Java's; this lab uses JavaScript's, so rare syntax differs.
9. **Equality is strict** (a list never equals a string); IG's coercion may differ.
10. **The empty-first-param shape** (`Bearer , resource_metadata=...`): one real client (LM Studio's MCP bridge) rejected it, reported in an earlier demo and **not re-measured here**. Which other clients break is UNVERIFIED. Whether the leading comma is strictly illegal under the HTTP list rules is arguable and is stated as such.
11. **Every "client that breaks" note** in the lint rules is labelled UNVERIFIED unless the rule's `basis` is `observed` (only WA001). The RFC statements are written from memory and the RFCs are marked not-read in the content pack.
12. **How real IG answers** an inactive token, a wrong audience, a missing scope or an unreachable introspection endpoint (this lab: 401, 401, 403, 503) is UNVERIFIED. The 401/403 shapes follow the Bearer contract, not IG's behaviour.

## Overlaps and boundaries

This lab is about route matching, header shapes and introspection only. The authorization side-band for an identity-aware route (B11), tool-argument guarding (D32) and stub gateway decisions in the agent gateway inspector are other apps; nothing here imports or calls them.
