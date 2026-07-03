document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  const canvas = document.getElementById('drawCanvas');
  const ctx = canvas.getContext('2d');
  const strokeSize = document.getElementById('stroke-size');
  const strokeValue = document.getElementById('stroke-value');
  const editorArea = document.querySelector('.editor-area');

  const state = {
    mode: 'write',
    tool: 'pen',
    color: '#0f172a',
    size: 4,
    drawing: false,
    startPoint: null,
  };

  // Saved notes index (stored in localStorage) - keeps titles for quick listing
  let savedIndex = [];

  function loadSavedIndex() {
    try {
      const raw = localStorage.getItem('savedNotesIndex');
      savedIndex = raw ? JSON.parse(raw) : [];
    } catch (e) {
      savedIndex = [];
    }
  }

  function saveSavedIndex() {
    localStorage.setItem('savedNotesIndex', JSON.stringify(savedIndex));
  }

  function renderSavedList() {
    const container = document.getElementById('saved-list');
    if (!container) return;
    container.innerHTML = '';
    savedIndex.forEach((title) => {
      const item = document.createElement('div');
      item.className = 'saved-item';
      item.innerHTML = `
        <div class="saved-title" data-title="${encodeURIComponent(title)}">${title}</div>
        <div class="saved-actions">
          <button class="load-saved" data-title="${encodeURIComponent(title)}">Mở</button>
          <button class="submit-saved" data-title="${encodeURIComponent(title)}">Submit</button>
          <button class="delete-saved" data-title="${encodeURIComponent(title)}">Xóa</button>
        </div>
      `;
      container.appendChild(item);
    });
  }

  function addToSavedList(title) {
    if (!title) return;
    // keep original title spacing for display
    if (!savedIndex.includes(title)) {
      savedIndex.unshift(title);
      // cap to 200 items
      if (savedIndex.length > 200) savedIndex = savedIndex.slice(0, 200);
      saveSavedIndex();
      renderSavedList();
    }
  }


  function resizeCanvas() {
    const rect = editorArea.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  document.querySelectorAll('.mode-switch button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.mode-switch button').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      state.mode = button.dataset.mode;
      updateMode();
    });
  });

  document.querySelectorAll('.color-btn').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.color-btn').forEach((btn) => btn.classList.remove('active'));
      button.classList.add('active');
      state.color = button.dataset.color;
    });
  });

  document.getElementById('pen-mode').addEventListener('click', () => switchTool('pen'));
  document.getElementById('line-mode').addEventListener('click', () => switchTool('line'));
  document.getElementById('eraser-mode').addEventListener('click', () => switchTool('eraser'));

  strokeSize.addEventListener('input', (e) => {
    state.size = Number(e.target.value);
    strokeValue.textContent = e.target.value;
  });

  document.getElementById('font-family').addEventListener('change', (e) => {
    document.execCommand('fontName', false, e.target.value);
    editor.focus();
  });

  document.getElementById('font-size').addEventListener('change', (e) => {
    document.execCommand('fontSize', false, e.target.value);
    editor.focus();
  });

  document.getElementById('font-color').addEventListener('change', (e) => {
    document.execCommand('foreColor', false, e.target.value);
    editor.focus();
  });

  document.getElementById('insert-table').addEventListener('click', insertTable);
  document.getElementById('save-note').addEventListener('click', saveNote);
  document.getElementById('load-note').addEventListener('click', loadNote);
  document.getElementById('export-html').addEventListener('click', exportHTML);
  document.getElementById('export-markdown').addEventListener('click', exportMarkdown);
  document.getElementById('clear-draw').addEventListener('click', clearDrawing);

  canvas.addEventListener('mousedown', (event) => {
    if (state.mode !== 'draw') return;
    state.drawing = true;
    state.startPoint = getPoint(event);
    if (state.tool === 'pen' || state.tool === 'eraser') {
      draw(state.startPoint, state.startPoint);
    }
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!state.drawing || state.mode !== 'draw') return;
    const point = getPoint(event);
    if (state.tool === 'pen' || state.tool === 'eraser') {
      draw(state.startPoint, point);
      state.startPoint = point;
    }
  });

  canvas.addEventListener('mouseup', () => {
    if (!state.drawing || state.mode !== 'draw') return;
    state.drawing = false;
  });

  canvas.addEventListener('mouseleave', () => {
    state.drawing = false;
  });

  function updateMode() {
    if (state.mode === 'draw') {
      canvas.style.display = 'block';
      editor.style.pointerEvents = 'none';
      editor.style.opacity = '0.4';
    } else {
      canvas.style.display = 'none';
      editor.style.pointerEvents = 'auto';
      editor.style.opacity = '1';
    }
  }

  // wire saved-list actions (delegated)
  document.addEventListener('click', (e) => {
    const target = e.target;
    if (target.classList.contains('load-saved')) {
      const title = decodeURIComponent(target.dataset.title || '');
      loadSavedNoteByTitle(title);
    }
    if (target.classList.contains('delete-saved')) {
      const title = decodeURIComponent(target.dataset.title || '');
      if (confirm(`Xóa ghi chú "${title}"?`)) deleteSavedNote(title);
    }
    if (target.classList.contains('submit-saved')) {
      const title = decodeURIComponent(target.dataset.title || '');
      if (confirm(`Gửi bài làm "${title}"? Bạn vẫn có thể chỉnh sửa trước khi gửi.`)) submitSavedNote(title);
    }
    // click on title -> inline rename
    if (target.classList.contains('saved-title')) {
      const oldTitle = decodeURIComponent(target.dataset.title || '');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = oldTitle;
      input.className = 'saved-rename-input';
      target.replaceWith(input);
      input.focus();
      input.select();
      function finishRename(commit) {
        const newTitle = commit ? input.value.trim() : oldTitle;
        const titleDiv = document.createElement('div');
        titleDiv.className = 'saved-title';
        titleDiv.dataset.title = encodeURIComponent(newTitle);
        titleDiv.textContent = newTitle;
        input.replaceWith(titleDiv);
        if (commit && newTitle && newTitle !== oldTitle) {
          renameSavedNote(oldTitle, newTitle);
        }
      }
      input.addEventListener('blur', () => finishRename(true));
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
        if (ev.key === 'Escape') { ev.preventDefault(); finishRename(false); }
      });
    }
  });

  document.getElementById('clear-saved').addEventListener('click', () => {
    if (!confirm('Xóa tất cả ghi chú đã lưu khỏi danh sách cục bộ?')) return;
    savedIndex = [];
    saveSavedIndex();
    renderSavedList();
  });

  function switchTool(tool) {
    state.tool = tool;
    document.getElementById('pen-mode').classList.toggle('active', tool === 'pen');
    document.getElementById('line-mode').classList.toggle('active', tool === 'line');
    document.getElementById('eraser-mode').classList.toggle('active', tool === 'eraser');
  }

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width) / window.devicePixelRatio,
      y: (event.clientY - rect.top) * (canvas.height / rect.height) / window.devicePixelRatio,
    };
  }

  function draw(start, end) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    ctx.lineWidth = state.tool === 'eraser' ? state.size * 3 : state.size;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  function clearDrawing() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function insertTable() {
    const rows = parseInt(document.getElementById('tbl-rows').value, 10) || 1;
    const cols = parseInt(document.getElementById('tbl-cols').value, 10) || 1;
    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';
    for (let r = 0; r < rows; r += 1) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c += 1) {
        const td = document.createElement('td');
        td.textContent = '\u00A0';
        td.style.border = '1px solid #cbd5e1';
        td.style.padding = '8px';
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    const sel = window.getSelection();
    if (!sel.rangeCount) {
      editor.appendChild(table);
      return;
    }
    const range = sel.getRangeAt(0);
    range.collapse(true);
    range.insertNode(table);
    range.setStartAfter(table);
    range.setEndAfter(table);
    sel.removeAllRanges();
    sel.addRange(range);
    editor.focus();
  }

  async function saveNote() {
    // Do not use prompt() (not supported); auto-generate a timestamped title
    const title = `note_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const drawingData = canvas.toDataURL();
    const payload = { title, content: editor.innerHTML, drawing: drawingData };
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      // add to local saved index so user can open/edit before final submit
      addToSavedList(title);
      alert('Ghi chú đã được lưu. Tên tự động: ' + title + '. Mở từ danh sách "Đã lưu" để chỉnh sửa hoặc gửi.');
    } catch (err) {
      console.error(err);
      alert('Lưu thất bại.');
    }
  }

  async function loadNote() {
    const title = prompt('Tên ghi chú cần tải:', 'note1');
    if (!title) return;
    const response = await fetch(`/api/notes/${encodeURIComponent(title)}`);
    if (!response.ok) {
      alert('Không tìm thấy ghi chú.');
      return;
    }
    const data = await response.json();
    editor.innerHTML = data.content;
    alert('Ghi chú đã được tải.');
  }

  async function loadSavedNoteByTitle(title) {
    if (!title) return;
    const response = await fetch(`/api/notes/${encodeURIComponent(title)}`);
    if (!response.ok) { alert('Không thể tải ghi chú.'); return; }
    const data = await response.json();
    editor.innerHTML = data.content;
    // if drawing data present, restore it and switch to draw mode
    if (data.drawing) {
      const img = new Image();
      img.onload = () => {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
        state.mode = 'draw';
        document.querySelectorAll('.mode-switch button').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === 'draw'));
        updateMode();
      };
      img.src = data.drawing;
    } else {
      // ensure write mode if no drawing
      state.mode = 'write';
      document.querySelectorAll('.mode-switch button').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === 'write'));
      updateMode();
    }
    // ensure the title is in saved index
    addToSavedList(title);
    alert(`Ghi chú "${title}" đã được mở. Bạn có thể chỉnh sửa và bấm Lưu để cập nhật.`);
  }

  async function deleteSavedNote(title) {
    // this only removes from local index; server deletion not implemented here
    savedIndex = savedIndex.filter((t) => t !== title);
    saveSavedIndex();
    renderSavedList();
  }

  async function renameSavedNote(oldTitle, newTitle) {
    if (!oldTitle || !newTitle) return;
    try {
      // fetch existing content from server (if available)
      const response = await fetch(`/api/notes/${encodeURIComponent(oldTitle)}`);
      let content = '';
      let drawing = null;
      if (response.ok) {
        const data = await response.json();
        content = data.content;
        drawing = data.drawing || null;
      } else {
        // if no server copy, use editor content and current canvas
        content = editor.innerHTML;
        drawing = canvas.toDataURL();
      }
      // save under new title (include drawing when present)
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle, content, drawing }),
      });
      // update local index
      savedIndex = savedIndex.map((t) => (t === oldTitle ? newTitle : t));
      saveSavedIndex();
      renderSavedList();
      alert(`Đã đổi tên "${oldTitle}" → "${newTitle}" và lưu.`);
    } catch (err) {
      console.error(err);
      alert('Đổi tên thất bại.');
    }
  }

  async function submitSavedNote(title) {
    if (!title) return;
    // load current content first
    const response = await fetch(`/api/notes/${encodeURIComponent(title)}`);
    if (!response.ok) { alert('Không thể tải ghi chú để gửi.'); return; }
    const data = await response.json();
    // allow user to edit before submit: put into editor and focus
    editor.innerHTML = data.content;
    editor.focus();
    // restore drawing if present
    if (data.drawing) {
      const img = new Image();
      img.onload = () => {
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
        state.mode = 'draw';
        document.querySelectorAll('.mode-switch button').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === 'draw'));
        updateMode();
      };
      img.src = data.drawing;
    }
    // after editing user can click Save to update and then confirm submit
    if (!confirm('Bạn muốn gửi ngay bây giờ (khuyến nghị: bấm Lưu trước khi gửi)?')) return;
    try {
      const drawingData = canvas.toDataURL();
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: editor.innerHTML, drawing: drawingData, submitted: true }),
      });
      alert('Bài làm đã được gửi.');
    } catch (err) {
      console.error(err);
      alert('Gửi thất bại.');
    }
  }

  function exportHTML() {
    downloadBlob(new Blob([editor.innerHTML], { type: 'text/html;charset=utf-8' }), 'note.html');
  }

  function exportMarkdown() {
    const markdown = htmlToMarkdown(editor.innerHTML);
    downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), 'note.md');
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function htmlToMarkdown(html) {
    return html
      .replace(/<\/h1>/gi, '\n# ')
      .replace(/<\/h2>/gi, '\n## ')
      .replace(/<\/h3>/gi, '\n### ')
      .replace(/<br\s*\/?>>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim();
  }

  function markdownToHTML(markdown) {
    return markdown
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\n{2,}/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  // load saved index from localStorage and render list
  loadSavedIndex();
  renderSavedList();
  updateMode();
});

// Cross-window messaging: respond to requests from opener/other windows
window.addEventListener('message', (evt) => {
  try {
    const msg = evt.data || {};
    if (msg.type === 'getContent') {
      const payload = {
        type: 'content',
        title: savedIndex[0] || null,
        content: document.getElementById('editor')?.innerHTML || '',
        drawing: document.getElementById('drawCanvas') ? document.getElementById('drawCanvas').toDataURL() : null,
      };
      // send back to the source window
      evt.source.postMessage(payload, '*');
    }
    if (msg.type === 'setContent') {
      if (typeof msg.content === 'string') {
        document.getElementById('editor').innerHTML = msg.content;
      }
      if (msg.drawing) {
        const img = new Image();
        img.onload = () => {
          const canvas = document.getElementById('drawCanvas');
          const ctx = canvas.getContext('2d');
          resizeCanvas();
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width / window.devicePixelRatio, canvas.height / window.devicePixelRatio);
          state.mode = 'draw';
          document.querySelectorAll('.mode-switch button').forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === 'draw'));
          updateMode();
        };
        img.src = msg.drawing;
      }
      if (msg.title) addToSavedList(msg.title);
    }
  } catch (e) {
    // ignore cross-origin or other errors
  }
});
