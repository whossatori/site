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
  const narrow = matchMedia('(max-width: 700px)');
  const paneGap = parseFloat(getComputedStyle(panes).getPropertyValue('--pane-gap')) || 8;
  const drafts = [];
  let busy = false;
  let pointer = null;
  let lastFocusedField = null;
  let pendingRemoval = null;
  let resizeDrag = null;

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
    if (resizeDrag) {
      if (event.pointerId !== resizeDrag.pointerId) return;
      if (event.altKey && (event.buttons & 1)) resizeAt(pointer);
      else stopResize();
      return;
    }
    const revealDistance = workspace.classList.contains('toolbar-open') ? 54 : 16;
    workspace.classList.toggle('toolbar-open', pointer.y <= revealDistance);
    setResizeCursor(event.altKey && !busy && !removeDialog.open ? dividerAt(pointer) : null);
  });
  function clearPointer() {
    pointer = null;
    stopResize();
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
    field.addEventListener('focus', () => { lastFocusedField = field; });
    pane.addEventListener('pointerenter', event => {
      if (!busy && !resizeDrag && !removeDialog.open && !event.buttons && event.pointerType !== 'touch') {
        field.focus({ preventScroll: true });
      }
    });
    return { pane, field };
  }

  function labelDrafts() {
    drafts.forEach((draft, index) => draft.input.setAttribute('aria-label', 'Paste pane ' + (index + 1)));
  }

  function makeSplitGroup(stacked) {
    const group = document.createElement('div');
    group.className = stacked ? 'split-group stacked' : 'split-group';
    return group;
  }

  function splitAxis(group) {
    return narrow.matches || group.classList.contains('stacked') ? 'rows' : 'columns';
  }

  function minimumSize(node, axis) {
    if (!node.classList.contains('split-group')) return axis === 'columns' ? 140 : 104;
    const [first, second] = node.children;
    const a = minimumSize(first, axis);
    const b = minimumSize(second, axis);
    return splitAxis(node) === axis ? a + paneGap + b : Math.max(a, b);
  }

  function refreshLayoutHeight() {
    const root = panes.firstElementChild;
    if (root) panes.style.setProperty('--layout-min-height', Math.max(200, minimumSize(root, 'rows')) + 'px');
  }

  function stackRows(rows) {
    if (rows.length === 1) return rows[0];
    const middle = Math.ceil(rows.length / 2);
    const group = makeSplitGroup(true);
    group.style.setProperty('--split-position', middle / rows.length * 100 + '%');
    group.append(stackRows(rows.slice(0, middle)), stackRows(rows.slice(middle)));
    return group;
  }

  function arrangeDefaultLayout() {
    const leaves = [...panes.children];
    if (leaves.length > 1) {
      const rows = [];
      for (let index = 0; index < leaves.length; index += 2) {
        const first = leaves[index];
        const second = leaves[index + 1];
        if (!second) {
          rows.push(first);
          break;
        }
        const row = makeSplitGroup(false);
        row.append(first, second);
        rows.push(row);
      }
      panes.replaceChildren(stackRows(rows));
    }
    refreshLayoutHeight();
  }

  function addDraft(text = '', attached = null, placement = null) {
    const { pane, field: input } = makePane(text, true);
    const draft = { pane, input, attached, loading: false };
    if (placement) {
      const { target, stacked, before, index } = placement;
      const group = makeSplitGroup(stacked);
      target.replaceWith(group);
      if (before) group.append(pane, target);
      else group.append(target, pane);
      drafts.splice(index, 0, draft);
    } else {
      panes.append(pane);
      drafts.push(draft);
    }
    labelDrafts();
    refreshLayoutHeight();
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

  function hoveredPane() {
    return pointer ? document.elementFromPoint(pointer.x, pointer.y)?.closest('.pane') : null;
  }

  function hoveredDraft() {
    const pane = hoveredPane();
    return drafts.find(draft => draft.pane === pane) ?? null;
  }

  function selectActivePane() {
    const active = document.activeElement;
    const field = active?.closest('.pane')?.firstElementChild
      ?? hoveredPane()?.firstElementChild
      ?? (lastFocusedField?.isConnected ? lastFocusedField : panes.querySelector('textarea, pre'));
    if (!field) return false;
    field.focus({ preventScroll: true });
    if (field.tagName === 'TEXTAREA') field.select();
    else {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(field);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return true;
  }

  function dividerAt(point) {
    if (!point || !panes.contains(document.elementFromPoint(point.x, point.y))) return null;
    let nearest = null;
    for (const group of panes.querySelectorAll('.split-group')) {
      const box = group.getBoundingClientRect();
      if (point.x < box.left || point.x > box.right || point.y < box.top || point.y > box.bottom) continue;
      const axis = splitAxis(group);
      const first = group.firstElementChild;
      const center = axis === 'columns' ? box.left + first.offsetWidth + paneGap / 2 : box.top + first.offsetHeight + paneGap / 2;
      const distance = Math.abs((axis === 'columns' ? point.x : point.y) - center);
      if (distance <= 12 && (!nearest || distance < nearest.distance)) nearest = { group, axis, center, distance };
    }
    return nearest;
  }

  function setResizeCursor(target) {
    if (target) panes.dataset.resizeAxis = target.axis;
    else delete panes.dataset.resizeAxis;
  }

  function resizeAt(point) {
    const { group, axis, offset, firstMin, secondMin } = resizeDrag;
    const box = group.getBoundingClientRect();
    const across = axis === 'columns';
    const extent = across ? box.width : box.height;
    if (extent <= paneGap) return;
    const scale = Math.min(1, (extent - paneGap) / (firstMin + secondMin));
    const position = (across ? point.x - box.left : point.y - box.top) - offset;
    const lower = firstMin * scale + paneGap / 2;
    const upper = extent - secondMin * scale - paneGap / 2;
    const clamped = Math.max(lower, Math.min(position, upper));
    group.style.setProperty('--split-position', clamped / extent * 100 + '%');
  }

  function stopResize() {
    const drag = resizeDrag;
    resizeDrag = null;
    delete panes.dataset.resizing;
    setResizeCursor(null);
    if (drag && panes.hasPointerCapture(drag.pointerId)) panes.releasePointerCapture(drag.pointerId);
  }

  panes.addEventListener('pointerdown', event => {
    if (!event.altKey || event.button !== 0 || event.pointerType === 'touch' || busy || removeDialog.open) return;
    const point = { x: event.clientX, y: event.clientY };
    const divider = dividerAt(point);
    if (!divider) return;
    const [first, second] = divider.group.children;
    resizeDrag = {
      group: divider.group,
      axis: divider.axis,
      offset: (divider.axis === 'columns' ? point.x : point.y) - divider.center,
      pointerId: event.pointerId,
      firstMin: minimumSize(first, divider.axis),
      secondMin: minimumSize(second, divider.axis),
    };
    event.preventDefault();
    panes.setPointerCapture(event.pointerId);
    panes.dataset.resizing = '';
    setResizeCursor(divider);
  }, true);
  panes.addEventListener('pointerup', event => {
    if (resizeDrag?.pointerId === event.pointerId) stopResize();
  });
  panes.addEventListener('dragstart', event => {
    if (resizeDrag) event.preventDefault();
  });
  panes.addEventListener('lostpointercapture', event => {
    if (resizeDrag?.pointerId === event.pointerId) stopResize();
  });
  document.addEventListener('keyup', event => {
    if (event.key === 'Alt') stopResize();
  });
  narrow.addEventListener('change', () => {
    stopResize();
    refreshLayoutHeight();
  });

  function splitPlacement(target, point) {
    if (!target) return null;
    const box = target.pane.getBoundingClientRect();
    const canSplitAcross = !narrow.matches && box.width >= 420;
    const canStack = box.height >= 260;
    if (!canSplitAcross && !canStack) return null;
    const x = point ? (point.x - box.left) / box.width - .5 : 0;
    const y = point ? (point.y - box.top) / box.height - .5 : 0;
    const stacked = canStack && (!canSplitAcross || Math.abs(y) > Math.abs(x));
    const before = (stacked ? y : x) < 0;
    return { target: target.pane, stacked, before, index: drafts.indexOf(target) + (before ? 0 : 1) };
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
    const target = hovered ?? drafts.find(draft => draft.input === lastFocusedField) ?? drafts.at(-1);
    const placement = splitPlacement(target, hovered ? pointer : null)
      ?? { target: panes.firstElementChild, stacked: true, before: false, index: drafts.length };
    const draft = addDraft('', null, placement);
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
    refreshLayoutHeight();
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
      arrangeDefaultLayout();
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
      arrangeDefaultLayout();
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
    if (event.repeat || event.isComposing || removeDialog.open || resizeDrag) return;
    if (event.key === 'Alt' && !busy) setResizeCursor(dividerAt(pointer));
    const control = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey;
    if (control && event.key.toLowerCase() === 'a' && selectActivePane()) {
      event.preventDefault();
      return;
    }
    let action;
    if (control && event.code === 'KeyS') {
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
