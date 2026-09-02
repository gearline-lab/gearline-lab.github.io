import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const config = JSON.parse(await readFile(resolve(root, "config/amazon-products.json"), "utf8"));
const cleanEnvValue = (value) => String(value ?? "").trim().replace(/^"|"$/g, "");
const clientId = cleanEnvValue(process.env.AMAZON_CREATOR_CREDENTIAL_ID);
const clientSecret = cleanEnvValue(process.env.AMAZON_CREATOR_SECRET);
const credentialVersion = cleanEnvValue(process.env.AMAZON_CREATOR_VERSION);

if (!clientId || !clientSecret || !credentialVersion) {
  throw new Error("AMAZON_CREATOR_CREDENTIAL_ID、AMAZON_CREATOR_SECRET、AMAZON_CREATOR_VERSION が必要です。");
}

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const getToken = async () => {
  const versionConfig = {
    "2.1": { endpoint: "https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token", json: false, scope: "creatorsapi/default" },
    "2.2": { endpoint: "https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token", json: false, scope: "creatorsapi/default" },
    "2.3": { endpoint: "https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token", json: false, scope: "creatorsapi/default" },
    "3.1": { endpoint: "https://api.amazon.com/auth/o2/token", json: true, scope: "creatorsapi::default" },
    "3.2": { endpoint: "https://api.amazon.co.uk/auth/o2/token", json: true, scope: "creatorsapi::default" },
    "3.3": { endpoint: "https://api.amazon.co.jp/auth/o2/token", json: true, scope: "creatorsapi::default" }
  }[credentialVersion];
  if (!versionConfig) throw new Error(`未対応のCreator API認証情報Versionです: ${credentialVersion}`);
  const body = {
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
    scope: versionConfig.scope
  };
  const response = await fetch(versionConfig.endpoint, {
    method: "POST",
    headers: { "Content-Type": versionConfig.json ? "application/json" : "application/x-www-form-urlencoded" },
    body: versionConfig.json ? JSON.stringify(body) : new URLSearchParams(body).toString()
  });
  if (!response.ok) throw new Error(`Creator APIのトークン取得に失敗しました: ${response.status}`);
  const tokenBody = await response.json();
  if (!tokenBody.access_token) throw new Error("Creator APIのアクセストークンが返されませんでした。");
  return tokenBody.access_token;
};

const renderCard = ({ item, fallback, updatedAt }) => {
  const title = item.itemInfo?.title?.displayValue ?? fallback.title;
  const image = item.images?.primary?.large?.url ?? item.images?.primary?.medium?.url ?? item.images?.primary?.small?.url ?? null;
  const url = item.detailPageURL ?? fallback.url;
  const priceText = "価格・在庫はAmazonの商品ページで最新情報を確認してください。";
  const visual = image
    ? `<a class="product-card__visual" href="${escapeHtml(url)}" rel="nofollow sponsored"><img src="${escapeHtml(image)}" alt="${escapeHtml(title)}"></a>`
    : "";
  return `<aside class="product-card" aria-label="紹介商品"><div class="product-card__body"><p class="product-card__label">AMAZONで確認</p><p class="product-card__title">${escapeHtml(title)}</p><p class="product-card__note">${priceText}</p><a class="product-card__cta" href="${escapeHtml(url)}" rel="nofollow sponsored">Amazon.co.jpで確認する</a></div>${visual}</aside>`;
};

const token = await getToken();
const itemIds = config.products.map((product) => product.asin);
const items = [];
// Creators API accepts at most 10 ASINs per GetItems request.  Keep the
// catalog refresh reliable as the product registry grows by batching requests
// and combining the returned item records before rendering cards.
for (let offset = 0; offset < itemIds.length; offset += 10) {
  const batch = itemIds.slice(offset, offset + 10);
  const response = await fetch("https://creatorsapi.amazon/catalog/v1/getItems", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-marketplace": config.marketplace
    },
    body: JSON.stringify({
      itemIds: batch,
      itemIdType: "ASIN",
      marketplace: config.marketplace,
      partnerTag: config.partnerTag,
      resources: ["images.primary.large", "images.primary.medium", "itemInfo.title", "offersV2.listings.price", "offersV2.listings.isBuyBoxWinner"]
    })
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Creator APIのGetItemsに失敗しました: ${response.status} ${errorBody.slice(0, 500)}`);
  }
  const data = await response.json();
  items.push(...(data.itemsResult?.items ?? data.itemResults?.items ?? []));
}
const itemsByAsin = new Map(items.map((item) => [item.asin, item]));
const updatedAt = new Date();

for (const product of config.products) {
  const item = itemsByAsin.get(product.asin);
  if (!item) throw new Error(`ASIN ${product.asin} の商品データが返されませんでした。`);
  const card = renderCard({ item, fallback: product.fallback, updatedAt });
  const expression = new RegExp(`<!-- AMAZON_CARD:${product.asin}:START -->[\\s\\S]*?<!-- AMAZON_CARD:${product.asin}:END -->`, "g");
  for (const file of product.files) {
    const filePath = resolve(root, file);
    const html = await readFile(filePath, "utf8");
    if (!expression.test(html)) throw new Error(`${file} に ${product.asin} の商品カードマーカーがありません。`);
    expression.lastIndex = 0;
    const updatedHtml = html.replace(expression, `<!-- AMAZON_CARD:${product.asin}:START -->\n    ${card}\n    <!-- AMAZON_CARD:${product.asin}:END -->`);
    await writeFile(filePath, updatedHtml);
  }
}

console.log(`Amazon商品カードを更新しました: ${config.products.map((product) => product.asin).join(", ")}`);
