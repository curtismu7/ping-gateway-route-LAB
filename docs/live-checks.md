# Live checks (instructions only, owner-only)

Nothing in this repo runs these. They are what an owner could do against a **real** PingGateway to turn UNVERIFIED items into facts. Do not run them against a shared or production gateway, and never paste a real host, token or tenant id into this repo.

All of them are owner-only writes to a gateway the owner controls.

1. Put a route with `'^host\.example'` in a condition on a scratch IG and read its startup log. Record the exact wording, and whether other routes still load. Settles items 4 and 5 in `docs/safety.md`.
2. Put two routes that both match one request and see which answers. Settles route order (item 2).
3. Add a route with no `condition`. Settles item 3.
4. Evaluate `find(null, 'x')` in a condition and see whether the route errors or does not match. Settles item 6.
5. Send `/a%2Fb/../c` and see what `request.uri.path` holds. Settles item 7.
6. Stop the introspection endpoint and note the status a client sees (item 12).
7. Check the licence terms of the image you used before telling anyone it is free to run. UNVERIFIED until you have read them.

Record the result next to the item and change the text in `docs/safety.md` from UNVERIFIED only when you have the evidence.
