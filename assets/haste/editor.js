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
  const workspace = panes.closest('.workspace');
  const status = document.getElementById('status');
  const save = document.getElementById('save');
  const create = document.getElementById('new');
  const split = document.getElementById('split');
  const raw = document.getElementById('raw');
  const removeDialog = document.getElementById('remove-pane');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const drafts = [];
  let busy = false;
  let pointer = null;
  let focusedDraft = null;
  let pendingRemoval = null;

  const rawUrl = id => '/h/r/' + id;

  function paneHasContent(pane) {
    return Boolean(pane.attached?.size || pane.input.value);
  }

  function hasDraft() {
    return drafts.some(paneHasContent);
  }

  function updateEditor() {
    save.disabled = busy || drafts.some(pane => pane.loading) || !hasDraft();
    split.disabled = create.disabled = busy;
    for (const { input, attached, loading } of drafts) {
      input.readOnly = busy || loading || Boolean(attached?.size > previewBytes && !input.value);
    }
  }

  document.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    const revealDistance = workspace.classList.contains('toolbar-open') ? 54 : 16;
    workspace.classList.toggle('toolbar-open', pointer.y <= revealDistance);
  });
  function clearPointer() {
    pointer = null;
    workspace.classList.remove('toolbar-open');
  }
  document.documentElement.addEventListener('pointerleave', clearPointer);
  window.addEventListener('blur', clearPointer);

  function makePane(text, editable) {
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
    pane.addEventListener('pointerenter', event => {
      if (!busy && !removeDialog.open && !event.buttons && event.pointerType !== 'touch') {
        field.focus({ preventScroll: true });
      }
    });
    return { pane, field };
  }

  function labelDrafts() {
    drafts.forEach((draft, index) => draft.input.setAttribute('aria-label', 'Paste pane ' + (index + 1)));
  }

  function addDraft(text = '', attached = null, placement = null) {
    const { pane, field: input } = makePane(text, true);
    const draft = { pane, input, attached, loading: false };
    if (placement) {
      const { target, stacked, before } = placement;
      const group = document.createElement('div');
      group.className = stacked ? 'split-group stacked' : 'split-group';
      target.pane.replaceWith(group);
      if (before) group.append(pane, target.pane);
      else group.append(target.pane, pane);
      drafts.splice(drafts.indexOf(target) + (before ? 0 : 1), 0, draft);
    } else {
      panes.append(pane);
      drafts.push(draft);
    }
    labelDrafts();
    input.addEventListener('focus', () => { focusedDraft = draft; });
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
    return draft;
  }

  function hoveredDraft() {
    if (!pointer) return null;
    const pane = document.elementFromPoint(pointer.x, pointer.y)?.closest('.pane');
    return drafts.find(draft => draft.pane === pane) ?? null;
  }

  function splitPlacement(target, point) {
    if (!target) return null;
    const box = target.pane.getBoundingClientRect();
    const canSplitAcross = innerWidth > 700 && box.width >= 420;
    const canStack = box.height >= 260;
    if (!canSplitAcross && !canStack) return null;
    const x = point ? (point.x - box.left) / box.width - .5 : 0;
    const y = point ? (point.y - box.top) / box.height - .5 : 0;
    const stacked = canStack && (!canSplitAcross || Math.abs(y) > Math.abs(x));
    return { target, stacked, before: (stacked ? y : x) < 0 };
  }

  function animateOpen(pane, origin) {
    if (reduceMotion.matches) return;
    const box = pane.getBoundingClientRect();
    if (!box.width || !box.height) return;
    let from = 'scale(.985)';
    let transformOrigin = 'center';
    if (origin) {
      const size = 20;
      const x = origin.x - box.left - size / 2;
      const y = origin.y - box.top - size / 2;
      from = `translate(${x}px, ${y}px) scale(${size / box.width}, ${size / box.height})`;
      transformOrigin = 'top left';
    }
    pane.classList.add('opening');
    const animation = pane.animate([
      { transform: from, transformOrigin, opacity: .45 },
      { transform: 'none', transformOrigin, opacity: 1 },
    ], { duration: 210, easing: 'cubic-bezier(.18,.76,.25,1)' });
    const end = () => pane.classList.remove('opening');
    animation.finished.then(end, end);
  }

  function openSplit() {
    const hovered = hoveredDraft();
    const target = hovered ?? focusedDraft;
    const draft = addDraft('', null, splitPlacement(target, hovered ? pointer : null));
    draft.input.focus();
    animateOpen(draft.pane, pointer);
  }

  function discardDraft(draft) {
    const index = drafts.indexOf(draft);
    if (index < 0 || drafts.length === 1) return;
    const group = draft.pane.parentElement;
    if (group.classList.contains('split-group')) {
      const sibling = [...group.children].find(child => child !== draft.pane);
      group.replaceWith(sibling);
    } else {
      draft.pane.remove();
    }
    drafts.splice(index, 1);
    labelDrafts();
    status.textContent = '';
    updateEditor();
    const next = hoveredDraft() ?? drafts[Math.min(index, drafts.length - 1)];
    next.input.focus({ preventScroll: true });
  }

  function askToDiscard(draft) {
    if (!paneHasContent(draft)) {
      discardDraft(draft);
      return;
    }
    pendingRemoval = draft;
    const { x, y } = pointer;
    removeDialog.returnValue = '';
    removeDialog.showModal();
    const margin = 12;
    const left = Math.max(margin, Math.min(x + margin, innerWidth - removeDialog.offsetWidth - margin));
    const top = Math.max(margin, Math.min(y + margin, innerHeight - removeDialog.offsetHeight - margin));
    removeDialog.style.left = left + 'px';
    removeDialog.style.top = top + 'px';
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
        panes.append(makePane(await part.text(), false).pane);
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
      const first = drafts[0] ?? addDraft();
      updateEditor();
      first.input.focus();
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
    if (event.repeat || event.isComposing || removeDialog.open) return;
    let action;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.code === 'KeyS') {
      action = save;
    } else if (event.altKey && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
      if (event.code === 'KeyQ') action = split;
      if (event.code === 'KeyN') action = create;
      if (event.code === 'KeyR') action = raw;
      if (event.code === 'KeyE' && !viewId && !busy && drafts.length > 1) {
        const draft = hoveredDraft();
        if (draft && !draft.loading) {
          event.preventDefault();
          askToDiscard(draft);
        }
        return;
      }
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
  split.addEventListener('click', openSplit);
  removeDialog.addEventListener('close', () => {
    const draft = pendingRemoval;
    pendingRemoval = null;
    if (!draft) return;
    if (removeDialog.returnValue === 'remove') discardDraft(draft);
    else draft.input.focus({ preventScroll: true });
  });
  create.addEventListener('click', () => {
    if (hasDraft() && !confirm('Discard this draft and start a new paste?')) return;
    location.assign(editorUrl);
  });
  if (editId) loadDraft();
  else {
    const draft = addDraft();
    draft.input.focus();
    animateOpen(draft.pane, null);
  }
})();
