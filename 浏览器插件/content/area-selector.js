const AreaSelector = (() => {
  let isActive = false;
  let isSelecting = false;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let selectionEl = null;
  let overlayEl = null;
  let onSelectionComplete = null;
  let dragJustCompleted = false;
  const DRAG_THRESHOLD = 5;

  function getCoveredElements(left, top, width, height) {
    const result = [];
    const areaCenter = { x: left + width / 2, y: top + height / 2 };

    // Sample points in a grid pattern within the area
    const stepX = Math.max(width / 4, 20);
    const stepY = Math.max(height / 4, 20);
    const seen = new Set();

    for (let x = left + stepX / 2; x < left + width; x += stepX) {
      for (let y = top + stepY / 2; y < top + height; y += stepY) {
        const elements = document.elementsFromPoint(x, y);
        for (const el of elements) {
          if (seen.has(el)) continue;
          seen.add(el);
          // Skip annotator UI elements
          if (el.className && typeof el.className === 'string' &&
              el.className.startsWith('__proto_annotator')) continue;
          if (el.id && el.id.startsWith('__proto_annotator')) continue;
          // Skip body/html
          if (el === document.body || el === document.documentElement) continue;

          const rect = el.getBoundingClientRect();
          // Only include elements whose center is within the selection area
          const elCenterX = rect.left + rect.width / 2;
          const elCenterY = rect.top + rect.height / 2;
          if (elCenterX >= left && elCenterX <= left + width &&
              elCenterY >= top && elCenterY <= top + height) {
            const text = (el.textContent || '').trim().substring(0, 80);
            const selector = SelectorUtils.generateSelector(el);
            const html = SelectorUtils.getElementHTML(el);
            result.push({
              tag: el.tagName.toLowerCase(),
              text: text,
              selector: selector,
              htmlContext: html
            });
          }
        }
      }
    }

    // Deduplicate by selector, keep most specific (deepest) first
    const bySelector = new Map();
    for (const item of result) {
      if (!bySelector.has(item.selector)) {
        bySelector.set(item.selector, item);
      }
    }

    return Array.from(bySelector.values()).slice(0, 10);
  }

  function createOverlay() {
    overlayEl = document.createElement('div');
    overlayEl.className = '__proto_annotator_overlay__';
    overlayEl.style.cssText =
      'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483645;cursor:crosshair;';
    document.body.appendChild(overlayEl);
  }

  function createSelection(x, y) {
    selectionEl = document.createElement('div');
    selectionEl.className = '__proto_annotator_selection__';
    selectionEl.style.cssText =
      'position:fixed;border:2px dashed #d32f2f;background:rgba(211,47,47,0.1);pointer-events:none;z-index:2147483646;';
    selectionEl.style.left = x + 'px';
    selectionEl.style.top = y + 'px';
    selectionEl.style.width = '0px';
    selectionEl.style.height = '0px';
    document.body.appendChild(selectionEl);
  }

  function updateSelection(x, y) {
    if (!selectionEl) return;
    const left = Math.min(startX, x);
    const top = Math.min(startY, y);
    const width = Math.abs(x - startX);
    const height = Math.abs(y - startY);
    selectionEl.style.left = left + 'px';
    selectionEl.style.top = top + 'px';
    selectionEl.style.width = width + 'px';
    selectionEl.style.height = height + 'px';
  }

  function removeOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function removeSelection() {
    if (selectionEl) {
      selectionEl.remove();
      selectionEl = null;
    }
  }

  function onMouseDown(e) {
    if (!isActive || !e.shiftKey) return;
    isSelecting = true;
    isDragging = false;
    startX = e.clientX;
    startY = e.clientY;
  }

  function onMouseMove(e) {
    if (!isSelecting) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!isDragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
      isDragging = true;
      createOverlay();
      createSelection(startX, startY);
    }

    if (isDragging) {
      e.preventDefault();
      updateSelection(e.clientX, e.clientY);
    }
  }

  function onMouseUp(e) {
    if (!isSelecting) return;
    isSelecting = false;

    if (isDragging) {
      e.preventDefault();
      e.stopPropagation();

      const left = Math.min(startX, e.clientX);
      const top = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);

      removeOverlay();
      removeSelection();

      if (width > 10 && height > 10 && onSelectionComplete) {
        const rect = {
          left: left + window.scrollX,
          top: top + window.scrollY,
          width: width,
          height: height
        };
        // Capture elements covered by the area
        rect.coveredElements = getCoveredElements(left, top, width, height);
        onSelectionComplete(rect);
        dragJustCompleted = true;
      }
    }

    isDragging = false;
  }

  function isDragInProgress() {
    return isDragging;
  }

  function hasDragJustCompleted() {
    if (dragJustCompleted) {
      dragJustCompleted = false;
      return true;
    }
    return false;
  }

  function activate(callback) {
    if (isActive) return;
    isActive = true;
    onSelectionComplete = callback;
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('mousemove', onMouseMove, true);
    document.addEventListener('mouseup', onMouseUp, true);
  }

  function deactivate() {
    isActive = false;
    isSelecting = false;
    isDragging = false;
    onSelectionComplete = null;
    removeOverlay();
    removeSelection();
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('mouseup', onMouseUp, true);
  }

  return {
    activate,
    deactivate,
    isDragInProgress,
    hasDragJustCompleted
  };
})();