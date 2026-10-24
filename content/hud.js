/**
 * 页改笔 HTMLEdit · 模式胶囊（v2.1.0）
 * ---------------------------------------------------------------------------
 * 页面右下角常驻的「暂停 / 编辑 / 标注」三态胶囊，合并原 📋 浮标的职责。
 *
 * 设计约定（详见 v2.1.0-开发契约.md §2）：
 *   - 对外 API 固定：mount / unmount / setMode / setEditReadiness / setBadgeCount /
 *     setPanelOpen / setShortcutHints，反向回调 onModeRequest / onPanelToggle。
 *   - 胶囊自己不发 chrome 消息、不读 chrome.storage、不监听 document 键盘事件，
 *     也**不持有模式真相**：view.mode 只是最近一次 setMode() 的渲染缓存。
 *   - 样式全部内联在 Shadow DOM 的 <style> 里，content.css 不需要任何改动。
 *   - 宿主容器 id 为 __proto_annotator_hud__ 并挂 __proto_annotator = true，
 *     这样 editor.js 的 isToolElement() 与 annotator.js 的 isAnnotatorElement()
 *     都会把它当工具元素跳过（不会被双击编辑、Shift+点击标注）。
 *   - z-index 固定 2147483646，必须低于编辑卡片 2147483647。
 *   - 位置可拖动，存 localStorage（key: __proto_hud_pos__），随 session 走。
 *   - 加载顺序：panel.js 之后、content.js 之前（主智能体改 manifest）。
 * ---------------------------------------------------------------------------
 * 用法：
 *   Hud.mount();
 *   Hud.setMode('edit');              // 'paused' | 'edit' | 'annotate'
 *   Hud.setEditReadiness('not-ready');// 'ready' | 'not-ready' | 'unknown'
 *   Hud.setBadgeCount(3);             // <= 0 隐藏角标（本页标注数量）
 *   Hud.setPanelOpen(true);           // 胶囊左移避让 360px 面板
 *   Hud.setShortcutHints({ edit: '⌥Q', annotate: '⌥W', export: '⌥E' });
 *   Hud.onModeRequest = function (mode) {};   // 用户点了某一段
 *   Hud.onPanelToggle = function () {};       // 用户点了 📋 热区
 *   Hud.collapse();                   // 附加：主智能体处理 Esc 时可调用（只收起，不换模式）
 */
const Hud = (() => {
  // ======================== 常量 ========================
  var POS_KEY = '__proto_hud_pos__';
  var PANEL_WIDTH = 360;          // 标注面板宽度，展开时胶囊让出这一段
  var DEFAULT_RIGHT = 20;         // 折叠态贴右 20px（沿用原 FAB）
  var DEFAULT_BOTTOM = 24;
  var EDGE = 8;                   // 拖动时离视口边缘的最小距离
  var HOVER_CLOSE_DELAY = 520;    // 鼠标移出后延迟收起，避免误触立刻消失

  var NAME = { paused: '暂停', edit: '编辑', annotate: '标注' };
  var MODES = ['paused', 'edit', 'annotate'];

  var ICON = {
    paused: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="4" height="14" rx="1.2"/><rect x="13" y="5" width="4" height="14" rx="1.2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    annotate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.7-.8L3 21l1.9-5.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/></svg>'
  };

  var PANEL_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>';

  // ======================== DOM 引用（unmount 后全部置空） ========================
  var container = null;      // 宿主 div（light DOM，带 __proto_annotator 标记）
  var shadow = null;
  var pillEl = null;
  var faceEl = null;
  var iconEl = null;
  var readyDotEl = null;
  var countEl = null;
  var panelBtnEl = null;

  // ======================== 渲染缓存（真相在外部） ========================
  // 这里只保存「最近一次外部推过来的值」，任何交互都通过回调交回主智能体决定。
  var view = {
    mode: 'paused',
    readiness: 'unknown',
    count: 0,
    panelOpen: false,
    hints: { edit: '', annotate: '', export: '' }
  };

  var expanded = false;       // 胶囊展开态（纯视觉，不属于模式状态）
  var customPos = null;       // { left, top } 拖动后的位置，基准是"面板收起"时的左上角
  var drag = null;
  var suppressClick = false;  // 拖完的那一次 click 不要当成点击
  var hoverTimer = null;
  var parkedTimer = null;
  var nearCorner = false;       // 指针是否靠近右下角（暂停态据此决定是否浮现）
  var clampTimer = null;
  var resizeBound = false;

  // ======================== 样式（全部内联在 Shadow DOM） ========================
  function getStyles() {
    return '' +
      ':host { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; transition: right .22s ease, left .22s ease; }' +
      '.pill, .pill * { box-sizing: border-box; }' +
      // 1px 描边用 inset box-shadow 画，保证折叠态正好 44×44（border 会把宽度撑到 46）
      '.pill { position: relative; display: flex; align-items: center; gap: 0; height: 44px; padding: 0 4px; margin: 0; background: #fff; border: 0; border-radius: 12px; box-shadow: 0 0 0 1px rgba(31,35,40,.10) inset, 0 1px 2px rgba(31,35,40,.06), 0 8px 22px rgba(31,35,40,.12); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 13px; font-weight: 400; line-height: 1; text-align: left; user-select: none; -webkit-user-select: none; cursor: pointer; touch-action: none; opacity: 1; transition: opacity .18s ease, box-shadow .18s ease; }' +
      '.pill:hover { box-shadow: 0 0 0 1px rgba(31,35,40,.12) inset, 0 1px 2px rgba(31,35,40,.08), 0 10px 26px rgba(31,35,40,.16); }' +
      '.pill[data-mode="paused"] { opacity: .55; }' +
      '.pill[data-mode="paused"]:hover { opacity: 1; }' +
      // 暂停态默认「停靠」：整体淡出并停止接收点击，鼠标靠近右下角才浮现。
      // 页面处于暂停时用户是在正常使用页面，右下角不该常驻一个控件。
      '.pill.parked { opacity: 0; pointer-events: none; transform: translateY(10px) scale(.94); }' +
      '.pill { transition: opacity .2s ease, transform .2s ease, right .22s ease, left .22s ease, box-shadow .18s ease; }' +
      '.pill .face { position: relative; width: 36px; height: 36px; border-radius: 9px; flex: 0 0 auto; display: grid; place-items: center; color: #fff; transition: background .18s ease; }' +
      '.pill[data-mode="edit"] .face { background: linear-gradient(135deg, #2bd06a, #17a34a); }' +
      '.pill[data-mode="annotate"] .face { background: linear-gradient(135deg, #5b6cff, #7c5bff); }' +
      '.pill[data-mode="paused"] .face { background: #c3c9d1; }' +
      '.pill .face .icon-holder { width: 19px; height: 19px; display: flex; align-items: center; justify-content: center; }' +
      '.pill .face svg { width: 19px; height: 19px; display: block; }' +
      // 琥珀色小点：编辑态但保存条件未就绪
      '.pill .ready-dot { display: none; position: absolute; top: 1px; right: 1px; width: 9px; height: 9px; border-radius: 50%; background: #f5a524; box-shadow: 0 0 0 2px #fff; }' +
      '.pill .ready-dot.show { display: block; }' +
      // 三段：暂停 │ 编辑 │ 标注
      '.pill .segs { display: flex; gap: 2px; overflow: hidden; max-width: 0; opacity: 0; transition: max-width .2s ease, opacity .16s ease; }' +
      '.pill.open .segs { max-width: 260px; opacity: 1; margin-left: 2px; }' +
      '.pill .seg { height: 32px; padding: 0 11px; border-radius: 8px; border: 0; margin: 0; background: transparent; font-family: inherit; font-size: 12.5px; font-weight: 600; line-height: 32px; color: #5b6570; cursor: pointer; white-space: nowrap; display: flex; align-items: center; }' +
      '.pill .seg:hover { background: #f2f4f6; color: #1f2328; }' +
      '.pill .seg.on[data-for="edit"] { background: rgba(34,197,94,.14); color: #15803d; }' +
      '.pill .seg.on[data-for="annotate"] { background: rgba(91,108,255,.14); color: #4453e0; }' +
      '.pill .seg.on[data-for="paused"] { background: #eef1f4; color: #39424e; }' +
      '.pill .seg:focus-visible { outline: 2px solid #5b6cff; outline-offset: 1px; }' +
      // 分隔线只为 📋 热区服务：非标注态没有热区，就不占位、不留一根孤立的 1px 线
      '.pill .divider { display: none; width: 1px; height: 22px; background: #eceff3; margin: 0 3px; }' +
      '.pill[data-mode="annotate"] .divider { display: block; }' +
      // 📋 热区：只在标注态出现
      '.pill .panel-btn { width: 32px; height: 32px; border-radius: 8px; border: 0; margin: 0; padding: 0; background: transparent; cursor: pointer; display: none; place-items: center; color: #5b6570; }' +
      '.pill .panel-btn svg { width: 17px; height: 17px; display: block; }' +
      '.pill[data-mode="annotate"] .panel-btn { display: grid; }' +
      '.pill .panel-btn:hover { background: #f2f4f6; color: #5b6cff; }' +
      '.pill .panel-btn:focus-visible { outline: 2px solid #5b6cff; outline-offset: 1px; }' +
      // 已改 N 处角标
      '.pill .count { display: none; position: absolute; top: -7px; right: -7px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #5b6cff; color: #fff; font-family: inherit; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; box-shadow: 0 0 0 2px #fff; pointer-events: none; }' +
      '.pill .count.show { display: block; }' +
      '@media (prefers-reduced-motion: reduce) { :host { transition: none; } .pill, .pill .segs { transition: none; } }';
  }

  // ======================== HTML 结构（照设计图搬进 Shadow DOM） ========================
  function buildHTML() {
    return '' +
      '<div class="pill" data-mode="paused">' +
      '  <div class="face" id="hudFace">' +
      '    <span class="icon-holder" id="hudIcon"></span>' +
      '    <span class="ready-dot" id="hudReadyDot"></span>' +
      '  </div>' +
      '  <div class="segs">' +
      '    <button type="button" class="seg" data-for="paused">暂停</button>' +
      '    <button type="button" class="seg" data-for="edit">编辑</button>' +
      '    <button type="button" class="seg" data-for="annotate">标注</button>' +
      '  </div>' +
      '  <div class="divider"></div>' +
      '  <button type="button" class="panel-btn" id="hudPanelBtn" title="展开/收起标注面板">' + PANEL_ICON + '</button>' +
      '  <span class="count" id="hudCount"></span>' +
      '</div>';
  }

  // ======================== 渲染 ========================
  function hintText(key) {
    var hint = view.hints[key];
    return hint ? '（' + hint + '）' : '（未分配快捷键）';
  }

  function segTitle(mode) {
    if (mode === 'edit') return '切到编辑模式' + hintText('edit');
    if (mode === 'annotate') return '切到标注模式' + hintText('annotate');
    return '暂停 · 不再拦截页面交互';
  }

  function faceTitle(mode) {
    var hint = mode === 'paused' ? '' : ' ' + hintText(mode);
    return '当前：' + (NAME[mode] || mode) + hint + ' · 点击展开/收起';
  }

  function panelTitle() {
    var hint = view.hints.export ? '（导出 ' + view.hints.export + '）' : '';
    return '展开/收起标注面板' + hint;
  }

  function render() {
    if (!pillEl) return;

    var mode = MODES.indexOf(view.mode) >= 0 ? view.mode : 'paused';
    pillEl.setAttribute('data-mode', mode);
    updateParked();
    if (iconEl) iconEl.innerHTML = ICON[mode] || ICON.paused;

    // 当前段高亮（其余可点）
    var segs = pillEl.querySelectorAll('.seg');
    for (var i = 0; i < segs.length; i++) {
      var segMode = segs[i].getAttribute('data-for');
      var isOn = segMode === mode;
      if (isOn) segs[i].classList.add('on');
      else segs[i].classList.remove('on');
      segs[i].setAttribute('aria-pressed', isOn ? 'true' : 'false');
      segs[i].title = segTitle(segMode);
    }

    // 琥珀点：只有"在编辑态、但目录/权限还没就绪"时才出现
    if (readyDotEl) {
      if (mode === 'edit' && view.readiness === 'not-ready') readyDotEl.classList.add('show');
      else readyDotEl.classList.remove('show');
    }

    // 数字角标：n <= 0 隐藏
    if (countEl) {
      if (view.count > 0) {
        countEl.textContent = view.count > 99 ? '99+' : String(view.count);
        countEl.title = view.count + ' 条标注';
        countEl.classList.add('show');
      } else {
        countEl.classList.remove('show');
        countEl.textContent = '';
        countEl.title = '';
      }
    }

    if (panelBtnEl) panelBtnEl.title = panelTitle();
    if (faceEl) faceEl.title = faceTitle(mode);
  }

  // ======================== 位置（默认贴右下角，可拖动） ========================
  function applyGeometry() {
    if (!container) return;
    if (customPos) {
      var left = view.panelOpen ? Math.max(EDGE, customPos.left - PANEL_WIDTH) : customPos.left;
      container.style.left = left + 'px';
      container.style.top = customPos.top + 'px';
      container.style.right = 'auto';
      container.style.bottom = 'auto';
    } else {
      container.style.left = 'auto';
      container.style.top = 'auto';
      container.style.right = (view.panelOpen ? DEFAULT_RIGHT + PANEL_WIDTH : DEFAULT_RIGHT) + 'px';
      container.style.bottom = DEFAULT_BOTTOM + 'px';
    }
  }

  function clampCustomPos() {
    if (!container || !customPos) return;
    var rect = container.getBoundingClientRect();
    var shift = view.panelOpen ? PANEL_WIDTH : 0;
    var maxLeft = Math.max(EDGE + shift, window.innerWidth - rect.width - EDGE + shift);
    var maxTop = Math.max(EDGE, window.innerHeight - rect.height - EDGE);
    var left = Math.min(Math.max(EDGE + shift, customPos.left), maxLeft);
    var top = Math.min(Math.max(EDGE, customPos.top), maxTop);
    if (left !== customPos.left || top !== customPos.top) {
      customPos = { left: Math.round(left), top: Math.round(top) };
      applyGeometry();
      savePos();
    }
  }

  function scheduleClamp() {
    if (!customPos) return;
    if (clampTimer) clearTimeout(clampTimer);
    clampTimer = setTimeout(function () {
      clampTimer = null;
      clampCustomPos();
    }, 260);
  }

  function loadPos() {
    try {
      var raw = window.localStorage.getItem(POS_KEY);
      if (!raw) return;
      var pos = JSON.parse(raw);
      if (pos && isFinite(pos.left) && isFinite(pos.top)) {
        customPos = { left: Number(pos.left), top: Number(pos.top) };
      }
    } catch (e) {
      customPos = null;
    }
  }

  function savePos() {
    if (!customPos) return;
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(customPos));
    } catch (e) {}
  }

  function onResize() {
    clampCustomPos();
  }

  // ======================== 拖动 ========================
  function onPointerDown(e) {
    if (!container || !pillEl) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var rect = container.getBoundingClientRect();
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false
    };
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
  }

  function onPointerMove(e) {
    if (!drag || !container) return;
    var dx = e.clientX - drag.startX;
    var dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;

    var shift = view.panelOpen ? PANEL_WIDTH : 0;
    var maxLeft = Math.max(EDGE + shift, window.innerWidth - drag.width - EDGE + shift);
    var maxTop = Math.max(EDGE, window.innerHeight - drag.height - EDGE);
    var left = Math.min(Math.max(EDGE + shift, drag.left + dx + shift), maxLeft);
    var top = Math.min(Math.max(EDGE, drag.top + dy), maxTop);

    customPos = { left: Math.round(left), top: Math.round(top) };
    container.style.transition = 'none';
    applyGeometry();
  }

  function onPointerUp() {
    if (!drag) return;
    var moved = drag.moved;
    stopDrag();
    if (moved) {
      suppressClick = true;       // 拖完的 click 不算点击
      savePos();
      applyGeometry();
      setTimeout(function () { suppressClick = false; }, 240);
    }
  }

  function stopDrag() {
    if (!drag) return;
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    drag = null;
    if (container) container.style.transition = '';
  }

  // ======================== 交互 ========================
  // 暂停态 = 停靠（淡出且不吃点击），除非指针已靠近右下角
  function updateParked() {
    if (!pillEl) return;
    var parked = view.mode === 'paused' && !nearCorner;
    pillEl.classList.toggle('parked', parked);
  }

  // 用 passive mousemove 做「接近右下角」检测，而不是铺一个透明热区元素：
  // 热区会实实在在挡住页面右下角的点击，被动监听则完全不吃事件。
  var lastCornerCheck = 0;
  function onDocMouseMove(e) {
    var now = Date.now();
    if (now - lastCornerCheck < 80) return;   // 节流，避免每帧计算
    lastCornerCheck = now;
    var dx = window.innerWidth - e.clientX;
    var dy = window.innerHeight - e.clientY;
    var near = dx < 150 && dy < 110;
    if (near === nearCorner) return;
    nearCorner = near;
    if (parkedTimer) {
      clearTimeout(parkedTimer);
      parkedTimer = null;
    }
    if (near) {
      updateParked();
    } else {
      // 离开角落时留一点缓冲，避免鼠标轻微抖动就闪没
      parkedTimer = setTimeout(function () {
        parkedTimer = null;
        updateParked();
      }, 420);
    }
  }

  function setExpanded(value) {
    expanded = !!value;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (pillEl) {
      if (expanded) pillEl.classList.add('open');
      else pillEl.classList.remove('open');
    }
    scheduleClamp();
  }

  function onPillClick(e) {
    if (!pillEl) return;
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    var target = e.target;
    if (target && target.closest) {
      // 📋 热区：只通知，不自己开面板（面板归 panel.js）
      if (target.closest('.panel-btn')) {
        if (typeof api.onPanelToggle === 'function') api.onPanelToggle();
        return;
      }
      // 点某一段：只把意图交回主智能体，胶囊不自己改模式
      var seg = target.closest('.seg');
      if (seg) {
        var mode = seg.getAttribute('data-for');
        if (typeof api.onModeRequest === 'function') api.onModeRequest(mode);
        return;
      }
    }
    setExpanded(!expanded);
  }

  function onMouseEnter() {
    if (drag) return;
    setExpanded(true);
  }

  function onMouseLeave() {
    if (hoverTimer) clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () {
      hoverTimer = null;
      if (!drag) setExpanded(false);
    }, HOVER_CLOSE_DELAY);
  }

  function onShadowKeyDown(e) {
    // 只在胶囊内部响应 Esc：只收起，不退出模式（也不往 document 注册键盘事件）
    if (e.key === 'Escape') setExpanded(false);
  }

  function bindEvents() {
    pillEl.addEventListener('click', onPillClick);
    pillEl.addEventListener('pointerdown', onPointerDown);
    pillEl.addEventListener('mouseenter', onMouseEnter);
    pillEl.addEventListener('mouseleave', onMouseLeave);
    shadow.addEventListener('keydown', onShadowKeyDown);
  }

  // ======================== 对外 API ========================
  function mount() {
    // content script 是 all_frames：胶囊全页只需要一个，只在顶层窗口挂载
    if (window.top !== window.self) return;

    if (container) {
      if (container.isConnected) {
        // 幂等：已挂载时只按缓存同步一次渲染
        render();
        applyGeometry();
        return;
      }
      // 宿主被页面脚本重绘弄丢了（innerHTML 覆盖 body 之类），清掉引用后重建
      unmount();
    }

    var body = document.body || document.documentElement;
    if (!body) return;

    container = document.createElement('div');
    container.id = '__proto_annotator_hud__';
    // editor.js / annotator.js 靠这个标记识别"工具元素"，避免胶囊被编辑或被标注
    container.__proto_annotator = true;
    container.style.cssText = 'position:fixed;left:auto;top:auto;right:' + DEFAULT_RIGHT + 'px;bottom:' + DEFAULT_BOTTOM + 'px;z-index:2147483646;';

    shadow = container.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = getStyles();
    shadow.appendChild(style);

    // 先在临时节点里解析 HTML，再取出 .pill 挂进 shadow
    var holder = document.createElement('div');
    holder.innerHTML = buildHTML();
    pillEl = holder.firstElementChild;
    shadow.appendChild(pillEl);

    faceEl = shadow.getElementById('hudFace');
    iconEl = shadow.getElementById('hudIcon');
    readyDotEl = shadow.getElementById('hudReadyDot');
    countEl = shadow.getElementById('hudCount');
    panelBtnEl = shadow.getElementById('hudPanelBtn');

    body.appendChild(container);

    bindEvents();
    loadPos();
    applyGeometry();
    if (customPos) clampCustomPos();
    render();

    if (!resizeBound) {
      window.addEventListener('resize', onResize);
      document.addEventListener('mousemove', onDocMouseMove, { passive: true });
      resizeBound = true;
    }
  }

  function unmount() {
    if (resizeBound) {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('mousemove', onDocMouseMove);
      resizeBound = false;
    }
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
    if (parkedTimer) {
      clearTimeout(parkedTimer);
      parkedTimer = null;
    }
    if (clampTimer) {
      clearTimeout(clampTimer);
      clampTimer = null;
    }
    stopDrag();

    if (container) {
      if (shadow) shadow.removeEventListener('keydown', onShadowKeyDown);
      container.remove();
    }

    container = null;
    shadow = null;
    pillEl = null;
    faceEl = null;
    iconEl = null;
    readyDotEl = null;
    countEl = null;
    panelBtnEl = null;
    expanded = false;
    suppressClick = false;
    nearCorner = false;
    view.mode = 'paused';
    view.readiness = 'unknown';
    view.count = 0;
    view.panelOpen = false;
  }

  function setMode(mode) {
    // 未知值（含旧版 'off'）一律按暂停处理，避免出现无样式的白胶囊
    view.mode = MODES.indexOf(mode) >= 0 ? mode : 'paused';
    render();
  }

  function setEditReadiness(state) {
    view.readiness = (state === 'ready' || state === 'not-ready') ? state : 'unknown';
    render();
  }

  // 角标显示「本页标注数量」。改字数量属于临时过程数据，不适合常驻展示，
  // 已移到扩展弹窗里显示。
  function setBadgeCount(n) {
    var num = parseInt(n, 10);
    view.count = isFinite(num) && num > 0 ? num : 0;
    render();
  }

  function setPanelOpen(open) {
    view.panelOpen = !!open;
    applyGeometry();
    scheduleClamp();
  }

  function setShortcutHints(map) {
    map = map || {};
    view.hints = {
      edit: map.edit || '',
      annotate: map.annotate || '',
      export: map.export || ''
    };
    render();
  }

  // 附加方法：主智能体处理 Esc 时可直接调用（只收起胶囊，不改变模式）
  function collapse() {
    setExpanded(false);
  }

  var api = {
    mount: mount,
    unmount: unmount,
    setMode: setMode,
    setEditReadiness: setEditReadiness,
    setBadgeCount: setBadgeCount,
    setPanelOpen: setPanelOpen,
    setShortcutHints: setShortcutHints,
    collapse: collapse
  };

  return api;
})();
