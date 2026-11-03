// Builds content-pack.json for the Learning Hub from the story data, so the pack cannot drift from the scenarios.
//   node scripts/build-content-pack.mjs        (writes content-pack.json)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scenarios = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/data/scenarios.json'), 'utf8'));
const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

export function buildPack() {
  const story = (id) => scenarios.find((s) => s.id === id);
  const tryCard = (id, cardId, label) => ({ id: cardId, label, description: story(id).takeaway, group: 'try-it', action: { type: 'route', href: `/#scenario-${id}` }, story: id });
  return {
    schema: 'demo-content-pack/1',
    id: 'ping-gateway-route-lab',
    title: 'Ping Gateway Route LAB (simulated)',
    version,
    demo: { id: 'ping-gateway-route-lab', name: 'Ping Gateway Route LAB (simulated)', catalog: 'A19', baseUrl: 'http://localhost:5050', doctor: '/api/health', tags: ['pinggateway', 'ig', 'route-condition', 'www-authenticate', 'rfc9728', 'rfc7662', 'simulated', 'mock', 'live'] },
    glossary: [
      { id: 'simulated-evaluator', term: 'Simulated evaluator', definition: 'This lab reads route conditions with its own small interpreter. It is not PingGateway, shares no code with it, and cannot show what only a real gateway shows: its real parse errors, route reload and handler chain.' },
      { id: 'route-condition', term: 'Route condition', definition: 'The expression on a route that decides whether a request belongs to it, written as ${ ... }. The lab covers the part real routes use: find(), matches(), contains(), ==, !=, and, or, not, empty and request.uri, request.method, request.headers and request.queryParams.' },
      { id: 'route-order', term: 'Route order', definition: 'When two routes match, one must win. The lab assumes routes are tried in name order. Whether real IG does that is UNVERIFIED.', aliases: ['shadowed route'] },
      { id: 'invalid-escape-trap', term: 'The \\. trap', definition: 'Inside a quoted condition string only \\\' and \\\\ are legal escapes. A regex written the natural way, with \\., cannot be parsed, so the route is not loaded and its requests get a bare 404. Use [.] for a literal dot. Observed once in a real deployment; here it is simulated.' },
      { id: 'www-authenticate', term: 'WWW-Authenticate challenge', definition: 'The header a 401 carries to tell a client how to authenticate: a scheme such as Bearer followed by name="value" params separated by commas.' },
      { id: 'empty-first-param', term: 'Empty first auth-param', definition: 'A comma straight after the scheme, as in Bearer , resource_metadata="...". One real client rejected it. The lab flags it as WA001.' },
      { id: 'resource-metadata', term: 'resource_metadata', definition: 'A param in the 401 challenge that points a client at the protected-resource metadata document (RFC 9728), which names the authorization server to use.' },
      { id: 'insufficient-scope', term: 'insufficient_scope', definition: 'The token is valid but too narrow. The answer is 403 with the scope the client should ask for, not 401.' },
      { id: 'introspection', term: 'Token introspection', definition: 'The resource server asks the authorization server whether a token is active and what it carries (scope, aud, exp, client_id). An inactive token gets just {"active": false}.' },
      { id: 'live-mode', term: 'Live mode', definition: 'Opt-in. The Request simulator can send the request you composed to ONE gateway on this machine and set its real answer (status, a short list of safe headers, a bounded body preview) beside the simulator\'s prediction. The prediction, and every other tab, is still simulated. The seed routes are a scrubbed copy of one deployment, so a disagreement can mean the route table differs from your gateway.', aliases: ['real gateway', 'live check'] },
      { id: 'live-experiment', term: 'Live experiment', definition: 'An unauthenticated GET that needs no change to the gateway, with the simulator\'s prediction beside the real answer. Five ship with the lab (health, no route, a protected route, dot-segments, a percent-encoded letter). Experiments that change a gateway stay owner-run instructions.' },
      { id: 'virtual-clock', term: 'Virtual clock', definition: 'The lab moves its own clock to expire tokens, so nothing sleeps and a run is repeatable.' },
    ],
    sources: [
      { id: 'rfc6750', title: 'RFC 6750: The OAuth 2.0 Bearer Token Usage', url: 'https://www.rfc-editor.org/rfc/rfc6750', kind: 'standard', use: 'Bearer challenge params, error codes, 401 vs 403 contract', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc7235', title: 'RFC 7235: HTTP Authentication', url: 'https://www.rfc-editor.org/rfc/rfc7235', kind: 'standard', use: 'challenge and auth-param syntax', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc7662', title: 'RFC 7662: OAuth 2.0 Token Introspection', url: 'https://www.rfc-editor.org/rfc/rfc7662', kind: 'standard', use: 'the introspection response the mock AS returns', status: 'not-read', checked: '2026-10-21' },
      { id: 'rfc9728', title: 'RFC 9728: OAuth 2.0 Protected Resource Metadata', url: 'https://www.rfc-editor.org/rfc/rfc9728', kind: 'standard', use: 'resource_metadata and the metadata document lint', status: 'not-read', checked: '2026-10-21' },
    ],
    cards: [
      tryCard('S01', 'try-host', 'Same path, chosen by host'),
      tryCard('S02', 'try-miss', 'No route matches'),
      tryCard('S03', 'try-order', 'A broad route shadows a specific one'),
      tryCard('S04', 'try-dot-trap', 'The \\. trap'),
      tryCard('S05', 'try-dot-fix', 'The [.] fix'),
      tryCard('S06', 'try-lookahead', 'Negative lookahead'),
      tryCard('S07', 'try-comma', 'Bearer , resource_metadata'),
      tryCard('S08', 'try-space', 'The fixed challenge'),
      tryCard('S09', 'try-bad-shapes', 'Three ways to break resource_metadata'),
      tryCard('S10', 'try-inactive', 'Revoked and unknown tokens'),
      tryCard('S11', 'try-expired', 'Expiry on the virtual clock'),
      tryCard('S12', 'try-aud', 'Wrong audience'),
      tryCard('S13', 'try-403', 'Insufficient scope is a 403'),
      tryCard('S14', 'try-contract', '401 and 403 swapped'),
      tryCard('S15', 'try-hostile', 'A hostile condition'),
      tryCard('S16', 'try-redos', 'A catastrophic regex'),
      tryCard('S17', 'try-as-down', 'The introspection endpoint is down'),
      { id: 'concept-simulated', label: 'What is simulated', description: 'What this lab can and cannot show about real PingGateway.', group: 'concept', action: { type: 'route', href: '/#concept-simulated' }, terms: ['simulated-evaluator', 'route-condition', 'route-order', 'live-mode'] },
      { id: 'concept-challenge', label: 'Reading a 401 challenge', description: 'Scheme, params, resource_metadata and the 401 versus 403 contract.', group: 'concept', action: { type: 'route', href: '/#concept-challenge' }, terms: ['www-authenticate', 'empty-first-param', 'resource-metadata', 'insufficient-scope'] },
      { id: 'try-live', label: 'Live: the real answer beside the prediction', description: 'With Live on, send one of the five experiments to your own local gateway and compare status, challenge and body with what the simulator predicted. Off by default; the page says why when it is off.', group: 'try-it', action: { type: 'route', href: '/#/simulator' }, terms: ['live-mode', 'live-experiment'] },
      { id: 'ref-doctor', label: 'Doctor and health', description: 'Preflight checks and the demo-health/1 endpoint.', group: 'setup', action: { type: 'route', href: '/api/health' } },
    ],
    stories: scenarios.map((s) => ({ id: s.id, title: s.title, say: s.takeaway })),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(ROOT, 'content-pack.json'), `${JSON.stringify(buildPack(), null, 2)}\n`);
  console.log('wrote content-pack.json');
}
