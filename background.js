'use strict';

// アクティブなクロールセッション管理
const activeSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START_CRAWL') {
    startCrawl(message);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === 'STOP_CRAWL') {
    stopCrawl(message.sessionId);
    sendResponse({ ok: true });
    return false;
  }
});

/**
 * クロールを開始する
 * BFS (幅優先探索) で同一ドメイン内のページを巡回し、
 * キーワードにマッチするURLをポップアップへ通知する
 */
async function startCrawl({ sessionId, url, keywords, maxPages, maxDepth }) {
  const keywordList = keywords
    .split(/[\s,]+/)
    .map(k => k.trim())
    .filter(Boolean);

  if (keywordList.length === 0) {
    notifyPopup({ type: 'CRAWL_ERROR', sessionId, error: 'キーワードが指定されていません' });
    return;
  }

  let baseOrigin;
  try {
    baseOrigin = new URL(url).origin;
  } catch {
    notifyPopup({ type: 'CRAWL_ERROR', sessionId, error: '無効なURLです: ' + url });
    return;
  }

  // セッション状態
  const session = {
    stopped: false,
    crawled: 0
  };
  activeSessions.set(sessionId, session);

  // BFSキュー: { url, depth }
  const queue = [{ url: normalizeUrl(url), depth: 0 }];
  const visited = new Set();
  visited.add(normalizeUrl(url));

  while (queue.length > 0 && !session.stopped) {
    if (session.crawled >= maxPages) break;

    const { url: currentUrl, depth } = queue.shift();

    // 進捗通知
    notifyPopup({
      type: 'CRAWL_PROGRESS',
      sessionId,
      crawled: session.crawled,
      total: Math.min(maxPages, session.crawled + queue.length + 1),
      status: `クロール中: ${truncateUrl(currentUrl, 50)}`
    });

    let html;
    try {
      html = await fetchPage(currentUrl);
    } catch {
      // 取得失敗はスキップ
      continue;
    }

    session.crawled++;

    if (session.stopped) break;

    // キーワードチェック（テキスト部分を抽出して検索）
    const textContent = stripHtml(html);
    if (containsAllKeywords(textContent, keywordList)) {
      notifyPopup({ type: 'CRAWL_MATCH', sessionId, url: currentUrl });
    }

    // 次の深さへ進む場合のみリンクを抽出
    if (depth < maxDepth) {
      const links = extractLinks(html, currentUrl, baseOrigin);
      for (const link of links) {
        const normalized = normalizeUrl(link);
        if (!visited.has(normalized)) {
          visited.add(normalized);
          queue.push({ url: normalized, depth: depth + 1 });
        }
      }
    }
  }

  activeSessions.delete(sessionId);

  if (session.stopped) {
    notifyPopup({ type: 'CRAWL_STOPPED', sessionId });
  } else {
    notifyPopup({
      type: 'CRAWL_COMPLETE',
      sessionId,
      crawled: session.crawled
    });
  }
}

function stopCrawl(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.stopped = true;
  }
}

/**
 * ページのHTMLをfetchで取得する
 * リダイレクト追跡あり、タイムアウト10秒
 */
async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ja,en;q=0.9'
      }
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    // HTMLのみ処理（PDFや画像を除外）
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('html')) {
      throw new Error('Not HTML');
    }

    // 文字化け対策: レスポンスのバイト列を取得し、
    // Content-Typeのcharsetまたはmetaタグのcharsetで読む
    const buffer = await response.arrayBuffer();
    return decodeHtml(buffer, contentType);
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * バイト列をHTMLとしてデコードする
 * charsetをContent-TypeまたはHTMLのmetaタグから推定
 */
function decodeHtml(buffer, contentType) {
  // まずUTF-8で仮デコードしてmetaタグのcharsetを調べる
  const utf8text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  // Content-Typeのcharset
  const ctMatch = contentType.match(/charset=([^\s;]+)/i);
  if (ctMatch) {
    const charset = ctMatch[1].trim().replace(/['"]/g, '');
    try {
      return new TextDecoder(charset, { fatal: false }).decode(buffer);
    } catch {
      return utf8text;
    }
  }

  // metaタグのcharset
  const metaMatch = utf8text.match(
    /<meta[^>]+(?:charset=["']?([^"';\s>]+)|http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"';\s>]+))/i
  );
  if (metaMatch) {
    const charset = (metaMatch[1] || metaMatch[2] || '').trim();
    if (charset) {
      try {
        return new TextDecoder(charset, { fatal: false }).decode(buffer);
      } catch {
        return utf8text;
      }
    }
  }

  return utf8text;
}

/**
 * HTML文字列から同一オリジンの内部リンクを抽出する
 */
function extractLinks(html, baseUrl, baseOrigin) {
  const links = new Set();

  // href属性からリンクを取得
  const hrefRegex = /href=["']([^"'#?\s][^"'\s]*)['"]/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    const raw = match[1];
    try {
      const resolved = new URL(raw, baseUrl).href;
      const parsed = new URL(resolved);

      // 同一オリジンのみ
      if (parsed.origin !== baseOrigin) continue;

      // 不要な拡張子を除外（PDF, 画像, CSS, JSなど）
      const ext = parsed.pathname.split('.').pop().toLowerCase();
      const skip = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp',
                    'css', 'js', 'json', 'xml', 'zip', 'tar', 'gz',
                    'mp4', 'mp3', 'avi', 'mov', 'doc', 'docx', 'xls',
                    'xlsx', 'ppt', 'pptx'];
      if (skip.includes(ext)) continue;

      // フラグメントとクエリを除去したURLを追加
      parsed.hash = '';
      links.add(parsed.href);
    } catch {
      // 無効なURLはスキップ
    }
  }

  return links;
}

/**
 * HTMLタグを除去してテキストコンテンツを返す
 * script/styleブロックも削除
 */
function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * テキストが全てのキーワードを含むか確認する（大文字小文字を無視）
 */
function containsAllKeywords(text, keywords) {
  const lowerText = text.toLowerCase();
  return keywords.every(kw => lowerText.includes(kw.toLowerCase()));
}

/**
 * URLを正規化（末尾スラッシュを統一、クエリ除去）
 */
function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    // 末尾スラッシュを統一
    if (parsed.pathname === '' || parsed.pathname === '/') {
      parsed.pathname = '/';
    }
    return parsed.href;
  } catch {
    return url;
  }
}

/**
 * 表示用URLの短縮
 */
function truncateUrl(url, maxLen) {
  if (url.length <= maxLen) return url;
  return url.substring(0, maxLen - 3) + '...';
}

/**
 * ポップアップにメッセージを送信する
 * ポップアップが閉じている場合はエラーを無視
 */
function notifyPopup(message) {
  chrome.runtime.sendMessage(message).catch(() => {
    // ポップアップが閉じている場合は無視
  });
}
