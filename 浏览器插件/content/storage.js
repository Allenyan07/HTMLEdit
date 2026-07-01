const ProtoStorage = (() => {
  function getStorageKey() {
    const url = window.location.href;
    try {
      const path = new URL(url).pathname;
      const dir = path.substring(0, path.lastIndexOf('/') + 1);
      return 'proto_' + btoa(unescape(encodeURIComponent(dir))).replace(/[+=/]/g, '_');
    } catch (e) {
      return 'proto_' + btoa(unescape(encodeURIComponent(url))).replace(/[+=/]/g, '_');
    }
  }

  function getAnnotations() {
    return new Promise((resolve) => {
      const key = getStorageKey();
      chrome.storage.local.get([key], (result) => {
        resolve(result[key] || []);
      });
    });
  }

  function saveAnnotations(annotations) {
    const key = getStorageKey();
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: annotations }, () => resolve());
    });
  }

  function addAnnotation(annotation) {
    return getAnnotations().then((annotations) => {
      annotations.push(annotation);
      return saveAnnotations(annotations);
    });
  }

  function deleteAnnotation(id) {
    return getAnnotations().then((annotations) => {
      const filtered = annotations.filter((a) => a.id !== id);
      return saveAnnotations(filtered);
    });
  }

  function updateAnnotation(id, updates) {
    return getAnnotations().then((annotations) => {
      const idx = annotations.findIndex((a) => a.id === id);
      if (idx !== -1) {
        annotations[idx] = { ...annotations[idx], ...updates };
        return saveAnnotations(annotations);
      }
      return Promise.resolve();
    });
  }

  function clearAnnotations() {
    const key = getStorageKey();
    return new Promise((resolve) => {
      chrome.storage.local.set({ [key]: [] }, () => resolve());
    });
  }

  function getNextId() {
    return getAnnotations().then((annotations) => {
      const existingIds = new Set(annotations.map((a) => a.id));
      let maxNum = 0;
      annotations.forEach((a) => {
        // Parse the numeric prefix (e.g., "A03" -> 3, "A0342" -> 3)
        const match = a.id.match(/^A(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      });
      // Try sequential first, add random suffix on collision
      let nextId = 'A' + String(maxNum + 1).padStart(2, '0');
      if (existingIds.has(nextId)) {
        nextId = 'A' + String(maxNum + 1).padStart(2, '0') + String(Math.floor(Math.random() * 100)).padStart(2, '0');
      }
      return nextId;
    });
  }

  function getPageName() {
    try {
      const path = new URL(window.location.href).pathname;
      return decodeURIComponent(path.split('/').pop()) || 'index.html';
    } catch (e) {
      return window.location.href.split('/').pop() || 'unknown';
    }
  }

  return {
    getStorageKey,
    getAnnotations,
    saveAnnotations,
    addAnnotation,
    deleteAnnotation,
    updateAnnotation,
    clearAnnotations,
    getNextId,
    getPageName
  };
})();