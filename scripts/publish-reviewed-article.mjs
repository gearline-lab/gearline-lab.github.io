// Article-only publishing: no Threads or routine social actions.
import { readFile, writeFile, access, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { validateItem } from "./amazon-request-policy.mjs";
const execute = process.argv.includes("--execute");
const today = new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Tokyo"}).format(new Date());
const planText = await readFile("config/article-publish-plan.json", "utf8").catch(error => { if(error.code === "ENOENT") return null; throw error; });
if (!planText) {
  for (const file of (await readdir(".")).filter(x=>/^[a-z0-9-]+\.html$/.test(x))) {
    const local=await readFile(file,"utf8");
    if(!local.includes(`"datePublished":"${today}"`)) continue;
    const url=`https://gearline-lab.github.io/${file}`;
    const r=await fetch(url,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
    const live=await r.text();
    if(r.ok && live.includes(`"datePublished":"${today}"`) && live.includes(`href="${url}"`)) {
      console.log(JSON.stringify({article:"already-published-today",published:url,publicVerified:true}));
      process.exit(0);
    }
  }
  throw Error("Research-backed reviewed article plan required; no article has been published today");
}
const plan = JSON.parse(planText);
const file = plan.articleFile;
if (plan.publicationType !== "new" || !/^[a-z0-9-]+\.html$/.test(file)) throw Error("New article slug required");
const url = `https://gearline-lab.github.io/${file}`;
const html = await readFile(file, "utf8");
const data = JSON.parse(await readFile("config/amazon-candidate-results.json", "utf8"));
const verified = data.results.find(x => x.status === "resolved" && x.item?.asin === plan.product.asin);
if (!verified || Date.now() - Date.parse(verified.checkedAt) > 86400000 || !Number.isFinite(Date.parse(verified.checkedAt))) throw Error("Fresh API item required");
validateItem(verified.item);
if (plan.product.trackingId !== "gearlineweb-22") throw Error("Wrong property tag");
const digest = createHash("sha256").update(html).digest("hex");
if (plan.reviewedSha256 !== digest) throw Error("Editorial review hash missing or stale; read the article and review exact content before publication");
if (!html.includes(`"datePublished":"${today}"`) || !html.includes(`href="${url}"`)) throw Error("Article date/canonical mismatch");
const asins = [...html.matchAll(/AMAZON_CARD:([A-Z0-9]+):START/g)].map(x=>x[1]);
if(asins.length !== 2 || asins.some(x=>x!==plan.product.asin)) throw Error("Card/product mismatch");
const amazonLinks = [...html.matchAll(/href="(https:\/\/www\.amazon\.co\.jp[^" ]+)"/g)].map(x=>x[1].replaceAll("&amp;","&"));
if(amazonLinks.length !== 2 || amazonLinks.some(x=>x!==verified.item.detailPageURL)) throw Error("Card URL differs from API");
if(!html.includes(verified.item.imageURL) || !html.includes(plan.product.primarySource)) throw Error("Source or authorized image missing");
execFileSync("node", ["scripts/gearline-article-qa.mjs",file], {stdio:"inherit"});
const thumb = `assets/thumbnails/${file.replace(/\.html$/, ".png")}`;
await access(thumb);
const git = (...args) => execFileSync("git",args,{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
if (git("remote","get-url","origin") !== "https://github.com/gearline-lab/gearline-lab.github.io.git") throw Error("Unexpected publication remote");
if(!execute) { console.log(JSON.stringify({valid:true,url,reviewedSha256:digest})); process.exit(0); }
// Require the dedicated Gearline askpass; inherited unrelated tokens are not used.
delete process.env.GITHUB_TOKEN;
process.env.GIT_TERMINAL_PROMPT = "0";
process.env.GIT_ASKPASS = `${process.cwd()}/scripts/github-askpass.sh`;
git("fetch","origin","main");
let published = false;
try { git("cat-file","-e",`origin/main:${file}`); published = true; } catch {}
if(published && git("show",`origin/main:${file}`) !== html.trim()) throw Error("Existing public URL differs; refusing overwrite");
if(!published) {
  const index = await readFile("index.html","utf8");
  if(!index.includes(`href="${file}"`)) throw Error("Listing missing");
  let sitemap = await readFile("sitemap.xml","utf8");
  if(!sitemap.includes(`<loc>${url}</loc>`)) {
    sitemap = sitemap.replace("</urlset>", `  <url><loc>${url}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.9</priority></url>\n</urlset>`);
    await writeFile("sitemap.xml",sitemap);
  }
  const files = [file,thumb,"index.html","sitemap.xml","config/amazon-products.json"];
  const staged = git("diff","--cached","--name-only");
  if(staged) throw Error("Unrelated staged changes; refusing commit");
  git("add","--",...files);
  git("commit","-m",`Publish ${file}`);
  git("push","origin","HEAD:main"); // Never force.
}
async function get(path) {
  const r=await fetch(`https://gearline-lab.github.io/${path}`,{redirect:"error",cache:"no-store",signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw Error(`Public ${path}: ${r.status}`);
  return r;
}
let publicVerified = false;
for(let attempt=0;attempt<12;attempt++) {
  try {
    const live=await (await get(file)).text();
    if(!live.includes(`"datePublished":"${today}"`) || !live.includes(`href="${url}"`) || !live.includes(`AMAZON_CARD:${plan.product.asin}:START`)) throw Error("Public article not current");
    if(!(await (await get("index.html")).text()).includes(`href="${file}"`)) throw Error("Public listing missing");
    if(!(await (await get("sitemap.xml")).text()).includes(`<loc>${url}</loc>`)) throw Error("Public sitemap missing");
    await get(thumb);
    publicVerified=true; break;
  } catch(error) { if(attempt===11)throw error; await new Promise(r=>setTimeout(r,10000)); }
}
console.log(JSON.stringify({published:url,publicVerified}));
