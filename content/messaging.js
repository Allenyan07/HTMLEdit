const Messaging = (() => {
  const isTopFrame = window.self === window.top;

  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
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