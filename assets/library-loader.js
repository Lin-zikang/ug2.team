(() => {
  'use strict';

  const DOMESTIC_CDN = {
    marked: [
      'https://cdn.bootcdn.net/ajax/libs/marked/12.0.2/marked.min.js',
      'https://cdn.staticfile.net/marked/12.0.2/marked.min.js',
      'https://s4.zstatic.net/ajax/libs/marked/12.0.2/marked.min.js',
      'https://cdnjs.snrat.com/ajax/libs/marked/12.0.2/marked.min.js'
    ],
    purify: [
      'https://cdn.bootcdn.net/ajax/libs/dompurify/3.1.6/purify.min.js',
      'https://cdn.staticfile.net/dompurify/3.1.6/purify.min.js',
      'https://s4.zstatic.net/ajax/libs/dompurify/3.1.6/purify.min.js',
      'https://cdnjs.snrat.com/ajax/libs/dompurify/3.1.6/purify.min.js'
    ],
    katex: [
      'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.11/katex.min.js',
      'https://cdn.staticfile.net/KaTeX/0.16.11/katex.min.js',
      'https://s4.zstatic.net/ajax/libs/KaTeX/0.16.11/katex.min.js',
      'https://cdnjs.snrat.com/ajax/libs/KaTeX/0.16.11/katex.min.js'
    ],
    katexCss: [
      'https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.11/katex.min.css',
      'https://cdn.staticfile.net/KaTeX/0.16.11/katex.min.css',
      'https://s4.zstatic.net/ajax/libs/KaTeX/0.16.11/katex.min.css',
      'https://cdnjs.snrat.com/ajax/libs/KaTeX/0.16.11/katex.min.css'
    ]
  };

  const LOCAL = {
    marked: 'vendor/marked.min.js',
    purify: 'vendor/purify.min.js',
    katex: 'vendor/katex.min.js',
    katexCss: 'vendor/katex.min.css'
  };

  const LOAD_TIMEOUT = 2800;

  function unique(list) {
    return [...new Set(list.filter(Boolean))];
  }

  function isRemote(url) {
    return /^https?:\/\//i.test(url);
  }

  let lastProgress = 0;

  function reportProgress(percent, label) {
    lastProgress = Math.max(lastProgress, Math.min(100, Math.round(percent)));
    const detail = { percent: lastProgress, label };
    window.UG2LibraryStatus = detail;
    window.dispatchEvent(new CustomEvent('ug2:library-progress', { detail }));
  }

  function loadScript(sources, test) {
    return new Promise((resolve, reject) => {
      if (test()) return resolve('already-loaded');
      const candidates = unique(Array.isArray(sources) ? sources : [sources]);
      let current = 0;
      let settled = false;
      const errors = [];

      const add = () => {
        if (settled) return;
        const src = candidates[current];
        if (!src) {
          settled = true;
          reject(new Error(`无法加载脚本：${candidates.join(' / ')}`));
          return;
        }

        const script = document.createElement('script');
        script.src = src;
        script.charset = 'UTF-8';
        script.async = true;
        if (isRemote(src)) script.crossOrigin = 'anonymous';

        const next = (reason) => {
          if (settled) return;
          if (reason) errors.push(reason);
          script.remove();
          current += 1;
          add();
        };

        const timer = setTimeout(() => next(new Error(`加载超时：${src}`)), LOAD_TIMEOUT);
        script.onload = () => {
          clearTimeout(timer);
          if (settled) return;
          if (test()) {
            settled = true;
            resolve(isRemote(src) ? 'domestic-cdn' : 'local');
          } else {
            next(new Error(`库未正确初始化：${src}`));
          }
        };
        script.onerror = () => {
          clearTimeout(timer);
          next(new Error(`加载失败：${src}`));
        };
        document.head.appendChild(script);
      };

      add();
    });
  }

  function loadStyle(sources) {
    return new Promise((resolve) => {
      const candidates = unique(Array.isArray(sources) ? sources : [sources]);
      let current = 0;
      let settled = false;

      const add = () => {
        if (settled) return;
        const href = candidates[current];
        if (!href) {
          settled = true;
          resolve('unavailable');
          return;
        }

        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        if (isRemote(href)) link.crossOrigin = 'anonymous';

        const next = () => {
          if (settled) return;
          link.remove();
          current += 1;
          add();
        };

        const timer = setTimeout(next, LOAD_TIMEOUT);
        link.onload = () => {
          clearTimeout(timer);
          if (!settled) {
            settled = true;
            resolve(isRemote(href) ? 'domestic-cdn' : 'local');
          }
        };
        link.onerror = () => {
          clearTimeout(timer);
          next();
        };
        document.head.appendChild(link);
      };

      add();
    });
  }

  async function registerWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      await navigator.serviceWorker.ready;
      return registration;
    } catch (error) {
      console.warn('Service Worker 注册失败，页面仍可使用内置库。', error);
    }
  }

  registerWorker();
  reportProgress(8, '正在准备 Markdown 与 LaTeX…');

  window.UG2LibrariesReady = Promise.all([
    loadStyle([LOCAL.katexCss, ...DOMESTIC_CDN.katexCss])
      .then((result) => { reportProgress(34, '正在准备公式样式…'); return result; }),
    loadScript([LOCAL.marked, ...DOMESTIC_CDN.marked], () => Boolean(window.marked))
      .then((result) => { reportProgress(48, '正在准备 Markdown…'); return result; }),
    loadScript([LOCAL.purify, ...DOMESTIC_CDN.purify], () => Boolean(window.DOMPurify))
      .then((result) => { reportProgress(62, '正在检查渲染安全性…'); return result; })
  ]).then(async ([katexCss, marked, purify]) => {
    reportProgress(76, '正在准备 LaTeX…');
    const katex = await loadScript([LOCAL.katex, ...DOMESTIC_CDN.katex], () => Boolean(window.katex))
      .catch((error) => {
        console.warn('KaTeX 本体加载失败，将使用国内公式图片 API 兜底。', error);
        return 'api-fallback';
      });
    reportProgress(100, 'Markdown · LaTeX 已就绪');
    return { katexCss, marked, purify, katex };
  });
})();
