// ══════════════════════════════════════════════════════════════════
// sw.js  —  同興營造 Kiosk Service Worker
// 部署位置：yehlc.github.io/Tonsin/sw.js
// 功能：快取所有 LIFF 靜態頁面，讓 WiFi iPad 在無網路時仍可開啟
// ══════════════════════════════════════════════════════════════════

const CACHE_VER  = 'tonsin-v3';   // 更新版本時改此名稱，舊快取自動清除
const BASE       = '/Tonsin';

// ── 預快取清單（安裝時一次性下載）────────────────────────────────
const PRECACHE = [
  `${BASE}/liff-kiosk.html`,
  `${BASE}/liff-inspection.html`,
  `${BASE}/liff-floorplan.html`,
  `${BASE}/liff-attachment.html`,
  // QR Code 函式庫（供 inspection 離線顯示簽名 QR）
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  // Chart.js（供 stats 頁面）
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js',
];

// ── Install：預快取靜態資源 ───────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting(); // 立即啟用，不等舊 SW 結束
  event.waitUntil(
    caches.open(CACHE_VER).then(cache =>
      // 用 allSettled 避免單一失敗中斷整個安裝
      Promise.allSettled(
        PRECACHE.map(url =>
          cache.add(url).catch(e =>
            console.warn(`[SW] 快取失敗: ${url}`, e.message)
          )
        )
      )
    )
  );
});

// ── Activate：清除舊版快取 ─────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VER).map(k => {
          console.log(`[SW] 清除舊快取: ${k}`);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim()) // 立即控制所有分頁
  );
});

// ── Fetch：請求攔截策略 ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. ngrok / API 伺服器 → 純網路，讓 app 自行處理失敗（有離線佇列）
  if (
    url.hostname.includes('ngrok') ||
    url.hostname.includes('localhost') ||
    url.port === '3000'
  ) {
    return; // 不攔截，讓 fetch 正常走
  }

  // 2. LIFF SDK（含認證重導向）→ 純網路，不快取
  if (url.hostname.includes('line-scdn.net')) {
    return;
  }

  // 3. LINE API → 純網路
  if (url.hostname.includes('api.line.me') || url.hostname.includes('liff.line.me')) {
    return;
  }

  // 4. 我們的靜態頁面 + CDN 函式庫 → Cache-First（有快取就用，沒快取才抓網路）
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // 背景更新（stale-while-revalidate）
        const fetchPromise = fetch(event.request).then(fresh => {
          if (fresh && fresh.status === 200) {
            caches.open(CACHE_VER).then(c => c.put(event.request, fresh.clone()));
          }
          return fresh;
        }).catch(() => {}); // 離線時背景更新失敗是正常的，不需處理
        return cached; // 立刻回傳快取版本
      }

      // 快取沒有 → 嘗試網路
      return fetch(event.request).then(response => {
        if (!response || response.status !== 200) return response;
        // 快取一份供下次離線使用
        const toCache = response.clone();
        caches.open(CACHE_VER).then(c => c.put(event.request, toCache));
        return response;
      }).catch(() => {
        // 網路也失敗 → 回傳 kiosk 首頁（讓使用者知道有問題）
        return caches.match(`${BASE}/liff-kiosk.html`);
      });
    })
  );
});

// ── Message：接收來自頁面的指令 ──────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // 接收「預載平面圖」指令（由 kiosk 頁面觸發）
  if (event.data?.type === 'PRECACHE_URLS' && event.data.urls) {
    caches.open(CACHE_VER).then(cache =>
      Promise.allSettled(
        event.data.urls.map(url =>
          fetch(url, { headers: { 'ngrok-skip-browser-warning': 'true' } })
            .then(r => r.ok ? cache.put(url, r) : null)
            .catch(() => {})
        )
      )
    ).then(() => {
      event.source?.postMessage({ type: 'PRECACHE_DONE', urls: event.data.urls });
    });
  }
});
