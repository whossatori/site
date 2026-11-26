const origin = 'https://api.satos.cc';

export async function onRequest({ request, next, env }) {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/i/') && !path.startsWith('/x/')) return next();

  if (/^\/i\/del\/[A-Za-z0-9]{3}\/?$/.test(path)) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const asset = new URL('/admin/delete-image/', request.url);
    const page = await env.ASSETS.fetch(new Request(asset, { method: request.method }));
    const headers = new Headers(page.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https://api.satos.cc; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    return new Response(page.body, { status: page.status, headers });
  }

  const deletion = /^\/(?:i\/del|x\/(?:del|delete))\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(path);
  const image = /^\/i\/[A-Za-z0-9]{3}\/?$/.test(path)
    || /^\/x\/[A-Za-z0-9]+(?:[./].*)?$/.test(path);
  if (!deletion && !image) return new Response('Not found', { status: 404 });
  if (request.method !== 'GET' && (request.method !== 'HEAD' || deletion)) {
    return new Response('Method not allowed', {
      status: 405, headers: { Allow: deletion ? 'GET' : 'GET, HEAD' },
    });
  }

  const headers = new Headers();
  for (const name of ['Range', 'If-Range']) {
    const value = request.headers.get(name);
    if (value && !deletion) headers.set(name, value);
  }
  const response = await fetch(origin + path, { method: request.method, headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    return new Response('Unexpected response from the image server', { status: 502 });
  }
  return response;
}
