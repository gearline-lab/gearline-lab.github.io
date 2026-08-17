import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const inputPath = resolve(root, process.argv[2] ?? "config/amazon-candidates.json");
const outputPath = resolve(root, process.argv[3] ?? "config/amazon-candidate-results.json");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const clean = (value) => String(value ?? "").trim().replace(/^"|"$/g, "");
const clientId = clean(process.env.AMAZON_CREATOR_CREDENTIAL_ID);
const clientSecret = clean(process.env.AMAZON_CREATOR_SECRET);
const version = clean(process.env.AMAZON_CREATOR_VERSION);
if (!clientId || !clientSecret || !version) throw new Error("Creators API認証情報が必要です。");

const auth = {
  "2.1": ["https://creatorsapi.auth.us-east-1.amazoncognito.com/oauth2/token", false, "creatorsapi/default"],
  "2.2": ["https://creatorsapi.auth.eu-south-2.amazoncognito.com/oauth2/token", false, "creatorsapi/default"],
  "2.3": ["https://creatorsapi.auth.us-west-2.amazoncognito.com/oauth2/token", false, "creatorsapi/default"],
  "3.1": ["https://api.amazon.com/auth/o2/token", true, "creatorsapi::default"],
  "3.2": ["https://api.amazon.co.uk/auth/o2/token", true, "creatorsapi::default"],
  "3.3": ["https://api.amazon.co.jp/auth/o2/token", true, "creatorsapi::default"]
}[version];
if (!auth) throw new Error(`未対応のCreators API認証情報Versionです: ${version}`);
const [tokenEndpoint, jsonBody, scope] = auth;
const tokenResponse = await fetch(tokenEndpoint, {
  method: "POST",
  headers: { "Content-Type": jsonBody ? "application/json" : "application/x-www-form-urlencoded" },
  body: jsonBody
    ? JSON.stringify({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope })
    : new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }).toString()
});
if (!tokenResponse.ok) throw new Error(`Creators APIトークン取得に失敗しました: ${tokenResponse.status}`);
const { access_token: accessToken } = await tokenResponse.json();
if (!accessToken) throw new Error("Creators APIアクセストークンが返されませんでした。");

const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s\-_/（）()]+/gu, "");
const results = [];
for (const candidate of input.candidates ?? []) {
  if (!candidate?.id || !candidate?.keywords || !Array.isArray(candidate.requiredTerms) || !candidate.requiredTerms.length) {
    throw new Error("候補には id、keywords、requiredTerms が必要です。");
  }
  if (!candidate.searchIntent || ["primaryQuery", "readerSituation", "decisionToMake", "comparisonAxis"].some((key) => !String(candidate.searchIntent[key] ?? "").trim())) {
    throw new Error("候補には具体的な検索意図（primaryQuery、readerSituation、decisionToMake、comparisonAxis）が必要です。");
  }
  const response = await fetch("https://creatorsapi.amazon/catalog/v1/searchItems", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "x-marketplace": input.marketplace ?? "www.amazon.co.jp" },
    body: JSON.stringify({
      keywords: candidate.keywords,
      itemCount: 10,
      partnerTag: input.partnerTag ?? "gearlineweb-22",
      resources: ["itemInfo.title", "images.primary.large", "images.primary.medium", "offersV2.listings.isBuyBoxWinner"]
    })
  });
  if (!response.ok) throw new Error(`SearchItemsに失敗しました: ${response.status}`);
  const data = await response.json();
  const items = data.searchResult?.items ?? [];
  const matches = items.filter((item) => {
    const title = normalize(item.itemInfo?.title?.displayValue);
    const includesRequired = candidate.requiredTerms.every((term) => title.includes(normalize(term)));
    const includesExcluded = (candidate.excludedTerms ?? []).some((term) => title.includes(normalize(term)));
    return includesRequired && !includesExcluded;
  });
  const purchasable = matches.filter((item) => item.detailPageURL && (item.images?.primary?.large?.url || item.images?.primary?.medium?.url));
  const candidates = purchasable.map((item) => ({
    asin: item.asin,
    title: item.itemInfo?.title?.displayValue,
    detailPageURL: item.detailPageURL,
    imageURL: item.images?.primary?.large?.url ?? item.images?.primary?.medium?.url
  }));
  results.push({
    id: candidate.id,
    query: candidate.keywords,
    searchIntent: candidate.searchIntent,
    status: purchasable.length === 1 ? "resolved" : purchasable.length === 0 ? "not-found" : "ambiguous",
    item: purchasable.length === 1 ? {
      asin: purchasable[0].asin,
      title: purchasable[0].itemInfo?.title?.displayValue,
      detailPageURL: purchasable[0].detailPageURL,
      imageURL: purchasable[0].images?.primary?.large?.url ?? purchasable[0].images?.primary?.medium?.url
    } : null,
    matchCount: purchasable.length,
    candidates
  });
}
const selectedCandidate = results.find((result) => result.status === "resolved")?.item ?? null;
await writeFile(outputPath, `${JSON.stringify({ checkedAt: new Date().toISOString(), marketplace: input.marketplace ?? "www.amazon.co.jp", selectedCandidate, results }, null, 2)}\n`);
if (results.some((result) => result.status !== "resolved")) process.exitCode = 2;
console.log(JSON.stringify({ outputPath, results }));
