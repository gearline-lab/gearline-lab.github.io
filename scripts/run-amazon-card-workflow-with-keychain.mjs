import { execFileSync } from "node:child_process";

const refIndex = process.argv.indexOf("--ref");
const ref = refIndex >= 0 ? process.argv[refIndex + 1] : null;
if (!ref || !/^[-a-z0-9/]+$/u.test(ref)) throw new Error("--ref に安全なブランチ名を指定してください。");

// The PAT remains in macOS Keychain and is kept only in this process memory.
const token = execFileSync("security", ["find-internet-password", "-a", "gearline-lab", "-s", "github.com", "-w"], {
  encoding: "utf8"
}).trim();
if (!token) throw new Error("GitHub PATをキーチェーンから取得できません。");

const repo = "gearline-lab/gearline-lab.github.io";
const workflow = "update-amazon-cards.yml";
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
  body: JSON.stringify({ ref })
});

for (let attempt = 0; attempt < 45; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const data = await api(`/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&per_page=10`);
  const run = data.workflow_runs?.find((item) => item.event === "workflow_dispatch" && new Date(item.created_at).valueOf() >= startedAt - 10_000);
  if (!run || run.status !== "completed") continue;
  if (run.conclusion !== "success") throw new Error(`Creators API workflow failed: ${run.conclusion ?? "unknown"}`);
  console.log(JSON.stringify({ runId: run.id, ref, conclusion: run.conclusion }));
  process.exit(0);
}

throw new Error("Creators API workflowの完了待ちがタイムアウトしました。");
