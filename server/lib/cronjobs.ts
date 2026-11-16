/**
 * One company's share of each background job.
 *
 * The cron routes in routes/public.ts walk the companies and call runJobForCompany() through runFor(), which
 * applies that company's own schedule (Super Admin › Company › Cron Jobs) and records the run. The same
 * function backs the tab's Run now button, so what the button does is exactly what the schedule does.
 *
 * Kept apart from the routes so a job can be run from anywhere without pulling in Express.
 */
import { Company, Connector, IntakeEvent, Lead, Webhook } from "../models";
import { inCompanyDb } from "./tenantdb";
import { applyRetention } from "./retention";
import { LOST_STATUS, WON_STATUS } from "../../shared/constants";

export async function runJobForCompany(job: string, company: any): Promise<any> {
  const cid = String(company._id);
  switch (job) {
    case "retry": {
      const { runEvent } = await import("./intake");
      return inCompanyDb(cid, async () => {
        const due = await IntakeEvent.find({ companyId: company._id, status: "failed", nextAttemptAt: { $lte: new Date() } }).limit(50).lean<any[]>();
        let ok = 0;
        for (const ev of due) {
          const c = await Connector.findById(ev.connectorId).lean();
          if (!c) continue;
          const r: any = await runEvent(c, ev._id, ev.payload);
          if (r.ok) ok++;
        }
        return { retried: due.length, ok };
      });
    }
    case "pull":
    case "pull_frequent": {
      const { runPullConnectors } = await import("./pull");
      return runPullConnectors(job === "pull" ? "daily" : "frequent", { companyId: company._id });
    }
    case "prospect": {
      const { prospectWorker } = await import("./prospect");
      return prospectWorker(30_000, { companyId: company._id });
    }
    case "insights": {
      const { scheduleInsights } = await import("./insights");
      return { queued: await scheduleInsights(new Date(), { companyId: company._id }) };
    }
    case "billing": {
      const { refreshBilling } = await import("./clients");
      await inCompanyDb(cid, () => refreshBilling(company._id, true));
      return { billing: "refreshed" };
    }
    case "followups": {
      const { fireEvent } = await import("./whatsapp");
      return inCompanyDb(cid, async () => {
        if (!company.whatsapp) return { sent: 0, reason: "no WhatsApp number" };
        if (!(await Webhook.exists({ scope: "company", companyId: company._id, event: "followup_digest", active: true }))) return { sent: 0, reason: "no active webhook" };
        const due = await Lead.find({ companyId: company._id, deletedAt: null, status: { $nin: [LOST_STATUS, WON_STATUS] }, $or: [{ status: "Follow-ups needed" }, { nextFollowUpAt: { $lte: new Date(Date.now() + 86400_000) } }] })
          .limit(40)
          .select("name phone status")
          .lean<any[]>();
        const fresh = await Lead.countDocuments({ companyId: company._id, deletedAt: null, status: "New" });
        if (!due.length && !fresh) return { sent: 0, reason: "nothing due" };
        const message = [`Good morning! ${company.name} lead digest:`, `• ${fresh} new lead(s) not yet contacted`, `• ${due.length} follow-up(s) due today`, "", ...due.map((l, i) => `${i + 1}. ${l.name || "—"} (${l.phone || ""}) – ${l.status}`)].join("\n");
        const r = await fireEvent("company", company._id, "followup_digest", { phone: company.whatsapp, name: company.contactPerson, company: company.name, message, params: { new: fresh, due: due.length } }, "cron");
        return { sent: r.sent, due: due.length, new: fresh };
      });
    }
    case "housekeeping": {
      const removed = await applyRetention(company);
      return { removed, total: Object.values(removed).reduce((a: number, n: any) => a + n, 0) };
    }
    case "jobs":
      return { note: "The job worker runs for the whole platform, not per company" };
    default:
      return { note: `No per-company work for ${job}` };
  }
}

/** Every active company, for the cron routes to walk. */
export const activeCompanies = () => Company.find({ deletedAt: null, status: "active" }).select("name code plan whatsapp contactPerson cron retention s3Enabled dbName").lean<any[]>();
