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
  "ugreen-revodok-6in1": "https://ugreen.jp/products/ugreen-revodok-usb-c-%E3%83%8F%E3%83%96-6-in-1-100w",
  "anker-332-usb-c-hub": "https://www.ankerjapan.com/products/A8355",
  "elgato-stream-deck-plus": "https://www.elgato.com/ww/en/p/stream-deck-plus",
  "apple-studio-display": "https://www.apple.com/jp/studio-display/",
  "bambu-lab-a1": "https://jp.store.bambulab.com/products/a1",
  "logicool-mx-keys-s": "https://www.logicool.co.jp/ja-jp/products/keyboards/mx-keys-s.html",
  "bambu-lab-p2s": "https://jp.store.bambulab.com/products/p2s",
  "anker-675-usb-c-docking-station": "https://www.ankerjapan.com/products/a8377",
  "anker-nano-docking-station-13in1": "https://www.ankerjapan.com/products/a83c3111"
};
const slugById = {
  "ugreen-revodok-6in1": "ugreen-revodok-6in1-buying-guide.html",
  "anker-332-usb-c-hub": "anker-332-usb-c-hub-buying-guide.html",
  "elgato-stream-deck-plus": "elgato-stream-deck-plus-workflow-guide.html",
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
const title = selected.id === "ugreen-revodok-6in1"
  ? "UGREEN Revodok 6-in-1を選ぶ前に。Macの接続条件を整理する"
  : selected.id === "anker-332-usb-c-hub"
    ? "Anker 332を選ぶ前に。Macのポート不足を条件で見極める"
    : selected.id === "elgato-stream-deck-plus"
      ? "Stream Deck +をMac作業に置く前に。キーとダイヤルの使い分け"
      : selected.id === "apple-studio-display"
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
const description = selected.id === "ugreen-revodok-6in1"
  ? "UGREEN Revodok 6-in-1の映像、データ、給電条件を公式情報から整理し、Macの接続に合うか判断する購入ガイドです。"
  : selected.id === "anker-332-usb-c-hub"
    ? "Anker 332 USB-Cハブの端子構成と対応条件を公式情報から整理し、Macのポート不足を解消できるか判断するガイドです。"
    : selected.id === "elgato-stream-deck-plus"
      ? "Elgato Stream Deck +のキー、ダイヤル、プロファイルを公式情報から整理し、Mac作業に必要か判断するガイドです。"
      : selected.id === "apple-studio-display"
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
const thumbnailSource = selected.id === "ugreen-revodok-6in1"
  ? "assets/thumbnails/ugreen-revodok-6in1.png"
  : selected.id === "anker-332-usb-c-hub"
    ? "assets/thumbnails/anker-332-usb-c-hub.png"
    : selected.id === "elgato-stream-deck-plus"
      ? "assets/thumbnails/stream-deck-plus.png"
      : selected.id === "apple-studio-display"
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
const sectionLabel = selected.id.includes("bambu") ? "3D PRINT / BUYING GUIDE" : selected.id.includes("logicool") ? "KEYBOARD / MAC SETUP" : selected.id.includes("elgato") ? "MAC WORKFLOW / CONTROL" : "MAC PERIPHERALS / DESK SETUP";
const specText = selected.id === "logicool-mx-keys-s"
  ? "MX Keys SはBluetooth Low EnergyとLogi Bolt USBレシーバーに対応し、複数端末の切り替えを公式仕様で案内しています。今回のAPI取得商品はMac向けUS配列モデルなので、購入前に配列と入力ソースを確認します。"
  : selected.id === "elgato-stream-deck-plus"
    ? "Stream Deck +はキーとダイヤルを組み合わせ、アプリごとのプロファイルで操作を切り替えられます。公式の技術仕様と対応ソフトを、自分の反復作業と照合します。"
    : selected.id.includes("ugreen") || selected.id.includes("anker")
      ? "USB-Cハブは端子数だけでなく、映像・データ・給電の役割を分けて確認します。Mac側の対応仕様と、常設する端子／持ち出す端子を先に書き出します。"
      : selected.id.includes("apple")
        ? "Studio Displayは表示、カメラ、音声、接続を一体化したモニターです。Macの対応条件と机の奥行きを、公式仕様を起点に照合します。"
        : "公式ページの仕様表を起点に、必要な機能と設置条件を照合します。";
const useText = selected.id === "logicool-mx-keys-s"
  ? "長文入力やショートカットが中心なら、テンキーの有無、手首の位置、バックライトの必要性を先に決めます。複数端末を切り替える場合は各端末の入力ソースも確認します。"
  : selected.id === "elgato-stream-deck-plus"
    ? "毎日繰り返す操作を3つだけ書き出し、キーに割り当てる操作とダイヤルで連続調整する操作を分けます。置き場所は手を伸ばす距離とケーブルの取り回しで決めます。"
    : selected.id.includes("bambu")
      ? "本体の設置だけでなく、扉の開閉、材料交換、排熱、清掃の動線を確保します。増設機器を使う場合は、増設後のケーブルと置き場所も先に測ります。"
      : "常設する接続と抜き差しする接続を分け、机の手前には交換頻度の高い端子だけを残します。設置場所を測ってからケーブル長を選ぶと余長が増えにくくなります。";
const article = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Gearline Lab</title><meta name="description" content="${description}"><link rel="canonical" href="https://gearline-lab.github.io/${slug}"><meta property="og:type" content="article"><meta property="og:site_name" content="Gearline Lab"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="https://gearline-lab.github.io/${slug}"><meta property="og:image" content="https://gearline-lab.github.io/assets/thumbnails/${thumbnailName}"><meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"Article",headline:title,description,mainEntityOfPage:`https://gearline-lab.github.io/${slug}`,image:`https://gearline-lab.github.io/assets/thumbnails/${thumbnailName}`,datePublished:today,dateModified:today,inLanguage:"ja-JP",author:{"@type":"Organization",name:"Gearline Lab"}})}</script><style>:root{--ink:#17202a;--muted:#64707c;--line:#dde3e8;--accent:#759b24;--wash:#f4f7f1}*{box-sizing:border-box}body{margin:0;color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Yu Gothic",sans-serif;line-height:1.9}main{max-width:820px;margin:auto;padding:32px 20px 80px}a{color:#2563a8;text-decoration:none}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.1em}.article-thumbnail{margin:24px 0 36px}.article-thumbnail img{display:block;width:100%;height:auto;border-radius:14px}.article-thumbnail figcaption,.meta{font-size:12px;color:var(--muted)}.toc{border:1px solid var(--line);padding:20px 24px;margin:28px 0}.toc h2{font-size:18px;margin:0 0 8px}.toc ol{margin:0;padding-left:22px}h1{font-size:clamp(28px,5vw,46px);line-height:1.35}h2{font-size:27px;margin-top:52px;border-left:4px solid var(--accent);padding-left:12px}.note{background:var(--wash);padding:18px 20px;border-radius:10px}.product-card{border:1px solid var(--line);border-radius:14px;display:grid;grid-template-columns:180px 1fr;gap:22px;padding:20px;margin:28px 0}.product-card img{width:100%;height:150px;object-fit:contain}.product-card h3{margin:0 0 8px}.product-card .cta{display:inline-block;background:#0b1822;color:#fff;padding:10px 18px;border-radius:8px;font-weight:700}@media(max-width:600px){main{padding:22px 16px 60px}.product-card{grid-template-columns:1fr}.product-card img{height:170px}}</style><script async src="https://www.googletagmanager.com/gtag/js?id=G-711HXNH46X"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag("js",new Date);gtag("config","G-711HXNH46X");</script><script defer src="assets/js/affiliate-analytics.js"></script></head><body><main><p class="eyebrow">${sectionLabel}</p><h1>${title}</h1><p class="meta">公開日：${today}　更新日：${today}</p><p class="note">広告：本ページにはAmazonアソシエイトリンクが含まれます。商品情報は公式情報とAmazon掲載情報を確認して作成しています。実機での検証結果ではありません。</p><figure class="article-thumbnail"><img src="assets/thumbnails/${thumbnailName}" alt="${title}を整理する編集用イメージ"><figcaption>イメージ：記事内容を整理した編集用ビジュアルです。製品の公式写真・実測結果ではありません。</figcaption></figure><p>${description}スペックの多さではなく、先に用途と設置条件を決めてから判断します。</p><nav class="toc" aria-label="目次"><h2>目次</h2><ol><li><a href="#spec">公式仕様から先に確認すること</a></li><li><a href="#use">使い方と設置を分けて考える</a></li><li><a href="#fit">向く条件・見送る条件</a></li><li><a href="#source">根拠と商品情報</a></li></ol></nav>${card("intro")}<section id="spec"><h2>公式仕様から先に確認すること</h2><p>${specText}</p><ul><li>使う機器と必要な規格を先に書き出す</li><li>設置場所と交換・清掃・持ち出しの動線を測る</li><li>公式の対応条件を自分の機器の仕様と照合する</li></ul></section><section id="use"><h2>使い方と設置を分けて考える</h2><p>${useText}</p><p>毎日使う機能と、たまに使う機能を分けると、購入後の運用が具体的になります。使わない機能のために設置や管理を増やさないことも、購入判断の一部です。</p></section><section id="fit"><h2>向く条件・見送る条件</h2><h3>向く条件</h3><ul><li>公式仕様のうち、必要な機能が具体的な作業に直結している</li><li>設置・交換・保守の動線を確保できる</li><li>現在の機器と接続条件を照合できている</li></ul><h3>見送る条件</h3><ul><li>数字や機能の多さだけで選び、用途がまだ決まっていない</li><li>設置場所や周辺スペースを測っていない</li><li>対応条件を確認せず、購入後に解決しようとしている</li></ul><p>迷う場合は用途を一つに絞り、必要な仕様が一つでも欠けるかを確認してから判断してください。関連する<a href="index.html">Gearline Labの記事一覧</a>も比較材料になります。</p></section><section id="source"><h2>根拠と商品情報</h2><p class="meta"><a href="${sourceById[selected.id]}">${sourceById[selected.id]}</a>を参照（${today}確認）。製品情報は一次情報とCreators APIで確認した商品データに基づきます。</p>${card("end")}<p class="meta">価格・在庫はAmazonの商品ページで最新情報を確認してください。</p><p class="meta">記事紹介投稿案：${title}。公式情報をもとに、購入前の条件を整理しました。 https://gearline-lab.github.io/${slug}</p></section></main></body></html>`;
await writeFile(resolve(root, slug), article);
const plan = { publicationType: "new", articleFile: slug, product: { asin: product.asin, trackingId: "gearlineweb-22", primarySource: sourceById[selected.id], creatorApiVerified: true, authorizedImageVerified: true }, searchIntent: selected.searchIntent, searchDemand: selected.searchDemand, searchOpportunityScore: selected.searchOpportunityScore, introPost: { text: `購入前に確認したい条件を公式情報から整理しました。 https://gearline-lab.github.io/${slug} #購入ガイド #デスク環境` }, publishFiles: [`assets/thumbnails/${thumbnailName}`, "config/amazon-products.json"] };
await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
console.log(JSON.stringify({ articleFile: slug, asin: product.asin, source: sourceById[selected.id] }));
