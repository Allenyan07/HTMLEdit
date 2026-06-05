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

  function sendToTopFrame(message) {
    if (isTopFrame) return Promise.resolve(null);
    return sendToBackground({ ...message, _target: 'top' });
  }

  function sendToAllFrames(message) {
    return sendToBackground({ ...message, _target: 'all' });
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
      annotation: annotation,
      sourceFrame: ProtoStorage.getPageName(),
      isTopFrame: isTopFrame
    });
  }

  return {
    isTopFrame,
    sendToBackground,
    sendToTopFrame,
    sendToAllFrames,
    onMessage,
    broadcastAnnotationChange
  };
})();