import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const zeroMode = process.argv.includes("--zero");
const inputPath = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]);
const periodArg = process.argv.find((arg) => arg.startsWith("--period="))?.slice(9);
if (!zeroMode && !inputPath) throw new Error("週次レポート入力JSONのパスを指定してください。");
if (zeroMode && !/^\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}$/u.test(periodArg ?? "")) {
  throw new Error("--zero では --period=YYYY-MM-DD_to_YYYY-MM-DD が必要です。");
}
const readJson = async (path, fallback = null) => {
  try { return JSON.parse(await readFile(resolve(root, path), "utf8")); } catch { return fallback; }
};
const input = zeroMode
  ? {
      period: periodArg,
      trackingIds: [
        { id: "gearlineweb-22", clicks: 0, orders: 0 },
        { id: "gearlinebsky-22", clicks: 0, orders: 0 }
      ]
    }
  : await readJson(inputPath);
if (!input?.period || !Array.isArray(input.trackingIds)) throw new Error("週次入力の形式が不正です。");
const allowedIds = new Set(["gearlineweb-22", "gearlinebsky-22"]);
if (!input.trackingIds.every((row) => allowedIds.has(row.id))) throw new Error("Gearline Lab以外のトラッキングIDは使えません。");
const policy = await readJson("config/growth-optimization-policy.json");
if (!policy?.rules || !policy.default) throw new Error("改善ポリシーを読み込めません。");
const snapshots = await readJson("data/bluesky-weekly-snapshots.json", []);
const latest = snapshots.at(-1);
const previous = snapshots.at(-2);
const sum = (key) => input.trackingIds.reduce((total, row) => total + Number(row[key] ?? 0), 0);
const ga4Input = input.analytics?.ga4;
const scInput = input.analytics?.searchConsole;
const ga4Verified = ga4Input?.source === "Google Analytics 4 official UI" && ga4Input.measurementId === "G-711HXNH46X";
const scVerified = scInput?.source === "Google Search Console official UI";
const metrics = {
  amazon: { clicks: sum("clicks"), orders: sum("orders") },
  ga4: ga4Verified ? {
    sessions: Number(ga4Input.sessions ?? 0),
    affiliateCardViews: Number(ga4Input.affiliateCardViews ?? 0),
    affiliateClicks: Number(ga4Input.affiliateClicks ?? 0)
  } : null,
  searchConsole: scVerified ? {
    impressions: Number(scInput.impressions ?? 0),
    ctr: Number(scInput.ctr ?? 0)
  } : null,
  bluesky: latest ? {
    standalonePosts: Number(latest.last7Days?.standalonePosts ?? 0),
    interactions: Object.values(latest.last7Days?.interactions ?? {}).reduce((total, value) => total + Number(value ?? 0), 0),
    followerDelta: previous ? Number(latest.profile?.followers ?? 0) - Number(previous.profile?.followers ?? 0) : null
  } : null
};
const matches = (rule) => {
  switch (rule.id) {
    case "search-demand-cluster": return metrics.searchConsole?.impressions === 0;
    case "search-snippet-match": return metrics.searchConsole && metrics.searchConsole.impressions >= 20 && metrics.searchConsole.ctr < 1;
    case "social-practical-angle": return metrics.bluesky && metrics.bluesky.followerDelta !== null && metrics.bluesky.standalonePosts >= 5 && metrics.bluesky.followerDelta <= 0 && metrics.bluesky.interactions === 0;
    case "affiliate-card-cta": return metrics.ga4 && metrics.ga4.sessions > 0 && metrics.ga4.affiliateCardViews > 0 && metrics.ga4.affiliateClicks === 0;
    case "product-fit-qualifier": return metrics.amazon.clicks >= 5 && metrics.amazon.orders === 0;
    default: return false;
  }
};
const selected = [...policy.rules].sort((a, b) => a.priority - b.priority).find(matches) ?? policy.default;
const plan = {
  period: input.period,
  generatedAt: new Date().toISOString(),
  onePrimaryChangePerWeek: true,
  selectedChange: selected,
  metrics,
  dataAvailability: {
    amazon: true,
    ga4: Boolean(ga4Verified),
    searchConsole: Boolean(scVerified),
    bluesky: Boolean(latest)
  },
  note: "未取得のGA4・Search Console指標はゼロと推測せず、判定対象から外しています。"
};
await mkdir(resolve(root, "reports"), { recursive: true });
await writeFile(resolve(root, "config/next-week-growth-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
const availability = Object.entries(plan.dataAvailability).filter(([, value]) => !value).map(([key]) => key).join("、") || "なし";
const lines = [
  `# Gearline Lab 自動改善レビュー（${input.period}）`, "",
  "## 今週自動採用する変更", "",
  `- **${selected.id}**: ${selected.change}`,
  `- 期待指標: ${selected.expectedMetric}`,
  `- 検証方法: ${selected.verification}`,
  "",
  "## 判定データ", "",
  `- Amazon（gearlineweb-22 + gearlinebsky-22）: クリック ${metrics.amazon.clicks}、注文 ${metrics.amazon.orders}`,
  `- GA4: ${metrics.ga4 ? `セッション ${metrics.ga4.sessions}、カード表示 ${metrics.ga4.affiliateCardViews}、Amazonクリック ${metrics.ga4.affiliateClicks}` : "公式確認値なし"}`,
  `- Search Console: ${metrics.searchConsole ? `表示 ${metrics.searchConsole.impressions}、CTR ${metrics.searchConsole.ctr}%` : "公式確認値なし"}`,
  `- Bluesky: ${metrics.bluesky ? `独自投稿 ${metrics.bluesky.standalonePosts}、公開反応 ${metrics.bluesky.interactions}、フォロワー差分 ${metrics.bluesky.followerDelta ?? "初回"}` : "公開スナップショットなし"}`,
  `- 未取得のため判定に使わなかったデータ: ${availability}`,
  "",
  "次週はこの変更だけを優先して実行し、同じ指標で再判定します。"
];
const report = resolve(root, "reports", `growth-review-${input.period}.md`);
await writeFile(report, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report, plan: resolve(root, "config/next-week-growth-plan.json"), selectedChange: selected.id, dataAvailability: plan.dataAvailability }));
