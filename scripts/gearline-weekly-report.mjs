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
const lines = [
  `# Gearline Lab 週次収益レポート（${input.period}）`, "", "| ID | クリック | 注文 | 発送済 | 売上 | 紹介料 |", "|---|---:|---:|---:|---:|---:|",
  ...input.trackingIds.map((r) => `| ${r.id} | ${r.clicks || 0} | ${r.orders || 0} | ${r.shipped || 0} | ${r.sales || 0} | ${r.fee || 0} |`),
  `| 合計 | ${totals.clicks} | ${totals.orders} | ${totals.shipped} | ${totals.sales} | ${totals.fee} |`, "",
  `- CVR: ${cvr}%`, `- 週次紹介料目標: ${input.targetFee}円`, `- 目標差: ${totals.fee - Number(input.targetFee || 0)}円`, "",
  "## 改善案", "", "- 実績データを確認後、優先度（大・中・小）ごとに最大3件をCodexが追記します。"
];
await mkdir(resolve(process.cwd(), "reports"), { recursive: true });
const output = resolve(process.cwd(), "reports", `weekly-${input.period}.md`);
await writeFile(output, `${lines.join("\n")}\n`);
console.log(JSON.stringify({ report: output, totals, cvr }));
