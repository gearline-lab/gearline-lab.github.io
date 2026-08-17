import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = process.argv[2];
if (!inputPath) throw new Error("Amazon公式画面から転記したJSONのパスを指定してください。");
const input = JSON.parse(await readFile(resolve(process.cwd(), inputPath), "utf8"));
if (!Array.isArray(input.trackingIds) || !input.trackingIds.every((row) => ["gearlineweb-22", "gearlinebsky-22"].includes(row.id))) {
  throw new Error("gearlineweb-22 と gearlinebsky-22 だけを入力してください。");
}
const totals = input.trackingIds.reduce((sum, row) => ({
  clicks: sum.clicks + Number(row.clicks || 0), orders: sum.orders + Number(row.orders || 0),
  shipped: sum.shipped + Number(row.shipped || 0), sales: sum.sales + Number(row.sales || 0), fee: sum.fee + Number(row.fee || 0)
}), { clicks: 0, orders: 0, shipped: 0, sales: 0, fee: 0 });
const cvr = totals.clicks ? (totals.orders / totals.clicks * 100).toFixed(2) : "0.00";
const analytics = input.analytics?.ga4;
const nonNegative = (value, label) => {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error(`GA4 ${label} は0以上の数値で入力してください。`);
  return Number(value);
};
let analyticsLines = ["## GA4 サイト利用状況", "", "- GA4の確認済み値は未入力です。次回、GA4公式画面で確認した値を入力してください。"];
if (analytics) {
  if (analytics.measurementId !== "G-711HXNH46X") throw new Error("GA4の測定IDは G-711HXNH46X に限定します。");
  if (analytics.source !== "Google Analytics 4 official UI") throw new Error("GA4の値はGoogle Analytics 4公式画面で確認したものだけを入力してください。");
  for (const [key, label] of [["activeUsers", "アクティブユーザー"], ["sessions", "セッション"], ["views", "表示回数"], ["engagementRate", "エンゲージメント率"], ["averageEngagementTimeSeconds", "平均エンゲージメント時間"], ["outboundClicks", "外部リンククリック"], ["affiliateClicks", "Amazonアフィリエイトクリック"]]) nonNegative(analytics[key] ?? 0, label);
  const rate = Number(analytics.engagementRate ?? 0).toFixed(2);
  const avgTime = Number(analytics.averageEngagementTimeSeconds ?? 0).toFixed(1);
  analyticsLines = [
    "## GA4 サイト利用状況", "",
    `- 測定ID: ${analytics.measurementId}`,
    `- 確認元: ${analytics.source}`,
    `- 確認時刻: ${analytics.verifiedAt ?? "未記録"}`,
    "",
    "| アクティブユーザー | セッション | 表示回数 | エンゲージメント率 | 平均エンゲージメント時間 | 外部リンククリック | Amazonクリック |",
    "|---:|---:|---:|---:|---:|---:|---:|",
    `| ${analytics.activeUsers ?? 0} | ${analytics.sessions ?? 0} | ${analytics.views ?? 0} | ${rate}% | ${avgTime}秒 | ${analytics.outboundClicks ?? 0} | ${analytics.affiliateClicks ?? 0} |`,
    "",
    "- GA4は計測開始直後や集計遅延中に値が変動するため、紹介料・注文数とは別指標として扱います。"
  ];
}
const lines = [
  `# Gearline Lab 週次収益レポート（${input.period}）`, "", "| ID | クリック | 注文 | 発送済 | 売上 | 紹介料 |", "|---|---:|---:|---:|---:|---:|",
  ...input.trackingIds.map((r) => `| ${r.id} | ${r.clicks || 0} | ${r.orders || 0} | ${r.shipped || 0} | ${r.sales || 0} | ${r.fee || 0} |`),
  `| 合計 | ${totals.clicks} | ${totals.orders} | ${totals.shipped} | ${totals.sales} | ${totals.fee} |`, "",
  `- CVR: ${cvr}%`, `- 週次紹介料目標: ${input.targetFee}円`, `- 目標差: ${totals.fee - Number(input.targetFee || 0)}円`, "",
  ...analyticsLines, "",
  "## 改善案", "", "- 実績データを確認後、優先度（大・中・小）ごとに最大3件をCodexが追記します。"
];
await mkdir(resolve(process.cwd(), "reports"), { recursive: true });
const output = resolve(process.cwd(), "reports", `weekly-${input.period}.md`);
await writeFile(output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report: output, totals, cvr, analyticsIncluded: Boolean(analytics) }));
