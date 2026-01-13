import fs from "fs";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import Parser from "rss-parser";

const parser = new Parser();
const RSS_URL = "https://news.google.com/rss/search?q=ボートレース&hl=ja&gl=JP&ceid=JP:ja";

async function getOgImage(url) {
  try {
    const res = await fetch(url, { timeout: 10000 });
    const html = await res.text();
    const dom = new JSDOM(html);
    const meta = dom.window.document.querySelector(
      'meta[property="og:image"]'
    );
    return meta ? meta.content : null;
  } catch (e) {
    return null;
  }
}

(async () => {
  const feed = await parser.parseURL(RSS_URL);
  const posts = [];

  for (const item of feed.items.slice(0, 30)) {
    const image = await getOgImage(item.link);

    posts.push({
      id: Date.now() + Math.random(),
      title: item.title,
      link: item.link,
      date: item.isoDate,
      source: "news.google.com",
      image: image || "https://via.placeholder.com/400x225?text=NO+IMAGE"
    });
  }

  fs.writeFileSync("posts.json", JSON