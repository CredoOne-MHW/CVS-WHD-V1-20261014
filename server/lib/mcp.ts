import { assertPublicUrl } from "./net";
import { HttpError } from "./http";

/**
 * Minimal Model Context Protocol client (Streamable HTTP transport, JSON-RPC 2.0).
 * Works with hosted MCP servers such as Zapier MCP, Make, HubSpot, Pipedream, Composio, or your own.
 * Handles both plain JSON and text/event-stream responses, and the Mcp-Session-Id header.
 */
const PROTOCOL = "2025-06-18";

async function rpc(url: string, headers: Record<string, string>, body: any, timeoutMs: number) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const session = r.headers.get("mcp-session-id") || undefined;
  if (body.id === undefined) return { session, result: null }; // notification
  const ct = r.headers.get("content-type") || "";
  const text = await r.text();
  if (!r.ok) throw new HttpError(502, `MCP server returned ${r.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  let msg: any = null;
  if (ct.includes("text/event-stream")) {
    // take the JSON-RPC response with our id from the SSE stream
    for (const block of text.split(/\n\n+/)) {
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("\n");
      if (!data) continue;
      try {
        const j = JSON.parse(data);
        if (j.id === body.id) msg = j;
      } catch {}
    }
  } else {
    try {
      msg = JSON.parse(text);
    } catch {}
  }
  if (!msg) throw new HttpError(502, "MCP server sent an unreadable response");
  if (msg.error) throw new HttpError(502, `MCP error: ${msg.error.message || JSON.stringify(msg.error).slice(0, 200)}`);
  return { session, result: msg.result };
}

export async function mcpSession(serverUrl: string, token?: string, timeoutMs = 25_000) {
  await assertPublicUrl(serverUrl);
  const base: Record<string, string> = token ? { authorization: /^bearer /i.test(token) ? token : `Bearer ${token}` } : {};
  let id = 0;
  const init = await rpc(serverUrl, base, { jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "CredoOne LMS", version: "1.0" } } }, timeoutMs);
  const headers = { ...base, ...(init.session ? { "mcp-session-id": init.session } : {}), "mcp-protocol-version": init.result?.protocolVersion || PROTOCOL };
  await rpc(serverUrl, headers, { jsonrpc: "2.0", method: "notifications/initialized" }, timeoutMs).catch(() => undefined);
  return {
    server: init.result?.serverInfo,
    listTools: async () => (await rpc(serverUrl, headers, { jsonrpc: "2.0", id: ++id, method: "tools/list", params: {} }, timeoutMs)).result?.tools || [],
    callTool: async (name: string, args: any) => (await rpc(serverUrl, headers, { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args || {} } }, timeoutMs)).result,
  };
}

/** Pull the records out of a tools/call result: structuredContent, or JSON inside the text content. */
export function toolItems(result: any, itemsPath?: string): any[] {
  if (result?.isError) throw new HttpError(502, `MCP tool error: ${(result.content || []).map((c: any) => c.text).join(" ").slice(0, 300)}`);
  let data: any = result?.structuredContent;
  if (data == null) {
    const texts = (result?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text);
    for (const t of texts) {
      try {
        data = JSON.parse(t);
        break;
      } catch {}
    }
    if (data == null && texts.length) data = texts.map((t: string) => ({ comments: t }));
  }
  if (itemsPath) data = itemsPath.split(".").reduce((v: any, k) => (v == null ? undefined : v[k]), data);
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const arr = Object.values(data).find((v) => Array.isArray(v));
    return (arr as any[]) || [data];
  }
  return [];
}
