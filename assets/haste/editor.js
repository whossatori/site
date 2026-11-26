(() => {
  const editorUrl = '/admin/paste/';
  const adminApi = 'https://api.satos.cc/admin/haste';
  const previewBytes = 2 * 1024 * 1024;
  const maxBytes = 250 * 1024 * 1024;
  const separator = '\n\n---\n\n';
  const idPattern = /^[A-Za-z0-9]{3}$/;
  const viewId = location.pathname.match(/^\/h\/([A-Za-z0-9]{3})\/?$/)?.[1];
  const editQuery = new URLSearchParams(location.search).get('edit') ?? '';
  const editId = idPattern.test(editQuery) ? editQuery : null;
  const token = viewId ? null : localStorage.getItem('admin_token');
  if (!viewId && !token) {
    location.replace('/home/?paste=' + (editId ?? 'create'));
    return;
  }

  const panes = document.getElementById('panes');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const create = document.getElementById('new');
  const split = document.getElementById('split');
  const raw = document.getElementById('raw');
  const drafts = [];
  let busy = false;

  const rawUrl = id => '/h/r/' + id;

  function hasDraft() {
    return drafts.some(pane => pane.attached?.size || pane.input.value);
  }

  function updateEditor() {
    save.disabled = busy || drafts.some(pane => pane.loading) || !hasDraft();
    split.disabled = create.disabled = busy;
    for (const { input, attached, loading } of drafts) {
      input.readOnly = busy || loading || Boolean(attached?.size > previewBytes && !input.value);
    }
  }

  function mountPane(text, editable) {
    const pane = document.createElement('div');
    const field = document.createElement(editable ? 'textarea' : 'pre');
    pane.className = 'pane';
    field.setAttribute('aria-label', 'Paste pane ' + (panes.childElementCount + 1));
    if (editable) {
      field.value = text;
      field.spellcheck = false;
      field.autocomplete = 'off';
    } else {
      field.textContent = text;
      field.tabIndex = 0;
    }
    pane.append(field);
    panes.append(pane);
    return { pane, field };
  }

  function addDraft(text = '', attached = null) {
    const { pane, field: input } = mountPane(text, true);
    const draft = { input, attached, loading: false };
    drafts.push(draft);
    input.addEventListener('input', () => {
      draft.attached = null;
      status.textContent = '';
      updateEditor();
    });
    pane.addEventListener('dragover', event => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      pane.classList.add('dragging');
    });
    pane.addEventListener('dragleave', () => pane.classList.remove('dragging'));
    pane.addEventListener('drop', event => {
      pane.classList.remove('dragging');
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      if (event.dataTransfer.files.length === 1) attach(draft, event.dataTransfer.files[0]);
      else status.textContent = 'Drop one text file per pane.';
    });
    updateEditor();
    return input;
  }

  async function attach(draft, file) {
    if (busy || draft.loading) return;
    if (!file.size || file.size > maxBytes) {
      status.textContent = file.size ? 'Text files can be up to 250 MiB.' : 'The file is empty.';
      return;
    }
    draft.loading = true;
    updateEditor();
    try {
      const large = file.size > previewBytes;
      const text = large ? '' : new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (text.includes('\0')) throw new Error('Binary file');
      draft.input.value = text;
      draft.attached = file;
      status.textContent = large ? file.name + ' is attached. Save to upload it.' : file.name;
    } catch {
      status.textContent = 'Choose a UTF-8 text file.';
    } finally {
      draft.loading = false;
      updateEditor();
      draft.input.focus();
    }
  }

  async function fetchPaste(id) {
    const response = await fetch(rawUrl(id));
    if (!response.ok) throw new Error(response.status === 404 ? 'Paste not found.' : 'Could not load the paste.');
    return response;
  }

  async function previewOf(response) {
    const reader = response.body.getReader();
    const chunks = [];
    let remaining = previewBytes;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return { blob: new Blob(chunks), truncated: false };
      if (value.length > remaining) {
        chunks.push(value.subarray(0, remaining));
        await reader.cancel();
        return { blob: new Blob(chunks), truncated: true };
      }
      chunks.push(value);
      remaining -= value.length;
    }
  }

  function slicePanes(blob, layout) {
    if (!layout) return [blob];
    const panesInFile = [];
    let offset = 0;
    for (const length of layout.split(',').map(Number)) {
      if (offset > blob.size || (offset === blob.size && length)) break;
      panesInFile.push(blob.slice(offset, offset + length));
      offset += length + separator.length;
    }
    return panesInFile;
  }

  async function openViewer() {
    raw.href = rawUrl(viewId);
    raw.hidden = false;
    document.title = 'Paste · ' + viewId;
    status.textContent = 'Loading paste…';
    try {
      const response = await fetchPaste(viewId);
      const { blob, truncated } = await previewOf(response);
      for (const part of slicePanes(blob, response.headers.get('X-Haste-Panes'))) {
        mountPane(await part.text(), false);
      }
      status.textContent = truncated ? 'Showing the first 2 MiB. Raw opens the full paste.' : '';
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
      for (const part of slicePanes(original, response.headers.get('X-Haste-Panes'))) {
        addDraft(await part.text(), part);
      }
      status.textContent = 'Editing a copy.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      const first = drafts[0]?.input ?? addDraft();
      updateEditor();
      first.focus();
    }
  }

  async function publish() {
    if (save.disabled) return;
    const parts = drafts.map(pane => pane.attached ?? new Blob([pane.input.value]));
    const file = parts.length === 1 ? parts[0] : new Blob(parts.flatMap((part, index) => index ? [separator, part] : [part]));
    if (file.size > maxBytes) {
      status.textContent = 'The combined paste is over 250 MiB.';
      return;
    }
    const headers = new Headers({ Authorization: 'Bearer ' + token });
    let body = file;
    if (parts.length > 1) {
      body = new FormData();
      body.append('file', file, 'paste.txt');
      body.append('panes', parts.map(part => part.size).join(','));
    } else {
      headers.set('Content-Type', 'text/plain; charset=utf-8');
    }
    busy = true;
    updateEditor();
    status.textContent = 'Saving…';
    try {
      const response = await fetch(adminApi, { method: 'POST', headers, body });
      if (response.status === 401) {
        if (localStorage.getItem('admin_token') === token) localStorage.removeItem('admin_token');
        status.textContent = 'Your session expired. Copy your draft before signing in again.';
        return;
      }
      const paste = await response.json().catch(() => null);
      if (!response.ok || !paste || !idPattern.test(paste.id)) {
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

  document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing) return;
    let action;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyS') {
      action = save;
    } else if (event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (event.code === 'KeyQ') action = split;
      if (event.code === 'KeyN') action = create;
      if (event.code === 'KeyR') action = raw;
    }
    if (action && !action.hidden && !action.disabled) {
      event.preventDefault();
      action.click();
    }
  });

  if (viewId) {
    openViewer();
    return;
  }
  save.hidden = create.hidden = split.hidden = false;
  save.addEventListener('click', publish);
  split.addEventListener('click', () => addDraft().focus());
  create.addEventListener('click', () => {
    if (hasDraft() && !confirm('Discard this draft and start a new paste?')) return;
    location.assign(editorUrl);
  });
  if (editId) loadDraft();
  else addDraft().focus();
})();
