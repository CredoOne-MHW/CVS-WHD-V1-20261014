/**
 * DPDP consent — the same set of endpoints for Super Admin (any company, plus the platform's default notice)
 * and for a company (its own). `scope` decides whose company is being worked on, so neither side can read
 * another company's consents.
 *
 * Reports download as Excel through the existing exporter, so every tab's Download button behaves like the
 * rest of the platform.
 */
import { Router, type Request } from "express";
import { z } from "zod";
import multer from "multer";
import { Company, DpdpDocument, DpdpConsent, CookieConsent, Lead } from "../models";
import { can } from "../middleware/auth";
import { h, parse, notFound, badRequest, paging, escapeRegex } from "../lib/http";
import { inCompanyDb } from "../lib/tenantdb";
import { noticeFor, publish, storeUpload, extractUpload, toHtml, varsFor, platformDefault, withdraw, downloadNotice, accept } from "../lib/dpdp";
import { DEFAULT_NOTICE, DPDP_PURPOSES, COOKIE_CATEGORIES, fillVars, missingVars } from "../../shared/dpdp";
import { sheet } from "../lib/files";
import { tenantUrls } from "../lib/tenant";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

type Scope = "super" | "company";

/** Which company this request is about, and whether the caller may touch it. */
async function target(req: Request, scope: Scope) {
  const id = scope === "company" ? req.auth!.companyId : req.params.id;
  if (!id) return null; // Super Admin working on the platform's default notice
  const c = await Company.findOne({ _id: id, deletedAt: null }).lean<any>();
  if (!c) throw notFound("Company not found");
  return c;
}

export function dpdpRoutes(scope: Scope) {
  // mounted at /companies/:id, so it must inherit that parameter — see mobileRoutes for what its absence did
  const r = Router({ mergeParams: true });
  const read = scope === "company" ? can("dpdp:document", "read") : can("companies", "read");
  const write = scope === "company" ? can("dpdp:document", "update") : can("companies", "update");
  const readLog = scope === "company" ? can("dpdp:acceptance", "read") : can("companies", "read");
  const readCookies = scope === "company" ? can("dpdp:cookies", "read") : can("companies", "read");

  /* ── The notice ───────────────────────────────────────────────────────── */

  /** What this company shows today, its versions, and what the editor needs. */
  r.get("/dpdp", read, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) {
      // Super Admin › the platform's default
      const doc = await platformDefault();
      const versions = await DpdpDocument.find({ companyId: null }).sort({ version: -1 }).limit(20).select("version title source publishedAt publishedBy active words").lean<any[]>();
      return res.json({ platform: true, notice: { ...doc, missing: [] }, versions, purposes: DPDP_PURPOSES, cookies: COOKIE_CATEGORIES, defaultMarkdown: DEFAULT_NOTICE });
    }
    const [notice, own, versions] = await Promise.all([
      noticeFor(c),
      DpdpDocument.findOne({ companyId: c._id, active: true }).sort({ version: -1 }).lean<any>(),
      DpdpDocument.find({ companyId: c._id }).sort({ version: -1 }).limit(20).select("version title source publishedAt publishedBy active words").lean<any[]>(),
    ]);
    const def = await platformDefault();
    const vars = varsFor(c);
    res.json({
      company: { _id: c._id, name: c.name, code: c.code, officer: c.dpdpOfficer, officerEmail: c.dpdpOfficerEmail, ...tenantUrls(c) },
      notice,
      /** what the editor starts from: the company's own text, else the platform's with its details filled in */
      editor: { title: own?.title || fillVars(def.title, vars), markdown: own?.markdown || fillVars(def.markdown || "", vars), source: own?.source || "builtin" },
      usingDefault: !own,
      versions,
      vars,
      missing: missingVars(`${def.title} ${def.markdown || ""}`, vars),
      purposes: DPDP_PURPOSES,
      cookies: COOKIE_CATEGORIES,
      consentUrl: `${tenantUrls(c).customUrl || tenantUrls(c).platformUrl}/consent`,
    });
  }));

  /** Save and publish the written notice. */
  r.post("/dpdp", write, h(async (req, res) => {
    const c = await target(req, scope);
    const b = parse(z.object({ title: z.string().min(4).max(200), markdown: z.string().min(50).max(200_000), notes: z.string().max(300).optional() }), req.body);
    const doc = await publish(c?._id || null, { title: b.title, markdown: b.markdown, html: toHtml(b.markdown), source: "builtin", words: b.markdown.split(/\s+/).length, notes: b.notes }, req.auth!.email);
    res.locals.action = "Publish consent notice";
    res.locals.item = `${c?.name || "Platform"} · v${doc.version}`;
    res.status(201).json({ version: doc.version, notice: c ? await noticeFor(c) : doc });
  }));

  /** The written notice as the person will see it — rendered by the same code the screen uses. */
  r.post("/dpdp/preview", read, h(async (req, res) => {
    const c = await target(req, scope);
    const b = parse(z.object({ markdown: z.string().max(200_000) }), req.body);
    const vars = c ? varsFor(c) : {};
    res.json({ html: fillVars(toHtml(b.markdown), vars) });
  }));

  /** Upload a PDF or Word notice. The text is pulled out so the screen can be scrolled; the file is kept. */
  r.post("/dpdp/upload", write, upload.single("file"), h(async (req: any, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Upload a file on a company — the platform's default is written here");
    if (!req.file) throw badRequest("Choose a PDF, Word, Markdown or text file");
    if (c.s3Enabled === false) throw badRequest("Switch on S3 storage for this company first");
    const { html, words } = await extractUpload(req.file.buffer, req.file.originalname, req.file.mimetype || "");
    if (!html.trim()) throw badRequest("No text could be read from that file — a scanned image cannot be shown as a notice");
    const fileKey = await storeUpload(c, req.file.buffer, req.file.originalname, req.file.mimetype || "");
    const title = String(req.body?.title || req.file.originalname.replace(/\.[^.]+$/, "")).slice(0, 200);
    const doc = await publish(c._id, { title, html, source: "upload", fileKey, fileName: req.file.originalname, fileType: req.file.mimetype, words }, req.auth!.email);
    res.locals.action = "Upload consent notice";
    res.locals.item = `${c.name} · v${doc.version}`;
    res.status(201).json({ version: doc.version, notice: await noticeFor(c) });
  }));

  /** The original uploaded file. */
  r.get("/dpdp/file", read, h(async (req, res) => {
    const c = await target(req, scope);
    const doc = await DpdpDocument.findOne({ companyId: c?._id || null, active: true }).sort({ version: -1 }).lean<any>();
    if (!doc?.fileKey) throw notFound("This notice has no uploaded file");
    const f = await downloadNotice(doc.fileKey);
    res.setHeader("Content-Type", f.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${(doc.fileName || "notice").replace(/"/g, "")}"`);
    res.send(f.body);
  }));

  /** Go back to the platform's default (the company's own versions are kept). */
  r.post("/dpdp/use-default", write, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("This is the default");
    await DpdpDocument.updateMany({ companyId: c._id, active: true }, { $set: { active: false } });
    res.locals.action = "Use the platform's consent notice";
    res.locals.item = c.name;
    res.json({ notice: await noticeFor(c) });
  }));

  /** Who to write to about data protection — named in the notice. */
  r.put("/dpdp/officer", write, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Set this on a company");
    const b = parse(z.object({ dpdpOfficer: z.string().max(120).optional(), dpdpOfficerEmail: z.string().email().optional().or(z.literal("")) }), req.body);
    await Company.updateOne({ _id: c._id }, { $set: b });
    res.locals.action = "Update grievance officer";
    res.locals.item = c.name;
    res.json({ ok: true });
  }));

  /* ── The signed-in user's own consent (the apps) ──────────────────────── */

  if (scope === "company") {
    /** Does this user still have to accept the notice? The app asks at every start. */
    r.get("/dpdp/mine", h(async (req, res) => {
      const c = await target(req, scope);
      const notice = await noticeFor(c!);
      const mine = await inCompanyDb(String(c!._id), () => DpdpConsent.findOne({ companyId: c!._id, subjectKind: "user", subjectId: String(req.auth!.userId), withdrawnAt: null }).sort({ acceptedAt: -1 }).lean<any>());
      const needed = !mine || mine.documentVersion !== notice.version;
      res.json({ needed, acceptedAt: mine?.acceptedAt || null, notice: needed ? { id: String(notice._id), version: notice.version, title: notice.title, html: notice.html } : null });
    }));

    /** Records it, with the same evidence the website collects. */
    r.post("/dpdp/accept", h(async (req, res) => {
      const c = await target(req, scope);
      const b = parse(
        z.object({
          documentId: z.string().min(1),
          documentVersion: z.number().optional(),
          purposes: z.array(z.string().max(30)).max(10),
          source: z.enum(["app", "crm", "website", "form"]).default("app"),
          page: z.string().max(300).optional(),
          openedAt: z.string().optional(),
          readSeconds: z.number().min(0).max(7200),
          scrollPct: z.number().min(0).max(100),
          reachedEndAt: z.string().optional(),
        }),
        req.body
      );
      const row = await inCompanyDb(String(c!._id), () =>
        accept({
          companyId: c!._id,
          documentId: b.documentId,
          documentVersion: b.documentVersion,
          subjectKind: "user",
          subjectId: String(req.auth!.userId),
          name: req.auth!.name,
          email: req.auth!.email,
          purposes: b.purposes,
          source: b.source,
          page: b.page,
          openedAt: b.openedAt ? new Date(b.openedAt) : undefined,
          readSeconds: b.readSeconds,
          scrollPct: b.scrollPct,
          reachedEndAt: b.reachedEndAt ? new Date(b.reachedEndAt) : undefined,
          ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
          userAgent: String(req.headers["user-agent"] || "").slice(0, 250),
        })
      ).catch((e: any) => {
        throw badRequest(e.message);
      });
      res.locals.action = "Accept consent notice";
      res.status(201).json({ ok: true, acceptedAt: row.acceptedAt });
    }));
  }

  /* ── Acceptance log ───────────────────────────────────────────────────── */

  const listConsents = async (c: any, q: any) => {
    const { page, limit, skip } = paging(q);
    const find: any = { companyId: c._id };
    if (q.status === "withdrawn") find.withdrawnAt = { $ne: null };
    if (q.status === "accepted") find.withdrawnAt = null;
    if (q.source) find.source = q.source;
    if (q.from || q.to) find.acceptedAt = { ...(q.from ? { $gte: new Date(q.from) } : {}), ...(q.to ? { $lte: new Date(`${q.to}T23:59:59`) } : {}) };
    if (q.q) {
      const rx = new RegExp(escapeRegex(String(q.q)), "i");
      find.$or = [{ name: rx }, { email: rx }, { phone: rx }, { visitorId: rx }];
    }
    return inCompanyDb(String(c._id), async () => {
      const [items, total] = await Promise.all([DpdpConsent.find(find).sort({ acceptedAt: -1 }).skip(skip).limit(limit).lean<any[]>(), DpdpConsent.countDocuments(find)]);
      return { items, total, page, limit };
    });
  };

  r.get("/dpdp/consents", readLog, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Choose a company");
    res.json(await listConsents(c, req.query));
  }));

  /** The figures above the list: how many accepted, how many read it to the end, how many withdrew. */
  r.get("/dpdp/summary", readLog, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Choose a company");
    const out = await inCompanyDb(String(c._id), async () => {
      const [accepted, withdrawn, rows, cookies, cookieAll, cookieNecessary] = await Promise.all([
        DpdpConsent.countDocuments({ companyId: c._id, withdrawnAt: null }),
        DpdpConsent.countDocuments({ companyId: c._id, withdrawnAt: { $ne: null } }),
        DpdpConsent.find({ companyId: c._id }).select("readSeconds scrollPct purposes acceptedAt").limit(5000).lean<any[]>(),
        CookieConsent.countDocuments({ companyId: c._id }),
        CookieConsent.countDocuments({ companyId: c._id, choice: "all" }),
        CookieConsent.countDocuments({ companyId: c._id, choice: "necessary" }),
      ]);
      const read = rows.filter((x) => (x.scrollPct || 0) >= 98).length;
      const avgSeconds = rows.length ? Math.round(rows.reduce((a, x) => a + (x.readSeconds || 0), 0) / rows.length) : 0;
      const byPurpose: Record<string, number> = {};
      for (const p of DPDP_PURPOSES) byPurpose[p.key] = rows.filter((x) => (x.purposes || []).includes(p.key)).length;
      const last7 = rows.filter((x) => x.acceptedAt && new Date(x.acceptedAt) >= new Date(Date.now() - 7 * 86400_000)).length;
      return { accepted, withdrawn, total: rows.length, readToEnd: read, avgSeconds, byPurpose, last7, cookies: { total: cookies, all: cookieAll, necessary: cookieNecessary, custom: cookies - cookieAll - cookieNecessary } };
    });
    res.json(out);
  }));

  r.post("/dpdp/consents/:consentId/withdraw", write, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Choose a company");
    const row = await inCompanyDb(String(c._id), () => withdraw(c._id, req.params.consentId, req.auth!.email));
    if (!row) throw notFound();
    res.locals.action = "Withdraw consent";
    res.locals.item = `${c.name} · ${row.email || row.phone || row.visitorId}`;
    res.json(row);
  }));

  /* ── Cookie consent ───────────────────────────────────────────────────── */

  r.get("/dpdp/cookies", readCookies, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Choose a company");
    const { page, limit, skip } = paging(req.query);
    const find: any = { companyId: c._id };
    if (req.query.choice) find.choice = req.query.choice;
    const out = await inCompanyDb(String(c._id), async () => {
      const [items, total] = await Promise.all([CookieConsent.find(find).sort({ decidedAt: -1 }).skip(skip).limit(limit).lean<any[]>(), CookieConsent.countDocuments(find)]);
      return { items, total, page, limit };
    });
    res.json(out);
  }));

  /* ── Reports ──────────────────────────────────────────────────────────── */

  /** Every tab's Download button: Excel, with the evidence columns an audit asks for. */
  r.post("/dpdp/report", readLog, h(async (req, res) => {
    const c = await target(req, scope);
    if (!c) throw badRequest("Choose a company");
    const kind = String(req.body?.kind || "consents");
    const rows = await inCompanyDb(String(c._id), async () => {
      if (kind === "cookies") {
        const list = await CookieConsent.find({ companyId: c._id }).sort({ decidedAt: -1 }).limit(20000).lean<any[]>();
        return list.map((x) => ({
          "Decided on": x.decidedAt,
          Visitor: x.visitorId,
          Choice: x.choice,
          Necessary: "Yes",
          Preferences: x.categories?.preferences ? "Yes" : "No",
          Analytics: x.categories?.analytics ? "Yes" : "No",
          Marketing: x.categories?.marketing ? "Yes" : "No",
          Page: x.page || "",
          IP: x.ip || "",
          Device: (x.userAgent || "").slice(0, 120),
        }));
      }
      const list = await DpdpConsent.find({ companyId: c._id }).sort({ acceptedAt: -1 }).limit(20000).lean<any[]>();
      return list.map((x) => ({
        "Accepted on": x.acceptedAt,
        Name: x.name || "",
        Email: x.email || "",
        Phone: x.phone || "",
        Who: x.subjectKind,
        Visitor: x.visitorId || "",
        "Notice version": x.documentVersion,
        Source: x.source,
        Page: x.page || "",
        "Read (seconds)": x.readSeconds ?? "",
        "Scrolled (%)": x.scrollPct ?? "",
        "Reached the end": x.reachedEndAt ? "Yes" : "No",
        ...Object.fromEntries(DPDP_PURPOSES.map((p) => [p.label, (x.purposes || []).includes(p.key) ? "Yes" : "No"])),
        Status: x.withdrawnAt ? "Withdrawn" : "Accepted",
        "Withdrawn on": x.withdrawnAt || "",
        IP: x.ip || "",
        Device: (x.userAgent || "").slice(0, 120),
      }));
    });
    const buf = await sheet(rows, kind === "cookies" ? "Cookie consent" : "DPDP acceptance");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${c.code}-${kind}-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  }));

  return r;
}
