(function () {
  'use strict';

  // 避免重复注入
  if (window.__ocrContentLoaded) return;
  window.__ocrContentLoaded = true;

  // ===== 状态管理 =====
  const state = {
    isCapturing: false,
    isDragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
  };

  // ===== 消息监听 =====
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startCapture') {
      startCaptureMode();
      sendResponse({ ok: true });
    }
    return true;
  });

  // ===== 选区模式 =====
  function startCaptureMode() {
    if (state.isCapturing) return;
    state.isCapturing = true;

    removeExistingElements();
    createOverlay();
  }

  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'ocr-overlay';

    const hint = document.createElement('div');
    hint.id = 'ocr-initial-hint';
    hint.textContent = '拖拽选取要识别的区域  ·  ESC 取消';

    document.body.appendChild(overlay);
    document.body.appendChild(hint);

    overlay.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  }

  function onMouseDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();

    const hint = document.getElementById('ocr-initial-hint');
    if (hint) hint.remove();

    state.isDragging = true;
    state.startX = e.clientX;
    state.startY = e.clientY;
    state.currentX = e.clientX;
    state.currentY = e.clientY;

    const overlay = document.getElementById('ocr-overlay');
    const selection = document.createElement('div');
    selection.id = 'ocr-selection';
    overlay.appendChild(selection);

    updateSelectionBox();
  }

  function onMouseMove(e) {
    if (!state.isDragging) return;
    e.preventDefault();

    state.currentX = e.clientX;
    state.currentY = e.clientY;
    updateSelectionBox();
  }

  function onMouseUp(e) {
    if (!state.isDragging) return;
    state.isDragging = false;

    const rect = getSelectionRect();

    if (rect.width < 10 || rect.height < 10) {
      cancelCapture();
      return;
    }

    performCapture(rect);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      cancelCapture();
    }
  }

  function updateSelectionBox() {
    const selection = document.getElementById('ocr-selection');
    if (!selection) return;

    const rect = getSelectionRect();
    selection.style.left = rect.x + 'px';
    selection.style.top = rect.y + 'px';
    selection.style.width = rect.width + 'px';
    selection.style.height = rect.height + 'px';

    let sizeHint = selection.querySelector('#ocr-selection-hint');
    if (!sizeHint) {
      sizeHint = document.createElement('div');
      sizeHint.id = 'ocr-selection-hint';
      selection.appendChild(sizeHint);
    }
    sizeHint.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }

  function getSelectionRect() {
    const x = Math.min(state.startX, state.currentX);
    const y = Math.min(state.startY, state.currentY);
    const width = Math.abs(state.currentX - state.startX);
    const height = Math.abs(state.currentY - state.startY);
    return { x, y, width, height };
  }

  function cancelCapture() {
    state.isCapturing = false;
    state.isDragging = false;
    removeEventListeners();
    removeExistingElements();
  }

  function removeEventListeners() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
  }

  function removeExistingElements() {
    const ids = ['ocr-overlay', 'ocr-initial-hint', 'ocr-result-panel'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
  }

  // ===== 截图流程 =====
  function performCapture(rect) {
    const overlay = document.getElementById('ocr-overlay');

    // 隐藏遮罩（但保留 DOM，防止闪烁）
    if (overlay) overlay.style.visibility = 'hidden';

    const captureData = {
      action: 'captureAndOcr',
      rect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
      devicePixelRatio: window.devicePixelRatio || 1,
    };

    // 显示结果面板（加载状态）
    const panelPosition = calculatePanelPosition(rect);
    showResultPanel(panelPosition, null, 'loading');

    // 移除遮罩
    if (overlay) overlay.remove();
    removeEventListeners();
    state.isCapturing = false;

    // 发消息给 background 执行截图和 OCR
    chrome.runtime.sendMessage(captureData, (response) => {
      if (chrome.runtime.lastError) {
        showResultPanel(panelPosition, { error: chrome.runtime.lastError.message }, 'error');
        return;
      }

      if (response.error) {
        showResultPanel(panelPosition, { error: response.error }, 'error');
      } else {
        showResultPanel(panelPosition, { text: response.text }, 'result');
      }
    });
  }

  function calculatePanelPosition(rect) {
    const panelWidth = 420;
    const panelMaxHeight = Math.min(500, window.innerHeight - 64);
    const margin = 16;

    let x = rect.x + rect.width + margin;
    let y = rect.y;

    // 右侧放不下时放左侧
    if (x + panelWidth > window.innerWidth - margin) {
      x = rect.x - panelWidth - margin;
    }

    // 左侧也放不下时居中到选区上下
    if (x < margin) {
      x = Math.max(margin, (window.innerWidth - panelWidth) / 2);
      y = rect.y + rect.height + margin;
    }

    // 确保纵向在视口内
    if (y + panelMaxHeight > window.innerHeight - margin) {
      y = window.innerHeight - panelMaxHeight - margin;
    }

    if (y < margin) {
      y = margin;
    }

    return { x, y };
  }

  // ===== 结果浮层 =====
  function showResultPanel(position, data, state) {
    let panel = document.getElementById('ocr-result-panel');
    if (!panel) {
      panel = createResultPanel();
      document.body.appendChild(panel);
    }

    panel.style.left = position.x + 'px';
    panel.style.top = position.y + 'px';

    const body = panel.querySelector('#ocr-result-body');
    body.innerHTML = '';

    if (state === 'loading') {
      body.innerHTML = `
        <div id="ocr-loading">
          <div class="ocr-spinner"></div>
          <span>正在识别中…</span>
        </div>
      `;
    } else if (state === 'error') {
      body.innerHTML = `
        <div id="ocr-error">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <div id="ocr-error-message">${escapeHtml(data.error)}</div>
        </div>
      `;
      panel.querySelector('.ocr-btn-copy').style.display = 'none';
    } else if (state === 'result') {
      const copyBtn = panel.querySelector('.ocr-btn-copy');
      copyBtn.style.display = 'flex';
      copyBtn.dataset.text = data.text;

      const contentEl = document.createElement('div');
      contentEl.id = 'ocr-text-content';
      contentEl.innerHTML = renderMarkdown(data.text);
      body.appendChild(contentEl);
    }
  }

  function createResultPanel() {
    const panel = document.createElement('div');
    panel.id = 'ocr-result-panel';

    panel.innerHTML = `
      <div id="ocr-result-header">
        <div id="ocr-result-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          识别结果
        </div>
        <div id="ocr-result-actions">
          <button class="ocr-btn ocr-btn-copy" title="复制全部文字">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制
          </button>
          <button class="ocr-btn ocr-btn-close" title="关闭">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>
      <div id="ocr-result-body"></div>
    `;

    panel.querySelector('.ocr-btn-close').addEventListener('click', () => {
      panel.remove();
    });

    panel.querySelector('.ocr-btn-copy').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const text = btn.dataset.text || '';
      copyToClipboard(text, btn);
    });

    // 拖动支持
    makeDraggable(panel);

    return panel;
  }

  function makeDraggable(panel) {
    const header = panel.querySelector('#ocr-result-header');
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    header.style.cursor = 'move';

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const x = Math.max(0, Math.min(e.clientX - offsetX, window.innerWidth - panel.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - offsetY, window.innerHeight - panel.offsetHeight));
      panel.style.left = x + 'px';
      panel.style.top = y + 'px';
    });

    document.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  async function copyToClipboard(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied');
      btn.querySelector('svg').outerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      btn.childNodes[btn.childNodes.length - 1].textContent = ' 已复制';

      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          复制
        `;
      }, 2000);
    } catch {
      // 备用方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  // ===== 工具函数 =====
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderMarkdown(text) {
    // 基础 Markdown 渲染（不引入外部库）
    let html = escapeHtml(text);

    // 代码块（先处理，防止内容被其他规则干扰）
    html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Markdown 表格
    html = renderMarkdownTable(html);

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 斜体
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 保留换行
    html = html.replace(/\n/g, '<br>');

    return html;
  }

  function renderMarkdownTable(html) {
    // 匹配表格块（以 | 开头的行）
    return html.replace(/((?:\|.+\|\n?)+)/g, (tableBlock) => {
      const lines = tableBlock.trim().split('\n');
      if (lines.length < 2) return tableBlock;

      const headerLine = lines[0];
      const separatorLine = lines[1];

      if (!separatorLine.match(/^\|[\s\-|:]+\|$/)) {
        return tableBlock;
      }

      const headers = parseTableRow(headerLine);
      const rows = lines.slice(2).map(parseTableRow);

      let tableHtml = '<table><thead><tr>';
      headers.forEach((h) => {
        tableHtml += `<th>${h}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';

      rows.forEach((row) => {
        tableHtml += '<tr>';
        row.forEach((cell) => {
          tableHtml += `<td>${cell}</td>`;
        });
        tableHtml += '</tr>';
      });

      tableHtml += '</tbody></table>';
      return tableHtml;
    });
  }

  function parseTableRow(line) {
    return line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
  }
})();
