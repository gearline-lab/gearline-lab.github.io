import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const inputPath = resolve(root, process.argv[2] ?? "config/amazon-candidates.json");
const outputPath = resolve(root, process.argv[3] ?? "config/amazon-candidate-results.json");
const input = JSON.parse(await readFile(inputPath, "utf8"));
const searchPolicy = JSON.parse(await readFile(resolve(root, "config/search-intent-policy.json"), "utf8"));
let growthPlan = null;
try { growthPlan = JSON.parse(await readFile(resolve(root, "config/next-week-growth-plan.json"), "utf8")); } catch { /* first weekly review has not run yet */ }
const dailyPolicy = searchPolicy.dailyArticle ?? {};
const allowedSignals = new Set(dailyPolicy.candidateDemandSignals ?? []);
const minimumOpportunityScore = Number(dailyPolicy.minimumSearchOpportunityScore ?? 0);
const clean = (value) => String(value ?? "").trim().replace(/^"|"$/g, "");
const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
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
  const demandSignals = candidate.searchDemand?.signals;
  if (!Array.isArray(demandSignals) || !demandSignals.some((signal) => allowedSignals.has(signal))) {
    throw new Error(`候補 ${candidate.id} には許可された検索需要シグナルが1つ以上必要です。`);
  }
  if (!String(candidate.searchDemand?.evidence ?? "").trim()) {
    throw new Error(`候補 ${candidate.id} には検索需要の根拠が必要です。`);
  }
  if (!Number.isFinite(candidate.searchOpportunityScore) || candidate.searchOpportunityScore < minimumOpportunityScore || candidate.searchOpportunityScore > 100) {
    throw new Error(`候補 ${candidate.id} の検索機会スコアは ${minimumOpportunityScore}〜100 で設定してください。`);
  }
  let response;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    response = await fetch("https://creatorsapi.amazon/catalog/v1/searchItems", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "x-marketplace": input.marketplace ?? "www.amazon.co.jp" },
      body: JSON.stringify({
        keywords: candidate.keywords,
        itemCount: 10,
        partnerTag: input.partnerTag ?? "gearlineweb-22",
        resources: ["itemInfo.title", "images.primary.large", "images.primary.medium", "offersV2.listings.isBuyBoxWinner"]
      })
    });
    if (response.ok || response.status !== 429 || attempt === 3) break;
    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfterSeconds) ? retryAfterSeconds * 1000 : 1_000 * (attempt + 1));
  }
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
    searchDemand: candidate.searchDemand,
    searchOpportunityScore: candidate.searchOpportunityScore,
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
// Weekly optimisation may change the ranking, never the API safety checks or
// the minimum SEO gate. This keeps daily publication moving while giving the
// next article the strongest verified search opportunity first.
const resolved = results.filter((result) => result.status === "resolved");
const ranking = [...resolved].sort((a, b) => Number(b.searchOpportunityScore ?? 0) - Number(a.searchOpportunityScore ?? 0));
const selected = ranking[0] ?? null;
const selectedCandidate = selected?.item ?? null;
await writeFile(outputPath, `${JSON.stringify({
  checkedAt: new Date().toISOString(),
  marketplace: input.marketplace ?? "www.amazon.co.jp",
  growthDirective: growthPlan?.selectedChange ?? null,
  selectedCandidate,
  selectedCandidateContext: selected ? {
    id: selected.id,
    searchIntent: selected.searchIntent,
    searchDemand: selected.searchDemand,
    searchOpportunityScore: selected.searchOpportunityScore
  } : null,
  results
}, null, 2)}\n`);
if (results.some((result) => result.status !== "resolved")) process.exitCode = 2;
console.log(JSON.stringify({ outputPath, results }));
