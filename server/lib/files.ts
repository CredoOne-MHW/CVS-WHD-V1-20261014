import * as XLSX from "xlsx";
import AdmZip from "adm-zip";

/** Parse .xlsx / .xls / .csv into row objects keyed by header (lower-cased, trimmed). */
export function parseSheet(buf: Buffer, fileName: string): Record<string, any>[] {
  const wb = XLSX.read(buf, { type: "buffer", raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "", raw: false });
  return rows.map((r) => {
    const o: Record<string, any> = {};
    for (const [k, v] of Object.entries(r)) o[k.toLowerCase().trim().replace(/[\s\-]+/g, "_")] = typeof v === "string" ? v.trim() : v;
    return o;
  });
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
  if (["xlsx", "xls"].includes(ext)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    return wb.SheetNames.map((n) => `# ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
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
    for (const e of zip.getEntries()) {
      if (e.isDirectory || e.entryName.startsWith("__MACOSX")) continue;
      const t = await extractText(e.getData(), e.entryName, depth + 1).catch(() => "");
      if (t) out.push(`## ${e.entryName}\n${t}`);
    }
    return out.join("\n\n");
  }
  return "";
}

export const KB_EXTENSIONS = ["csv", "xlsx", "xls", "zip", "txt", "json", "docx", "pdf", "md"];
