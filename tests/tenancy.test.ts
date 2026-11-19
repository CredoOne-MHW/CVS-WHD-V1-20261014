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

/* ------------------------------------------------------------------------------------------------ *
 * A customer must not be able to find, or reach, another customer
 *
 * Two separate things, and only the second is security. Leaving a name out of a search result is a
 * courtesy: the ids are in the request, so anything that merely hid names could be walked straight past
 * by sending one. So every route that turns an id from the request into a conversation is checked here
 * too, not just the search.
 *
 * Read statically for the same reason as above: the failure this guards against is a future edit that
 * adds a fourth way to build a member list and forgets the refusal. Three existed already.
 * ------------------------------------------------------------------------------------------------ */

const chatSrc = readFileSync("server/routes/co/chat.ts", "utf8");

const route = (path: string, method = "get") => {
  const start = chatSrc.indexOf(`r.${method}("${path}"`);
  if (start < 0) return "";
  const next = chatSrc.slice(start + 5).search(/\nr\.(get|post|put|patch|delete)\(/);
  return next < 0 ? chatSrc.slice(start) : chatSrc.slice(start, start + 5 + next);
};

/* the company has always come from the session — the thing that must never regress */
const people = route("/chat/people");
ok(
  "the people directory takes its company from the session, never the request",
  /directory\(companyId/.test(people) &&
    /const \{ id, companyId \} = me\(req\)/.test(people) &&
    !/companyId:\s*(b|req)\.(body|query|params)/.test(chatSrc),
  "a company id accepted from the request is a cross-workspace leak, whatever else is filtered"
);

const dir = chatSrc.slice(chatSrc.indexOf("async function directory"), chatSrc.indexOf("const hiddenFromCustomer"));
ok("the directory can be asked for a customer's view of it", /forCustomer/.test(dir));
ok(
  "…and that view excludes customers",
  /find\.kind = \{ \$ne: "customer" \}/.test(dir),
  "\$ne rather than a list, so a user row written before the field existed still counts as staff"
);
ok(
  "the search passes the viewer's own kind",
  /const forCustomer = req\.auth!\.kind === "customer"/.test(people) && /directory\(companyId, forCustomer\)/.test(people),
  "a flag that is never passed is not a filter"
);
ok(
  "a customer still gets their own record back",
  /if \(!self && forCustomer\)/.test(people),
  "the customer filter removes the viewer from their own directory, so this would otherwise return null for them"
);

/* every route that makes a member out of an id in the request */
const DOORS: [string, string, string][] = [
  ["/chat/direct", "post", "hiddenFromCustomer(req.auth, other)"],
  ["/chat/groups", "post", 'req.auth!.kind === "customer"'],
  ["/chat/groups/:id", "put", 'req.auth!.kind === "customer"'],
];

for (const [path, method, needle] of DOORS) {
  const body = route(path, method);
  ok(`${method.toUpperCase()} ${path} exists`, body.length > 0);
  if (!body) continue;
  ok(
    `${method.toUpperCase()} ${path} refuses a customer naming another customer`,
    body.includes(needle),
    "the id is in the request, so hiding the name elsewhere stops nobody"
  );
  ok(
    `${method.toUpperCase()} ${path} reads the field it judges on`,
    /\.select\([^)]*kind/.test(body),
    "a guard on a field that was never selected is always undefined, and so never fires"
  );
}

/* the exhaustive half: no fourth door without a refusal */
/*
 * Five reads of the User collection exist in this file, and each is deliberate:
 *
 *   1  directory()            the search          — filtered for a customer
 *   2  POST /chat/direct      the other person    — refused if both are customers
 *   3  POST /chat/groups      the members         — refused if any other is a customer
 *   4  PUT  /chat/groups/:id  the members again   — same refusal
 *   5  POST /chat/notice      ids only, no names  — a send list, discloses nobody, staff-gated
 *   6  GET  /chat/people      the viewer's own record, by their own id — discloses them to themselves
 *
 * The count is asserted so that a sixth cannot appear unnoticed. If one is added, decide which of the
 * two shapes it is and update this list with it — the failure is the prompt to think, not a nuisance.
 */
const userQueries = [...chatSrc.matchAll(/User\.(find|findOne)\(/g)].length;
ok(
  "every way of looking a colleague up is accounted for",
  userQueries === 6,
  `${userQueries} User queries in chat.ts, 6 expected — see the list above this check.\n        ` +
    "A new one needs a kind filter or a refusal, and then this list updated — deliberately, not quietly."
);

/* the client and lead search is staff-only outright, whatever a role grid says */
const coSrc = readFileSync("server/routes/co/index.ts", "utf8");
const lookup = coSrc.slice(coSrc.indexOf('r.get("/people-lookup"'), coSrc.indexOf('r.get("/people-lookup"') + 1200);
ok(
  "the client and lead lookup refuses a customer outright",
  /req\.auth!\.kind === "customer"/.test(lookup) && /throw forbidden/.test(lookup),
  "this searches the company's book of business; a mis-ticked role box must not be the only thing in the way"
);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
