import { Router } from "express";
import { z } from "zod";
import { can } from "../middleware/auth";
import { h, parse } from "../lib/http";
import { datasetsFor, runReport, toFile, specSchema } from "../lib/reports";
import { agenticReport } from "../lib/agentic";
import { rateLimit } from "../lib/cache";
import { HttpError } from "../lib/http";

/** DIY reports (both consoles) + Agentic reports (company). All read-only. */
export function reportRoutes(scope: "super" | "company") {
  const r = Router();

  r.get("/datasets", can("reports", "read"), h(async (req, res) => {
    res.json(datasetsFor(req.auth!));
  }));

  r.post("/run", can("reports:builder", "read"), h(async (req, res) => {
    res.locals.logRead = true;
    res.locals.action = "Run report";
    const rep = await runReport(req.auth!, req.body, { maxRows: 2000 });
    res.locals.item = rep.title;
    res.json(rep);
  }));

  r.post("/export", can("reports:export", "read"), h(async (req, res) => {
    const format = req.query.format === "csv" ? "csv" : "xlsx";
    const spec = parse(specSchema, req.body);
    const rep = await runReport(req.auth!, { ...spec, limit: 50000 }, { maxRows: 50000 });
    res.locals.logRead = true;
    res.locals.action = `Export ${format.toUpperCase()}`;
    res.locals.item = rep.title;
    const name = `${rep.title.replace(/[^\w\- ]+/g, "").trim() || "report"}-${new Date().toISOString().slice(0, 10)}.${format}`;
    res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
    res.send(toFile(rep, format));
  }));

  if (scope === "company") {
    r.post("/agentic", can("reports:ai", "read"), h(async (req, res) => {
      const b = parse(z.object({ agentId: z.string(), prompt: z.string().min(4).max(1500) }), req.body);
      if (!(await rateLimit(`agentic:${req.auth!.userId}`, 20, 60))) throw new HttpError(429, "Too many AI reports in a minute — wait a moment");
      res.locals.logRead = true;
      res.locals.action = "Agentic report";
      res.locals.item = b.prompt.slice(0, 80);
      res.json(await agenticReport(req.auth!, b.agentId, b.prompt));
    }));
  }
  return r;
}
