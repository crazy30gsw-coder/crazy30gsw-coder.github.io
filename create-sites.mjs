import fs from "fs";
import path from "path";
import Parser from "rss-parser";

const parser = new Parser();

// ===== 設定 =====
const FEEDS_PATH = "./feeds.json";
const POSTS_JSON = "./posts.json";
const POSTS_DIR = "./posts";
const MAX_ITEMS = 80;

// ===== 準備 =====
if (!fs.existsSync(FEEDS_PATH)) {
  console.error("❌ feeds.json が見つかりません");
  process.exit(1);
}

if (!fs.existsSync(POSTS_DIR)) {
  fs.mkdirSync(POSTS_DIR, { recursive: true });
}

const feeds = JSON.parse(fs.readFileSync(FEEDS_PATH, "utf-8"));

let allPosts = [];

// ===== RSS取得 =====
for (const feed of feeds) {
  try {
    console.log("▶ RSS取得:", feed.url);
    const res = await parser.parseURL(feed.url);

    for (const item of res.items) {
      const id =
        item.guid ||
        item.id ||
        Buffer.from(item.link).toString("base64").slice(0, 32);

      allPosts.push({
        id,
        title: item.title ?? "",
        link: item.link ?? "",
        date: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
        source: feed.name ?? res.title ?? "",
        image:
          item.enclosure?.url ||
          item["media:content"]?.url ||
          item["media:thumbnail"]?.url ||
          null,
        summary:
          item.contentSnippet ??
          item.summary ??
          item.content?.slice(0, 120) ??
          "",
      });
    }
  } catch (err) {
    console.error("❌ RSS失敗:", feed.url, err.message);
  }
}

// ===== 整理 =====
allPosts = allPosts
  .filter(p => p.title && p.link)
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, MAX_ITEMS);

// ===== posts.json 出力 =====
fs.writeFileSync(POSTS_JSON, JSON.stringify(allPosts, null, 2));
console.log("✅ posts.json 生成:", allPosts.length, "件");

// ===== 個別記事HTML生成 =====
for (const post of allPosts) {
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${post.title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <h1>${post.title}</h1>
  <p>${post.date}</p>
  ${
    post.image
      ? `<img src="${post.image}" style="max-width:100%;height:auto;">`
      : ""
  }
  <p>${post.summary}</p>
  <p><a href="${post.link}" target="_blank">元記事を開く</a></p>
  <p><a href="/">一覧へ戻る</a></p>
</body>
</html>`;

  fs.writeFileSync(path.join(POSTS_DIR, `${post.id}.html`), html);
}

console.log("✅ posts/ HTML生成 完了");