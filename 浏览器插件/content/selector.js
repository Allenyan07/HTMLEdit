const SelectorUtils = (() => {
  function generateSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return '#' + CSS.escape(el.id);

    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      if (current.id) {
        path.unshift('#' + CSS.escape(current.id));
        break;
      }

      let selector = current.tagName.toLowerCase();
      if (current === document.documentElement || current === document.body) {
        path.unshift(selector);
        break;
      }

      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          selector += ':nth-of-type(' + index + ')';
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  function findElement(selector) {
    if (!selector) return null;
    try {
      return document.querySelector(selector);
    } catch (e) {
      return null;
    }
  }

  function getElementText(el) {
    if (!el) return '';
    // Form elements
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (el.value && el.value.trim()) return el.value.trim();
      // Fallback to placeholder if no value
      if (el.placeholder) return el.placeholder.trim();
      return '';
    }
    if (el.tagName === 'SELECT') {
      const selected = el.options[el.selectedIndex];
      return selected ? selected.text.trim() : '';
    }
    let text = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      }
    });
    return text.trim();
  }

  function getElementHTML(el) {
    if (!el) return '';
    const clone = el.cloneNode(false);
    clone.textContent = '...';
    return clone.outerHTML.replace('>...<', '>' + el.textContent.trim().substring(0, 50) + '<');
  }

  function getElementRect(el) {
    // Unused — kept for potential future use
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
  }

  return {
    generateSelector,
    findElement,
    getElementText,
    getElementHTML
  };
})();