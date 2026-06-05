const ProtoAnnotator = (() => {
  let modeActive = false;

  function init() {
    Messaging.onMessage(handleMessage);

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown, true);

    chrome.runtime.sendMessage({ type: 'GET_MODE' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[ProtoAnnotator] GET_MODE error:', chrome.runtime.lastError.message);
        return;
      }
      if (response && response.active) {
        console.log('[ProtoAnnotator] Restoring active mode on init');
        activateMode();
      }
    });
  }

  function handleKeyDown(e) {
    if (!modeActive) return;

    // Escape: close card, edit overlay, or remove highlight
    if (e.key === 'Escape') {
      Annotator.closeCard();
      Panel.closeOverlays();
      Annotator.removeHighlightAnnotation();
    }

    // Enter: confirm card if open
    if (e.key === 'Enter' && !e.shiftKey) {
      const cardContainer = document.getElementById('__proto_annotator_card__');
      if (cardContainer) {
        const confirmBtn = cardContainer.shadowRoot?.querySelector('.btn-confirm');
        if (confirmBtn && document.activeElement?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          confirmBtn.click();
        }
      }
    }

    // Ctrl+Shift+E: export annotations
    if (e.ctrlKey && e.shiftKey && (e.key === 'e' || e.key === 'E')) {
      e.preventDefault();
      if (Messaging.isTopFrame) {
        Panel.exportAnnotations();
      }
    }
  }

  function handleMessage(message, sender) {
    switch (message.type) {
      case 'PING':
        return { pong: true };

      case 'MODE_CHANGED':
        console.log('[ProtoAnnotator] MODE_CHANGED:', message.active);
        if (message.active) {
          activateMode();
        } else {
          deactivateMode();
        }
        break;

      case 'ANNOTATION_CREATED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
        }
        if (message.annotation && message.annotation.pageName === ProtoStorage.getPageName()) {
          Annotator.restoreBadges().catch(() => {});
        }
        break;

      case 'ANNOTATION_DELETED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'ANNOTATION_UPDATED':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'NAVIGATE_TO_ANNOTATION':
        handleNavigateToAnnotation(message.annotation);
        break;

      case 'CLEAR_ALL_ANNOTATIONS':
        if (Messaging.isTopFrame) {
          Panel.refreshList();
        }
        Annotator.restoreBadges().catch(() => {});
        break;

      case 'HIGHLIGHT_ELEMENT':
        handleHighlightElement(message);
        break;
    }
    return false;
  }

  function handleNavigateToAnnotation(annotation) {
    if (!annotation) return;

    if (Messaging.isTopFrame) {
      const targetPage = annotation.pageName;
      const iframes = document.querySelectorAll('iframe');
      let targetIframe = null;

      iframes.forEach((iframe) => {
        try {
          const src = iframe.src || iframe.getAttribute('src');
          if (src && (src.endsWith('/' + targetPage) || src.endsWith('/' + encodeURIComponent(targetPage)))) {
            targetIframe = iframe;
          }
        } catch (e) {}
      });

      if (!targetIframe && iframes.length > 0) {
        targetIframe = iframes[0];
        const currentSrc = targetIframe.src || targetIframe.getAttribute('src') || '';
        const basePath = currentSrc.substring(0, currentSrc.lastIndexOf('/') + 1);
        targetIframe.src = basePath + targetPage;
        // iframe load will trigger content script init and MODE_CHANGED restore;
        // the NAVIGATE_TO_ANNOTATION broadcast from background will reach the new iframe
      } else if (targetIframe) {
        const currentSrc = targetIframe.src || targetIframe.getAttribute('src') || '';
        if (!currentSrc.endsWith(targetPage) && !currentSrc.endsWith(encodeURIComponent(targetPage))) {
          const basePath = currentSrc.substring(0, currentSrc.lastIndexOf('/') + 1);
          targetIframe.src = basePath + targetPage;
        }
        // Since background broadcasts to all frames, the target iframe will
        // also receive this message and handle it directly.
        // The top frame just needs to scroll the iframe into view if needed.
        targetIframe.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } else {
      // iframe receives NAVIGATE_TO_ANNOTATION directly from background
      if (annotation.pageName === ProtoStorage.getPageName()) {
        Annotator.highlightAnnotation(annotation.id);
      }
    }
  }

  function handleHighlightElement(message) {
    if (message.selector) {
      const el = SelectorUtils.findElement(message.selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        Annotator.highlightAnnotation(message.annotationId);
      }
    } else if (message.areaRect) {
      Annotator.highlightAnnotation(message.annotationId);
    }
  }

  function activateMode() {
    if (modeActive) return;
    modeActive = true;
    console.log('[ProtoAnnotator] Mode activated');

    Annotator.activate();

    if (Messaging.isTopFrame) {
      Panel.create();
      Panel.show();
    }
  }

  function deactivateMode() {
    if (!modeActive) return;
    modeActive = false;
    console.log('[ProtoAnnotator] Mode deactivated');

    Annotator.deactivate();

    if (Messaging.isTopFrame) {
      Panel.hide();
      // If panel was minimized (FAB visible), destroy it including FAB
      Panel.destroy();
    }
  }

  return { init, activateMode, deactivateMode };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', ProtoAnnotator.init);
} else {
  ProtoAnnotator.init();
}