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

export const LEAD_TEMPLATE_HEADERS = ["Name", "WhatsApp No", "Phone No", "Email", "Address", "Comments", "Source", "Campaign", "Medium", "Referral", "Status", "Consent WhatsApp (Y/N)"];

export function leadTemplateBuffer(format: "xlsx" | "csv") {
  const ws = XLSX.utils.aoa_to_sheet([
    LEAD_TEMPLATE_HEADERS,
    ["Riya Sen", "9876543210", "9876543210", "riya@example.com", "Salt Lake, Kolkata", "Full body checkup for parents", "website_form", "Puja Health Camp", "cpc", "", "New", "Y"],
  ]);
  ws["!cols"] = LEAD_TEMPLATE_HEADERS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Leads");
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
