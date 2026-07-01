const Messaging = (() => {
  const isTopFrame = window.self === window.top;
  const DEFAULT_TIMEOUT_MS = 20000;

  function sendToBackground(message, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          success: false,
          error: {
            code: 'BACKGROUND_TIMEOUT',
            message: 'Background did not respond in time',
            detail: message && message.type ? message.type : ''
          }
        });
      }, timeoutMs);

      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          resolve({
            success: false,
            error: {
              code: 'BACKGROUND_UNAVAILABLE',
              message: chrome.runtime.lastError.message || 'Background unavailable',
              detail: message && message.type ? message.type : ''
            }
          });
        } else {
          resolve(response);
        }
      });
    });
  }

  function onMessage(callback) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      const result = callback(message, sender);
      if (result instanceof Promise) {
        result.then(sendResponse);
        return true;
      } else if (result !== undefined && result !== false) {
        sendResponse(result);
        return false;
      }
      return false;
    });
  }

  function broadcastAnnotationChange(type, annotation) {
    return sendToBackground({
      type: type,
      annotation: annotation
    });
  }

  return {
    isTopFrame,
    sendToBackground,
    onMessage,
    broadcastAnnotationChange
  };
})();
