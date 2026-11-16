/**
 * Super Admin › Mobile App Release — every company's app in one place.
 *
 * The per-company Mobile App tab decides what an app is called and how it looks. This is the other half:
 * starting builds across companies, watching them, and the one GitHub setting that makes a push to the app's
 * code rebuild everybody's app at once.
 */
import { Router } from "express";
import { z } from "zod";
import { Company, MobileBuild, PushDevice } from "../../models";
import { can } from "../../middleware/auth";
import { h, parse, notFound, badRequest, paging } from "../../lib/http";
import { startBuild, buildRepo, buildWorkflow, readyToBuild, setupState, iosEnabled } from "../../lib/mobilebuild";
import { signingEnabled } from "../../lib/signing";
import { state as autoState, saveState, newSecret, rebuildAll } from "../../lib/autobuild";
import { buildSecret, ensureBuildSecret, rotateBuildSecret } from "../../lib/buildsecret";
import { pushSecrets, listSecretNames } from "../../lib/githubsecrets";
import { PLATFORMS } from "../../../shared/mobile";

const r = Router();
const read = can("mobile_release", "read");
const write = can("mobile_release", "update");
const days = (n: number) => new Date(Date.now() - n * 86_400_000);

/** The four numbers across the top, and everything the set-up panel shows. */
r.get("/mobile-releases/summary", read, h(async (req, res) => {
  const since = days(7);
  const [building, ready, failed, auto] = await Promise.all([
    MobileBuild.countDocuments({ status: { $in: ["queued", "building"] } }),
    MobileBuild.countDocuments({ status: "ready", createdAt: { $gte: since } }),
    MobileBuild.countDocuments({ status: "failed", createdAt: { $gte: since } }),
    autoState(),
  ]);

  /**
   * How many phones are on the newest build of their own company's app. Each company has its own version
   * line, so this is worked out per company and then added up — comparing version strings across companies
   * would be meaningless.
   */
  const seen = await PushDevice.find({ lastSeenAt: { $gte: days(30) } }).select("companyId appVersion").lean<any[]>().catch(() => []);
  const newest = new Map<string, string>();
  for (const b of await MobileBuild.find({ status: "ready" }).sort({ createdAt: -1 }).select("companyId version").lean<any[]>()) {
    const k = String(b.companyId);
    if (!newest.has(k)) newest.set(k, b.version);
  }
  const current = seen.filter((d) => d.appVersion && newest.get(String(d.companyId)) && String(d.appVersion).startsWith(newest.get(String(d.companyId))!)).length;

  const { value: secret, source: secretSource } = await buildSecret();
  const held = { MOBILE_BUILD_SECRET: !!secret && secretSource === "platform" };
  const gate = readyToBuild(held);
  res.json({
    stats: { building, ready, failed, devices: { current, total: seen.length } },
    setup: {
      ...gate,
      repo: buildRepo(),
      workflow: buildWorkflow(),
      requirements: setupState(held),
      signingEnabled: signingEnabled(),
      buildSecret: { source: secretSource, present: !!secret },
      ios: iosEnabled(),
    },
    auto: { on: auto.on, branch: auto.branch, hasSecret: !!auto.secret, lastPush: auto.lastPush },
    platformUrl: (process.env.APP_BASE_URL || "").trim(),
    webhookPath: "/api/public/webhooks/github/push",
    platforms: PLATFORMS,
  });
}));

/** Builds across every company, newest first, with the filters the table offers. */
r.get("/mobile-releases/builds", read, h(async (req, res) => {
  const { page, limit, skip } = paging(req.query);
  const find: any = {};
  if (req.query.companyId) find.companyId = String(req.query.companyId);
  if (req.query.platform) find.platform = String(req.query.platform);
  if (req.query.status) find.status = String(req.query.status);

  const [rows, total] = await Promise.all([
    MobileBuild.find(find).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<any[]>(),
    MobileBuild.countDocuments(find),
  ]);
  const names = new Map(
    (await Company.find({ _id: { $in: rows.map((b) => b.companyId) } }).select("name code").lean<any[]>()).map((c: any) => [String(c._id), c])
  );
  res.json({
    builds: rows.map((b) => ({ ...b, company: names.get(String(b.companyId))?.name || b.companyCode, companyCode: b.companyCode || names.get(String(b.companyId))?.code })),
    total,
    page,
    limit,
  });
}));

/** The companies that can be built, for the picker — name, code and whether an app already exists. */
r.get("/mobile-releases/companies", read, h(async (req, res) => {
  const list = await Company.find({ deletedAt: null, status: "active" }).select("name code mobile status").sort({ name: 1 }).lean<any[]>();
  const ready = new Set((await MobileBuild.distinct("companyId", { status: "ready" })).map(String));
  res.json({
    companies: list.map((c) => ({
      _id: c._id,
      name: c.name,
      code: c.code,
      platforms: c.mobile?.platforms?.length ? c.mobile.platforms : ["android"],
      autoBuild: !!c.mobile?.autoBuild,
      hasApp: ready.has(String(c._id)),
    })),
  });
}));

/**
 * Starts a build — for one company, or for every company that already has an app.
 *
 * "All companies" deliberately skips a company with no app yet: a first build decides the application id and
 * the signing key, which is not something a bulk action should do behind someone's back.
 */
r.post("/mobile-releases/build", write, h(async (req, res) => {
  const b = parse(
    z.object({
      companyId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
      platform: z.enum(["android", "ios"]).default("android"),
      target: z.enum(["test", "store"]).default("test"),
      all: z.boolean().default(false),
    }),
    req.body
  );
  const platform = b.platform || "android";
  const by = req.auth!.email;

  if (!b.all) {
    if (!b.companyId) throw badRequest("Pick a company, or tick every company with an app");
    const c = await Company.findOne({ _id: b.companyId, deletedAt: null }).lean<any>();
    if (!c) throw notFound("Company not found");
    const build = await startBuild(c, platform, by, { target: b.target || "test" });
    res.locals.action = "Start mobile build";
    res.locals.item = `${c.code} ${platform} ${b.target || "test"}`;
    return res.status(201).json({ started: 1, builds: [build] });
  }

  const withApp = new Set((await MobileBuild.distinct("companyId", { status: "ready", platform })).map(String));
  const companies = (await Company.find({ deletedAt: null, status: "active" }).lean<any[]>()).filter((c) => withApp.has(String(c._id)));
  let started = 0;
  const problems: string[] = [];
  for (const c of companies) {
    try {
      await startBuild(c, platform, by, { trigger: "auto", target: b.target || "test" });
      started++;
    } catch (e: any) {
      problems.push(`${c.code}: ${e?.message || e}`);
    }
  }
  res.locals.action = "Start mobile build (every company)";
  res.locals.item = `${platform} · ${started}`;
  res.status(201).json({ started, skipped: problems.length, problems: problems.slice(0, 20) });
}));

/** The automatic-rebuild switch, the branch, and a fresh secret when one is wanted. */
r.put("/mobile-releases/auto", write, h(async (req, res) => {
  const b = parse(z.object({ on: z.boolean().optional(), branch: z.string().max(80).optional(), rotate: z.boolean().optional() }), req.body);
  const now = await autoState();
  const patch: any = {};
  if (b.on !== undefined) patch.on = b.on;
  if (b.branch) patch.branch = b.branch.trim();
  if (b.rotate || !now.secret) patch.secret = newSecret(); // a switch with no secret would never fire
  const next = await saveState(patch, req.auth!.email);
  res.locals.action = b.rotate ? "New build-trigger secret" : "Automatic rebuilds";
  res.locals.item = b.on === undefined ? next.branch : b.on ? "on" : "off";
  res.json({ on: next.on, branch: next.branch, hasSecret: !!next.secret });
}));

/**
 * Writes the two shared secrets into the build repository, so nobody has to paste them.
 *
 * It needs the build token to carry Secrets: write. Where it does not, the refusal is reported per secret
 * and the panel still shows the values to copy — the manual route never stops working.
 */
r.post("/mobile-releases/github-secrets", write, h(async (req, res) => {
  const [{ value: callback }, auto] = await Promise.all([ensureBuildSecret(req.auth!.email), autoState()]);
  let trigger = auto.secret;
  if (!trigger) trigger = (await saveState({ secret: newSecret() }, req.auth!.email)).secret;

  const out = await pushSecrets({ MOBILE_BUILD_SECRET: callback, BUILD_TRIGGER_SECRET: trigger }).catch((e: any) => ({
    repo: "",
    results: [{ name: "all", ok: false, message: e?.message || String(e) }],
  }));
  res.locals.action = "Write build secrets to GitHub";
  res.locals.item = out.results.filter((r2: any) => r2.ok).length + " of " + out.results.length;
  res.json(out);
}));

/** Which of them the repository already holds. GitHub never gives back a value, only the names. */
r.get("/mobile-releases/github-secrets", read, h(async (req, res) => {
  res.json({ names: await listSecretNames() });
}));

/** A new callback secret. Everything building right now will fail to report back — the screen says so. */
r.post("/mobile-releases/build-secret/rotate", write, h(async (req, res) => {
  const value = await rotateBuildSecret(req.auth!.email).catch((e: any) => {
    throw badRequest(e.message);
  });
  res.locals.action = "New build callback secret";
  res.json({ ok: true, secret: value });
}));

/** The secret itself, only when someone asks to see it. */
r.get("/mobile-releases/auto/secret", write, h(async (req, res) => {
  const [s, cb] = await Promise.all([autoState(), buildSecret()]);
  res.locals.action = "Reveal build secrets";
  res.json({ secret: s.secret || "", buildSecret: cb.value, buildSecretSource: cb.source });
}));

/** "Rebuild everybody now", without waiting for a push. */
r.post("/mobile-releases/auto/run", write, h(async (req, res) => {
  const out = await rebuildAll(req.auth!.email, "auto");
  res.locals.action = "Rebuild every app";
  res.locals.item = String(out.builds);
  res.json(out);
}));

export default r;
