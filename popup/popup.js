function initPopup() {
  checkConfiguration();
  bindEvents();
}

function checkConfiguration() {
  chrome.storage.sync.get(['apiKey', 'model'], (result) => {
    const notConfigured = document.getElementById('notConfigured');
    const configured = document.getElementById('configured');
    const modelBadge = document.getElementById('modelBadge');

    if (result.apiKey) {
      notConfigured.style.display = 'none';
      configured.style.display = 'flex';
      modelBadge.textContent = result.model || 'gemini-2.5-flash';
    } else {
      notConfigured.style.display = 'flex';
      configured.style.display = 'none';
    }
  });
}

function bindEvents() {
  document.getElementById('goToOptions').addEventListener('click', openOptions);
  document.getElementById('openOptions').addEventListener('click', openOptions);
  document.getElementById('startCapture').addEventListener('click', startCapture);
}

function openOptions() {
  chrome.runtime.openOptionsPage();
  window.close();
}

function startCapture() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      return;
    }

    const tab = tabs[0];

    // 某些特殊页面无法注入内容脚本
    if (
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('edge://')
    ) {
      alert('无法在此页面使用截图功能，请在普通网页上使用。');
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'startCapture' }, (response) => {
      if (chrome.runtime.lastError) {
        // 内容脚本未就绪，尝试注入后再发消息
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            files: ['content.js'],
          },
          () => {
            chrome.tabs.insertCSS
              ? chrome.tabs.insertCSS(tab.id, { file: 'content.css' })
              : chrome.scripting.insertCSS({
                  target: { tabId: tab.id },
                  files: ['content.css'],
                });

            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, { action: 'startCapture' });
            }, 100);
          }
        );
      }
    });

    window.close();
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
