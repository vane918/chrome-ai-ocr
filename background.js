'use strict';

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const REQUEST_TIMEOUT_MS = 30000;

// ===== 消息路由 =====
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'captureAndOcr') {
    handleCaptureAndOcr(message, sender.tab.id)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ error: error.message }));
    return true; // 保持 sendResponse 通道开放
  }
});

// ===== 主流程 =====
async function handleCaptureAndOcr(message, tabId) {
  const { rect, devicePixelRatio } = message;

  // 1. 截取当前标签页可见区域
  const dataUrl = await captureVisibleTab(tabId);

  // 2. 裁剪选区
  const croppedBase64 = await cropImage(dataUrl, rect, devicePixelRatio);

  // 3. 读取配置
  const config = await getConfig();

  // 4. 调用 Gemini API
  const text = await callGeminiApi(croppedBase64, config);

  return { text };
}

// ===== 截图 =====
async function captureVisibleTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(
      null, // 当前窗口
      { format: 'png', quality: 100 },
      (dataUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error('截图失败：' + chrome.runtime.lastError.message));
          return;
        }
        resolve(dataUrl);
      }
    );
  });
}

// ===== 裁剪图片（OffscreenCanvas + DPR 处理）=====
async function cropImage(dataUrl, rect, dpr) {
  // 将 data URL 转为 ImageBitmap
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const imageBitmap = await createImageBitmap(blob);

  // DPR 缩放：captureVisibleTab 返回的是物理像素，CSS 坐标需要乘以 DPR
  // 注意：captureVisibleTab 截取的是视口，坐标已是视口相对值，不加 scrollX/scrollY
  const scaledRect = {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  };

  // 边界检查
  const sx = Math.max(0, scaledRect.x);
  const sy = Math.max(0, scaledRect.y);
  const sw = Math.min(scaledRect.width, imageBitmap.width - sx);
  const sh = Math.min(scaledRect.height, imageBitmap.height - sy);

  if (sw <= 0 || sh <= 0) {
    throw new Error('选区超出截图范围，请重试');
  }

  // 使用 OffscreenCanvas 裁剪
  const canvas = new OffscreenCanvas(sw, sh);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(imageBitmap, sx, sy, sw, sh, 0, 0, sw, sh);

  const croppedBlob = await canvas.convertToBlob({ type: 'image/png' });
  const base64 = await blobToBase64(croppedBlob);

  // 返回不含前缀的 base64 字符串
  return base64.split(',')[1];
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片转换失败'));
    reader.readAsDataURL(blob);
  });
}

// ===== 配置读取 =====
async function getConfig() {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(['apiKey', 'model', 'prompt'], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error('读取配置失败'));
        return;
      }
      if (!result.apiKey) {
        reject(new Error('未配置 API Key，请点击插件图标 → 设置 进行配置'));
        return;
      }
      resolve({
        apiKey: result.apiKey,
        model: result.model || 'gemini-2.5-flash',
        prompt: result.prompt || getDefaultPrompt(),
      });
    });
  });
}

function getDefaultPrompt() {
  return `请识别图片中的所有文字。要求：
1. 完整提取所有可见文字
2. 保持原始段落结构和换行
3. 如有表格请用 Markdown 表格格式输出
4. 如有代码请用代码块格式输出
5. 只输出识别内容，不要添加解释或描述`;
}

// ===== Gemini API 调用 =====
async function callGeminiApi(base64Image, config) {
  const { apiKey, model, prompt } = config;
  const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: 'image/png',
              data: base64Image,
            },
          },
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(formatApiError(response.status, errorData));
    }

    const data = await response.json();
    return extractTextFromResponse(data);
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('请求超时（30秒），请检查网络连接后重试');
    }

    throw error;
  }
}

function extractTextFromResponse(data) {
  try {
    const candidate = data.candidates?.[0];

    if (!candidate) {
      throw new Error('API 返回空结果');
    }

    if (candidate.finishReason === 'SAFETY') {
      throw new Error('内容被安全过滤器拦截，请尝试其他区域');
    }

    const parts = candidate.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('API 返回格式异常');
    }

    const text = parts.map((p) => p.text || '').join('');

    if (!text.trim()) {
      return '（未识别到文字）';
    }

    return text.trim();
  } catch (error) {
    if (error.message.startsWith('API')) {
      throw error;
    }
    throw new Error('解析 API 响应失败：' + error.message);
  }
}

function formatApiError(status, errorData) {
  const message = errorData?.error?.message || '';

  const errorMap = {
    400: `请求参数错误：${message || '图片可能无效'}`,
    401: 'API Key 无效，请在设置页面重新配置',
    403: 'API Key 权限不足或已被禁用',
    429: 'API 请求过于频繁，请稍后重试',
    500: 'Gemini 服务器内部错误，请稍后重试',
    503: 'Gemini 服务暂时不可用，请稍后重试',
  };

  return errorMap[status] || `API 请求失败（${status}）：${message}`;
}
