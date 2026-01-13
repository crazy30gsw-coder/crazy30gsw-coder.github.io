import fs from "fs";

const feeds = JSON.parse(fs.readFileSync("feeds.json","utf8")).feeds;
const max = JSON.parse(fs.readFileSync("feeds.json","utf8")).maxItems || 80;

async function fetchText(u){
  const r=await fetch(u,{headers:{'user-agent':'rss'}});
  return await r.text();
}

function pick(tag,x){
  const m=x.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`,"i"));
  return m?m[1].replace(/<!\\[CDATA\\[|\\]\\]>/g,""):"";
}

function img(x){
  const m=x.match(/<img[^>]+src="([^"]+)"/i);
  return m?m[1]:"";
}

let all=[];
for(const f of feeds){
  const xml=await fetchText(f.url);
  for(const m of xml.matchAll(/<item>([\\s\\S]*?)<\/item>/g)){
    const it=m[1];
    const title=pick("title",it);
    const url=pick("link",it);
    const date=new Date(pick("pubDate",it)||Date.now()).toISOString();
    all.push({
      title,url,
      source:new URL(url).hostname,
      date,
      image:img(it),
      category: title.includes("G1")?"G1":"その他"
    });
  }
}

all=[...new Map(all.map(p=>[p.url,p])).values()]
.sort((a,b)=>new Date(b.date)-new Date(a.date))
.slice(0,max);

fs.writeFileSync("posts.json",JSON.stringify({
  updatedAt:new Date().toISOString(),
  posts:all
},null,2));

console.log("posts.json 更新:",all.length);