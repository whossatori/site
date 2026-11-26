(() => {
  const token = localStorage.getItem('admin_token');
  if (!token) {
    location.replace('/admin/');
    return;
  }

  const base = 'https://api.satos.cc/admin/haste';
  const status = document.getElementById('status');
  document.querySelector('main').hidden = false;

  async function request(path = '', options = {}) {
    const headers = new Headers(options.headers);
    headers.set('Authorization', 'Bearer ' + token);
    const response = await fetch(base + path, { ...options, headers });
    if (response.status === 401) {
      if (localStorage.getItem('admin_token') === token) localStorage.removeItem('admin_token');
      location.replace('/admin/');
      throw new Error('Sign in again to manage pastes.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data) throw new Error(data?.error ?? 'Could not reach the paste service.');
    return data;
  }

  async function copyLink(link) {
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = 'Could not copy the link.';
    }
  }

  const form = document.getElementById('paste-form');
  if (form) {
    const input = document.getElementById('paste-text');
    const submit = form.querySelector('button');
    const result = document.getElementById('paste-result');
    const link = document.getElementById('paste-link');
    document.getElementById('copy-link').addEventListener('click', () => copyLink(link.href));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = 'Publishing…';
      try {
        const paste = await request('', {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          body: input.value,
        });
        link.href = link.textContent = paste.link;
        result.hidden = false;
        status.textContent = 'Paste published.';
      } catch (error) {
        status.textContent = error.message;
      } finally {
        submit.disabled = false;
      }
    });
    return;
  }

  const list = document.getElementById('paste-list');
  const template = document.getElementById('paste-row');
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  function rowFor(paste) {
    const row = template.content.firstElementChild.cloneNode(true);
    const link = row.querySelector('.paste-link');
    link.href = link.textContent = paste.link;
    row.querySelector('.paste-preview').textContent = paste.preview;
    const time = row.querySelector('time');
    time.dateTime = new Date(paste.created_at).toISOString();
    time.textContent = date.format(paste.created_at);
    row.querySelector('.copy').addEventListener('click', () => copyLink(paste.link));
    row.querySelector('.delete').addEventListener('click', async event => {
      if (!confirm('Delete paste ' + paste.id + '?')) return;
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await request('/' + paste.id, { method: 'DELETE' });
        row.remove();
        status.textContent = list.childElementCount ? 'Paste deleted.' : 'No pastes yet.';
      } catch (error) {
        status.textContent = error.message;
        button.disabled = false;
      }
    });
    return row;
  }

  request().then(pastes => {
    list.replaceChildren(...pastes.map(rowFor));
    status.textContent = pastes.length ? '' : 'No pastes yet.';
  }).catch(error => { status.textContent = error.message; });
})();
