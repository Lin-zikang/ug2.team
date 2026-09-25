(() => {
  'use strict';

  const CONTENT_LIST_URL = 'content/files.json';
  const PUBLISHED_DIRECTORY = 'content/published/';
  const DRAFT_KEY = 'ug2-live-draft-v1';
  const FALLBACK_ITEMS_KEY = 'ug2-local-items-v1';
  const DB_NAME = 'ug2-content-center';
  const DB_STORE = 'completed';
  const SUBMISSION_KEY = 'UG2-OFFICIAL-SUBMISSION-KEY-v1::United-Grade-2';
  const PBKDF2_ITERATIONS = 120000;
  const HOME_WORDMARK_URL = 'https://i.imgs.ovh/2026/06/21/1cd907bf4c68be34bca7f75690bd1757.png';
  const LATEX_RENDER_API = 'https://www.zhihu.com/equation?tex=';
  const PAGE_SIZE = 6;

  const state = {
    official: [],
    local: [],
    lastListRoute: 'articles',
    currentDetail: null,
    librariesReady: false,
    pages: { articles: 1, posts: 1, local: 1 },
    searches: { articles: '', posts: '' },
    pendingScrollY: null
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function decodeUtf8(bytes) {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return decoded.replace(/^\uFEFF/, '');
  }

  async function readResponseUtf8(response) {
    return decodeUtf8(await response.arrayBuffer());
  }

  function withNoCache(url) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}refresh=${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function noCacheRequestOptions() {
    return {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    };
  }

  const els = {
    tabs: $$('.tab-button'),
    views: $$('.view-panel'),
    articlesList: $('#articlesList'),
    postsList: $('#postsList'),
    localList: $('#localList'),
    articlesPagination: $('#articlesPagination'),
    postsPagination: $('#postsPagination'),
    localPagination: $('#localPagination'),
    articlesSearchInput: $('#articlesSearchInput'),
    postsSearchInput: $('#postsSearchInput'),
    articlesSearchStatus: $('#articlesSearchStatus'),
    postsSearchStatus: $('#postsSearchStatus'),
    detailHost: $('#detailHost'),
    libraryState: $('#libraryState'),
    draftTitle: $('#draftTitle'),
    draftType: $('#draftType'),
    draftSummary: $('#draftSummary'),
    markdownInput: $('#markdownInput'),
    previewContent: $('#previewContent'),
    wordCount: $('#wordCount'),
    draftStatus: $('#draftStatus'),
    finishDialog: $('#finishDialog'),
    creatorName: $('#creatorName'),
    downloadOnFinish: $('#downloadOnFinish'),
    toast: $('#toast')
  };

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2200);
  }

  function updateLibraryProgress(detail) {
    if (!detail || state.librariesReady) return;
    const percent = Math.max(0, Math.min(100, Number(detail.percent) || 0));
    const label = detail.label || '正在准备 Markdown 与 LaTeX…';
    els.libraryState.textContent = `${label} ${percent}%`;
    els.libraryState.style.setProperty('--library-progress', `${percent}%`);
    document.documentElement.style.setProperty('--library-progress-page', `${percent}%`);
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[char]);
  }

  function highlightedHtml(value = '', query = '') {
    const text = String(value || '');
    const needle = String(query || '').trim();
    if (!needle) return escapeHtml(text);

    const haystack = text.toLocaleLowerCase();
    const loweredNeedle = needle.toLocaleLowerCase();
    if (!loweredNeedle) return escapeHtml(text);

    let cursor = 0;
    let index = haystack.indexOf(loweredNeedle, cursor);
    if (index < 0) return escapeHtml(text);

    let html = '';
    while (index >= 0) {
      html += escapeHtml(text.slice(cursor, index));
      html += `<mark class="search-match">${escapeHtml(text.slice(index, index + needle.length))}</mark>`;
      cursor = index + needle.length;
      index = haystack.indexOf(loweredNeedle, cursor);
    }
    return html + escapeHtml(text.slice(cursor));
  }

  function localDate(input = new Date()) {
    const date = input instanceof Date ? input : new Date(input);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function debounce(fn, wait = 260) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  function stripMarkdown(markdown = '') {
    return markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[#>*_~\-]+/g, ' ')
      .replace(/\$+[^$]*\$+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isEscaped(value, index) {
    let backslashes = 0;
    for (let i = index - 1; i >= 0 && value[i] === '\\'; i -= 1) backslashes += 1;
    return backslashes % 2 === 1;
  }

  function findClosingDelimiter(value, start, delimiter, options = {}) {
    for (let index = start; index < value.length; index += 1) {
      if (options.singleLine && /[\r\n]/.test(value[index])) return -1;
      if (value.startsWith(delimiter, index) && !isEscaped(value, index)) return index;
    }
    return -1;
  }

  function isFenceStart(value, index) {
    const marker = value[index];
    if (marker !== '`' && marker !== '~') return null;
    let lineStart = index - 1;
    while (lineStart >= 0 && value[lineStart] !== '\n' && value[lineStart] !== '\r') lineStart -= 1;
    const prefix = value.slice(lineStart + 1, index);
    if (!/^\s*$/.test(prefix)) return null;
    let length = 0;
    while (value[index + length] === marker) length += 1;
    return length >= 3 ? { marker, length } : null;
  }

  function findFenceEnd(value, start, marker, length) {
    const fence = marker.repeat(length);
    let index = start;
    while (index < value.length) {
      const lineEnd = value.indexOf('\n', index);
      const end = lineEnd === -1 ? value.length : lineEnd;
      const line = value.slice(index, end);
      if (line.trimStart().startsWith(fence)) return lineEnd === -1 ? end : lineEnd + 1;
      if (lineEnd === -1) return value.length;
      index = lineEnd + 1;
    }
    return value.length;
  }

  function protectMathSegments(source = '') {
    const value = String(source);
    const tokens = [];
    const makeToken = (display, expression) => {
      const id = `UG2MATHTOKEN${tokens.length}END`;
      tokens.push({ id, display, expression: expression.trim() });
      return id;
    };

    let protectedSource = '';
    let index = 0;
    while (index < value.length) {
      const fence = isFenceStart(value, index);
      if (fence) {
        const close = findFenceEnd(value, index + fence.length, fence.marker, fence.length);
        protectedSource += value.slice(index, close);
        index = close;
        continue;
      }

      if (value[index] === '`') {
        let length = 0;
        while (value[index + length] === '`') length += 1;
        const marker = '`'.repeat(length);
        const close = value.indexOf(marker, index + length);
        if (close !== -1) {
          protectedSource += value.slice(index, close + length);
          index = close + length;
          continue;
        }
      }

      if (value.startsWith('$$', index) && !isEscaped(value, index)) {
        const close = findClosingDelimiter(value, index + 2, '$$');
        if (close !== -1) {
          const expression = value.slice(index + 2, close);
          protectedSource += expression.trim() ? makeToken(true, expression) : value.slice(index, close + 2);
          index = close + 2;
          continue;
        }
      }

      if (value.startsWith('\\[', index) && !isEscaped(value, index)) {
        const close = findClosingDelimiter(value, index + 2, '\\]');
        if (close !== -1) {
          const expression = value.slice(index + 2, close);
          protectedSource += expression.trim() ? makeToken(true, expression) : value.slice(index, close + 2);
          index = close + 2;
          continue;
        }
      }

      if (value.startsWith('\\(', index) && !isEscaped(value, index)) {
        const close = findClosingDelimiter(value, index + 2, '\\)', { singleLine: true });
        if (close !== -1) {
          const expression = value.slice(index + 2, close);
          protectedSource += expression.trim() ? makeToken(false, expression) : value.slice(index, close + 2);
          index = close + 2;
          continue;
        }
      }

      if (value[index] === '$' && value[index + 1] !== '$' && !isEscaped(value, index)) {
        const next = value[index + 1] || '';
        if (next && !/\s/.test(next)) {
          const close = findClosingDelimiter(value, index + 1, '$', { singleLine: true });
          if (close !== -1 && value[close + 1] !== '$') {
            const expression = value.slice(index + 1, close);
            const beforeClose = value[close - 1] || '';
            if (expression.trim() && !/\s/.test(beforeClose)) {
              protectedSource += makeToken(false, expression);
              index = close + 1;
              continue;
            }
          }
        }
      }

      protectedSource += value[index];
      index += 1;
    }

    return { protectedSource, tokens };
  }

  function latexApiUrl(expression, display) {
    const tex = display ? `\\displaystyle ${expression}` : expression;
    return `${LATEX_RENDER_API}${encodeURIComponent(tex)}`;
  }

  function renderLatexWithApi(item) {
    const escaped = escapeHtml(item.expression);
    const src = escapeHtml(latexApiUrl(item.expression, item.display));
    return `<span class="latex-api-fallback${item.display ? ' is-display' : ''}" role="img" aria-label="${escaped}"><img src="${src}" alt="${escaped}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
  }

  function renderMath(item) {
    if (window.katex?.renderToString) {
      try {
        return window.katex.renderToString(item.expression, {
          displayMode: item.display,
          throwOnError: true,
          strict: 'ignore',
          output: 'htmlAndMathml'
        });
      } catch (error) {
        console.warn('KaTeX 渲染失败，已切换至国内公式渲染 API。', error);
      }
    }
    return renderLatexWithApi(item);
  }

  function renderMarkdown(source = '') {
    if (!state.librariesReady) return '<p>Markdown 渲染库正在加载…</p>';
    const { protectedSource, tokens } = protectMathSegments(source);

    let html = window.marked.parse(protectedSource, { gfm: true, breaks: true, mangle: false, headerIds: false });

    for (const item of tokens) {
      html = html.split(item.id).join(renderMath(item));
    }

    return window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true },
      ADD_ATTR: ['target', 'rel']
    });
  }

  function arrayToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToArray(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function deriveKey(salt) {
    if (!window.crypto?.subtle) throw new Error('当前环境不支持 Web Crypto，请通过 HTTPS 打开网页。');
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(SUBMISSION_KEY),
      'PBKDF2',
      false,
      ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptItem(item) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(salt);
    const payload = {
      title: item.title,
      creator: item.creator,
      type: item.type,
      summary: item.summary || '',
      markdown: item.markdown
    };
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(JSON.stringify(payload))
    );
    return JSON.stringify({
      format: 'UG2-ENCRYPTED-TXT',
      version: 2,
      encryption: {
        algorithm: 'AES-256-GCM',
        kdf: 'PBKDF2-SHA-256',
        iterations: PBKDF2_ITERATIONS,
        salt: arrayToBase64(salt),
        iv: arrayToBase64(iv),
        data: arrayToBase64(new Uint8Array(encrypted))
      }
    }, null, 2);
  }

  async function decryptText(text) {
    let envelope;
    try { envelope = JSON.parse(String(text).replace(/^\uFEFF/, '')); }
    catch (_) { throw new Error('不是有效的 UG2 加密文本文件。'); }
    if (envelope?.format !== 'UG2-ENCRYPTED-TXT' || !envelope.encryption) {
      throw new Error('文件格式不受支持。');
    }
    const salt = base64ToArray(envelope.encryption.salt);
    const iv = base64ToArray(envelope.encryption.iv);
    const encrypted = base64ToArray(envelope.encryption.data);
    const key = await deriveKey(salt);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);
    const payload = JSON.parse(decodeUtf8(decrypted));
    const result = {
      ...payload,
      title: payload.title || envelope.title,
      creator: payload.creator || envelope.creator,
      type: payload.type || envelope.type,
      summary: typeof payload.summary === 'string' ? payload.summary.trim() : envelope.summary
    };
    delete result.date;
    delete result.createdAt;
    return result;
  }

  function safeFilename(value) {
    return String(value || '未命名')
      .replace(/[\\/:*?"<>|,;]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 70) || '未命名';
  }

  function normalizeListedFileName(value) {
    const name = String(value || '').trim();
    if (!name) return '';
    return /\.txt$/i.test(name) ? name : `${name}.txt`;
  }

  function fileNameFromTitle(title) {
    return normalizeListedFileName(safeFilename(title || '未命名'));
  }

  function titleFromFileName(fileName) {
    return String(fileName || '').replace(/\.txt$/i, '').trim();
  }

  function normalizeListType(value, fallback = 'article') {
    const type = String(value || '').trim().toLowerCase();
    if (['post', 'posts', '帖子'].includes(type)) return 'post';
    if (['article', 'articles', '文章'].includes(type)) return 'article';
    return fallback === 'post' ? 'post' : 'article';
  }

  function makeFileEntry(fileName, date = '', type = 'article') {
    const normalized = normalizeListedFileName(fileName);
    if (!/^[^/\\]+\.txt$/i.test(normalized)) return null;
    return {
      id: normalized,
      fileName: normalized,
      title: titleFromFileName(normalized),
      creator: '',
      date: String(date || '').trim(),
      type: normalizeListType(type)
    };
  }

  function makeCatalogEntry(entry, fallbackType = 'article') {
    if (typeof entry === 'string') return makeFileEntry(entry, '', fallbackType);
    if (!entry || typeof entry !== 'object') return null;

    const explicitTitle = typeof entry.title === 'string' ? entry.title.trim() : '';
    const explicitFileName = entry.fileName || entry.filename || entry.file || entry.path;
    const fileNameSource = explicitFileName || (explicitTitle ? fileNameFromTitle(explicitTitle) : entry.name);
    const normalized = normalizeListedFileName(fileNameSource);
    if (!/^[^/\\]+\.txt$/i.test(normalized)) return null;

    const title = explicitTitle || titleFromFileName(normalized);
    if (!title) return null;

    return {
      id: normalized,
      fileName: normalized,
      title,
      creator: String(explicitTitle ? (entry.name || entry.creator || entry.author || '') : (entry.creator || entry.author || '')).trim(),
      date: String(entry.data || entry.date || entry.createdDate || '').trim(),
      type: normalizeListType(entry.type || entry.kind || entry.category, fallbackType)
    };
  }

  function dedupeFileEntries(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      if (!entry) return false;
      const key = entry.fileName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function parseFileMarker(text, fallbackType = 'article') {
    return dedupeFileEntries(String(text || '')
      .split(';')
      .map((part) => {
        const raw = part.trim();
        if (!raw) return null;
        const comma = raw.lastIndexOf(',');
        const name = comma >= 0 ? raw.slice(0, comma).trim() : raw;
        const date = comma >= 0 ? raw.slice(comma + 1).trim() : '';
        return makeFileEntry(name, date, fallbackType);
      }));
  }

  function parseCatalogList(list, fallbackType = 'article') {
    if (typeof list === 'string') return parseFileMarker(list, fallbackType);
    if (!Array.isArray(list)) return [];
    return list.map((entry) => makeCatalogEntry(entry, fallbackType));
  }

  function parseFileEntries(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '').trim();
    if (!raw) return [];
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) return dedupeFileEntries(parseCatalogList(data));
      if (data && typeof data === 'object') {
        const grouped = [];
        grouped.push(...parseCatalogList(data.articles, 'article'));
        grouped.push(...parseCatalogList(data.posts, 'post'));
        if (grouped.length) return dedupeFileEntries(grouped);

        const list = data.files || data.items || data.contents;
        if (list) return dedupeFileEntries(parseCatalogList(list, normalizeListType(data.type)));
        if (data.title) return dedupeFileEntries([makeCatalogEntry(data, normalizeListType(data.type))]);
      }
    } catch (_) {}
    return parseFileMarker(raw);
  }

  async function downloadEncrypted(item) {
    try {
      const encryptedText = await encryptItem(item);
      const blob = new Blob(['\uFEFF', encryptedText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename(item.title || item.id || '未命名')}.txt`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast('加密 .txt 文件已生成');
    } catch (error) {
      showToast(error.message || '文件生成失败');
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function dbGetAll() {
    try {
      const db = await openDatabase();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (_) {
      try { return JSON.parse(localStorage.getItem(FALLBACK_ITEMS_KEY) || '[]'); }
      catch (_) { return []; }
    }
  }

  async function dbPut(item) {
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(item);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const items = await dbGetAll();
      const next = items.filter((entry) => entry.id !== item.id).concat(item);
      localStorage.setItem(FALLBACK_ITEMS_KEY, JSON.stringify(next));
    }
  }

  async function dbDelete(id) {
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch (_) {
      const items = (await dbGetAll()).filter((entry) => entry.id !== id);
      localStorage.setItem(FALLBACK_ITEMS_KEY, JSON.stringify(items));
    }
  }

  async function loadOfficial(force = false) {
    void force;
    const response = await fetch(withNoCache(CONTENT_LIST_URL), noCacheRequestOptions());
    if (!response.ok) throw new Error(`内容清单加载失败（${response.status}）`);
    state.official = parseFileEntries(await readResponseUtf8(response))
      .map((entry) => ({
        ...entry,
        summary: '点击进入后加载正文内容'
      }))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    renderOfficialLists();
  }

  async function loadLocal() {
    state.local = (await dbGetAll()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    renderLocalList();
  }

  function createContentCard(item, source = 'official', query = '') {
    const button = document.createElement('article');
    button.className = 'content-card';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', `查看：${item.title}`);
    const label = item.type === 'post' ? '帖子' : '文章';
    const summary = item.summary || (source === 'official' ? '点击进入后加载正文内容' : stripMarkdown(item.markdown || '').slice(0, 94)) || '点击查看内容';
    const creator = item.creator || '小学二年级联合会';
    const creatorHtml = query
      ? `<span class="card-author"><span class="card-author-label">作者</span><span>${highlightedHtml(creator, query)}</span></span>`
      : `<span>${escapeHtml(creator)}</span>`;
    button.innerHTML = `
      <div class="card-topline">
        <span class="type-chip">${label}</span>
        <span class="card-date">${escapeHtml(item.date || '')}</span>
      </div>
      <h3>${highlightedHtml(item.title || '未命名', query)}</h3>
      <p>${escapeHtml(summary)}</p>
      <div class="card-footer">
        ${creatorHtml}
        <span class="card-open">进入查看 →</span>
      </div>`;
    const open = () => navigateToDetail(source, item.id);
    button.addEventListener('click', open);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    return button;
  }

  function matchesSearch(item, query) {
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return true;
    return [item.title, item.creator].some((value) => String(value || '').toLocaleLowerCase().includes(needle));
  }

  function buildListRoute(route, page = 1, query = '') {
    const params = new URLSearchParams();
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeQuery = String(query || '').trim();
    if (safePage > 1) params.set('page', String(safePage));
    if (safeQuery) params.set('q', safeQuery);
    const suffix = params.toString();
    return `${route}${suffix ? `?${suffix}` : ''}`;
  }

  function updateSearchUi(route, resultCount, totalCount) {
    const query = state.searches[route] || '';
    const input = route === 'articles' ? els.articlesSearchInput : els.postsSearchInput;
    const status = route === 'articles' ? els.articlesSearchStatus : els.postsSearchStatus;
    const clear = $(`[data-search-clear="${route}"]`);
    if (input) input.value = query;
    if (clear) clear.hidden = !query;
    if (!status) return;
    if (query) {
      status.textContent = `“${query}”找到 ${resultCount} 条结果（共 ${totalCount} 条），匹配文字已在标题或作者栏标记。`;
    } else {
      status.textContent = '输入关键词后点击“搜索”。';
    }
  }

  function paginationTokens(current, total) {
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
    const visible = [...new Set([1, total, current - 1, current, current + 1].filter((page) => page >= 1 && page <= total))]
      .sort((a, b) => a - b);
    const tokens = [];
    visible.forEach((page, index) => {
      if (index && page - visible[index - 1] > 1) tokens.push('ellipsis');
      tokens.push(page);
    });
    return tokens;
  }

  function renderPagination(host, current, total, onChange) {
    host.replaceChildren();
    host.hidden = total <= 1;
    if (total <= 1) return;

    const makeButton = (label, page, options = {}) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `page-button${options.active ? ' active' : ''}`;
      button.textContent = label;
      button.disabled = Boolean(options.disabled);
      if (options.active) button.setAttribute('aria-current', 'page');
      if (!options.disabled && !options.active) button.addEventListener('click', () => onChange(page));
      return button;
    };

    host.appendChild(makeButton('上一页', current - 1, { disabled: current === 1 }));
    paginationTokens(current, total).forEach((token) => {
      if (token === 'ellipsis') {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'page-ellipsis';
        ellipsis.textContent = '…';
        ellipsis.setAttribute('aria-hidden', 'true');
        host.appendChild(ellipsis);
      } else {
        host.appendChild(makeButton(String(token), token, { active: token === current }));
      }
    });
    host.appendChild(makeButton('下一页', current + 1, { disabled: current === total }));
  }

  function scrollToList(host) {
    const panel = host.closest('.view-panel, .local-section') || host;
    const top = panel.getBoundingClientRect().top + window.scrollY - 104;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: Math.max(0, top), behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  function fillList(host, items, source, emptyText, pageKey, paginationHost, options = {}) {
    host.replaceChildren();
    paginationHost.replaceChildren();
    if (!items.length) {
      state.pages[pageKey] = 1;
      paginationHost.hidden = true;
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = emptyText;
      host.appendChild(empty);
      return;
    }

    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const currentPage = Math.min(Math.max(1, state.pages[pageKey] || 1), totalPages);
    state.pages[pageKey] = currentPage;
    const start = (currentPage - 1) * PAGE_SIZE;
    items.slice(start, start + PAGE_SIZE).forEach((item) => host.appendChild(createContentCard(item, source, options.query || '')));
    renderPagination(paginationHost, currentPage, totalPages, (page) => {
      if (options.hashRoute) {
        navigate(buildListRoute(options.hashRoute, page, options.query || ''));
        requestAnimationFrame(() => scrollToList(host));
        return;
      }
      state.pages[pageKey] = page;
      fillList(host, items, source, emptyText, pageKey, paginationHost, options);
      scrollToList(host);
    });
  }

  function renderOfficialLists() {
    const allArticles = state.official.filter((item) => item.type === 'article');
    const allPosts = state.official.filter((item) => item.type === 'post');
    const articles = allArticles.filter((item) => matchesSearch(item, state.searches.articles));
    const posts = allPosts.filter((item) => matchesSearch(item, state.searches.posts));
    const articleEmpty = state.searches.articles ? `没有找到与“${state.searches.articles}”匹配的官方文章。` : '目前没有已公开的官方文章。';
    const postEmpty = state.searches.posts ? `没有找到与“${state.searches.posts}”匹配的官方帖子。` : '目前没有已公开的官方帖子。';

    fillList(els.articlesList, articles, 'official', articleEmpty, 'articles', els.articlesPagination, { query: state.searches.articles, hashRoute: 'articles' });
    fillList(els.postsList, posts, 'official', postEmpty, 'posts', els.postsPagination, { query: state.searches.posts, hashRoute: 'posts' });
    updateSearchUi('articles', articles.length, allArticles.length);
    updateSearchUi('posts', posts.length, allPosts.length);
  }

  function renderLocalList() {
    fillList(els.localList, state.local, 'local', '你还没有本地成稿。完成一篇 Markdown 后，它会显示在这里。', 'local', els.localPagination);
  }

  function activeView(name, options = {}) {
    els.views.forEach((view) => view.classList.toggle('active', view.dataset.view === name));
    els.tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.route === name));
    if (name !== 'detail') state.lastListRoute = name;
    if (!options.preserveScroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function preserveScrollForNextRoute() {
    state.pendingScrollY = window.scrollY;
  }

  function restorePendingScroll(scrollY) {
    if (!Number.isFinite(scrollY)) return;
    state.pendingScrollY = null;
    requestAnimationFrame(() => window.scrollTo({ top: scrollY, left: window.scrollX, behavior: 'auto' }));
  }

  function navigate(route) {
    if (location.hash.slice(1) === route) {
      handleRoute();
      return;
    }
    location.hash = route;
  }

  function navigateToDetail(source, id) {
    navigate(`detail/${source}/${encodeURIComponent(id)}`);
  }

  function buildPaper(item, options = {}) {
    const article = document.createElement('article');
    article.className = 'official-paper';
    article.innerHTML = `
      <div class="paper-watermark"><img src="logo.svg" alt="" /></div>
      <header class="paper-header">
        <span class="panel-kicker">${item.type === 'post' ? 'OFFICIAL POST' : 'OFFICIAL ARTICLE'}</span>
        <h1>${escapeHtml(item.title || '未命名')}</h1>
        ${item.summary ? `<p class="paper-summary">${escapeHtml(item.summary)}</p>` : ''}
        <div class="paper-meta">
          <span>${item.type === 'post' ? '帖子' : '文章'}</span>
          <span>创作者：${escapeHtml(item.creator || '小学二年级联合会')}</span>
          <span>创作时间：${escapeHtml(item.date || '')}</span>
        </div>
      </header>
      <div class="markdown-body">${renderMarkdown(item.markdown || '')}</div>
      <footer class="paper-signature">
        <a class="paper-wordmark-link" href="index.html" aria-label="返回小学二年级联合会首页">
          <img class="paper-wordmark" src="${HOME_WORDMARK_URL}" alt="小学二年级联合会横向文字标识" />
        </a>
      </footer>`;

    if (options.tools?.length) {
      const tools = document.createElement('div');
      tools.className = 'paper-tools';
      options.tools.forEach(({ label, action, danger = false }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `tool-button${danger ? ' danger' : ''}`;
        button.textContent = label;
        button.addEventListener('click', action);
        tools.appendChild(button);
      });
      article.appendChild(tools);
    }
    return article;
  }

  async function loadOfficialDetail(entry) {
    const fileUrl = `${PUBLISHED_DIRECTORY}${encodeURIComponent(entry.fileName)}`;
    const response = await fetch(withNoCache(fileUrl), noCacheRequestOptions());
    if (!response.ok) throw new Error(`${entry.fileName} 读取失败（${response.status}）`);

    const decrypted = await decryptText(await readResponseUtf8(response));
    if (!decrypted.title || !decrypted.creator || !decrypted.markdown) {
      throw new Error(`${entry.fileName} 缺少必要的加密内容字段`);
    }

    const item = {
      ...decrypted,
      id: entry.id,
      fileName: entry.fileName,
      title: decrypted.title || entry.title,
      creator: decrypted.creator,
      date: entry.date || '',
      type: decrypted.type === 'post' ? 'post' : 'article',
      summary: typeof decrypted.summary === 'string' ? decrypted.summary.trim() : (stripMarkdown(decrypted.markdown).slice(0, 120) || '')
    };
    return item;
  }

  async function showDetail(source, id) {
    activeView('detail');
    els.detailHost.innerHTML = '<div class="empty-state">正在加载内容…</div>';
    try {
      let item;
      if (source === 'local') {
        item = state.local.find((entry) => entry.id === id);
        if (!item) {
          await loadLocal();
          item = state.local.find((entry) => entry.id === id);
        }
      } else {
        const entry = state.official.find((candidate) => candidate.id === id);
        if (!entry) throw new Error('内容条目不存在。');
        item = await loadOfficialDetail(entry);
      }
      if (!item) throw new Error('未找到该内容。');
      state.currentDetail = { source, item };

      const tools = [{
        label: '复制 Markdown 原文',
        action: async () => {
          try {
            await navigator.clipboard.writeText(item.markdown || '');
            showToast('Markdown 原文已复制');
          } catch (_) { showToast('复制失败，请检查浏览器权限'); }
        }
      }];

      if (source === 'local') {
        tools.push({ label: '下载加密 .txt', action: () => downloadEncrypted(item) });
        tools.push({
          label: '删除本项',
          danger: true,
          action: async () => {
            if (!confirm(`确定删除“${item.title}”吗？此操作无法撤销。`)) return;
            await dbDelete(item.id);
            await loadLocal();
            showToast('本地成稿已删除');
            navigate('publish');
          }
        });
      }

      els.detailHost.replaceChildren(buildPaper(item, { tools }));
    } catch (error) {
      els.detailHost.innerHTML = `<div class="empty-state">${escapeHtml(error.message || '内容加载失败')}</div>`;
    }
  }

  async function handleRoute() {
    const route = (location.hash || '#articles').slice(1);
    const [path, queryString = ''] = route.split('?');
    const parts = path.split('/');
    if (parts[0] === 'detail' && parts.length >= 3) {
      await showDetail(parts[1], decodeURIComponent(parts.slice(2).join('/')));
      return;
    }

    const name = ['articles', 'posts', 'publish'].includes(parts[0]) ? parts[0] : 'articles';
    const preservedScrollY = Number.isFinite(state.pendingScrollY) ? state.pendingScrollY : null;
    if (name === 'articles' || name === 'posts') {
      const params = new URLSearchParams(queryString);
      const requestedPage = Number.parseInt(params.get('page') || '1', 10);
      state.pages[name] = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      state.searches[name] = String(params.get('q') || '').trim();
    }

    activeView(name, { preserveScroll: preservedScrollY !== null });
    if (name === 'publish') {
      state.lastListRoute = 'publish';
      await loadLocal();
      restorePendingScroll(preservedScrollY);
      return;
    }

    renderOfficialLists();
    state.lastListRoute = buildListRoute(name, state.pages[name], state.searches[name]);

    if (location.hash && location.hash.slice(1) !== state.lastListRoute) {
      history.replaceState(null, '', `#${state.lastListRoute}`);
    }
    restorePendingScroll(preservedScrollY);
  }

  function syncPaperWordmarkWidth() {
    const probe = document.createElement('button');
    probe.type = 'button';
    probe.className = 'tool-button';
    probe.textContent = '复制 Markdown 原文';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;white-space:nowrap;';
    document.body.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    if (width > 0) document.documentElement.style.setProperty('--paper-wordmark-width', `${width}px`);
  }

  function updatePreview() {
    const markdown = els.markdownInput.value;
    els.previewContent.innerHTML = renderMarkdown(markdown || '*开始输入后，这里会实时显示渲染效果。*');
    els.wordCount.textContent = `${markdown.replace(/\s/g, '').length} 字`;
  }

  function saveDraft() {
    const draft = {
      title: els.draftTitle.value,
      type: els.draftType.value,
      summary: els.draftSummary.value,
      markdown: els.markdownInput.value,
      savedAt: new Date().toISOString()
    };
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      els.draftStatus.textContent = `草稿已缓存 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      els.draftStatus.textContent = '草稿缓存失败';
    }
  }

  const saveDraftDebounced = debounce(saveDraft, 300);

  function loadDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!draft) return;
      els.draftTitle.value = draft.title || '';
      els.draftType.value = draft.type === 'post' ? 'post' : 'article';
      els.draftSummary.value = draft.summary || '';
      els.markdownInput.value = draft.markdown || '';
    } catch (_) {}
  }

  function clearDraft(ask = true) {
    if (ask && (els.draftTitle.value || els.draftSummary.value || els.markdownInput.value) && !confirm('确定清空当前草稿吗？')) return;
    els.draftTitle.value = '';
    els.draftType.value = 'article';
    els.draftSummary.value = '';
    els.markdownInput.value = '';
    localStorage.removeItem(DRAFT_KEY);
    updatePreview();
    els.draftStatus.textContent = '草稿已启用本地缓存';
  }

  function openFinishDialog() {
    const title = els.draftTitle.value.trim();
    const markdown = els.markdownInput.value.trim();
    if (!title) return showToast('请先填写文章标题');
    if (!markdown) return showToast('请先输入 Markdown 内容');
    els.creatorName.value = '';
    els.finishDialog.hidden = false;
    setTimeout(() => els.creatorName.focus(), 50);
  }

  function closeFinishDialog() {
    els.finishDialog.hidden = true;
  }

  async function finishDraft() {
    const creator = els.creatorName.value.trim();
    if (!creator) return showToast('请输入创作者名称');
    const item = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: els.draftTitle.value.trim(),
      type: els.draftType.value === 'post' ? 'post' : 'article',
      summary: els.draftSummary.value.trim(),
      markdown: els.markdownInput.value,
      creator,
      date: localDate(),
      createdAt: new Date().toISOString()
    };
    await dbPut(item);
    closeFinishDialog();
    if (els.downloadOnFinish.checked) await downloadEncrypted(item);
    clearDraft(false);
    await loadLocal();
    showToast('已保存为不可修改的本地成稿');
  }

  function bindEvents() {
    window.addEventListener('ug2:library-progress', (event) => updateLibraryProgress(event.detail));
    els.tabs.forEach((tab) => tab.addEventListener('click', () => navigate(tab.dataset.route)));
    $$('.community-search').forEach((form) => form.addEventListener('submit', (event) => {
      event.preventDefault();
      const route = form.dataset.searchRoute;
      const input = route === 'articles' ? els.articlesSearchInput : els.postsSearchInput;
      const query = input?.value.trim() || '';
      state.pages[route] = 1;
      state.searches[route] = query;
      preserveScrollForNextRoute();
      navigate(buildListRoute(route, 1, query));
    }));
    $$('[data-search-clear]').forEach((button) => button.addEventListener('click', () => {
      const route = button.dataset.searchClear;
      state.pages[route] = 1;
      state.searches[route] = '';
      const input = route === 'articles' ? els.articlesSearchInput : els.postsSearchInput;
      if (input) input.value = '';
      preserveScrollForNextRoute();
      navigate(route);
    }));
    $$('[data-refresh]').forEach((button) => button.addEventListener('click', async () => {
      const original = button.textContent;
      button.disabled = true;
      button.textContent = '刷新中…';
      try {
        await loadOfficial(true);
        showToast('官方内容列表已刷新');
      } catch (error) {
        showToast(error.message || '刷新失败');
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    }));
    $('#refreshLocal').addEventListener('click', async () => {
      await loadLocal();
      showToast('本地成稿列表已刷新');
    });
    $('#backButton').addEventListener('click', () => navigate(state.lastListRoute || 'articles'));
    $('#clearDraft').addEventListener('click', () => clearDraft(true));
    $('#finishDraft').addEventListener('click', openFinishDialog);
    $('#confirmFinish').addEventListener('click', finishDraft);
    $$('[data-close-dialog]').forEach((button) => button.addEventListener('click', closeFinishDialog));
    els.finishDialog.addEventListener('click', (event) => {
      if (event.target === els.finishDialog) closeFinishDialog();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.finishDialog.hidden) closeFinishDialog();
    });
    [els.draftTitle, els.draftType, els.draftSummary, els.markdownInput].forEach((input) => input.addEventListener('input', () => {
      updatePreview();
      saveDraftDebounced();
    }));
    els.draftType.addEventListener('change', saveDraftDebounced);
    window.addEventListener('hashchange', handleRoute);
  }

  async function init() {
    bindEvents();
    syncPaperWordmarkWidth();
    window.addEventListener('resize', debounce(syncPaperWordmarkWidth, 120));
    loadDraft();
    updateLibraryProgress(window.UG2LibraryStatus);
    try {
      await window.UG2LibrariesReady;
      state.librariesReady = true;
      els.libraryState.textContent = 'Markdown · LaTeX 已就绪';
      els.libraryState.style.setProperty('--library-progress', '100%');
      document.documentElement.style.setProperty('--library-progress-page', '100%');
      els.libraryState.classList.add('ready');
    } catch (error) {
      els.libraryState.textContent = '渲染库加载失败';
      console.error(error);
    }
    updatePreview();
    await Promise.allSettled([loadOfficial(false), loadLocal()]);
    if (!state.official.length) renderOfficialLists();
    await handleRoute();
  }

  init();
})();
