/**
 * The company's apps — settings, builds and downloads.
 *
 * `scope` is who is asking: Super Admin works on any company and may start a build; a company reads its own
 * settings and downloads the finished app. The build itself reports back on a public route of its own, with
 * a signature, in routes/public.ts.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import multer from "multer";
import { Company, MobileBuild } from "../models";
import { can } from "../middleware/auth";
import { h, parse, notFound, badRequest, paging } from "../lib/http";
import { putAt, getObject, deleteObject } from "../lib/s3";
import { s3Area } from "../../shared/platform";
import { appConfig, startBuild, setupState, readyToBuild, latestReady, buildRepo, buildWorkflow, buildRef, iosEnabled } from "../lib/mobilebuild";
import { signingSummary } from "../lib/signing";
import { PLATFORMS, APP_SCREENS, platformLabel, type Platform } from "../../shared/mobile";
import { tenantUrls } from "../lib/tenant";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
type Scope = "super" | "company";

async function target(req: Request, scope: Scope) {
  const id = scope === "company" ? req.auth!.companyId : req.params.id;
  const c = await Company.findOne({ _id: id, deletedAt: null }).lean<any>();
  if (!c) throw notFound("Company not found");
  return c;
}

export function mobileRoutes(scope: Scope) {
  const r = Router();
  const read = scope === "company" ? can("mobile_app", "read") : can("companies", "read");
  const write = scope === "company" ? can("mobile_app", "update") : can("companies", "update");

  /** Settings, the state of the build set-up, and this company's builds. */
  r.get("/mobile", read, h(async (req, res) => {
    const c = await target(req, scope);
    const { page, limit, skip } = paging(req.query);
    const [builds, total] = await Promise.all([
      MobileBuild.find({ companyId: c._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean<any[]>(),
      MobileBuild.countDocuments({ companyId: c._id }),
    ]);
    const gate = readyToBuild();
    /**
     * Every part below is a convenience, not the page. One of them failing used to 500 the whole tab, and
     * the browser showed a spinner for ever; now a part that cannot be worked out is simply left out.
     */
    const safe = <T,>(fn: () => T, fallback: T): T => {
      try {
        return fn();
      } catch {
        return fallback;
      }
    };
    res.json({
      company: { _id: c._id, name: c.name, code: c.code, ...safe(() => tenantUrls(c), {} as any) },
      config: safe(() => appConfig(c), { appName: c.name, bundleId: "", primary: "#2f5c24", accent: "#d9b52a", platforms: ["android"] } as any),
      saved: c.mobile || {},
      screens: APP_SCREENS,
      platforms: PLATFORMS,
      ios: safe(() => iosEnabled(), false),
      builds,
      total,
      page,
      limit,
      latest: await latestReady(c._id).catch(() => ({})),
      signing: scope === "super" ? await signingSummary(c).catch(() => null) : null,
      setup: scope === "super" ? { ...gate, repo: buildRepo(), workflow: buildWorkflow(), ref: buildRef() || "default branch", requirements: safe(() => setupState(), []) } : { ok: gate.ok },
      prefix: safe(() => s3Area(c.code, "app"), ""),
    });
  }));

  if (scope === "super") {
    /** App name, icon, colours, which platforms and which screens. */
    r.put("/mobile", write, h(async (req, res) => {
      const c = await target(req, scope);
      const b = parse(
        z.object({
          enabled: z.boolean().optional(),
          appName: z.string().max(40).optional(),
          shortName: z.string().max(20).optional(),
          bundleId: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, "Use something like in.credoone.lms.company").optional().or(z.literal("")),
          primary: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
          accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
          platforms: z.array(z.enum(["android", "ios"])).max(2).optional(),
          screens: z.array(z.string().max(30)).max(20).optional(),
          autoBuild: z.boolean().optional(),
          storeListing: z.object({ subtitle: z.string().max(80).optional(), description: z.string().max(4000).optional(), privacyUrl: z.string().max(300).optional(), supportEmail: z.string().max(160).optional() }).optional(),
        }),
        req.body
      );
      const mobile = { ...(c.mobile || {}), ...b };
      if (c.mobile?.bundleId && b.bundleId && b.bundleId !== c.mobile.bundleId && (await MobileBuild.exists({ companyId: c._id, status: "ready" })))
        throw badRequest("The application id cannot change once an app has been built and installed — a new id is a different app on the phone");
      await Company.updateOne({ _id: c._id }, { $set: { mobile } });
      res.locals.action = "Update app settings";
      res.locals.item = c.name;
      res.json({ saved: mobile, config: appConfig({ ...c, mobile }) });
    }));

    /** The app icon, kept with the company's other branding. */
    r.post("/mobile/icon", write, upload.single("file"), h(async (req: any, res) => {
      const c = await target(req, scope);
      if (!req.file) throw badRequest("Choose a PNG of 1024×1024");
      if (c.s3Enabled === false) throw badRequest("Switch on S3 storage for this company first");
      const kind = req.query.kind === "splash" ? "splash" : "icon";
      const { key } = await putAt(`${s3Area(c.code, "branding")}/app-${kind}.png`, req.file.buffer, req.file.mimetype || "image/png");
      await Company.updateOne({ _id: c._id }, { $set: { [`mobile.${kind}Key`]: key } });
      res.locals.action = `Upload app ${kind}`;
      res.locals.item = c.name;
      res.status(201).json({ key });
    }));

    /** Build now. */
    r.post("/mobile/build", write, h(async (req, res) => {
      const c = await target(req, scope);
      const b = parse(z.object({ platform: z.enum(["android", "ios"]), notes: z.string().max(300).optional() }), req.body);
      const build = await startBuild(c, b.platform as Platform, req.auth!.email, { notes: b.notes }).catch((e: any) => {
        throw badRequest(e.message);
      });
      res.locals.action = "Build app";
      res.locals.item = `${c.name} · ${platformLabel(b.platform)} ${build.version}`;
      res.status(201).json(build);
    }));

    /** Give up on a build that will never report back. */
    r.post("/mobile/build/:buildId/cancel", write, h(async (req, res) => {
      const c = await target(req, scope);
      const build = await MobileBuild.findOneAndUpdate({ _id: req.params.buildId, companyId: c._id, status: { $in: ["queued", "building"] } }, { $set: { status: "cancelled", finishedAt: new Date(), error: `Cancelled by ${req.auth!.email}` } }, { new: true }).lean<any>();
      if (!build) throw notFound("That build has already finished");
      res.locals.action = "Cancel build";
      res.json(build);
    }));

    r.delete("/mobile/build/:buildId", write, h(async (req, res) => {
      const c = await target(req, scope);
      const build = await MobileBuild.findOne({ _id: req.params.buildId, companyId: c._id }).lean<any>();
      if (!build) throw notFound();
      if (build.fileKey) await deleteObject(build.fileKey).catch(() => {});
      await MobileBuild.deleteOne({ _id: build._id });
      res.locals.action = "Delete build";
      res.locals.item = `${c.name} · ${build.version}`;
      res.json({ ok: true });
    }));
  }

  /** The signed app itself. The bucket stays private: the file is streamed through here. */
  r.get("/mobile/download/:buildId", read, h(async (req, res) => {
    const c = await target(req, scope);
    const build = await MobileBuild.findOne({ _id: req.params.buildId, companyId: c._id, status: "ready" }).lean<any>();
    if (!build?.fileKey) throw notFound("That build has no file");
    const f = await getObject(build.fileKey);
    await MobileBuild.updateOne({ _id: build._id }, { $inc: { downloads: 1 } });
    res.locals.action = "Download app";
    res.locals.item = `${c.name} · ${build.version}`;
    res.setHeader("Content-Type", build.platform === "ios" ? "application/octet-stream" : "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${build.fileName || `app-${build.version}.apk`}"`);
    res.send(f.body);
  }));

  return r;
}
