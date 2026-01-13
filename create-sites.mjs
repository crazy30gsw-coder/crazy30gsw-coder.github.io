import fs from "node:fs/promises";
import path from "node:path";
import Parser from "rss-parser";

const FEEDS_PATH = "./feeds.json";
const POSTS_PATH = "./posts.json";
const P_DIR = "./p";

const parser = new Parser({
  customFields: {
    item: [
      ["media:content", "mediaContent", { keepArray: true }],
      ["media:thumbnail", "mediaThumbnail", { keepArray: true }]
    ]
  }
});

const MAX_ITEMS_PER_FEED = 30;       // 1フィードあたり最大取得
const MAX_TOTAL_POSTS = 120;         // 全体上限（増やしたければここ）

function hostOf(url){
  try { return new URL(url).hostname.replace(/^www\./,""); } catch { return ""; }
}

function pickImage(item){
  const mc = item.mediaContent?.[0]?.$?.url;
  if (mc) return mc;
  const mt = item.mediaThumbnail?.[0]?.$?.url;
  if (mt) return mt;
  const enc = item.enclosure?.url;
  if (enc) return enc;

  const html = item.content || item.summary || item.description || item.contentSnippet || "";
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  return m?.[1] || "";
}

function stripHtml(html){
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi,"")
    .replace(/<style[\s\S]*?<\/style>/gi,"")
    .replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function isoDate(item){
  return item.isoDate || item.pubDate || item.published || new Date().toISOString();
}

function toSlug(s){
  // 安定 slug（英数+短く）
  const base = String(s || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60) || "post";
  return base;
}

function hashId(str){
  // 超軽量hash（衝突しにくい程度）
  let h = 2166136261;
  for (let i=0;i<str.length;i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h>>>0).toString(16);
}

function pickCategory(post){
  const t = ((post.title||"") + " " + (post.description||"") + " " + (post.source||"") + " " + (post.url||"")).toLowerCase();
  const scandal = ["不倫","浮気","炎上","逮捕","解雇","降板","謝罪","暴露","流出","スキャンダル","賭博","薬","暴力","パワハラ","セクハラ"];
  const politics = ["政治","総理","首相","官房","大臣","与党","野党","国会","選挙","投票","支持率","税","増税","減税","外交","内閣","法案","知事","市長"];
  if (scandal.some(w => t.includes(w))) return "sc";
  if (politics.some(w => t.includes(w))) return "pol";
  return "ent";
}

function label(cat){
  if (cat==="sc") return "スキャンダル";
  if (cat==="pol") return "政治";
  return "芸能";
}

function fmtJP(iso){
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  const hh = String(d.getHours()).padStart(2,"0");
  const mm = String(d.getMinutes()).padStart(2,"0");
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

function timeAgo(iso){
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const min = Math.floor(diff/60000);
  if(min < 1) return "たった今";
  if(min < 60) return `${min}分前`;
  const h = Math.floor(min/60);
  if(h < 24) return `${h}時間前`;
  const d = Math.floor(h/24);
  return `${d}日前`;
}

function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function placeholderSvg(word){
  const safe = escapeHtml(String(word||"NO IMAGE").slice(0,18));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#0b1220"/>
        <stop offset="1" stop-color="#111827"/>
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="470" cy="70" r="90" fill="rgba(255,106,0,.25)"/>
    <circle cx="420" cy="110" r="60" fill="rgba(255,204,0,.18)"/>
    <text x="40" y="210" font-size="48" fill="rgba(255,255,255,.92)" font-family="system-ui" font-weight="900">${safe}</text>
    <text x="40" y="250" font-size="20" fill="rgba(255,255,255,.65)" font-family="system-ui">まとめ速報</text>
  </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function renderPostHtml(post){
  // まとめ風：要約 + 引用（短め） + 元記事リンク
  const title = escapeHtml(post.title);
  const catLabel = escapeHtml(label(post.category));
  const date = escapeHtml(fmtJP(post.date));
  const ago = escapeHtml(timeAgo(post.date));
  const source = escapeHtml(post.source || hostOf(post.url) || "");
  const url = escapeHtml(post.url);
  const img = post.image ? escapeHtml(post.image) : placeholderSvg(catLabel);

  const summary = escapeHtml(post.summary || "");
  const quote = escapeHtml(post.quote || "");

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
  <meta name="description" content="${summary || title}" />
  <meta name="theme-color" content="#ff6a00" />

  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${summary || ""}" />
  <meta property="og:type" content="article" />
  <meta property="og:image" content="${img}" />

  <style>
    :root{--bg:#f3f3f3;--card:#fff;--ink:#111;--muted:#666;--line:#e6e6e6;--brand:#ff6a00;--link:#0b57d0;--shadow:0 10px 25px rgba(0,0,0,.06);--radius:12px;--max:860px;}
    *{box-sizing:border-box}
    body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;background:var(--bg);color:var(--ink)}
    a{color:var(--link);text-decoration:none} a:hover{text-decoration:underline}
    header{background:linear-gradient(180deg,#ff7a1a,#ff6a00);position:sticky;top:0;z-index:10;border-bottom:1px solid rgba(0,0,0,.08)}
    .hwrap{max-width:var(--max);margin:0 auto;padding:12px 14px;display:flex;align-items:center;gap:12px}
    .logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#ffcc00,#fff);display:grid;place-items:center;font-weight:1000;color:#111}
    .hwrap b{color:#fff;font-size:18px}
    .wrap{max-width:var(--max);margin:0 auto;padding:14px}
    .box{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
    .head{padding:14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,#fff,#fafafa)}
    .tag{display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#fff7ef;border:1px solid #ffd7bb;color:#7a2f00;font-weight:1000;font-size:12px}
    h1{margin:10px 0 0;font-size:22px;line-height:1.25}
    .meta{margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px}
    .hero{display:block;width:100%;max-height:420px;object-fit:cover}
    .body{padding:14px;font-size:15px;line-height:1.8}
    .kome{margin:14px 0 0;padding:14px;border:1px solid var(--line);border-radius:12px;background:#fbfbfb}
    .kome b{display:block;margin-bottom:6px}
    blockquote{margin:12px 0;padding:12px 14px;border-left:5px solid var(--brand);background:#fff7ef;border-radius:10px}
    .btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
    .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:#fff;font-weight:900}
    .btn.primary{background:#111;color:#fff;border-color:#111}
    .foot{padding:12px 14px;border-top:1px solid var(--line);background:#fafafa;color:var(--muted);font-size:12px;line-height:1.6}
  </style>
</head>
<body>
<header>
  <div class="hwrap">
    <div class="logo">速</div>
    <b>まとめ速報</b>
  </div>
</header>

<div class="wrap">
  <article class="box">
    <div class="head">
      <span class="tag">${catLabel}</span>
      <h1>${title}</h1>
      <div class="meta">
        <span>${source}</span>
        <span>${date}</span>
        <span>${ago}</span>
      </div>
    </div>

    <img class="hero" src="${img}" alt="" onerror="this.style.display='none'">

    <div class="body">
      ${summary ? `<div class="kome"><b>【要約】</b>${summary}</div>` : ""}
      ${quote ? `<blockquote>【引用】${quote}</blockquote>` : ""}

      <div class="kome">
        <b>【元記事】</b>
        <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>
      </div>

      <div class="btns">
        <a class="btn" href="../index.html">← トップに戻る</a>
        <a class="btn primary" href="${url}" target="_blank" rel="noopener noreferrer">元記事を開く</a>
      </div>
    </div>

    <div class="foot">
      ※ 本ページはRSS見出し等から自動生成した「要約・引用・リンク集」です。全文転載は行いません。
    </div>
  </article>
</div>
</body>
</html>`;
}

function buildSummaryAndQuote(item){
  // RSS本文は短いことが多いので「短い要約」扱い
  const raw = stripHtml(item.contentSnippet || item.content || item.summary || item.description || "");
  const text = raw.slice(0, 220);
  const summary = text ? `${text}${raw.length > 220 ? "…" : ""}` : "";

  // 引用はさらに短く
  const quote = raw.slice(0, 90) + (raw.length > 90 ? "…" : "");
  return { summary, quote };
}

async function main(){
  await fs.mkdir(P_DIR, { recursive: true });

  const feeds = JSON.parse(await fs.readFile(FEEDS_PATH, "utf-8"));
  if(!Array.isArray(feeds)) throw new Error("feeds.json は配列である必要があります");

  const all = [];

  for (const feed of feeds){
    if(!feed?.url) continue;
    let parsed;
    try {
      parsed = await parser.parseURL(feed.url);
    } catch (e) {
      console.error("RSS取得失敗:", feed.url, e?.message || e);
      continue;
    }

    const items = (parsed.items || []).slice(0, MAX_ITEMS_PER_FEED);
    for(const item of items){
      const url = item.link || "";
      if(!url) continue;

      const title = item.title || "";
      const date = isoDate(item);
      const source = hostOf(url) || feed.name || "source";
      const image = pickImage(item);

      const { summary, quote } = buildSummaryAndQuote(item);

      const base = `${toSlug(title)}-${hashId(url)}`;
      const slug = base.length > 80 ? base.slice(0,80) : base;
      const page = `p/${slug}.html`;

      const post = {
        id: hashId(url),
        title,
        url,
        source,
        date,
        image,
        description: summary,     // 一覧で使う
        summary,
        quote,
        category: pickCategory({ title, description: summary, source, url }),
        page
      };

      all.push(post);
    }
  }

  // 重複排除（url hash id）
  const map = new Map();
  for(const p of all){
    map.set(p.id, p);
  }
  let posts = Array.from(map.values());

  posts.sort((a,b)=> new Date(b.date) - new Date(a.date));
  posts = posts.slice(0, MAX_TOTAL_POSTS);

  // 個別ページ生成
  for(const p of posts){
    const html = renderPostHtml(p);
    await fs.writeFile(path.join(P_DIR, path.basename(p.page)), html, "utf-8");
  }

  // posts.json 出力（トップ一覧が読む）
  const out = {
    updatedAt: new Date().toISOString(),
    posts: posts.map(p => ({
      id: p.id,
      title: p.title,
      url: p.url,
      source: p.source,
      date: p.date,
      image: p.image,
      description: p.description,
      category: p.category,
      page: p.page
    }))
  };

  await fs.writeFile(POSTS_PATH, JSON.stringify(out, null, 2), "utf-8");
  console.log("OK: posts:", posts.length, "pages:", posts.length);
}

main().catch(e=>{
  console.error(e);
  process.exit(1);
});