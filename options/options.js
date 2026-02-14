const DEFAULT_PROMPTS = {
  gemini: `请识别图片中的所有文字。要求：
1. 完整提取所有可见文字
2. 保持原始段落结构和换行
3. 如有表格请用 Markdown 表格格式输出
4. 如有代码请用代码块格式输出
5. 只输出识别内容，不要添加解释或描述`,
  qwen: `请识别图片中的所有文字，直接输出纯文本。要求：
1. 完整提取所有可见文字
2. 保持原始段落结构和换行
3. 如有表格请用 Markdown 表格格式输出
4. 如有代码请用代码块格式输出
5. 只输出识别内容，不要添加解释或描述
6. 不要将输出内容包裹在 HTML 标签或代码块中`,
};

const MODELS = {
  gemini: [
    { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash（推荐，速度最快）' },
    { value: 'gemini-2.5-pro', label: 'gemini-2.5-pro（精度更高）' },
    { value: 'gemini-2.0-flash', label: 'gemini-2.0-flash' },
    { value: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
    { value: 'gemini-1.5-pro', label: 'gemini-1.5-pro' },
  ],
  qwen: [
    { value: 'qwen-vl-ocr-latest', label: 'qwen-vl-ocr-latest（推荐）' },
    { value: 'qwen-vl-ocr', label: 'qwen-vl-ocr（稳定版）' },
  ],
};

const DEFAULT_MODELS = {
  gemini: 'gemini-2.5-flash',
  qwen: 'qwen-vl-ocr-latest',
};

function initPage() {
  loadSettings();
  bindEvents();
}

function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'qwenApiKey', 'provider', 'model', 'prompt'], (result) => {
    const provider = result.provider || 'gemini';

    const providerEl = document.getElementById('provider');
    providerEl.value = provider;
    providerEl.dataset.prev = provider;
    document.getElementById('apiKey').value = result.apiKey || '';
    document.getElementById('qwenApiKey').value = result.qwenApiKey || '';
    document.getElementById('prompt').value = result.prompt || DEFAULT_PROMPTS[provider];

    updateProviderUI(provider);

    // 填充模型列表后再设置已保存的值
    const savedModel = result.model || DEFAULT_MODELS[provider];
    document.getElementById('model').value = savedModel;
  });
}

function updateProviderUI(provider, prevProvider) {
  const geminiGroup = document.getElementById('geminiKeyGroup');
  const qwenGroup = document.getElementById('qwenKeyGroup');
  const modelSelect = document.getElementById('model');
  const promptTextarea = document.getElementById('prompt');

  // 切换服务商时，若提示词仍是上一个服务商的默认值，则自动替换为新服务商的默认值
  if (prevProvider && prevProvider !== provider) {
    const prevDefault = DEFAULT_PROMPTS[prevProvider];
    if (!promptTextarea.value.trim() || promptTextarea.value === prevDefault) {
      promptTextarea.value = DEFAULT_PROMPTS[provider];
    }
  }

  if (provider === 'qwen') {
    geminiGroup.style.display = 'none';
    qwenGroup.style.display = '';
  } else {
    geminiGroup.style.display = '';
    qwenGroup.style.display = 'none';
  }

  // 重建模型选项
  const currentModel = modelSelect.value;
  modelSelect.innerHTML = '';
  MODELS[provider].forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  });

  // 尝试保留当前选中值，否则使用该 provider 的默认值
  const targetModel = MODELS[provider].some((m) => m.value === currentModel)
    ? currentModel
    : DEFAULT_MODELS[provider];
  modelSelect.value = targetModel;
}

function bindEvents() {
  const providerSelect = document.getElementById('provider');
  providerSelect.addEventListener('change', (e) => {
    const prev = e.target.dataset.prev || 'gemini';
    updateProviderUI(e.target.value, prev);
    e.target.dataset.prev = e.target.value;
  });
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('toggleApiKey').addEventListener('click', () =>
    toggleVisibility('apiKey')
  );
  document.getElementById('toggleQwenApiKey').addEventListener('click', () =>
    toggleVisibility('qwenApiKey')
  );
  document.getElementById('resetPrompt').addEventListener('click', resetPrompt);
}

function toggleVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

function resetPrompt() {
  const provider = document.getElementById('provider').value;
  document.getElementById('prompt').value = DEFAULT_PROMPTS[provider];
}

function saveSettings() {
  const provider = document.getElementById('provider').value;
  const apiKey = document.getElementById('apiKey').value.trim();
  const qwenApiKey = document.getElementById('qwenApiKey').value.trim();
  const model = document.getElementById('model').value;
  const prompt = document.getElementById('prompt').value.trim();

  // 根据当前 provider 校验对应的 API Key
  if (provider === 'gemini') {
    if (!apiKey) {
      showStatus('请输入 Gemini API Key', 'error');
      return;
    }
    if (!apiKey.startsWith('AIza')) {
      showStatus('Gemini API Key 格式不正确，应以 AIza 开头', 'error');
      return;
    }
  } else {
    if (!qwenApiKey) {
      showStatus('请输入 DashScope API Key', 'error');
      return;
    }
    if (!qwenApiKey.startsWith('sk-')) {
      showStatus('DashScope API Key 格式不正确，应以 sk- 开头', 'error');
      return;
    }
  }

  chrome.storage.sync.set(
    {
      provider,
      apiKey: apiKey || undefined,
      qwenApiKey: qwenApiKey || undefined,
      model: model || DEFAULT_MODELS[provider],
      prompt: prompt || DEFAULT_PROMPTS[provider],
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
