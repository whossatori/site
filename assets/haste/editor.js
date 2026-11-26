(() => {
  const editorUrl = '/admin/paste/';
  const adminApi = 'https://api.satos.cc/admin/haste';
  const previewBytes = 2 * 1024 * 1024;
  const maxBytes = 250 * 1024 * 1024;
  const validId = /^[A-Za-z0-9]{3}$/;
  const viewId = location.pathname.match(/^\/h\/([A-Za-z0-9]{3})\/?$/)?.[1];
  const editQuery = new URLSearchParams(location.search).get('edit') ?? '';
  const editId = validId.test(editQuery) ? editQuery : null;
  const token = localStorage.getItem('admin_token');
  const signIn = () => location.replace('/home/?paste=' + (editId ?? 'create'));
  if (!viewId && !token) {
    signIn();
    return;
  }

  const input = document.getElementById('paste-text');
  const view = document.getElementById('paste-view');
  const surface = document.getElementById('surface');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const create = document.getElementById('new');
  const raw = document.getElementById('raw');
  const edit = document.getElementById('edit');
  const openFile = document.getElementById('open-file');
  const filePicker = document.getElementById('file');
  const copy = document.getElementById('copy-link');
  const manage = document.getElementById('manage');
  let attached = null;
  let busy = false;

  function updateEditor() {
    input.readOnly = busy || attached?.size > previewBytes && !input.value;
    openFile.disabled = busy;
    save.disabled = Boolean(viewId || busy || !attached && !input.value);
  }

  const rawUrl = id => '/h/r/' + id;
  async function fetchPaste(id) {
    const response = await fetch(rawUrl(id));
    if (!response.ok) throw new Error(response.status === 404 ? 'Paste not found.' : 'Could not load the paste.');
    return response;
  }

  async function readPreview(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let remaining = previewBytes;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { text: text + decoder.decode(), truncated: false };
      if (value.length > remaining) {
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        await reader.cancel();
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
      remaining -= value.length;
    }
  }

  async function openViewer() {
    view.hidden = false;
    raw.disabled = edit.disabled = false;
    copy.hidden = false;
    document.title = 'Haste · ' + viewId;
    status.textContent = 'Loading paste…';
    try {
      const paste = await readPreview(await fetchPaste(viewId));
      view.textContent = paste.text;
      status.textContent = paste.truncated ? 'Showing the first 2 MiB. Raw opens the full paste.' : '';
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function loadDraft() {
    busy = true;
    updateEditor();
    status.textContent = 'Loading paste…';
    try {
      const response = await fetchPaste(editId);
      const original = await response.blob();
      input.value = await original.text();
      attached = original;
      status.textContent = 'Editing a copy. Save to give it a new link.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      updateEditor();
      input.focus();
    }
  }

  async function attach(file) {
    if (!file || busy) return;
    if (!file.size || file.size > maxBytes) {
      status.textContent = file.size ? 'Text files can be up to 250 MiB.' : 'The file is empty.';
      return;
    }
    busy = true;
    updateEditor();
    try {
      if (file.size <= previewBytes) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
        if (text.includes('\0')) throw new Error('Binary file');
        input.value = text;
      } else {
        input.value = '';
      }
      attached = file;
      status.textContent = file.size <= previewBytes
        ? file.name
        : file.name + ' is attached. Save to upload the full file.';
    } catch {
      status.textContent = 'Choose a UTF-8 text file.';
    } finally {
      busy = false;
      updateEditor();
      input.focus();
    }
  }

  async function publish() {
    if (save.disabled) return;
    busy = true;
    updateEditor();
    status.textContent = 'Saving…';
    try {
      const response = await fetch(adminApi, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'text/plain; charset=utf-8' },
        body: attached ?? input.value,
      });
      if (response.status === 401) {
        if (localStorage.getItem('admin_token') === token) localStorage.removeItem('admin_token');
        status.textContent = 'Your session expired. Copy your draft before signing in again.';
        return;
      }
      const paste = await response.json().catch(() => null);
      if (!response.ok || !paste || !validId.test(paste.id)) {
        throw new Error(paste?.error ?? 'Could not save the paste.');
      }
      location.assign('/h/' + paste.id);
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      updateEditor();
    }
  }

  save.addEventListener('click', publish);
  create.addEventListener('click', () => {
    if (!viewId && (input.value || attached) && !confirm('Discard this draft and start a new paste?')) return;
    location.assign(editorUrl);
  });
  raw.addEventListener('click', () => location.assign(rawUrl(viewId)));
  edit.addEventListener('click', () => location.assign(editorUrl + '?edit=' + viewId));
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/h/' + viewId);
      status.textContent = 'Link copied.';
    } catch {
      status.textContent = 'Copy the link from the address bar.';
    }
  });

  document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing) return;
    const key = event.key.toLowerCase();
    let action;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && key === 's') {
      action = save;
    } else if (event.altKey && !event.metaKey && !event.ctrlKey) {
      if (event.shiftKey && event.code === 'KeyE') action = edit;
      if (!event.shiftKey && event.code === 'KeyN') action = create;
      if (!event.shiftKey && event.code === 'KeyR') action = raw;
    }
    if (action && !action.disabled) {
      event.preventDefault();
      action.click();
    }
  });

  manage.hidden = !token;
  if (viewId) {
    openViewer();
    return;
  }

  input.hidden = openFile.hidden = false;
  input.addEventListener('input', () => {
    attached = null;
    status.textContent = '';
    updateEditor();
  });
  openFile.addEventListener('click', () => filePicker.click());
  filePicker.addEventListener('change', () => {
    attach(filePicker.files[0]);
    filePicker.value = '';
  });
  const hasFiles = event => event.dataTransfer?.types.includes('Files');
  surface.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    surface.classList.add('dragging');
  });
  surface.addEventListener('dragleave', () => surface.classList.remove('dragging'));
  surface.addEventListener('drop', event => {
    surface.classList.remove('dragging');
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer.files.length !== 1) {
      status.textContent = 'Drop one text file at a time.';
      return;
    }
    attach(event.dataTransfer.files[0]);
  });
  updateEditor();
  if (editId) loadDraft();
  else input.focus();
})();
