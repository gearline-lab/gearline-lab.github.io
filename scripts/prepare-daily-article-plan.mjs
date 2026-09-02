import { access, copyFile, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Build a new-URL article from a Creator-API-resolved candidate.  The copy is
// a purchase guide based on the candidate's declared search intent; it never
// claims hands-on testing and leaves live price/stock to Amazon.
const root = process.cwd();
const planPath = resolve(root, "config/article-publish-plan.json");
const productsPath = resolve(root, "config/amazon-products.json");
const resultsPath = resolve(root, "config/amazon-candidate-results.json");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
const existing = new Set((await readdir(root)).filter((name) => name.endsWith(".html")));
if (await access(planPath).then(() => true).catch(() => false)) process.exit(0);
const data = JSON.parse(await readFile(resultsPath, "utf8"));
const verifiedAt = Date.parse(data.checkedAt ?? "");
if (!Number.isFinite(verifiedAt) || Date.now() - verifiedAt > 7 * 24 * 60 * 60 * 1000) {
  throw new Error("Creators API候補が7日以内に確認されていません。先に候補解決を再実行してください。");
}
const sourceById = {
  "apple-studio-display": "https://www.apple.com/jp/studio-display/",
  "bambu-lab-a1": "https://jp.store.bambulab.com/products/a1",
  "logicool-mx-keys-s": "https://www.logicool.co.jp/ja-jp/products/keyboards/mx-keys-s.html",
  "bambu-lab-p2s": "https://jp.store.bambulab.com/products/p2s",
  "anker-675-usb-c-docking-station": "https://www.ankerjapan.com/products/a8377",
  "anker-nano-docking-station-13in1": "https://www.ankerjapan.com/products/a83c3111"
};
const slugById = {
  "apple-studio-display": "apple-studio-display-desk-guide.html",
  "bambu-lab-a1": "bambu-lab-a1-desk-guide.html",
  "logicool-mx-keys-s": "logicool-mx-keys-s-mac-guide.html",
  "bambu-lab-p2s": "bambu-lab-p2s-materials-guide.html",
  "anker-675-usb-c-docking-station": "anker-675-desk-layout-guide.html",
  "anker-nano-docking-station-13in1": "anker-nano-docking-station-setup-guide.html"
};
const candidates = (data.results ?? [])
  .filter((item) => item.status === "resolved" && item.publicationEligible !== false && item.item && sourceById[item.id] && slugById[item.id] && !existing.has(slugById[item.id]))
  .sort((a, b) => Number(b.searchOpportunityScore ?? 0) - Number(a.searchOpportunityScore ?? 0));
const selected = candidates[0];
if (!selected) throw new Error("新規URLにできるCreators API確認済み候補がありません。");
const product = selected.item;
const slug = slugById[selected.id];
const title = selected.id === "apple-studio-display"
  ? "Apple Studio Displayを机に置く前に。Mac向けモニターの条件整理"
  : selected.id === "bambu-lab-a1"
    ? "Bambu Lab A1を選ぶ前に。造形サイズと設置条件を確認する"
    : selected.id === "bambu-lab-p2s"
  ? "Bambu Lab P2Sの材料選びを購入前に整理。密閉型3Dプリンターを使い切る条件"
  : selected.id === "logicool-mx-keys-s"
    ? "MX Keys SをMacで使う前に。配列と接続を決める購入ガイド"
  : selected.id === "anker-675-usb-c-docking-station"
    ? "Anker 675を机に置く前に。モニタースタンド一体型ドックの配置条件"
    : "Anker Nanoを常設する前に。着脱式USB-Cハブの接続を決める条件";
const description = selected.id === "apple-studio-display"
  ? "Apple Studio Displayの表示、接続、カメラ、音声、設置条件を公式情報から整理し、Macユーザーの購入判断を支援するガイドです。"
  : selected.id === "bambu-lab-a1"
    ? "Bambu Lab A1の造形サイズ、材料、設置、メンテナンス条件を公式情報から整理し、A1 miniとの差を判断する購入ガイドです。"
    : selected.id === "bambu-lab-p2s"
  ? "Bambu Lab P2Sの造形サイズ、ノズル、材料、設置条件を公式情報から整理し、必要な人と見送る人を分ける購入ガイドです。"
  : selected.id === "logicool-mx-keys-s"
    ? "Logicool MX Keys Sの配列、接続方式、複数端末切替、設置幅を公式情報から整理し、Macで使う条件を判断する購入ガイドです。"
  : "ドッキングステーションを机へ置く前に、設置寸法、接続条件、常設と持ち出しの分け方を公式情報から整理する購入ガイドです。";
const image = product.imageURL;
const amazonUrl = product.detailPageURL;
const thumbnailName = slug.replace(/\.html$/u, ".png");
const thumbnailSource = selected.id === "apple-studio-display"
  ? "assets/thumbnails/desk-setup-before-buying.png"
  : selected.id === "bambu-lab-a1"
    ? "assets/thumbnails/bambu-lab-a1-mini.png"
    : selected.id === "bambu-lab-p2s"
  ? "assets/thumbnails/bambu-lab-p2s.png"
  : selected.id === "logicool-mx-keys-s"
    ? "assets/thumbnails/logicool-k250-bluetooth-keyboard.png"
  : selected.id === "anker-675-usb-c-docking-station"
    ? "assets/thumbnails/anker-675-docking-station.png"
    : "assets/thumbnails/anker-nano-docking-station-13in1.png";
await copyFile(resolve(root, thumbnailSource), resolve(root, "assets/thumbnails", thumbnailName));
const productsConfig = JSON.parse(await readFile(productsPath, "utf8"));
if (!productsConfig.products.some((item) => item.asin === product.asin)) {
  productsConfig.products.push({ asin: product.asin, files: [slug], fallback: { title: product.title, url: amazonUrl } });
  await writeFile(productsPath, `${JSON.stringify(productsConfig, null, 2)}\n`);
}
const card = (placement) => `<!-- AMAZON_CARD:${product.asin}:START --><div class="product-card" data-affiliate-card data-asin="${product.asin}" data-article-slug="${slug.replace(/\.html$/u, "")}" data-placement="${placement}"><img src="${image}" alt="${product.title}（Amazon許諾画像）"><div><h3>${product.title}</h3><p>仕様と販売状況はAmazonの商品ページで確認できます。</p><a class="cta" data-affiliate-link href="${amazonUrl}">Amazon.co.jpで確認する</a></div></div><!-- AMAZON_CARD:${product.asin}:END -->`;
await writeFile(resolve(root, slug), article);
const plan = { publicationType: "new", articleFile: slug, product: { asin: product.asin, trackingId: "gearlineweb-22", primarySource: sourceById[selected.id], creatorApiVerified: true, authorizedImageVerified: true }, searchIntent: selected.searchIntent, searchDemand: selected.searchDemand, searchOpportunityScore: selected.searchOpportunityScore, introPost: { text: `購入前に確認したい条件を公式情報から整理しました。 https://gearline-lab.github.io/${slug} #購入ガイド #デスク環境` }, publishFiles: [`assets/thumbnails/${thumbnailName}`, "config/amazon-products.json"] };
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ articleFile: slug, asin: product.asin, source: sourceById[selected.id] }));
