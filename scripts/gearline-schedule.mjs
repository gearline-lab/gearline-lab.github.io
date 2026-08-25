import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
// Heartbeats call this script without flags. That is the live, guarded run;
// --dry-run remains the explicit status-only mode for local verification.
if (!args.has("--dry-run")) {
  const forwarded = process.argv.slice(2).filter((arg) => arg !== "--execute");
  const child = spawn("node", ["scripts/gearline-orchestrator.mjs", "--execute", ...forwarded], { cwd: root, stdio: "inherit" });
  const code = await new Promise((resolveRun, rejectRun) => {
    child.on("error", rejectRun);
    child.on("close", resolveRun);
  });
  process.exit(code ?? 1);
}
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice(7);
const date = dateArg ? new Date(`${dateArg}T12:00:00+09:00`) : new Date();
if (Number.isNaN(date.valueOf())) throw new Error("--date は YYYY-MM-DD で指定してください。");
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Tokyo" }).format(date);
const dateJst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
const planPath = resolve(root, "config/bluesky-daily-plan.json");
const growthPlanPath = resolve(root, "config/next-week-growth-plan.json");

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
const growthPlan = await exists(growthPlanPath)
  ? JSON.parse(await readFile(growthPlanPath, "utf8")).selectedChange?.id ?? "available"
  : "waiting-for-first-weekly-review";
const result = { date: dateJst, growthDirective: growthPlan, daily: "not-run", article: "not-due", weeklyReport: "not-due" };

// The Codex heartbeat researches and writes the local plan. This runner only
// executes a validated plan; it never invents content or bypasses QA.
if (await exists(planPath)) {
  result.daily = JSON.parse(await run("zsh", ["scripts/run-bluesky-daily-with-keychain.sh", ...(args.has("--dry-run") ? ["--dry-run"] : [])]));
} else {
  result.daily = "waiting-for-validated-plan";
}

// A product article is evaluated every day. Completion requires a new canonical
// URL; revisions of existing articles are tracked separately and never count as
// the daily article. The heartbeat still has to create a research-backed plan
// and pass article QA before it can be published.
const articlePlanPath = resolve(root, "config/article-publish-plan.json");
result.article = await exists(articlePlanPath)
  ? "waiting-for-heartbeat-publication-qa"
  : "waiting-for-researched-article-plan";

if (weekday === "Mon") {
  const reportInputPath = resolve(root, "config/weekly-report-input.json");
  result.weeklyReport = await exists(reportInputPath)
    ? "ready-to-render"
    : "ready-to-render-zero-activity-report";
}

console.log(JSON.stringify(result));
