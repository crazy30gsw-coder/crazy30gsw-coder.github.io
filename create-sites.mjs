import fs from "fs";
import path from "path";
import Parser from "rss-parser";

const parser = new Parser();

// ===== 設定 =====
const FEEDS_FILE = "feeds.json";
const POSTS_JSON = "posts.json";
const POSTS_DIR = "posts";
const MAX_ITEMS_PER_FEED = 20;

// ===== feeds.json 読み込み =====
if (!fs.existsSync(FEEDS_FILE)) {
  console.error("❌ feeds.json が見つかりません");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(FEEDS_FILE, "utf-8"));

// ★ ここが超重要
const feeds = Array.isArray(raw) ? raw : raw.feeds;

if (!Array.isArray(feeds)) {
  console.error("❌ feeds.json の形式が不正です（配列ではありません）");
  process.exit(1);
}

// ===== 出力フォルダ準備 =====
if (!fs.existsSync(POSTS_DIR)) {
  fs.mkdirSync(POSTS_DIR);
}

const allPosts = [];

// ===== RSS 処理 =====
for (const feed of feeds) {
  try {
    console.log(`📡 Fetch: ${feed.url}`);
    const rss = await parser.parseURL(feed.url);

    const items = rss.items.slice(0, MAX_ITEMS_PER_FEED);

    for (const item of items) {
      const id =
        item.guid ||
        item.id ||
        Buffer.from(item.link).toString("base64");

      const post = {
        id,
        title: item.title || "",
        link: item.link || "",
        date: item.isoDate || item.pubDate || "",
        source: rss.title || "",
        category: feed.category || "その他",
        image:
          item.enclosure?.url ||
          item["media:content"]?.url ||
          null,
        description: item.contentSnippet || ""
      };

      allPosts.push(post);

      // 個別記事HTML
      const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${post.title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<h1>${post.title}</h1>
<p>${post.date}</p>
<p><a href="${post.link}" target="_blank">元記事を読む</a></p>
</body>
</html>`;

      fs.writeFileSync(
        path.join(POSTS_DIR, `${id}.html`),
        html
      );
    }
  } catch (e) {
    console.error("⚠ RSSエラー:", feed.url, e.message);
  }
}

// ===== posts.json 出力 =====
fs.writeFileSync(
  POSTS_JSON,
  JSON.stringify(allPosts, null, 2)
);

console.log(`✅ posts.json 生成: ${allPosts.length} 件`);