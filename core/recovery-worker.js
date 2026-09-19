"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { list, update } = require("./recovery-store");
const { decide } = require("./kill-critic");
const { validateUnifiedDiff } = require("./interop/patch-candidate");

const exec = promisify(execFile);
const POLL_MS = Math.max(1000, Number(process.env.RECOVERY_POLL_MS || 5000));
const REPO_DIR = path.resolve(process.env.RECOVERY_REPO_DIR || path.join(__dirname, ".."));
const TEST_COMMAND = parseCommand(process.env.RECOVERY_TEST_COMMAND, ["npm", "test", "--prefix", "core"]);
const AUTO_CREATE_PR = String(process.env.RECOVERY_AUTO_CREATE_PR || "").toLowerCase() === "true";
const BASE_BRANCH = String(process.env.RECOVERY_BASE_BRANCH || "main");
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "");

function parseCommand(value, fallback) {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || !parsed.length || parsed.some(x => typeof x !== "string")) throw new Error("invalid command");
    return parsed;
  } catch {
    throw new Error("RECOVERY_TEST_COMMAND must be a JSON array, e.g. [\"npm\",\"test\",\"--prefix\",\"core\"]");
  }
}

async function git(args, cwd) {
  const authArgs = [];
  if (GITHUB_TOKEN && ["fetch", "push", "ls-remote"].includes(args[0])) {
    authArgs.push("-c", "http.extraheader=AUTHORIZATION: bearer " + GITHUB_TOKEN);
  }
  return exec("git", [...authArgs, ...args], { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
}

async function remoteRepository(cwd) {
  const { stdout } = await git(["remote", "get-url", "origin"], cwd);
  const remote = String(stdout || "").trim();
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!match) throw new Error("GITHUB_ORIGIN_NOT_RESOLVED");
  return { owner: match[1], repo: match[2] };
}

async function createPullRequest({ cwd, head, base, title, body }) {
  if (!GITHUB_TOKEN) throw new Error("GITHUB_TOKEN_REQUIRED_FOR_AUTO_PR");
  const { owner, repo } = await remoteRepository(cwd);
  const payload = JSON.stringify({ title, head, base, body });
  const result = await exec("curl", [
    "-fsS", "--connect-timeout", "5", "--max-time", "30",
    "-X", "POST", "https://api.github.com/repos/" + owner + "/" + repo + "/pulls",
    "-H", "Accept: application/vnd.github+json",
    "-H", "Authorization: Bearer " + GITHUB_TOKEN,
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    "-H", "Content-Type: application/json",
    "--data-binary", payload
  ], { cwd, timeout: 60000, maxBuffer: 1024 * 1024 });
  return JSON.parse(String(result.stdout || "{}"));
}

async function ensureBaseAvailable(base) {
  try {
    await git(["cat-file", "-e", `${base}^{commit}`], REPO_DIR);
    return;
  } catch {}
  if (!/^[0-9a-f]{7,64}$/i.test(base)) return;
  await git(["fetch", "--no-tags", "origin", base], REPO_DIR);
  await git(["cat-file", "-e", `${base}^{commit}`], REPO_DIR);
}

async function runCommand(command, cwd) {
  return exec(command[0], command.slice(1), { cwd, timeout: 10 * 60 * 1000, maxBuffer: 8 * 1024 * 1024 });
}

async function cleanup(worktree) {
  try { await git(["worktree", "remove", "--force", worktree], REPO_DIR); } catch {}
  try { fs.rmSync(worktree, { recursive: true, force: true }); } catch {}
}

async function processJob(job) {
  if (!job.patchProposal?.diff || job.status !== "sandbox_pending") return;

  let validation;
  try {
    validation = validateUnifiedDiff(job.patchProposal.diff);
  } catch (error) {
    update(job.id, { status: "stopped", workerError: `INVALID_PERSISTED_PATCH: ${String(error?.message || error)}` });
    return;
  }
  if (!validation.files.length) throw new Error("NO_CHANGED_FILES");

  const base = job.sha || BASE_BRANCH;
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "x10think-recovery-"));
  const patchFile = path.join(worktree, "recovery.patch");
  const branchName = `recovery/${job.fingerprint || job.id}`;

  try {
    await ensureBaseAvailable(base);
    await git(["worktree", "add", "--detach", worktree, base], REPO_DIR);

    // Reproduce the original CI failure before touching the worktree.
    // A passing baseline means the incident is not reproducible here, so fail closed.
    let baselineReproduction = null;
    try {
      const result = await runCommand(TEST_COMMAND, worktree);
      baselineReproduction = {
        reproduced: false,
        exitCode: 0,
        stdout: String(result.stdout || "").slice(-12000),
        stderr: String(result.stderr || "").slice(-12000)
      };
      update(job.id, {
        status: "stopped",
        sandbox: { pass:false, stage:"baseline_reproduction", baseline:baselineReproduction },
        workerError: "BASELINE_DID_NOT_REPRODUCE"
      });
      return;
    } catch (error) {
      baselineReproduction = {
        reproduced: true,
        exitCode: Number.isInteger(error.code) ? error.code : 1,
        stdout: String(error.stdout || "").slice(-12000),
        stderr: String(error.stderr || error.message || "").slice(-12000)
      };
    }

    fs.writeFileSync(patchFile, validation.diff, "utf8");

    try {
      await git(["apply", "--check", patchFile], worktree);
      await git(["apply", "--whitespace=error", patchFile], worktree);
      await git(["diff", "--check"], worktree);
    } catch (error) {
      const critic = decide({
        attempts: job.attempts,
        evidence: { ...(job.diagnosis?.evidence || {}), scopeMatch: 1, changedFileMatch: 1, sandboxPass: false, regressionPass: false },
        patch: job.patch
      });
      update(job.id, { status: "stopped", sandbox: { pass:false, stage:"apply", error:error.message }, critic });
      return;
    }

    let regressionPass = false;
    let regression = null;
    try {
      const result = await runCommand(TEST_COMMAND, worktree);
      regressionPass = true;
      regression = { pass:true, exitCode:0, stdout: String(result.stdout || "").slice(-12000), stderr: String(result.stderr || "").slice(-12000) };
    } catch (error) {
      regression = { pass:false, exitCode: Number.isInteger(error.code) ? error.code : 1, stdout: String(error.stdout || "").slice(-12000), stderr: String(error.stderr || error.message || "").slice(-12000) };
    }

    const evidence = {
      ...(job.diagnosis?.evidence || {}),
      scopeMatch: 1,
      changedFileMatch: 1,
      sandboxPass: true,
      regressionPass
    };
    const critic = decide({ attempts: job.attempts, evidence, patch: job.patch });
    if (critic.action !== "CREATE_PR") {
      update(job.id, { status: critic.action === "HUMAN_REVIEW" ? "human_review" : "stopped", sandbox: { pass:true, regression, files:validation.files }, critic, diagnosis:{ ...(job.diagnosis || {}), evidence } });
      return;
    }

    if (!AUTO_CREATE_PR) {
      update(job.id, { status:"pr_ready", sandbox:{ pass:true, regression, files:validation.files }, critic, diagnosis:{ ...(job.diagnosis || {}), evidence } });
      return;
    }

    await git(["switch", "-c", branchName], worktree);
    await git(["add", "--all"], worktree);
    await git(["commit", "-m", `fix: recover CI ${job.fingerprint || job.id}`], worktree);
    await git(["push", "-u", "origin", branchName], worktree);

    const title = `fix: automated CI recovery ${job.fingerprint || job.id}`;
    const body = [
      "Automated X10THINK recovery proposal.",
      "",
      `Failure fingerprint: ${job.fingerprint || job.id}`,
      `Workflow: ${job.workflow || "unknown"}`,
      `Original SHA: ${job.sha || "unknown"}`,
      "",
      "Kill Critic gate: sandbox + regression passed.",
      "Merge is intentionally not performed by the recovery worker."
    ].join("\n");
    const pr = await createPullRequest({ cwd: worktree, head: branchName, base: BASE_BRANCH, title, body });
    update(job.id, { status:"pr_created", prUrl:String(pr.html_url || "").trim(), sandbox:{ pass:true, regression, files:validation.files }, critic, diagnosis:{ ...(job.diagnosis || {}), evidence } });
  } finally {
    await cleanup(worktree);
  }
}

async function tick() {
  for (const job of list(100)) {
    if (job.status !== "sandbox_pending") continue;
    try {
      await processJob(job);
    } catch (error) {
      update(job.id, { status:"stopped", workerError:String(error?.message || error) });
    }
  }
}

if (require.main === module) {
  console.log(JSON.stringify({ event:"recovery_worker_started", repo:REPO_DIR, pollMs:POLL_MS, autoCreatePr:AUTO_CREATE_PR }));
  let busy = false;
  const loop = async () => {
    if (busy) return;
    busy = true;
    try { await tick(); } finally { busy = false; }
  };
  loop();
  setInterval(loop, POLL_MS);
}

module.exports = { processJob, tick };
