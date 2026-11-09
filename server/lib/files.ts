import * as XLSX from "xlsx";
import AdmZip from "adm-zip";

/**
 * Parse an uploaded .xlsx / .csv into row objects keyed by header (lower-cased, trimmed).
 * Untrusted files are read with maintained parsers (ExcelJS, PapaParse) — the npm "xlsx" build has unfixed
 * prototype-pollution / ReDoS advisories, so it is only used for WRITING files we generate ourselves.
 * Legacy binary .xls isn't accepted (save it as .xlsx or .csv).
 */
export async function parseSheet(buf: Buffer, fileName: string): Promise<Record<string, any>[]> {
  const ext = fileName.toLowerCase().split(".").pop();
  let rows: Record<string, any>[] = [];
  if (ext === "csv") {
    const Papa = (await import("papaparse")).default;
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    rows = Papa.parse<Record<string, any>>(text, { header: true, skipEmptyLines: "greedy" }).data;
  } else if (ext === "xlsx") {
    rows = await xlsxRows(buf, 0);
  } else throw new Error("Only .xlsx or .csv files are supported (save .xls files as .xlsx)");
  return rows.map((r) => {
    const o: Record<string, any> = Object.create(null);
    for (const [k, v] of Object.entries(r)) {
      const key = String(k).toLowerCase().trim().replace(/[\s\-]+/g, "_");
      if (!key || key === "__proto__" || key === "constructor" || key === "prototype") continue;
      o[key] = typeof v === "string" ? v.trim() : v;
    }
    return { ...o };
  });
}

/** Rows of one worksheet (first row = headers), every cell as display text. */
async function xlsxRows(buf: Buffer, sheet: number) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets[sheet];
  if (!ws) return [];
  const headers: string[] = [];
  const out: Record<string, any>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    const vals = (row.values as any[]).slice(1).map((v) => cellText(v));
    if (n === 1) return void headers.push(...vals.map((v) => String(v)));
    if (vals.every((v) => v === "")) return;
    const o: Record<string, any> = {};
    headers.forEach((h, i) => h && (o[h] = vals[i] ?? ""));
    out.push(o);
  });
  return out;
}
function cellText(v: any): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") return String(v.text ?? v.result ?? (Array.isArray(v.richText) ? v.richText.map((t: any) => t.text).join("") : v.hyperlink ?? ""));
  return String(v);
}

/**
 * Import template — the same fields, in the same order, as the Add lead form, so a filled sheet maps one to one.
 * Extra columns in a user's own file are still accepted (import matches by column name and common aliases),
 * and files made from the older template keep working.
 */
export const LEAD_TEMPLATE_HEADERS = [
  "Name",
  "Company Name",
  "Status",
  "WhatsApp No",
  "Phone No",
  "Email ID",
  "Source",
  "Campaign",
  "Address",
  "Comments",
  "Service / product",
  "No of Licenses",
  "Medium",
  "Referral",
  "Consent WhatsApp (Y/N)",
];

/** One row per column: what it is, whether it is needed, an example — written to a second sheet of the .xlsx. */
const TEMPLATE_GUIDE: [string, string, string, string][] = [
  ["Name", "Recommended", "Riya Sen", "Person's name. Leave blank if you only have a number."],
  ["Company Name", "Optional", "Sunrise Diagnostics Pvt Ltd", "The business the lead represents."],
  ["Status", "Optional", "New", "One of the Lead statuses; blank becomes New."],
  ["WhatsApp No", "One of the three", "9876543210", "10 digits, no +91. Used to de-duplicate."],
  ["Phone No", "One of the three", "9876543210", "10 digits. Copied to WhatsApp No when that is blank."],
  ["Email ID", "One of the three", "riya@example.com", "Also used to de-duplicate."],
  ["Source", "Optional", "website_form", "Blank becomes the source chosen on the Import screen."],
  ["Campaign", "Optional", "Puja Health Camp", "Blank uses the Campaign typed on the Import screen."],
  ["Address", "Optional", "Salt Lake, Kolkata", ""],
  ["Comments", "Optional", "Full body checkup for parents", "Kept as the lead's comments."],
  ["Service / product", "Optional", "Full Body Checkup, Home Collection", "Must already exist in Service master. Separate several with a comma."],
  ["No of Licenses", "Optional", "1", "A single number for every service, or one per service: 2, 1"],
  ["Medium", "Optional", "cpc", ""],
  ["Referral", "Optional", "Dr. Bose", ""],
  ["Consent WhatsApp (Y/N)", "Optional", "Y", "Y records that the lead agreed to be contacted on WhatsApp."],
];

export function leadTemplateBuffer(format: "xlsx" | "csv") {
  const sample = [
    ["Riya Sen", "Sunrise Diagnostics Pvt Ltd", "New", "9876543210", "9876543210", "riya@example.com", "website_form", "Puja Health Camp", "Salt Lake, Kolkata", "Full body checkup for parents", "", "1", "cpc", "", "Y"],
    ["Arjun Pal", "", "Contact Attempted", "9876500002", "", "arjun@example.com", "referral", "", "Howrah", "Asked for a call back after 6 pm", "", "", "", "Dr. Bose", "N"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([LEAD_TEMPLATE_HEADERS, ...sample]);
  ws["!cols"] = LEAD_TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(14, Math.min(32, h.length + 6)) }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
  if (format === "xlsx") {
    const guide = XLSX.utils.aoa_to_sheet([["Column", "Needed", "Example", "Notes"], ...TEMPLATE_GUIDE.map((r) => [...r])]);
    guide["!cols"] = [{ wch: 24 }, { wch: 18 }, { wch: 34 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, guide, "How to fill");
  }
  return XLSX.write(wb, { type: "buffer", bookType: format }) as Buffer;
}

/** Text extraction for AI knowledge bases: txt, csv, json, xlsx, docx, pdf, zip (recursively). */
export async function extractText(buf: Buffer, fileName: string, depth = 0): Promise<string> {
  const ext = fileName.toLowerCase().split(".").pop() || "";
  if (["txt", "md", "json", "csv"].includes(ext)) return buf.toString("utf8");
  if (ext === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    return wb.worksheets
      .map((ws) => {
        const lines: string[] = [];
        ws.eachRow({ includeEmpty: false }, (row) => lines.push((row.values as any[]).slice(1).map((v) => cellText(v).replace(/[\n,]/g, " ")).join(",")));
        return `# ${ws.name}\n${lines.join("\n")}`;
      })
      .join("\n\n");
  }
  if (ext === "docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: buf })).value;
  }
  if (ext === "pdf") {
    const pdf = (await import("pdf-parse")).default;
    return (await pdf(buf)).text;
  }
  if (ext === "zip" && depth < 2) {
    const zip = new AdmZip(buf);
    const out: string[] = [];
    const entries = zip.getEntries();
    // zip-bomb guard: limited entries and uncompressed size
    if (entries.length > 200) throw new Error("Zip has too many files (max 200)");
    if (entries.reduce((a, e) => a + (e.header?.size || 0), 0) > 50 * 1024 * 1024) throw new Error("Zip is too large when unpacked (max 50 MB)");
    for (const e of entries) {
      if (e.isDirectory || e.entryName.startsWith("__MACOSX") || e.entryName.includes("..")) continue;
      const t = await extractText(e.getData(), e.entryName, depth + 1).catch(() => "");
      if (t) out.push(`## ${e.entryName}\n${t}`);
    }
    return out.join("\n\n");
  }
  return "";
}

export const KB_EXTENSIONS = ["csv", "xlsx", "zip", "txt", "json", "docx", "pdf", "md"];
