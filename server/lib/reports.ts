import mongoose from "mongoose";
import * as XLSX from "xlsx";
import { z } from "zod";
import { Lead, WaLog, ActivityLog, AiUsage, Company } from "../models";
import { HttpError } from "./http";
import type { AuthCtx } from "../middleware/auth";

/**
 * Read-only report engine. Every report — DIY, Agentic (AI-written) and the AI assistant —
 * is a declarative spec validated here and compiled to a Mongo aggregation over WHITELISTED
 * fields only. No raw queries, no writes, tenant filter always applied, module permissions enforced.
 */

type FType = "string" | "number" | "date" | "enum";
interface Field {
  key: string;
  label: string;
  type: FType;
  path?: string;
  options?: readonly string[];
}
interface Dataset {
  key: string;
  label: string;
  model: mongoose.Model<any>;
  module: string; // company permission needed to read it
  scopes: ("super" | "company")[];
  dateField: string;
  softDelete?: boolean;
  scopeFilter?: (a: AuthCtx) => any;
  fields: Field[];
}

const STATUSES = ["New", "Contact Attempted", "Interested", "Not Interested", "Requirement Identified", "Price / Package Shared", "Appointment Booked", "Converted / Service Initiated", "Follow-ups needed", "Lost / Not Converted"] as const;

export const DATASETS: Dataset[] = [
  {
    key: "leads",
    label: "Leads",
    model: Lead,
    module: "leads",
    scopes: ["super", "company"],
    dateField: "createdAt",
    softDelete: true,
    fields: [
      { key: "name", label: "Name", type: "string" },
      { key: "whatsapp", label: "WhatsApp No", type: "string" },
      { key: "phone", label: "Phone No", type: "string" },
      { key: "email", label: "Email", type: "string" },
      { key: "address", label: "Address", type: "string" },
      { key: "comments", label: "Comments", type: "string" },
      { key: "source", label: "Source", type: "string" },
      { key: "campaign", label: "Campaign", type: "string" },
      { key: "medium", label: "Medium", type: "string" },
      { key: "referral", label: "Referral", type: "string" },
      { key: "status", label: "Status", type: "enum", options: STATUSES },
      { key: "lostReason", label: "Lost reason", type: "string" },
      { key: "score", label: "Score", type: "number" },
      { key: "createdAt", label: "Created", type: "date" },
      { key: "updatedAt", label: "Updated", type: "date" },
      { key: "nextFollowUpAt", label: "Next follow-up", type: "date" },
    ],
  },
  {
    key: "wa_logs",
    label: "WhatsApp messages",
    model: WaLog,
    module: "wa_logs",
    scopes: ["super", "company"],
    dateField: "createdAt",
    scopeFilter: (a) => (a.scope === "company" ? { scope: "company" } : {}),
    fields: [
      { key: "event", label: "Event", type: "string" },
      { key: "trigger", label: "Trigger", type: "enum", options: ["manual", "bulk", "auto", "test", "resend", "cron"] },
      { key: "to", label: "To", type: "string" },
      { key: "name", label: "Name", type: "string" },
      { key: "result", label: "Result", type: "enum", options: ["success", "failed"] },
      { key: "httpStatus", label: "HTTP status", type: "number" },
      { key: "detail", label: "Detail", type: "string" },
      { key: "createdAt", label: "Time", type: "date" },
    ],
  },
  {
    key: "activity",
    label: "Activity logs",
    model: ActivityLog,
    module: "activity_logs",
    scopes: ["super", "company"],
    dateField: "createdAt",
    scopeFilter: (a) => (a.scope === "company" ? { scope: "company" } : {}),
    fields: [
      { key: "userLabel", label: "User", type: "string" },
      { key: "action", label: "Action", type: "string" },
      { key: "module", label: "Module", type: "string" },
      { key: "item", label: "Item", type: "string" },
      { key: "response", label: "Response", type: "number" },
      { key: "error", label: "Error", type: "string" },
      { key: "createdAt", label: "Time", type: "date" },
    ],
  },
  {
    key: "ai_usage",
    label: "AI usage",
    model: AiUsage,
    module: "ai_agents",
    scopes: ["super", "company"],
    dateField: "createdAt",
    fields: [
      { key: "purpose", label: "Purpose", type: "string" },
      { key: "inputTokens", label: "Input tokens", type: "number" },
      { key: "outputTokens", label: "Output tokens", type: "number" },
      { key: "credits", label: "Credits", type: "number" },
      { key: "billed", label: "Billed (₹)", type: "number" },
      { key: "createdAt", label: "Time", type: "date" },
    ],
  },
  {
    key: "companies",
    label: "Companies",
    model: Company,
    module: "companies",
    scopes: ["super"],
    dateField: "createdAt",
    softDelete: true,
    fields: [
      { key: "name", label: "Company", type: "string" },
      { key: "code", label: "Code", type: "string" },
      { key: "plan", label: "Plan", type: "string" },
      { key: "status", label: "Status", type: "enum", options: ["active", "inactive"] },
      { key: "contactPerson", label: "Contact", type: "string" },
      { key: "email", label: "Email", type: "string" },
      { key: "whatsapp", label: "WhatsApp", type: "string" },
      { key: "slug", label: "Short name", type: "string" },
      { key: "customDomain", label: "Own domain", type: "string" },
      { key: "createdAt", label: "Created", type: "date" },
    ],
  },
];

const OPS = ["eq", "ne", "in", "nin", "contains", "gt", "gte", "lt", "lte", "exists"] as const;
const BUCKETS = ["day", "week", "month", "year"] as const;

export const specSchema = z.object({
  dataset: z.string(),
  title: z.string().max(140).optional(),
  columns: z.array(z.string()).max(30).optional(),
  filters: z.array(z.object({ field: z.string(), op: z.enum(OPS), value: z.any().optional() })).max(15).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  companyId: z.string().optional(), // Super Admin only
  groupBy: z.array(z.string()).max(2).optional(), // "status" or "createdAt:month"
  metrics: z.array(z.object({ op: z.enum(["count", "sum", "avg", "min", "max"]), field: z.string().optional() })).max(5).optional(),
  sort: z.object({ field: z.string(), dir: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().min(1).max(50000).optional(),
});
export type ReportSpec = z.infer<typeof specSchema>;

export function datasetsFor(a: AuthCtx) {
  return DATASETS.filter((d) => d.scopes.includes(a.scope) && (a.scope === "super" ? true : a.perms[d.module]?.read)).map((d) => ({
    key: d.key,
    label: d.label,
    dateField: d.dateField,
    fields: [...(a.scope === "super" && d.key !== "companies" ? [{ key: "company", label: "Company", type: "string" as FType, options: undefined as readonly string[] | undefined }] : []), ...d.fields.map(({ key, label, type, options }) => ({ key, label, type, options }))],
  }));
}

/** Compact schema text for prompting the AI (agentic reports / assistant). */
export function schemaForPrompt(a: AuthCtx) {
  return datasetsFor(a)
    .map((d) => `- ${d.key} (${d.label}; date field ${d.dateField}): ${d.fields.map((f) => `${f.key}:${f.type}${f.options ? `[${f.options.join("|")}]` : ""}`).join(", ")}`)
    .join("\n");
}

function coerce(f: Field, v: any): any {
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => coerce(f, x));
  if (v == null) return v;
  if (typeof v === "object") throw new HttpError(400, `Invalid value for ${f.key}`);
  if (f.type === "number") {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new HttpError(400, `${f.label} must be a number`);
    return n;
  }
  if (f.type === "date") {
    const d = new Date(String(v));
    if (isNaN(+d)) throw new HttpError(400, `${f.label} must be a date`);
    return d;
  }
  return String(v).slice(0, 200);
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export async function runReport(a: AuthCtx, raw: unknown, opts: { maxRows?: number } = {}) {
  const spec = specSchema.parse(raw);
  const ds = DATASETS.find((d) => d.key === spec.dataset && d.scopes.includes(a.scope));
  if (!ds) throw new HttpError(400, `Unknown dataset "${spec.dataset}"`);
  if (a.scope === "company" && !a.perms[ds.module]?.read) throw new HttpError(403, `No access to ${ds.label}`);
  const fieldMap = new Map(ds.fields.map((f) => [f.key, f]));
  const allowCompany = a.scope === "super" && ds.key !== "companies";
  const field = (k: string) => {
    const f = fieldMap.get(k);
    if (!f) throw new HttpError(400, `Unknown field "${k}" in ${ds.label}`);
    return f;
  };

  // ── $match: tenant + soft delete + dataset scope + dates + filters
  const match: any = { ...(ds.scopeFilter?.(a) || {}) };
  if (a.scope === "company") match.companyId = new mongoose.Types.ObjectId(a.companyId);
  else if (spec.companyId && allowCompany && mongoose.isValidObjectId(spec.companyId)) match.companyId = new mongoose.Types.ObjectId(spec.companyId);
  if (ds.softDelete) match.deletedAt = null;
  const range: any = {};
  if (spec.from) range.$gte = coerce({ key: "from", label: "From", type: "date" }, spec.from);
  if (spec.to) {
    const t = coerce({ key: "to", label: "To", type: "date" }, spec.to) as Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(spec.to)) t.setHours(23, 59, 59, 999);
    range.$lte = t;
  }
  if (Object.keys(range).length) match[ds.dateField] = range;
  for (const fl of spec.filters || []) {
    const f = field(fl.field);
    const v = coerce(f, fl.value);
    const cond =
      fl.op === "eq" ? v
      : fl.op === "ne" ? { $ne: v }
      : fl.op === "in" ? { $in: [].concat(v) }
      : fl.op === "nin" ? { $nin: [].concat(v) }
      : fl.op === "contains" ? { $regex: esc(String(v ?? "")), $options: "i" }
      : fl.op === "exists" ? (v === false || v === "false" ? { $in: [null, ""] } : { $nin: [null, ""] })
      : { [`$${fl.op}`]: v };
    match[f.key] = match[f.key] && typeof match[f.key] === "object" && typeof cond === "object" && !(cond instanceof Date) ? { ...match[f.key], ...cond } : cond;
  }

  const pipeline: any[] = [{ $match: match }];
  const max = Math.min(spec.limit || 500, opts.maxRows || 5000);
  let columns: { key: string; label: string; type: FType }[];

  if (spec.groupBy?.length || spec.metrics?.length) {
    // ── grouped
    const groupId: any = {};
    columns = [];
    for (const g of spec.groupBy || []) {
      const [k, bucket] = g.split(":");
      if (k === "company" && allowCompany) {
        groupId.company = "$companyId";
        columns.push({ key: "company", label: "Company", type: "string" });
        continue;
      }
      const f = field(k);
      if (bucket) {
        if (f.type !== "date" || !(BUCKETS as readonly string[]).includes(bucket)) throw new HttpError(400, `Bad grouping "${g}"`);
        groupId[g.replace(":", "_")] = { $dateTrunc: { date: `$${k}`, unit: bucket, timezone: "Asia/Kolkata" } };
        columns.push({ key: g.replace(":", "_"), label: `${f.label} (${bucket})`, type: "date" });
      } else {
        groupId[k] = `$${k}`;
        columns.push({ key: k, label: f.label, type: f.type });
      }
    }
    const metrics = spec.metrics?.length ? spec.metrics : [{ op: "count" as const }];
    const acc: any = {};
    for (const m of metrics) {
      if (m.op === "count") {
        acc.count = { $sum: 1 };
        columns.push({ key: "count", label: "Count", type: "number" });
      } else {
        const f = field(m.field || "");
        if (f.type !== "number") throw new HttpError(400, `${m.op} needs a number field`);
        const key = `${m.op}_${f.key}`;
        acc[key] = { [`$${m.op}`]: `$${f.key}` };
        columns.push({ key, label: `${m.op.toUpperCase()} ${f.label}`, type: "number" });
      }
    }
    pipeline.push({ $group: { _id: groupId, ...acc } });
    const proj: any = { _id: 0 };
    for (const k of Object.keys(groupId)) proj[k] = `$_id.${k}`;
    for (const k of Object.keys(acc)) proj[k] = 1;
    pipeline.push({ $project: proj });
    const sortKey = spec.sort?.field && columns.some((c) => c.key === spec.sort!.field) ? spec.sort.field : Object.keys(groupId).find((k) => k.includes("_")) || "count";
    pipeline.push({ $sort: { [sortKey]: spec.sort?.dir === "asc" || (!spec.sort && sortKey.includes("_")) ? 1 : -1 } });
    pipeline.push({ $limit: max });
  } else {
    // ── row listing
    const cols = (spec.columns?.length ? spec.columns : ds.fields.slice(0, 8).map((f) => f.key)).filter((k) => (k === "company" ? allowCompany : true));
    columns = cols.map((k) => (k === "company" ? { key: "company", label: "Company", type: "string" as FType } : (({ key, label, type }) => ({ key, label, type }))(field(k))));
    const s = spec.sort && fieldMap.has(spec.sort.field) ? { [spec.sort.field]: spec.sort.dir === "asc" ? 1 : -1 } : { [ds.dateField]: -1 };
    pipeline.push({ $sort: s }, { $limit: max });
    const proj: any = { _id: 0 };
    for (const c of cols) proj[c === "company" ? "companyId" : c] = 1;
    pipeline.push({ $project: proj });
  }

  const rows: any[] = await ds.model.aggregate(pipeline).option({ maxTimeMS: 20_000, allowDiskUse: false });

  // company names for Super Admin reports
  if (allowCompany && columns.some((c) => c.key === "company")) {
    const ids = [...new Set(rows.map((r) => String(r.company ?? r.companyId)).filter(Boolean))];
    const cs = await Company.find({ _id: { $in: ids } }).select("name").lean<any[]>();
    const names = Object.fromEntries(cs.map((c) => [String(c._id), c.name]));
    for (const r of rows) {
      r.company = names[String(r.company ?? r.companyId)] || "—";
      delete r.companyId;
    }
  }
  return { title: spec.title || ds.label, dataset: ds.key, columns, rows, truncated: rows.length >= max, spec };
}

/** Excel / CSV of a report (same spec, up to 50k rows). */
export function toFile(report: { title: string; columns: { key: string; label: string; type: FType }[]; rows: any[] }, format: "xlsx" | "csv") {
  const data = report.rows.map((r) => {
    const o: Record<string, any> = {};
    for (const c of report.columns) {
      const v = r[c.key];
      o[c.label] = c.type === "date" && v ? new Date(v).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : Array.isArray(v) ? v.join(", ") : v ?? "";
    }
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: report.columns.map((c) => c.label) });
  if (format === "csv") return Buffer.from("﻿" + XLSX.utils.sheet_to_csv(ws), "utf8"); // BOM so Excel opens ₹ and Bengali correctly
  ws["!cols"] = report.columns.map((c) => ({ wch: Math.min(40, Math.max(12, c.label.length + 2)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " ") || "Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
