'use strict';

const $ = id => document.getElementById(id);

let currentSessionId = null;

// 現在のタブのURLを取得してセット
chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  if (tabs[0] && tabs[0].url) {
    const url = tabs[0].url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      $('input-url').value = url;
    }
  }
});

// クロール開始
$('btn-start').addEventListener('click', () => {
  const url = $('input-url').value.trim();
  const keywords = $('input-keywords').value.trim();
  const maxPages = parseInt($('input-max-pages').value, 10) || 100;
  const maxDepth = parseInt($('input-max-depth').value, 10) || 3;

  if (!url) {
    showError('クロール開始URLを入力してください');
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showError('URLは http:// または https:// で始まる必要があります');
    return;
  }
  if (!keywords) {
    showError('検索キーワードを入力してください');
    return;
  }

  hideError();
  currentSessionId = Date.now().toString();

  setUIState('running');
  clearResults();

  chrome.runtime.sendMessage({
    type: 'START_CRAWL',
    sessionId: currentSessionId,
    url,
    keywords,
    maxPages,
    maxDepth
  }, response => {
    if (chrome.runtime.lastError) {
      showError('拡張機能との通信に失敗しました: ' + chrome.runtime.lastError.message);
      setUIState('idle');
    }
  });
});

// 停止
$('btn-stop').addEventListener('click', () => {
  if (currentSessionId) {
    chrome.runtime.sendMessage({
      type: 'STOP_CRAWL',
      sessionId: currentSessionId
    });
  }
});

// 全URLコピー
$('btn-copy').addEventListener('click', () => {
  const items = document.querySelectorAll('.url-item');
  if (items.length === 0) return;

  const urls = Array.from(items).map(el => el.textContent.trim()).join('\n');
  navigator.clipboard.writeText(urls).then(() => {
    const btn = $('btn-copy');
    btn.textContent = 'コピー完了!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = '全URLをコピー';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // フォールバック: テキストエリアを使ってコピー
    const ta = document.createElement('textarea');
    ta.value = urls;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    const btn = $('btn-copy');
    btn.textContent = 'コピー完了!';
    setTimeout(() => { btn.textContent = '全URLをコピー'; }, 2000);
  });
});

// バックグラウンドからのメッセージを受信
chrome.runtime.onMessage.addListener((message) => {
  if (message.sessionId && message.sessionId !== currentSessionId) return;

  switch (message.type) {
    case 'CRAWL_PROGRESS':
      updateProgress(message.crawled, message.total, message.status);
      break;

    case 'CRAWL_MATCH':
      addUrlToList(message.url);
      break;

    case 'CRAWL_COMPLETE':
      setUIState('done');
      updateProgress(message.crawled, message.crawled, '完了');
      setBadge('done', `完了 (${message.crawled}件クロール)`);
      break;

    case 'CRAWL_STOPPED':
      setUIState('stopped');
      setBadge('stopped', '停止');
      break;

    case 'CRAWL_ERROR':
      showError(message.error);
      setUIState('idle');
      break;
  }
});

// ——— UI ヘルパー ———

function setUIState(state) {
  const btnStart = $('btn-start');
  const btnStop = $('btn-stop');
  const progressArea = $('progress-area');
  const resultsArea = $('results-area');

  if (state === 'running') {
    btnStart.disabled = true;
    btnStop.style.display = 'block';
    progressArea.style.display = 'block';
    resultsArea.style.display = 'block';
    $('btn-copy').style.display = 'none';
    setBadge('running', '実行中');
  } else if (state === 'done' || state === 'stopped') {
    btnStart.disabled = false;
    btnStop.style.display = 'none';
    const count = document.querySelectorAll('.url-item').length;
    if (count > 0) $('btn-copy').style.display = 'block';
  } else {
    // idle
    btnStart.disabled = false;
    btnStop.style.display = 'none';
    progressArea.style.display = 'none';
  }
}

function updateProgress(crawled, total, statusText) {
  const pct = total > 0 ? Math.min(100, Math.round((crawled / total) * 100)) : 0;
  $('progress-bar').style.width = pct + '%';
  $('progress-text').textContent = `${statusText} — クロール済み: ${crawled}件 / マッチ: ${document.querySelectorAll('.url-item').length}件`;
}

function addUrlToList(url) {
  const list = $('url-list');
  // 空状態のプレースホルダを削除
  const empty = list.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'url-item';
  item.textContent = url;
  list.appendChild(item);

  const count = list.querySelectorAll('.url-item').length;
  $('match-count').textContent = count;

  // 自動スクロール
  list.scrollTop = list.scrollHeight;
}

function clearResults() {
  $('url-list').innerHTML = '<div class="empty-state">該当するURLが見つかりませんでした</div>';
  $('match-count').textContent = '0';
  $('progress-bar').style.width = '0%';
  $('progress-text').textContent = '初期化中...';
  $('status-badge').textContent = '';
  $('status-badge').className = 'status-badge';
}

function setBadge(type, text) {
  const badge = $('status-badge');
  badge.textContent = text;
  badge.className = 'status-badge ' + type;
}

function showError(msg) {
  const el = $('error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function hideError() {
  $('error-msg').style.display = 'none';
}
