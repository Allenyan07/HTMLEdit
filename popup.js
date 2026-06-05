document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleBtn');
  const statusText = document.getElementById('statusText');
  const hintText = document.getElementById('hintText');

  function updateUI(active) {
    if (active) {
      toggleBtn.textContent = '关闭标注模式';
      toggleBtn.classList.add('active');
      statusText.textContent = '标注模式已开启';
      statusText.classList.add('active');
      hintText.textContent = '在页面上 Shift+点击 标注元素，Shift+拖拽 标注区域';
    } else {
      toggleBtn.textContent = '开启标注模式';
      toggleBtn.classList.remove('active');
      statusText.textContent = '标注模式已关闭';
      statusText.classList.remove('active');
      hintText.textContent = '点击按钮开启标注模式';
    }
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) {
      statusText.textContent = '未找到活动标签页';
      toggleBtn.disabled = true;
      return;
    }
    if (!tabs[0].url) {
      statusText.textContent = '未找到页面地址';
      toggleBtn.disabled = true;
      return;
    }
    const url = tabs[0].url;
    if (!url.startsWith('file://') && !url.startsWith('http://') && !url.startsWith('https://')) {
      statusText.textContent = '请在网页或 file:// 页面上使用';
      toggleBtn.disabled = true;
      return;
    }

    const tabId = tabs[0].id;

    chrome.runtime.sendMessage({ type: 'GET_MODE', tabId: tabId }, (response) => {
      if (chrome.runtime.lastError || !response) {
        statusText.textContent = '未注入（请刷新页面后重试）';
        toggleBtn.disabled = true;
        return;
      }
      updateUI(response.active);
      toggleBtn.disabled = false;
    });

    toggleBtn.addEventListener('click', () => {
      const isActive = toggleBtn.classList.contains('active');
      chrome.runtime.sendMessage({
        type: 'SET_MODE',
        active: !isActive,
        tabId: tabId,
        topLevelUrl: tabs[0].url
      }, (response) => {
        if (chrome.runtime.lastError || !response) return;
        updateUI(!isActive);
      });
    });
  });
});