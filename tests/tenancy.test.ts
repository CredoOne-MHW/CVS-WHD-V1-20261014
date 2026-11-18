/**
 * A customer must never be able to read another customer's records.
 *
 * This is checked by reading the routes rather than by calling them, because the failure it guards against
 * is a *future edit*: someone adds `can("clients:tickets", "read")` to a customer endpoint, it looks right,
 * the tests pass, and every customer can read every other customer's support history. A permission answers
 * "may this kind of person read tickets" — which is the wrong question. The only safe scope is the client
 * on the sign-in itself.
 *
 *   npx tsx tests/tenancy.test.ts
 */
import { readFileSync } from "fs";

let fails = 0;
const ok = (name: string, cond: boolean, why = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !why ? "" : `\n        ${why}`}`);
};

const src = readFileSync("server/routes/co/home.ts", "utf8");

/** The handler body of one route, so each can be judged on its own. */
function handler(path: string, method = "get") {
  const start = src.indexOf(`r.${method}("${path}"`);
  if (start < 0) return "";
  // to the next route declaration, or the end
  const next = src.slice(start + 5).search(/\nr\.(get|post|put|patch|delete)\(/);
  return next < 0 ? src.slice(start) : src.slice(start, start + 5 + next);
}

const CUSTOMER_ROUTES: [string, string][] = [
  ["/home/customer", "get"],
  ["/my-tickets", "get"],
  ["/my-tickets", "post"],
];

for (const [path, method] of CUSTOMER_ROUTES) {
  const body = handler(path, method);
  ok(`${method.toUpperCase()} ${path} exists`, body.length > 0);
  if (!body) continue;

  ok(
    `${method.toUpperCase()} ${path} resolves the client from the sign-in`,
    /myClient\(req\)/.test(body),
    "it must call myClient(req), which refuses anything that is not a customer sign-in"
  );
  ok(
    `${method.toUpperCase()} ${path} is not gated by a permission instead`,
    !/\bcan\(/.test(body),
    "a permission says what kind of person may read tickets, not whose — that is the leak"
  );
  ok(
    `${method.toUpperCase()} ${path} never takes a client id from the request`,
    !/req\.(body|query|params)\s*\.\s*clientId/.test(body) && !/clientId:\s*(b|req)\./.test(body),
    "the client must come from the sign-in; accepting one lets a customer name somebody else's"
  );
}

/* myClient itself is the whole guard, so its three refusals are checked directly */
const guard = src.slice(src.indexOf("async function myClient"), src.indexOf("async function chatStats"));
ok("myClient refuses a staff sign-in", /kind !== "customer"/.test(guard));
ok("myClient refuses a customer with no client linked", /clientId \|\| req\.auth\.leadId/.test(guard) && /throw badRequest/.test(guard));
ok("myClient scopes its own lookup to the company", /tenant\(req\)/.test(guard));

/* and the queries it protects must use what it returned, not something off the request */
const list = handler("/my-tickets", "get");
ok("the ticket list is filtered by that client", /clientId:\s*client\._id/.test(list));
ok("…and by the company as well", /tenant\(req\)/.test(list));

/* the staff endpoint is the mirror image: it IS permission-gated, and must stay that way */
const staff = handler("/home/staff");
ok("the staff home is permission-gated", /can\("dashboard", "read"\)/.test(staff));
ok("…and never reaches the customer-only helper", !/myClient\(/.test(staff));

/* chat figures are per person, not per company — "12 unread" must mean twelve for *you* */
const chat = src.slice(src.indexOf("async function chatStats"), src.indexOf("The staff home screen"));
ok("chat figures are scoped to the person asking", /"members\.userId": userId/.test(chat));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
