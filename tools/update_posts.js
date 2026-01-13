import fs from "node:fs";
import path from "node:path";
import Parser from "rss-parser";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "posts");
const POSTS_JSON = path.join(ROOT, "posts.json");
const SOURCES_JSON = path.join(ROOT, "tools", "sources.json");

const MAX_ITEMS_PER_FEED = 8;      // 1RSSから拾う最大件数
const MAX_TOTAL_ITEMS = 50;        // posts.jsonに保持する最大件数
const TIMEZONE_OFFSET = "+09:00";  // 日本時間表記

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const s = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toIsoJst(dateLike) {
  // RSSのpubDate等をなるべくISO+09:00に寄せる
  const d = dateLike ? new Date(dateLike) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().replace("Z", TIMEZONE_OFFSET);

  // JSTへ固定表記（実際のDate内部はUTC基準だけど、表示上+09:00にする）
  const utc = d.getTime();
  const jst = new Date(utc + 9 * 60 * 60 * 1000);

  const yyyy = jst.getUTCFullYear();
  const mm = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const HH = String(jst.getUTCHours()).padStart(2, "0");
  const MM = String(jst.getUTCMinutes()).padStart(2, "0");
  const SS = String(jst.getUTCSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}${TIMEZONE_OFFSET}`;
}

function toDisplayJst(iso) {
  // 2026-01-13T09:00:00+09:00 -> 2026/1/13 9:00:00
  const s = String(iso || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return s;
  const [_, y, mo, d, h, mi, se] = m;
  return `${y}/${Number(mo)}/${Number(d)} ${Number(h)}:${mi}:${se}`;
}

function stableIdFromUrl(url) {
  // URLからなるべく安定したID生成（無い場合は現在時刻）
  // 完全一致しなくてもOK。被らないことが重要。
  if (!url) return String(Date.now());
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = (hash * 31 + url.charCodeAt(i)) >>> 0;
  }
  // "1768..."みたいな見た目に寄せる（ミリ秒っぽい桁）
  const now = Date.now();
  const suffix = String(hash).padStart(10, "0").slice(0, 6);
  return String(now).slice(0, 7) + suffix; // 13桁前後
}

function renderPostHtml({ title, date, sourceName, sourceUrl }) {
  const safeTitle = escapeHtml(title);
  const safeSourceUrl = escapeHtml(sourceUrl);
  const safeSourceName = escapeHtml(sourceName);
  const displayDate = escapeHtml(toDisplayJst(date));

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP",sans-serif;margin:0;background:#fff;color:#111}
    .wrap{max-width:860px;margin:0 auto;padding:24px}
    .muted{color:#666}
    a{color:#0a58ca;text-decoration:none}
    a:hover{text-decoration:underline}
    .card{border:1px solid #eee;border-radius:14px;padding:18px}
    h1{font-size:24px;margin:0 0 10px}
  </style>
</head>
<body>
  <div class="wrap">
    <p class="muted"><a href="/">← 最新記事へ戻る</a></p>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p class="muted">公開: ${displayDate}</p>
      <p class="muted">出典: ${safeSourceName}</p>
      <p><a href="${safeSourceUrl}" target="_blank" rel="noopener">元記事を開く</a></p>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  ensureDir(POSTS_DIR);

  const sources = readJson(SOURCES_JSON, []);
  if (!Array.isArray(sources) || sources.length === 0) {
    console.log("❌ tools/sources.json が空です");
    process.exit(1);
  }

  const existingPosts = readJson(POSTS_JSON, []);
  const existingBySourceUrl = new Map();
  for (const p of existingPosts) {
    if (p?.sourceUrl) existingBySourceUrl.set(p.sourceUrl, p);
  }

  const parser = new Parser({
    timeout: 20000,
    headers: { "User-Agent": "rss-to-gh-pages/1.0" }
  });

  let newCount = 0;
  const collected = [];

  for (const src of sources) {
    const feedUrl = src?.url;
    const srcName = src?.name || "RSS";
    if (!feedUrl) continue;

    console.log(`🛰️ Fetch: ${srcName} -> ${feedUrl}`);
    let feed;
    try {
      feed = await parser.parseURL(feedUrl);
    } catch (e) {
      console.log(`⚠️ 取得失敗: ${srcName}`, e?.message || e);
      continue;
    }

    const items = (feed.items || []).slice(0, MAX_ITEMS_PER_FEED);

    for (const it of items) {
      const title = it.title || "（タイトルなし）";
      const sourceUrl = it.link || it.guid || "";
      if (!sourceUrl) continue;

      // 既にあるならスキップ
      if (existingBySourceUrl.has(sourceUrl)) {
        collected.push(existingBySourceUrl.get(sourceUrl));
        continue;
      }

      const id = stableIdFromUrl(sourceUrl);
      const date = toIsoJst(it.isoDate || it.pubDate || new Date().toISOString());
      const link = `/posts/${id}.html`;

      const post = { id, title, date, link, sourceUrl, sourceName: srcName };
      collected.push(post);

      // HTML生成
      const htmlPath = path.join(POSTS_DIR, `${id}.html`);
      fs.writeFileSync(htmlPath, renderPostHtml(post), "utf-8");

      newCount++;
    }
  }

  // 重複除去（sourceUrl基準）
  const uniq = [];
  const seen = new Set();
  for (const p of collected) {
    if (!p?.sourceUrl) continue;
    if (seen.has(p.sourceUrl)) continue;
    seen.add(p.sourceUrl);
    uniq.push(p);
  }

  // 新しい順（date desc）
  uniq.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // 最大件数に切る
  const finalPosts = uniq.slice(0, MAX_TOTAL_ITEMS).map(p => ({
    id: String(p.id),
    title: String(p.title),
    date: String(p.date),
    link: String(p.link),
    sourceUrl: String(p.sourceUrl)
  }));

  writeJson(POSTS_JSON, finalPosts);

  console.log(`✅ 完了: 追加 ${newCount} 件 / 合計 ${finalPosts.length} 件`);
}

main().catch((e) => {
  console.error("❌ 致命的エラー", e);
  process.exit(1);
});