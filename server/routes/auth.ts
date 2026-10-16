import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User, Company } from "../models";
import { requireAuth, signToken, setAuthCookie, COOKIE, buildContext, invalidateAuth } from "../middleware/auth";
import { rateLimit } from "../lib/cache";
import { logActivity } from "../middleware/activity";
import { h, parse, HttpError } from "../lib/http";
import { COMPANY_MODULES, SA_MODULES } from "../../shared/constants";
import { requestHost, resolveHost, publicBranding, platformBranding, loadPlatformBranding, tenantUrls } from "../lib/tenant";

const r = Router();
const SA_BACKUP = "lms_sa_token";

// Brute-force protection: 8 tries / 10 min per email+IP, 40 / 10 min per IP (shared across instances with Redis)

/** One login page for everyone. The account's scope decides which console opens. */
r.post("/login", h(async (req, res) => {
  const { email, password } = parse(z.object({ email: z.string().email(), password: z.string().min(1) }), req.body);
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
  if (!(await rateLimit(`login:${email.toLowerCase()}|${ip}`, 8, 600)) || !(await rateLimit(`login-ip:${ip}`, 40, 600))) throw new HttpError(429, "Too many attempts. Try again in a few minutes.");

  const user = await User.findOne({ email: email.toLowerCase() });
  const ok = user && user.active && (await bcrypt.compare(password, user.passwordHash));
  if (!ok) throw new HttpError(401, "Invalid email or password");

  // White-label isolation: on a company's own URL only that company's users can sign in;
  // Super Admins sign in on the platform URL only.
  const host = requestHost(req);
  const t = await resolveHost(host);
  if (t.kind === "unknown") throw new HttpError(404, "No workspace is set up for this address");
  const hostCompany = t.kind === "company" ? t.company : null;
  if (hostCompany && (user.scope !== "company" || String(user.companyId) !== String(hostCompany._id))) throw new HttpError(401, "Invalid email or password");
  if (user.scope === "company") {
    const company = await Company.findById(user.companyId).lean<any>();
    if (!company || company.deletedAt) throw new HttpError(401, "Invalid email or password");
    if (company.status !== "active") throw new HttpError(403, "Your company account is deactivated. Contact support.");
  }
  user.lastLoginAt = new Date();
  await user.save();
  setAuthCookie(res, signToken({ uid: String(user._id), scope: user.scope as any, cid: user.companyId ? String(user.companyId) : undefined, tv: user.tokenVersion }));
  logActivity({ scope: user.scope, companyId: user.companyId, userId: user._id, userLabel: `${user.name} <${user.email}>`, action: "Login", module: "auth", item: user.email, response: 200 });
  res.json({ scope: user.scope, redirect: user.scope === "super" ? "/sa" : "/app" });
}));

r.post("/logout", (req, res) => {
  res.clearCookie(COOKIE, { path: "/" });
  res.clearCookie(SA_BACKUP, { path: "/" });
  res.json({ ok: true });
});

r.get("/me", requireAuth, h(async (req, res) => {
  const a = req.auth!;
  const nav = (a.scope === "super" ? SA_MODULES : COMPANY_MODULES).filter((m) => a.perms[m.key]?.read);
  if (a.scope === "super") await loadPlatformBranding();
  let branding: any = platformBranding();
  if (a.scope === "company") {
    const c = await Company.findById(a.companyId).lean<any>();
    if (c) branding = { ...publicBranding(c), ...tenantUrls(c) };
  }
  res.json({ ...a, nav, branding });
}));

/** Super Admin → "Force Login" into a company's admin console. The SA session is parked in a second cookie. */
r.post("/impersonate/:companyId", requireAuth, h(async (req, res) => {
  const a = req.auth!;
  if (a.scope !== "super" || !a.perms.companies?.update) throw new HttpError(403, "Only Super Admin can force login");
  const owner = await User.findOne({ companyId: req.params.companyId, isOwner: true, scope: "company" }).lean<any>();
  if (!owner) throw new HttpError(404, "Company has no admin user");
  res.cookie(SA_BACKUP, req.cookies[COOKIE], { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 2 * 3600 * 1000 });
  setAuthCookie(res, signToken({ uid: String(owner._id), scope: "company", cid: String(owner.companyId), tv: owner.tokenVersion, imp: a.email }, "2h"));
  logActivity({ scope: "super", userId: a.userId, userLabel: `${a.name} <${a.email}>`, action: "Force login", module: "companies", item: String(req.params.companyId), response: 200 });
  logActivity({ scope: "company", companyId: owner.companyId, userId: owner._id, userLabel: `${owner.name} <${owner.email}>`, impersonatedBy: a.email, action: "Force login (by Super Admin)", module: "auth", item: owner.email, response: 200 });
  res.json({ redirect: "/app" });
}));

r.post("/impersonate-exit", h(async (req, res) => {
  const backup = req.cookies[SA_BACKUP];
  if (!backup) throw new HttpError(400, "Not impersonating");
  const payload = jwt.verify(backup, process.env.JWT_SECRET!) as any;
  await buildContext(payload); // ensure the SA session is still valid
  setAuthCookie(res, backup);
  res.clearCookie(SA_BACKUP, { path: "/" });
  res.json({ redirect: "/sa/companies" });
}));

r.post("/change-password", requireAuth, h(async (req, res) => {
  const b = parse(z.object({ current: z.string(), next: z.string().min(8) }), req.body);
  const user = await User.findById(req.auth!.userId);
  if (!user || !(await bcrypt.compare(b.current, user.passwordHash))) throw new HttpError(400, "Current password is wrong");
  user.passwordHash = await bcrypt.hash(b.next, 12);
  user.tokenVersion += 1;
  await user.save();
  await invalidateAuth();
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
}));

export default r;
