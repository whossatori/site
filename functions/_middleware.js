const origin = 'https://api.satos.cc';

async function serveHaste(request, env, path) {
  const paste = path.match(/^\/h\/(r\/)?([A-Za-z0-9]{3})\/?$/);
  if (!paste) return new Response('Paste not found', { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  // The API keeps serving plain text. Only the public view URL loads the editor shell.
  const [, raw, id] = paste;
  const data = await fetch(origin + '/h/' + id, {
    method: raw ? request.method : 'HEAD', redirect: 'manual',
  });
  if (data.status >= 300 && data.status < 400) {
    return new Response('Unexpected response from the paste server', { status: 502 });
  }
  if (raw) return data;
  if (!data.ok) {
    return new Response(request.method === 'HEAD' ? null : 'Paste unavailable', {
      status: data.status, headers: { 'Cache-Control': 'no-store' },
    });
  }

  const asset = new URL('/admin/paste/', request.url);
  const page = await env.ASSETS.fetch(new Request(asset, { method: request.method }));
  const headers = new Headers(page.headers);
  headers.set('Cache-Control', 'no-store');
  return new Response(page.body, { status: page.status, headers });
}

export async function onRequest({ request, next, env }) {
  const path = new URL(request.url).pathname;
  if (path.startsWith('/h/')) return serveHaste(request, env, path);
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
    if (value && image) headers.set(name, value);
  }
  const response = await fetch(origin + path, { method: request.method, headers, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    return new Response('Unexpected response from the upload server', { status: 502 });
  }
  return response;
}
