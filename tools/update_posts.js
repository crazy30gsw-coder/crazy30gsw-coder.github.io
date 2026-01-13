import fs from "node:fs";
import path from "node:path";
import Parser from "rss-parser";

const ROOT = process.cwd();
const POSTS_DIR = path.join(ROOT, "posts");
const POSTS_JSON = path.join(ROOT, "posts.json");

const parser = new Parser({
  timeout: 20000
});

// ✅ ここにRSSを追加（好きなだけOK）
const FEEDS = [
  "https://news.google.com/rss/search?q=%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9&hl=ja&gl=JP&ceid=JP:ja",
  "https://news.yahoo.co.jp/pickup/rss.xml"
];

const MAX_POSTS = 80;

// ---------- utils ----------
function ensureDir(dir){
  if(!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeText(s){
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function nowIso(){
  return new Date().toISOString();
}

function makeIdFromLink(link){
  // ざっくり一意化（URLが無い記事もあるのでfallback）
  const base = link || ("no-link-" + Math.random());
  let h = 0;
  for(let i=0;i<base.length;i++){
    h = (h * 31 + base.charCodeAt(i)) >>> 0;
  }
  return String(h);
}

function loadExisting(){
  if(!fs.existsSync(POSTS_JSON)) return [];
  try{
    const j = JSON.parse(fs.readFileSync(POSTS_JSON, "utf-8"));
    return Array.isArray(j) ? j : [];
  }catch{
    return [];
  }
}

function savePosts(posts){
  fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2), "utf-8");
}

function renderPostHtml({ title, date, sourceUrl }){
  const t = safeText(title);
  const d = safeText(date);
  const src = safeText(sourceUrl || "");
  const srcLink = sourceUrl ? `<p><a href="${src}" target="_blank" rel="noopener">元記事を開く</a></p>` : "";

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${t}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,"Noto Sans JP",sans-serif;margin:0;background:#fff;color:#111}
    header{padding:18px 16px;border-bottom:1px solid #eee}
    a{color:#0a58ff}
    main{padding:16px}
    h1{font-size:22px;line-height:1.25;margin:0 0 10px}
    .meta{color:#666;font-size:13px;margin-bottom:18px}
    .box{border:1px solid #eee;border-radius:14px;padding:14px}
    .muted{color:#666}
  </style>
</head>
<body>
  <header>
    <a href="/" rel="noopener">← 一覧へ戻る</a>
  </header>
  <main>
    <h1>${t}</h1>
    <div class="meta">${d}</div>

    <div class="box">
      <p class="muted">この記事はRSSから自動生成した「読み取り用ページ」です。</p>
      ${srcLink}
    </div>
  </main>
</body>
</html>`;
}

async function fetchAll(){
  const items = [];
  for(const feedUrl of FEEDS){
    try{
      const feed = await parser.parseURL(feedUrl);
      for(const it of (feed.items || [])){
        items.push({
          title: it.title || "(no title)",
          sourceUrl: it.link || "",
          date: (it.isoDate || it.pubDate || nowIso())
        });
      }
      console.log("OK feed:", feedUrl, "items:", (feed.items || []).length);
    }catch(e){
      console.log("NG feed:", feedUrl, String(e?.message || e));
    }
  }
  return items;
}

async function main(){
  ensureDir(POSTS_DIR);

  const existing = loadExisting();
  const existingBySource = new Map(existing.map(p => [p.sourceUrl, p]));

  const fresh = await fetchAll();

  let added = 0;

  for(const it of fresh){
    const sourceUrl = it.sourceUrl || "";
    if(sourceUrl && existingBySource.has(sourceUrl)) continue;

    const id = makeIdFromLink(sourceUrl || it.title + it.date);
    const file = `${id}.html`;
    const link = `/posts/${file}`;

    const post = {
      id,
      title: it.title,
      date: new Date(it.date).toISOString(),
      link,
      sourceUrl: sourceUrl || ""
    };

    // 記事HTML生成
    const html = renderPostHtml(post);
    fs.writeFileSync(path.join(POSTS_DIR, file), html, "utf-8");

    existing.unshift(post);
    existingBySource.set(post.sourceUrl, post);
    added++;
  }

  // 新しい順にソート（dateが新しい順）
  existing.sort((a,b) => new Date(b.date) - new Date(a.date));

  // 件数制限
  const trimmed = existing.slice(0, MAX_POSTS);

  savePosts(trimmed);

  console.log(`done. added=${added}, total=${trimmed.length}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});