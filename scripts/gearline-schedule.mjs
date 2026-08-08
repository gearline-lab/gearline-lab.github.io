import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);
const date = dateArg ? new Date(`${dateArg}T12:00:00+09:00`) : new Date();
if (Number.isNaN(date.valueOf())) throw new Error("--date は YYYY-MM-DD で指定してください。");
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Tokyo" }).format(date);
const dateJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
const planPath = resolve(root, "config/bluesky-daily-plan.json");

const run = (command, commandArgs) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, commandArgs, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", rejectRun);
  child.on("close", (code) => code === 0 ? resolveRun(stdout.trim()) : rejectRun(new Error(stderr || `${command} failed: ${code}`)));
});

const exists = async (path) => access(path).then(() => true).catch(() => false);
const result = { date: dateJst, daily: "not-run", article: "not-due", weeklyReport: "not-due" };

// The Codex heartbeat researches and writes the local plan. This runner only
// executes a validated plan; it never invents content or bypasses QA.
if (await exists(planPath)) {
  result.daily = JSON.parse(await run("zsh", ["scripts/run-bluesky-daily-with-keychain.sh", ...(args.has("--dry-run") ? ["--dry-run"] : [])]));
} else {
  result.daily = "waiting-for-validated-plan";
}

if (["Tue", "Fri"].includes(weekday)) {
  const articlePlanPath = resolve(root, "config/article-publish-plan.json");
  result.article = await exists(articlePlanPath)
    ? "waiting-for-heartbeat-publication-qa"
    : "waiting-for-researched-article-plan";
}

if (weekday === "Mon") {
  const reportInputPath = resolve(root, "config/weekly-report-input.json");
  result.weeklyReport = await exists(reportInputPath)
    ? "ready-to-render"
    : "waiting-for-official-amazon-report-input";
}

console.log(JSON.stringify(result));
