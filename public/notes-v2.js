document.addEventListener('DOMContentLoaded', () => {
  const editor = document.getElementById('editor');
  const canvas = document.getElementById('drawCanvas');
  const ctx = canvas.getContext('2d');
  const importFile = document.getElementById('import-file');
  const writeButton = document.querySelector('[data-mode="write"]');
  const drawButton = document.querySelector('[data-mode="draw"]');
  const editorArea = document.querySelector('.editor-area');
  const defaultState = { mode: 'write', tool: 'pen', color: '#0f172a', size: 3 };
  let state = { ...defaultState, drawing: false, startPoint: null };

  function resizeCanvas() {
    canvas.width = editorArea.clientWidth;
    canvas.height = editorArea.clientHeight;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  const toolbar = document.querySelector('.notes-app.fullpage');

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cmd]');
    if (btn) {
      document.execCommand(btn.getAttribute('data-cmd'), false, null);
      editor.focus();
      return;
    }

    const action = e.target.id;
    if (action === 'insert-table') insertTable();
    if (action === 'save-note') saveNote();
    if (action === 'load-note') loadNote();
    if (action === 'export-html') exportHTML();
    if (action === 'export-markdown') exportMarkdown();
    if (action === 'clear') editor.innerHTML = '';
    if (action === 'pen-mode') switchTool('pen');
    if (action === 'line-mode') switchTool('line');
    if (action === 'eraser-mode') switchTool('eraser');
    if (action === 'clear-draw') clearDrawing();
  });

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

  importFile.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (file.name.endsWith('.md')) editor.innerHTML = markdownToHTML(reader.result);
      else editor.innerHTML = reader.result;
    };
    reader.readAsText(file);
  });

  function updateMode() {
    if (state.mode === 'draw') {
      canvas.style.display = 'block';
      editor.style.pointerEvents = 'none';
      editor.style.opacity = '0.5';
    } else {
      canvas.style.display = 'none';
      editor.style.pointerEvents = 'auto';
      editor.style.opacity = '1';
    }
  }

  function switchTool(tool) {
    state.tool = tool;
    document.getElementById('pen-mode').classList.toggle('active', tool === 'pen');
    document.getElementById('line-mode').classList.toggle('active', tool === 'line');
    document.getElementById('eraser-mode').classList.toggle('active', tool === 'eraser');
  }

  function drawLine(pointA, pointB) {
    ctx.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
    ctx.lineWidth = state.tool === 'eraser' ? 18 : state.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pointA.x, pointA.y);
    ctx.lineTo(pointB.x, pointB.y);
    ctx.stroke();
  }

  function clearDrawing() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function getPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  canvas.addEventListener('mousedown', (event) => {
    if (state.mode !== 'draw') return;
    state.drawing = true;
    state.startPoint = getPoint(event);
    if (state.tool === 'pen' || state.tool === 'eraser') {
      drawLine(state.startPoint, state.startPoint);
    }
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!state.drawing || state.mode !== 'draw') return;
    const point = getPoint(event);
    if (state.tool === 'pen' || state.tool === 'eraser') {
      drawLine(state.startPoint, point);
      state.startPoint = point;
    }
  });

  canvas.addEventListener('mouseup', (event) => {
    if (!state.drawing || state.mode !== 'draw') return;
    state.drawing = false;
    const point = getPoint(event);
    if (state.tool === 'line') drawLine(state.startPoint, point);
  });

  canvas.addEventListener('mouseleave', () => {
    state.drawing = false;
  });

  function insertTable() {
    const rows = parseInt(document.getElementById('tbl-rows').value, 10) || 1;
    const cols = parseInt(document.getElementById('tbl-cols').value, 10) || 1;
    const table = document.createElement('table');
    for (let r = 0; r < rows; r += 1) {
      const tr = document.createElement('tr');
      for (let c = 0; c < cols; c += 1) {
        const td = document.createElement('td');
        td.textContent = '\u00A0';
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
    const content = editor.innerHTML;
    const title = prompt('Tên ghi chú (khoảng trắng sẽ bị gỡ):', 'note1') || 'note1';
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content }),
    });
    alert('Ghi chú đã được lưu.');
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

  function exportHTML() {
    const blob = new Blob([editor.innerHTML], { type: 'text/html;charset=utf-8' });
    downloadBlob(blob, 'note.html');
  }

  function exportMarkdown() {
    const markdown = htmlToMarkdown(editor.innerHTML);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    downloadBlob(blob, 'note.md');
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

  updateMode();
});