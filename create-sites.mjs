import fs from "fs/promises";
import path from "path";

/**
 * 設定：RSS（Google News RSSなど）を追加していけば増える
 * 例: ボートレース系クエリ
 */
const FEEDS = [
  // 例：ボートレース
  "https://news.google.com/rss/search?q=%E3%83%9C%E3%83%BC%E3%83%88%E3%83%AC%E3%83%BC%E3%82%B9&hl=ja&gl=JP&ceid=JP:ja",
];

/**
 * 取得件数
 */
const LIMIT = 80;

/**
 * ユーティリティ：タグ削除
 */
function stripHtml(s = "") {
  return s.replace(/<[^>]*>/g, "").trim();
}

/**
 * XMLから最初に一致した値を抜く（簡易）
 */
function pick(xml, regex) {
  const m = xml.match(regex);
  return m ? m[1] : "";
}

/**
 * itemブロック抽出（簡易）
 */
function splitItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) items.push(m[1]);
  return items;
}

/**
 * Google News RSSのitemから:
 * - title
 * - pubDate
 * - link (GoogleのリダイレクトURL)
 * - source (media名)
 * - image (media:content / enclosure / content内img から拾う)
 */
function parseItem(itemXml) {
  const rawTitle = pick(itemXml, /<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || pick(itemXml, /<title>([\s\S]*?)<\/title>/);
  const title = stripHtml(rawTitle);

  const pubDate = pick(itemXml, /<pubDate>([\s\S]*?)<\/pubDate>/);
  const date = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

  const link = pick(itemXml, /<link>([\s\S]*?)<\/link>/);

  // source（媒体名）
  const sourceName =
    pick(itemXml, /<source[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/source>/) ||
    pick(itemXml, /<source[^>]*>([\s\S]*?)<\/source>/) ||
    "";

  // 画像候補1: media:content
  let image =
    pick(itemXml, /<media:content[^>]*url="([^"]+)"/) ||
    pick(itemXml, /<media:thumbnail[^>]*url="([^"]+)"/);

  // 画像候補2: enclosure
  if (!image) image = pick(itemXml, /<enclosure[^>]*url="([^"]+)"/);

  // 画像候補3: description内img
  if (!image) {
    const desc =
      pick(itemXml, /<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
      pick(itemXml, /<description>([\s\S]*?)<\/description>/) ||
      "";
    image = pick(desc, /<img[^>]*src="([^"]+)"/);
  }

  return { title, date, sourceUrl: link, sourceName, image };
}

/**
 * posts/ にHTML作る（記事ページは「元記事へ」誘導）
 */
function buildPostHtml({ title, date, sourceUrl }) {
  const safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${safeTitle}</title>
  <style>
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Kaku Gothic ProN","Noto Sans JP",Meiryo,sans-serif;background:#fff;color:#111;margin:0}
    .wrap{max-width:860px;margin:0 auto;padding:16px}
    a{color:#0b57d0;text-decoration:none}
    a:hover{text-decoration:underline}
    .back{display:inline-block;margin:8px 0 16px}
    h1{font-size:22px;line-height:1.35;margin:10px 0 8px}
    .meta{color:#666;font-size:12px;margin-bottom:14px}
    .box{border:1px solid #e6e6e6;border-radius:14px;padding:14px;background:#f8f9fb}
  </style>
</head>
<body>
  <div class="wrap">
    <a class="back" href="/">← 一覧へ戻る</a>
    <h1>${safeTitle}</h1>
    <div class="meta">${new Date(date).toLocaleString("ja-JP")}</div>
    <div class="box">
      このページはRSSから自動生成した「読み取り用ページ」です。<br><br>
      <a href="${sourceUrl}" target="_blank" rel="noopener noreferrer">元記事を開く</a>
    </div>
  </div>
</body>
</html>`;
}

async function main() {
  // fetchはNode18+想定（Termuxのnode最新版ならOK）
  const fetched = [];

  for (const url of FEEDS) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RSS取得失敗: ${res.status} ${url}`);
    const xml = await res.text();

    const items = splitItems(xml);
    for (const item of items) {
      const parsed = parseItem(item);
      if (parsed.title && parsed.sourceUrl) fetched.push(parsed);
    }
  }

  // date降順＆重複排除（title+sourceUrlで）
  fetched.sort((a,b) => new Date(b.date) - new Date(a.date));
  const uniq = [];
  const seen = new Set();
  for (const p of fetched) {
    const key = (p.title + "||" + p.sourceUrl).slice(0, 400);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
    if (uniq.length >= LIMIT) break;
  }

  // postsディレクトリ作成
  const postsDir = path.join(process.cwd(), "posts");
  await fs.mkdir(postsDir, { recursive: true });

  // posts.json と 個別HTML出力
  const posts = [];
  for (const p of uniq) {
    const id = String(Date.now()) + String(Math.floor(Math.random()*10000)).padStart(4,"0");
    const htmlName = `${id}.html`;
    const link = `/posts/${htmlName}`;

    const html = buildPostHtml({ title: p.title, date: p.date, sourceUrl: p.sourceUrl });
    await fs.writeFile(path.join(postsDir, htmlName), html, "utf-8");

    posts.push({
      id,
      title: p.title,
      date: p.date,
      link,
      sourceUrl: p.sourceUrl,
      sourceName: p.sourceName || "news.google.com",
      image: p.image || ""
    });
  }

  await fs.writeFile(path.join(process.cwd(), "posts.json"), JSON.stringify(posts, null, 2), "utf-8");

  console.log(`OK: posts.json ${posts.length}件 / posts/ ${posts.length}ファイル生成`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});