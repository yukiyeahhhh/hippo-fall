// ─ アクセス＆プレイ計測（Google Analytics 4） ─
// 使い方: 下の GA_ID に GA4 の「測定ID」(G-XXXXXXXXXX) を入れると計測が始まる。
// 空のままなら完全に無効（何も読み込まず、エラーも出ない）。
window.GA_ID = 'G-D1VYYE5KDX'; // ← GA4 測定ID

(function () {
  if (!window.GA_ID) return; // ID未設定なら計測しない
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + window.GA_ID;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', window.GA_ID);
})();

// ゲーム内イベント送信。GA未設定でも安全な no-op。
// 例: track('stage_clear', { stage: 3 })
window.track = function (name, params) {
  try { if (window.gtag) window.gtag('event', name, params || {}); } catch (e) {}
};
