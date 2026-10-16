import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge gate.
 *  - support.<company address> → the client support portal (any page path shows the portal)
 *  - /sa and /app without a session cookie → login. Real auth is enforced by the API on every call.
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") || req.headers.get("host") || "").split(",")[0].trim().toLowerCase();
  const path = req.nextUrl.pathname;
  if (host.startsWith("support.")) {
    if (path === "/support" || path.startsWith("/support/")) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = "/support";
    return NextResponse.rewrite(url);
  }
  if (/^\/(sa|app)(\/|$)/.test(path) && !req.cookies.get("lms_token")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
// pages only — never API calls, Next assets or files with an extension (images, manifest, service worker)
export const config = { matcher: ["/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)"] };
