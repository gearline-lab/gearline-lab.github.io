import { execFileSync } from "node:child_process";

const token = execFileSync("security", ["find-internet-password", "-a", "gearline-lab", "-s", "github.com", "-w"], {
  encoding: "utf8"
}).trim();
if (!token) throw new Error("GitHub PATをキーチェーンから取得できません。");

const repo = "gearline-lab/gearline-lab.github.io";
const workflow = "resolve-amazon-candidates.yml";
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2026-03-10"
};
const api = async (path, options = {}) => {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers, ...options });
  if (!response.ok) throw new Error(`GitHub Actions API failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
};

const startedAt = Date.now();
await api(`/actions/workflows/${workflow}/dispatches`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ ref: "main" })
});

for (let attempt = 0; attempt < 45; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const data = await api(`/actions/workflows/${workflow}/runs?branch=main&per_page=10`);
  const run = data.workflow_runs?.find((item) => item.event === "workflow_dispatch" && new Date(item.created_at).valueOf() >= startedAt - 10_000);
  if (!run || run.status !== "completed") continue;
  if (run.conclusion !== "success") throw new Error(`Creators API候補解決ワークフローが失敗しました: ${run.conclusion ?? "unknown"}`);
  console.log(JSON.stringify({ runId: run.id, conclusion: run.conclusion }));
  process.exit(0);
}

throw new Error("Creators API候補解決ワークフローの完了待ちがタイムアウトしました。");
