// 页改笔 HTMLEdit — 源文件字面量回填（纯函数，无 DOM 依赖）
//
// 用途：当 content/editor.js 的 findSafeSourceElement() 在「解析后的源文档」里
// 定位不到被编辑元素时（即该元素是页面脚本运行时渲染出来的），退一步在源文件的
// 原始字符串上做一次受控的文本替换。
//
// 设计原则：不猜测。只有唯一且结构上确定时才替换，有歧义一律拒绝。
//
// 关键实现约束（v2.0.6 修正）：
//   早期版本用「文本紧贴 > 和 </tag>」当锚点，这个前提是错的——`>` 只是普通字符，
//   不保证是元素开标签的结束符。反例：<button>价格 > 详情</button> 里那个 `>`
//   是文本内容。因此改为先把源文件扫描成结构化区间（文本 / 标签 / 注释 /
//   script / style / JS 注释），再要求候选的起终点在结构上自洽。
//
// 之所以是纯函数：这段逻辑不依赖 DOM，可以在 Node 里用真实 fixture 直接断言，
// 而不用再复制一份实现去测（见 test-fixtures/raw-patch.test.js）。

const RawPatch = (() => {
  'use strict';

  // 新文本里出现这些字符就拒绝写入：
  //   ' " `     —— 替换目标可能位于 <script> 的 JS 字符串里，未转义的引号会破坏整段脚本
  //   \ < >     —— 反斜杠会改变转义、尖括号会改变文档结构
  //   \r \n 及控制字符 —— 换行会打断 JS 单引号字符串，导致原型直接打不开
  // 注意：不拦 `$`。本模块用字符串切片拼接写入，不走 String.replace，
  // 因此 `$&` / `$1` 不会被展开（有专门断言覆盖）。
  const UNSAFE_CHARS = /['"`\\<>\r\n\u2028\u2029\u0000-\u001F]/;
  const TAG_NAME_RE = /^[a-z][a-z0-9-]*$/;
  const MAX_NEW_TEXT_LENGTH = 2000;

  // 低信息量文本（纯数字、纯标点、纯符号）不做回填。
  // 理由：这类文字极可能是运行时插值渲染出来的（如 ${r.rp} 渲染成 "0/0"），
  // 而源文件里往往另有同文的静态字面量，唯一匹配也会指向错误位置。
  const LOW_INFORMATION_RE = /^[\p{N}\p{P}\p{S}\s]+$/u;

  // ───────────────────────────── 源码结构扫描 ─────────────────────────────

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 找到从 from 开始的标签的结束位置（跳过引号内的 >）
  function findTagEnd(source, from) {
    let quote = null;
    for (let i = from; i < source.length; i += 1) {
      const ch = source[i];
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '>') return i + 1;
    }
    return source.length;
  }

  // 在 [from, to) 内找出 JS 注释区间。
  // 只用作「拒绝」依据：若误判为注释，结果是拒绝回填（安全方向），不会误写。
  function scanJsComments(source, from, to) {
    const out = [];
    let i = from;
    let state = 'code';
    let start = -1;

    while (i < to) {
      const ch = source[i];
      const next = source[i + 1];

      if (state === 'code') {
        if (ch === '/' && next === '/') { state = 'line'; start = i; i += 2; continue; }
        if (ch === '/' && next === '*') { state = 'block'; start = i; i += 2; continue; }
        if (ch === "'") { state = 'single'; i += 1; continue; }
        if (ch === '"') { state = 'double'; i += 1; continue; }
        if (ch === '`') { state = 'template'; i += 1; continue; }
        i += 1;
        continue;
      }

      if (state === 'line') {
        if (ch === '\n') { out.push({ start: start, end: i }); state = 'code'; }
        i += 1;
        continue;
      }

      if (state === 'block') {
        if (ch === '*' && next === '/') { out.push({ start: start, end: i + 2 }); state = 'code'; i += 2; continue; }
        i += 1;
        continue;
      }

      if (state === 'single' || state === 'double') {
        const quote = state === 'single' ? "'" : '"';
        if (ch === '\\') { i += 2; continue; }
        if (ch === quote) state = 'code';
        i += 1;
        continue;
      }

      // template
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { state = 'code'; }
      i += 1;
    }

    if (state === 'line' || state === 'block') out.push({ start: start, end: to });
    return out;
  }

  // 把源文件切成结构化区间。kind ∈ text | tag | comment | script | style | jscomment
  function scanRegions(source) {
    const n = source.length;
    const regions = [];

    function push(start, end, kind) {
      if (end > start) regions.push({ start: start, end: end, kind: kind });
    }

    let textStart = 0;
    let i = 0;

    while (i < n) {
      if (source[i] !== '<') { i += 1; continue; }
      const next = source[i + 1] || '';

      // HTML 注释（仅在此处识别：脚本内部不参与，避免 JS 字符串里的 '<!--' 伪造区间）
      if (source.startsWith('<!--', i)) {
        push(textStart, i, 'text');
        const close = source.indexOf('-->', i + 4);
        const end = close === -1 ? n : close + 3;
        push(i, end, 'comment');
        i = end;
        textStart = i;
        continue;
      }

      // 其它 <! 声明（如 <!DOCTYPE html>）按 bogus comment 处理
      if (next === '!' || next === '?') {
        push(textStart, i, 'text');
        const end = Math.min(findTagEnd(source, i), n);
        push(i, end, 'comment');
        i = end;
        textStart = i;
        continue;
      }

      const isClose = next === '/';
      const nameStart = isClose ? i + 2 : i + 1;
      const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(source.slice(nameStart, nameStart + 40));
      if (!nameMatch) { i += 1; continue; }   // `<` 后面不是标签名，当普通文本

      const tagEnd = findTagEnd(source, i);
      push(textStart, i, 'text');
      push(i, tagEnd, 'tag');
      const name = nameMatch[0].toLowerCase();

      if (!isClose && (name === 'script' || name === 'style')) {
        const closeRe = new RegExp('</' + name + '\\s*>', 'gi');
        closeRe.lastIndex = tagEnd;
        const closeMatch = closeRe.exec(source);
        const contentEnd = closeMatch ? closeMatch.index : n;

        push(tagEnd, contentEnd, name === 'script' ? 'script' : 'style');
        if (name === 'script') {
          scanJsComments(source, tagEnd, contentEnd).forEach((range) => {
            push(range.start, range.end, 'jscomment');
          });
        }

        if (closeMatch) {
          push(contentEnd, contentEnd + closeMatch[0].length, 'tag');
          i = contentEnd + closeMatch[0].length;
        } else {
          i = contentEnd;
        }
        textStart = i;
        continue;
      }

      i = tagEnd;
      textStart = i;
    }

    push(textStart, n, 'text');
    return regions;
  }

  // 区间优先级：越靠前越「内层/更具体」
  const KIND_PRIORITY = { jscomment: 0, comment: 1, style: 2, tag: 3, script: 4, text: 5 };

  function kindAt(regions, index) {
    let best = null;
    for (let i = 0; i < regions.length; i += 1) {
      const region = regions[i];
      if (index >= region.start && index < region.end) {
        if (best === null || KIND_PRIORITY[region.kind] < KIND_PRIORITY[best]) best = region.kind;
      }
    }
    return best === null ? 'text' : best;
  }

  // index 是否是某个 HTML 标签的结束符 '>'（最后一个字符的位置）
  function isTagTerminator(regions, index) {
    for (let i = 0; i < regions.length; i += 1) {
      const region = regions[i];
      if (region.kind === 'tag' && region.end === index + 1) return true;
    }
    return false;
  }

  function buildLineStarts(source) {
    const starts = [0];
    for (let i = 0; i < source.length; i += 1) {
      if (source.charCodeAt(i) === 10) starts.push(i + 1);
    }
    return starts;
  }

  function lineOf(starts, index) {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }

  // ───────────────────────────── 诊断 ─────────────────────────────

  function classifyOccurrences(source, text) {
    const out = [];
    if (!text) return out;

    const regions = scanRegions(source);
    const starts = buildLineStarts(source);
    const needle = String(text);

    let from = 0;
    let index = source.indexOf(needle, from);
    while (index !== -1) {
      const kind = kindAt(regions, index);
      out.push({
        index: index,
        line: lineOf(starts, index),
        kind: kind,
        inComment: kind === 'comment' || kind === 'jscomment',
        inScript: kind === 'script',
        inStyle: kind === 'style',
        inAttribute: kind === 'tag'
      });
      from = index + needle.length;
      index = source.indexOf(needle, from);
    }
    return out;
  }

  function scriptLineRanges(source) {
    const starts = buildLineStarts(source);
    return scanRegions(source)
      .filter((region) => region.kind === 'script')
      .map((region) => ({
        startLine: lineOf(starts, region.start),
        endLine: lineOf(starts, region.end)
      }));
  }

  function structureSignature(regions) {
    const counts = {};
    regions.forEach((region) => {
      counts[region.kind] = (counts[region.kind] || 0) + 1;
    });
    return counts;
  }

  // ───────────────────────────── 比对辅助 ─────────────────────────────

  // 源文件里的属性值可能带 JS 转义（onclick="openRevoke(\'effect\')"）与 HTML 实体
  // （onclick="go(&#39;x&#39;)"），运行时元素的属性值两者都没有，比较前统一还原。
  function decodeEntities(value) {
    return String(value == null ? '' : value)
      .replace(/&#x([0-9a-fA-F]+);/g, (whole, hex) => safeCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (whole, dec) => safeCodePoint(parseInt(dec, 10)))
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  function safeCodePoint(code) {
    if (!Number.isFinite(code) || code < 0 || code > 0x10FFFF) return '';
    if (code >= 0xD800 && code <= 0xDFFF) return '';
    return String.fromCodePoint(code);
  }

  function normalizeForCompare(value) {
    return decodeEntities(String(value == null ? '' : value).replace(/\\/g, ''));
  }

  // 取 class 词元。含模板表达式时返回 null（无法比对，跳过校验）。
  function classTokensOf(value) {
    if (value === null || value === undefined) return [];
    const text = String(value);
    if (text.indexOf('${') !== -1 || text.indexOf('{{') !== -1) return null;
    return text.split(/\s+/).filter(Boolean);
  }

  // class 兼容性：任一侧是另一侧的子集才算兼容。
  // 用于挡住「同标签同文本但在页面里是另一个元素」的误配
  // （真实案例：表格里 class=field-tag 的单元格被写到隐藏表单里 class=field-chip 的标签上）。
  function classCompatible(liveTokens, candidateTokens) {
    if (liveTokens === null || candidateTokens === null) return true;
    if (liveTokens.length === 0 && candidateTokens.length === 0) return true;
    const liveSubset = liveTokens.every((token) => candidateTokens.indexOf(token) !== -1);
    const candidateSubset = candidateTokens.every((token) => liveTokens.indexOf(token) !== -1);
    return liveSubset || candidateSubset;
  }

  function extractAttribute(tagText, name) {
    const pattern = new RegExp('(?:^|\\s)' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
    const match = pattern.exec(String(tagText || ''));
    if (!match) return null;
    if (match[2] !== undefined) return match[2];
    if (match[3] !== undefined) return match[3];
    return match[4];
  }

  function openingTagOf(source, index) {
    const open = source.lastIndexOf('<', index);
    if (open === -1) return '';
    return source.slice(open, index);
  }

  // ───────────────────────────── 主流程 ─────────────────────────────

  function fail(reason, source, text, extra) {
    const rawCandidates = (extra && extra.candidates) || [];
    return {
      ok: false,
      reason: reason,
      diagnostics: {
        tagName: (extra && extra.tagName) || '',
        originalText: text,
        occurrences: classifyOccurrences(source, text),
        candidates: rawCandidates.map((candidate) => ({
          index: candidate.index,
          line: candidate.line,
          anchorScore: candidate.anchorScore || 0
        })),
        scriptRanges: scriptLineRanges(source)
      }
    };
  }

  /**
   * 在源文件原始字符串上，按「结构锚定 + 唯一匹配」回填文本。
   *
   * @param {string} sourceText   源 HTML 文件的原始字符串
   * @param {string} tagName      运行时被编辑元素的小写标签名，如 'button'
   * @param {string} originalText 运行时元素当前文本，已 trim
   * @param {string} newText      用户输入的新文本，已 trim
   * @param {{anchors?: string[], elementClasses?: string[]|null, allowScript?: boolean, allowHtml?: boolean}} [options]
   *        anchors：运行时元素的辨识性属性值（onclick / href / data-* 等）。
   *        仅在候选 >= 2 时用于平局裁决，绝不会把唯一候选判失败。
   *        elementClasses：运行时元素的 class 词元，用于排除「同标签同文本但其实是另一个元素」。
   *        allowScript：是否允许命中 <script> 里的模板字面量（模式 B）。
   *        allowHtml：是否允许命中静态 HTML 里的元素文本（模式 A）。
   *        调用方在该元素「源文件里本就有同路径同标签的静态结构」时应把两者都传 false——
   *        那种情况下定位失败的原因是文本被拆开/写法有差异，改到别处一定是错的。
   *        此时仍走本函数，是为了拿到行号等诊断信息，而不是为了写入。
   * @returns {{ok:true,html:string,index:number,line:number,strategy:string}
   *          |{ok:false,reason:string,diagnostics:object}}
   */
  function patchSourceText(sourceText, tagName, originalText, newText, options) {
    const source = typeof sourceText === 'string' ? sourceText : '';
    const tag = String(tagName || '').toLowerCase();
    const original = String(originalText == null ? '' : originalText).trim();
    const next = String(newText == null ? '' : newText).trim();
    const anchors = (options && Array.isArray(options.anchors) ? options.anchors : [])
      .map(normalizeForCompare)
      .filter((anchor) => anchor.length >= 3);
    let elementClasses = null;
    if (options && options.elementClasses) {
      elementClasses = classTokensOf(
        Array.isArray(options.elementClasses)
          ? options.elementClasses.join(' ')
          : options.elementClasses
      );
    }
    const allowScript = !(options && options.allowScript === false);
    const allowHtml = !(options && options.allowHtml === false);

    const candidates = [];

    if (!next) return fail('EMPTY', source, original, { tagName: tag, candidates: candidates });
    if (next.length > MAX_NEW_TEXT_LENGTH) {
      return fail('TOO_LONG', source, original, { tagName: tag, candidates: candidates });
    }
    if (UNSAFE_CHARS.test(next)) {
      return fail('UNSAFE_CHAR', source, original, { tagName: tag, candidates: candidates });
    }
    if (!TAG_NAME_RE.test(tag)) {
      return fail('BAD_TAG', source, original, { tagName: tag, candidates: candidates });
    }
    if (!original) return fail('NO_ORIGINAL', source, original, { tagName: tag, candidates: candidates });
    if (original.length < 2 || LOW_INFORMATION_RE.test(original)) {
      return fail('LOW_INFORMATION', source, original, { tagName: tag, candidates: candidates });
    }

    const regions = scanRegions(source);
    const starts = buildLineStarts(source);
    const pattern = new RegExp(
      '>([ \\t\\r\\n]*)' + escapeRegExp(original) + '([ \\t\\r\\n]*)</' + tag + '>',
      'g'
    );

    let match = pattern.exec(source);
    while (match !== null) {
      const matchIndex = match.index;
      const textIndex = matchIndex + 1 + match[1].length;
      const textEnd = textIndex + original.length;
      const gtKind = kindAt(regions, matchIndex);
      const textKind = kindAt(regions, textIndex);
      const endKind = kindAt(regions, textEnd - 1);
      const blocked = textKind === 'comment' || textKind === 'jscomment'
        || textKind === 'style' || textKind === 'tag';

      // 模式 A：静态 HTML 元素文本 —— '>' 必须是真实标签结束符，整段文本同属文本区间
      const modeA = allowHtml && isTagTerminator(regions, matchIndex)
        && textKind === 'text' && endKind === 'text';

      // 模式 B：<script> 内的模板/字符串字面量 —— 起终点同属脚本区间
      const modeB = allowScript && gtKind === 'script'
        && textKind === 'script' && endKind === 'script';

      const openTag = openingTagOf(source, matchIndex);
      const classesOk = elementClasses === null
        || classCompatible(elementClasses, classTokensOf(extractAttribute(openTag, 'class')));

      if (!blocked && (modeA || modeB) && classesOk) {
        candidates.push({
          index: textIndex,
          line: lineOf(starts, textIndex),
          matchIndex: matchIndex,
          matchLength: match[0].length,
          lead: match[1],
          trail: match[2],
          mode: modeA ? 'html' : 'script',
          openTag: normalizeForCompare(openTag)
        });
      }

      if (match[0].length === 0) pattern.lastIndex += 1;
      match = pattern.exec(source);
    }

    if (candidates.length === 0) {
      return fail('NOT_FOUND', source, original, { tagName: tag, candidates: candidates });
    }

    let pool = candidates;
    if (pool.length > 1 && anchors.length > 0) {
      let best = -1;
      pool.forEach((candidate) => {
        let score = 0;
        anchors.forEach((anchor) => {
          if (candidate.openTag.indexOf(anchor) !== -1) score += 1;
        });
        candidate.anchorScore = score;
        if (score > best) best = score;
      });
      const top = pool.filter((candidate) => candidate.anchorScore === best);
      if (best > 0 && top.length === 1) pool = top;
    }

    if (pool.length !== 1) {
      return fail('AMBIGUOUS', source, original, { tagName: tag, candidates: candidates });
    }

    const hit = pool[0];
    const replaced = '>' + hit.lead + next + hit.trail + '</' + tag + '>';
    // 切片拼接写入：不走 String.replace，因此 $& / $1 等不会被展开
    const html = source.slice(0, hit.matchIndex) + replaced + source.slice(hit.matchIndex + hit.matchLength);

    // 写后自检：文档结构签名必须不变（注释 / 脚本 / 样式 / 标签数量）
    const before = structureSignature(regions);
    const after = structureSignature(scanRegions(html));
    const keys = Object.keys(before).concat(Object.keys(after));
    for (let i = 0; i < keys.length; i += 1) {
      if ((before[keys[i]] || 0) !== (after[keys[i]] || 0)) {
        return fail('UNSAFE_RESULT', source, original, { tagName: tag, candidates: candidates });
      }
    }

    return {
      ok: true,
      html: html,
      index: hit.index,
      line: hit.line,
      strategy: hit.mode === 'html' ? 'literal-tag' : 'literal-script'
    };
  }

  return {
    patchSourceText: patchSourceText,
    classifyOccurrences: classifyOccurrences,
    scriptLineRanges: scriptLineRanges,
    scanRegions: scanRegions,
    classCompatible: classCompatible,
    classTokensOf: classTokensOf
  };
})();
