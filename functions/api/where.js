// GET /api/where → { ip, country, region, city, isp }
// Where this request came from, as Cloudflare sees it (request.cf), for the usage log
// (app/js/usage.js). No secrets needed; locally (tools/dev-server.mjs) only the IP is known.

import { json } from '../_lib/util.js';

export async function onRequestGet({ request }) {
  const cf = request.cf || {};
  const h = request.headers;
  const ip = h.get('CF-Connecting-IP') || (h.get('X-Forwarded-For') || '').split(',')[0].trim() || h.get('X-Real-IP') || '';
  return json({ ip, country: cf.country || '', region: cf.region || '', city: cf.city || '', isp: cf.asOrganization || '' });
}
