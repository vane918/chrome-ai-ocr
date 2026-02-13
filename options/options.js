const DEFAULT_PROMPT = `请识别图片中的所有文字。要求：
1. 完整提取所有可见文字
2. 保持原始段落结构和换行
3. 如有表格请用 Markdown 表格格式输出
4. 如有代码请用代码块格式输出
5. 只输出识别内容，不要添加解释或描述`;

const DEFAULT_MODEL = 'gemini-2.5-flash';

function initPage() {
  loadSettings();
  bindEvents();
}

function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'model', 'prompt'], (result) => {
    const apiKeyInput = document.getElementById('apiKey');
    const modelSelect = document.getElementById('model');
    const promptTextarea = document.getElementById('prompt');

    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
    }

    modelSelect.value = result.model || DEFAULT_MODEL;
    promptTextarea.value = result.prompt || DEFAULT_PROMPT;
  });
}

function bindEvents() {
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('toggleApiKey').addEventListener('click', toggleApiKeyVisibility);
  document.getElementById('resetPrompt').addEventListener('click', resetPrompt);
}

function toggleApiKeyVisibility() {
  const input = document.getElementById('apiKey');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
}

function resetPrompt() {
  document.getElementById('prompt').value = DEFAULT_PROMPT;
}

function saveSettings() {
  const apiKey = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('model').value;
  const prompt = document.getElementById('prompt').value.trim();
  const statusEl = document.getElementById('saveStatus');

  if (!apiKey) {
    showStatus('请输入 API Key', 'error');
    return;
  }

  if (!apiKey.startsWith('AIza')) {
    showStatus('API Key 格式不正确，应以 AIza 开头', 'error');
    return;
  }

  chrome.storage.sync.set(
    {
      apiKey,
      model: model || DEFAULT_MODEL,
      prompt: prompt || DEFAULT_PROMPT,
    },
    () => {
      if (chrome.runtime.lastError) {
        showStatus('保存失败：' + chrome.runtime.lastError.message, 'error');
        return;
      }
      showStatus('设置已保存 ✓', 'success');
    }
  );
}

function showStatus(message, type) {
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = message;
  statusEl.className = 'save-status ' + type;

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'save-status';
  }, 3000);
}

document.addEventListener('DOMContentLoaded', initPage);
