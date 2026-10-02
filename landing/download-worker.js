const filename = 'Cue-0.1.4-apple-silicon.dmg';
const download = '/downloads/' + filename;
const validWebsiteId = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');

function trackInstallerRequest(ctx, websiteId, hostname) {
  ctx.waitUntil(fetch('https://cloud.umami.is/api/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'Cue-Download-Worker/1.0' },
    body: JSON.stringify({
      type: 'event',
      payload: { website: websiteId, hostname, url: '/downloads/installer', name: 'Installer request served' },
    }),
  }).catch(() => {}));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== download) return env.ASSETS.fetch(request);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    try {
      const object = request.method === 'HEAD' ? await env.BUCKET.head(filename) : await env.BUCKET.get(filename, { range: request.headers });
      if (!object) return new Response('Download temporarily unavailable. Please try again shortly.', { status: 503, headers: { 'Retry-After': '60' } });
      if (request.method === 'GET' && validWebsiteId(env.UMAMI_WEBSITE_ID)) trackInstallerRequest(ctx, env.UMAMI_WEBSITE_ID, url.hostname);
      const headers = new Headers({ 'Content-Type': 'application/x-apple-diskimage', 'Content-Disposition': 'attachment; filename="' + filename + '"', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
      headers.set('ETag', object.httpEtag);
      const range = request.method === 'GET' && request.headers.has('range') ? object.range : undefined;
      const offset = range?.offset ?? (range?.suffix ? Math.max(0, object.size - range.suffix) : 0);
      const length = range?.length ?? (object.size - offset);
      headers.set('Content-Length', String(length));
      if (range) headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
      return new Response(request.method === 'HEAD' ? null : object.body, { status: range ? 206 : 200, headers });
    } catch (error) {
      console.error('Cue download unavailable', error);
      return new Response('Download temporarily unavailable', { status: 503 });
    }
  },
};
