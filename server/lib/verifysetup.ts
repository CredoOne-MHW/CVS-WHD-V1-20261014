/**
 * Asks GitHub whether a build would actually work, before anyone presses Build.
 *
 * Everything the set-up panel showed until now was read from this platform's own settings: it could tell you
 * a value was present and well-formed, and nothing at all about whether it was *true*. A repository that does
 * not exist, a branch that was renamed, a workflow file that was never pushed, Actions never switched on —
 * every one of those looked perfect here and then came back as a 404 a minute later.
 *
 * So this asks. Four questions, four plain answers, each with what to do about it.
 */
import { buildRepo, buildWorkflow, buildRef, WORKFLOW_REVISION, MOBILE_REVISION } from "./mobilebuild";
import { signingRoute, SIGNING_HELP } from "./signing";

const env = (k: string) => (process.env[k] || "").trim();
const API = "https://api.github.com";

export interface Finding {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

async function gh(path: string) {
  const token = env("GITHUB_BUILD_TOKEN");
  return fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(10_000),
  });
}

export async function verifySetup(): Promise<{ ok: boolean; findings: Finding[] }> {
  const repo = buildRepo();
  const workflow = buildWorkflow();
  const findings: Finding[] = [];

  if (!repo || !env("GITHUB_BUILD_TOKEN")) {
    return {
      ok: false,
      findings: [{ key: "repo", label: "Repository", ok: false, detail: "GITHUB_BUILD_REPO or GITHUB_BUILD_TOKEN is not set.", fix: "Set both in the platform's environment." }],
    };
  }

  /* 1 — can the token see the repository at all? */
  let defaultBranch = "main";
  try {
    const res = await gh(`/repos/${repo}`);
    if (res.status === 404) {
      findings.push({
        key: "repo", label: "Repository", ok: false,
        detail: `GitHub does not recognise ${repo}, or the token cannot see it.`,
        fix: "GITHUB_BUILD_REPO must be owner/repo — no https://, no github.com/, no .git. A private repository also needs the token to have access to it.",
      });
      return { ok: false, findings };
    }
    if (res.status === 401) {
      findings.push({ key: "repo", label: "Repository", ok: false, detail: "GitHub rejected the token.", fix: "GITHUB_BUILD_TOKEN has expired or was revoked. Make a new fine-grained token with Actions: read and write." });
      return { ok: false, findings };
    }
    const json: any = await res.json();
    defaultBranch = json?.default_branch || "main";
    findings.push({ key: "repo", label: "Repository", ok: true, detail: `${repo} — reachable, default branch ${defaultBranch}.` });
  } catch (e: any) {
    findings.push({ key: "repo", label: "Repository", ok: false, detail: `Could not reach GitHub: ${e?.message || e}` });
    return { ok: false, findings };
  }

  /* 2 — does the branch the platform builds from exist? */
  const branch = buildRef() || defaultBranch;
  try {
    const res = await gh(`/repos/${repo}/branches/${encodeURIComponent(branch)}`);
    if (res.ok) findings.push({ key: "branch", label: "Branch", ok: true, detail: `${branch} exists.` });
    else
      findings.push({
        key: "branch", label: "Branch", ok: false,
        detail: `There is no branch called ${branch} in ${repo}.`,
        fix: `Set GITHUB_BUILD_REF to a branch that exists (the default is ${defaultBranch}), or leave it empty to use the default.`,
      });
  } catch {
    findings.push({ key: "branch", label: "Branch", ok: false, detail: "Could not check the branch." });
  }

  /* 3 — is the workflow file actually on that branch? This is the one that bites. */
  const path = `.github/workflows/${workflow}`;
  try {
    const res = await gh(`/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`);
    if (res.ok) {
      /**
       * Being there is not enough — it has to be the current one. The platform and the workflow ship
       * together and deploy separately (the platform to Vercel, the workflow by pushing it), so the pair
       * drift apart whenever only one half is done, and the build then fails on something already fixed.
       */
      const body: any = await res.json();
      const text = body?.content ? Buffer.from(body.content, "base64").toString("utf8") : "";
      const found = /#\s*lms-workflow:\s*([\w.\-]+)/.exec(text)?.[1];
      if (found === WORKFLOW_REVISION) {
        findings.push({ key: "workflow", label: "Workflow file", ok: true, detail: `${path} is on ${branch}, revision ${found} — current.` });
      } else {
        findings.push({
          key: "workflow", label: "Workflow file", ok: false,
          detail: found
            ? `${path} on ${branch} is revision ${found}; this platform ships ${WORKFLOW_REVISION}.`
            : `${path} is on ${branch}, but it is an older copy from before the revisions were marked.`,
          fix: `Push the .github folder from the current release to ${branch}. The platform and the workflow are deployed separately — deploying the platform does not update this file, so a build keeps failing on something already fixed.`,
        });
      }
    }
    else
      findings.push({
        key: "workflow", label: "Workflow file", ok: false,
        detail: `${path} is not on branch ${branch}.`,
        fix:
          workflow === "build-mobile.yml"
            ? "Commit and push .github/workflows/build-mobile.yml (it is in the release zip, inside the hidden .github folder) to that branch."
            : `This platform ships .github/workflows/build-mobile.yml, not ${workflow}. Set GITHUB_BUILD_WORKFLOW to build-mobile.yml, or remove it to use the default — ${workflow} looks like another project's workflow.`,
      });
  } catch {
    findings.push({ key: "workflow", label: "Workflow file", ok: false, detail: "Could not look for the workflow file." });
  }

  /* 4 — has Actions ever been switched on? A workflow GitHub has not registered cannot be dispatched. */
  try {
    const res = await gh(`/repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}`);
    if (res.ok) {
      const json: any = await res.json();
      const disabled = json?.state && json.state !== "active";
      findings.push({
        key: "actions", label: "Actions", ok: !disabled,
        detail: disabled ? `GitHub knows ${workflow} but it is ${json.state}.` : `${workflow} is registered and active — a build can be dispatched.`,
        fix: disabled ? "Enable the workflow on the repository's Actions tab." : undefined,
      });
    } else {
      findings.push({
        key: "actions", label: "Actions", ok: false,
        detail: `GitHub has not registered ${workflow} for this repository.`,
        fix: "Push the workflow to the default branch and open the repository's Actions tab once — GitHub does not register a workflow until Actions has been opened.",
      });
    }
  } catch {
    findings.push({ key: "actions", label: "Actions", ok: false, detail: "Could not check Actions." });
  }

  /* 5 — does the repository hold the secrets its own steps need? The upload and the callback both run on
         the runner, so these are its secrets, not the platform's. */
  try {
    const { listSecretNames } = await import("./githubsecrets");
    const names = await listSecretNames();
    if (!names.length) {
      findings.push({ key: "secrets", label: "Repository secrets", ok: true, detail: "Could not read them — give the token Secrets: read to have this checked." });
    } else {
      const need = ["MOBILE_BUILD_SECRET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
      const missing = need.filter((n) => !names.includes(n));
      if (!missing.length) findings.push({ key: "secrets", label: "Repository secrets", ok: true, detail: "The build has everything it needs to report back and to upload." });
      else
        findings.push({
          key: "secrets", label: "Repository secrets", ok: false,
          detail: `The repository is missing ${missing.join(", ")}.`,
          fix: missing.includes("MOBILE_BUILD_SECRET")
            ? "Press “Set up secrets in GitHub” above for MOBILE_BUILD_SECRET. The AWS pair must be added by hand — the upload runs on the runner, so it needs its own credentials."
            : "Add these in GitHub → Settings → Secrets and variables → Actions. The upload runs on the runner, not on the platform, so it needs its own AWS credentials.",
        });
    }
  } catch {
    findings.push({ key: "secrets", label: "Repository secrets", ok: true, detail: "Not checked." });
  }

  /* 6 — is the app source in the repository the one this platform ships? Pushing .github without mobile
         leaves the app's dependencies behind, and the build then dies inside Metro. */
  try {
    const res = await gh(`/repos/${repo}/contents/${encodeURIComponent("mobile/package.json")}?ref=${encodeURIComponent(branch)}`);
    if (!res.ok) {
      findings.push({
        key: "app", label: "App source", ok: false,
        detail: `mobile/package.json is not on branch ${branch}.`,
        fix: "Push the mobile folder from the current release to that branch — it is the app the build compiles.",
      });
    } else {
      const body: any = await res.json();
      const found = JSON.parse(Buffer.from(body.content || "", "base64").toString("utf8") || "{}").version;
      if (found === MOBILE_REVISION) findings.push({ key: "app", label: "App source", ok: true, detail: `mobile/ is revision ${found} — current.` });
      else
        findings.push({
          key: "app", label: "App source", ok: false,
          detail: `mobile/ on ${branch} is revision ${found || "unmarked"}; this platform ships ${MOBILE_REVISION}.`,
          fix: "Push the mobile folder from the current release. Its dependencies and the platform are shipped together, so an older copy fails inside Metro on a module the platform expects.",
        });
    }
  } catch {
    findings.push({ key: "app", label: "App source", ok: true, detail: "Not checked." });
  }

  /* 7 — can an Android app actually be signed? Neither route set up means a build that gets all the way to
         the signing step and dies there, which costs ten minutes to discover. */
  try {
    const { route, missing } = await signingRoute(true);
    if (route === "platform") findings.push({ key: "signing", label: "Signing", ok: true, detail: "The platform makes and keeps one permanent Android key per company." });
    else if (route === "github") findings.push({ key: "signing", label: "Signing", ok: true, detail: "The repository holds the four ANDROID_* secrets, so builds are signed with your own key." });
    else if (route === "unknown")
      findings.push({
        key: "signing", label: "Signing", ok: true,
        detail: "Could not read the repository's secrets, so this one is unverified.",
        fix: "Give the token Secrets: read to have this checked. The build itself still refuses an unsigned app.",
      });
    else
      findings.push({
        key: "signing", label: "Signing", ok: false,
        detail: `An Android build would fail at the signing step. The repository is missing ${missing.join(", ")}.`,
        fix: SIGNING_HELP,
      });
  } catch {
    findings.push({ key: "signing", label: "Signing", ok: true, detail: "Not checked." });
  }

  return { ok: findings.every((f) => f.ok), findings };
}
