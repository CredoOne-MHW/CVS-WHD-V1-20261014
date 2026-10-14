import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User, Company, Plan, Role } from "../models";
import { COMPANY_MODULES, SA_MODULES, fullPerm, noPerm, type Action, type PermMap } from "../../shared/constants";
import { HttpError, forbidden } from "../lib/http";

export const COOKIE = "lms_token";

export interface AuthCtx {
  userId: string;
  scope: "super" | "company";
  companyId?: string;
  name: string;
  email: string;
  isOwner: boolean;
  impersonatedBy?: string; // super admin email when force-logged in
  companyName?: string;
  plan?: string;
  perms: PermMap;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthCtx;
      rawBody?: string;
    }
  }
}

interface TokenPayload {
  uid: string;
  scope: "super" | "company";
  cid?: string;
  tv: number;
  imp?: string;
}

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
};

export function signToken(p: TokenPayload, ttl: string = "12h") {
  return jwt.sign(p, secret(), { expiresIn: ttl } as jwt.SignOptions);
}

export function setAuthCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 12 * 3600 * 1000,
  });
}

function andPerms(a: PermMap, b: PermMap): PermMap {
  const out: PermMap = {};
  for (const k of Object.keys(a)) {
    out[k] = { create: !!(a[k]?.create && b[k]?.create), read: !!(a[k]?.read && b[k]?.read), update: !!(a[k]?.update && b[k]?.update), delete: !!(a[k]?.delete && b[k]?.delete) };
  }
  return out;
}

/** Effective company permissions = Plan grid ∧ (Role grid, when the user has a role). */
export async function companyPerms(planName: string, roleId?: any): Promise<PermMap> {
  const plan = await Plan.findOne({ name: planName }).lean<any>();
  const base: PermMap = {};
  for (const m of COMPANY_MODULES) base[m.key] = plan?.permissions?.[m.key] ?? noPerm();
  if (!roleId) return base;
  const role = await Role.findById(roleId).lean<any>();
  return role ? andPerms(base, role.permissions || {}) : base;
}

async function superPerms(roleId?: any): Promise<PermMap> {
  const all: PermMap = {};
  for (const m of SA_MODULES) all[m.key] = fullPerm();
  if (!roleId) return all;
  const role = await Role.findById(roleId).lean<any>();
  return role ? andPerms(all, role.permissions || {}) : all;
}

export async function buildContext(p: TokenPayload): Promise<AuthCtx> {
  const user = await User.findById(p.uid).lean<any>();
  if (!user || !user.active || user.tokenVersion !== p.tv) throw new HttpError(401, "Session expired");
  if (user.scope === "super") {
    return { userId: String(user._id), scope: "super", name: user.name, email: user.email, isOwner: user.isOwner, perms: await superPerms(user.roleId) };
  }
  const company = await Company.findById(user.companyId).lean<any>();
  if (!company || company.deletedAt) throw new HttpError(401, "Company not found");
  if (company.status !== "active" && !p.imp) throw new HttpError(403, "Company account is deactivated. Contact support.");
  return {
    userId: String(user._id),
    scope: "company",
    companyId: String(company._id),
    companyName: company.name,
    plan: company.plan,
    name: user.name,
    email: user.email,
    isOwner: user.isOwner,
    impersonatedBy: p.imp,
    perms: await companyPerms(company.plan, user.isOwner ? undefined : user.roleId),
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : undefined;
    const token = req.cookies?.[COOKIE] || bearer;
    if (!token) throw new HttpError(401, "Not signed in");
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, secret()) as TokenPayload;
    } catch {
      throw new HttpError(401, "Session expired");
    }
    req.auth = await buildContext(payload);
    next();
  } catch (e) {
    next(e);
  }
}

export const requireScope = (scope: "super" | "company") => (req: Request, _res: Response, next: NextFunction) =>
  req.auth?.scope === scope ? next() : next(forbidden());

/** Tags the request with its module (for activity logs) and enforces the CRUD scope. */
export const can = (module: string, action: Action) => (req: Request, res: Response, next: NextFunction) => {
  res.locals.module = module;
  if (!req.auth?.perms?.[module]?.[action]) return next(forbidden(`No ${action} access to ${module}`));
  next();
};

/** Tenant filter helper — every company query goes through this. */
export const tenant = (req: Request) => {
  if (!req.auth?.companyId) throw forbidden();
  return { companyId: req.auth.companyId };
};
