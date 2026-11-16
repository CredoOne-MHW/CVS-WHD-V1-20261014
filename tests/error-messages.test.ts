/**
 * What the error handler says for the failures a person can actually do something about.
 *
 * This exists because of a bug it would have caught: an image over the upload limit, and every refusal from
 * S3, came back as "Internal server error (ref …)". Neither is an internal fault — both are things somebody
 * can fix — and both were indistinguishable from a genuine crash.
 *
 *   npx tsx tests/error-messages.test.ts
 */
import { errorHandler, HttpError } from "../server/lib/http";

let fails = 0;

/** Runs one error through the handler and returns what the client would receive. */
function handle(err: any) {
  let status = 0;
  let body: any = null;
  const res: any = {
    locals: {},
    status(s: number) {
      status = s;
      return this;
    },
    json(b: any) {
      body = b;
      return this;
    },
  };
  errorHandler(err, { requestId: "abcdef123456" } as any, res, (() => {}) as any);
  return { status, error: String(body?.error || "") };
}

function check(name: string, got: any, want: { status: number; has: string }) {
  const ok = got.status === want.status && got.error.includes(want.has);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${got.status} ${JSON.stringify(got.error)}\n        want ${want.status} containing ${JSON.stringify(want.has)}`}`);
}

const multer = (code: string, extra: any = {}) => Object.assign(new Error(code), { name: "MulterError", code, ...extra });
const aws = (name: string) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: 403 } });

/* an upload that is too big is the user's to fix, not a crash */
check("file too large names the limit", handle(multer("LIMIT_FILE_SIZE", { limit: 8 * 1024 * 1024 })), { status: 400, has: "8 MB" });
check("file too large is not a 500", handle(multer("LIMIT_FILE_SIZE", { limit: 8 * 1024 * 1024 })), { status: 400, has: "too large" });
check("an unexpected field says so", handle(multer("LIMIT_UNEXPECTED_FILE", { field: "file" })), { status: 400, has: "file" });

/* every S3 refusal says which setting is wrong */
check("no such bucket", handle(aws("NoSuchBucket")), { status: 502, has: "S3_BUCKET" });
check("access denied names the permission", handle(aws("AccessDenied")), { status: 502, has: "s3:PutObject" });
check("bad key id", handle(aws("InvalidAccessKeyId")), { status: 502, has: "AWS_ACCESS_KEY_ID" });
check("bad secret", handle(aws("SignatureDoesNotMatch")), { status: 502, has: "AWS_SECRET_ACCESS_KEY" });
check("no credentials at all", handle(aws("CredentialsProviderError")), { status: 502, has: "AWS_ACCESS_KEY_ID" });

/* and everything else keeps behaving exactly as it did */
check("our own errors are untouched", handle(new HttpError(409, "S3 is turned off for this company")), { status: 409, has: "turned off" });
check("a duplicate key still says so", handle(Object.assign(new Error("dup"), { code: 11000, keyPattern: { code: 1 } })), { status: 409, has: "Duplicate value for code" });
check("a real crash is still a 500 with a ref", handle(new Error("cannot read properties of undefined")), { status: 500, has: "ref " });
check("a real crash does not leak its message", handle(new Error("secret internal detail")), { status: 500, has: "Internal server error" });

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
