import { NextResponse, type NextRequest } from "next/server";

/** Cheap edge gate: no session cookie → login. Real auth is enforced by the API on every call. */
export function middleware(req: NextRequest) {
  if (!req.cookies.get("lms_token")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}
export const config = { matcher: ["/sa/:path*", "/app/:path*"] };
