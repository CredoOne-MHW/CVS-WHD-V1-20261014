/**
 * Notifications: the chain from a message being sent to a banner appearing on somebody's phone.
 *
 * Every link is checked by reading the code, because every one of them fails *silently*. A phone with no
 * push token is simply never in the list. A message accepted by Expo and dropped by Firebase looks exactly
 * like a message nobody sent. There is nothing to see in a log, which is why these are asserted here.
 *
 *   npx tsx tests/push.test.ts
 */
import { readFileSync } from "fs";

let fails = 0;
const ok = (name: string, cond: boolean, why = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !why ? "" : `\n        ${why}`}`);
};

const chat = readFileSync("server/routes/co/chat.ts", "utf8");
const live = readFileSync("mobile/src/lib/live.ts", "utf8");
const app = readFileSync("mobile/src/App.tsx", "utf8");
const brand = readFileSync("mobile/scripts/brand.mjs", "utf8");
const wf = readFileSync(".github/workflows/build-mobile.yml", "utf8");
const creds = readFileSync("shared/storecreds.ts", "utf8");

/* ── 1 · the server sends one for every new message ───────────────────────────────────────────── */

const sends = [...chat.matchAll(/pushToUsers\(/g)].length;
ok("new messages push to the other members", sends >= 2, "both a text message and an attachment must notify");
ok("…to everybody except the sender", /others/.test(chat) && /String\(x\) !== id/.test(chat));
ok("…carrying the thread, so a tap can open it", /data:\s*\{\s*threadId/.test(chat));
ok("a group notification says who spoke", /t\.kind === "group" \? `\$\{name\}:/.test(chat));

/* ── 2 · any signed-in person can register their phone ────────────────────────────────────────── */

const reg = chat.slice(chat.indexOf('r.post("/chat/devices"'), chat.indexOf('r.delete("/chat/devices"'));
ok(
  "registering a device needs no module permission",
  !/can\("chats"/.test(reg),
  "it used to need Chats read, so customers — and any role without chat — could never register, and so received nothing at all"
);
ok("the token is still tied to the person asking", /req\.auth!\.userId/.test(reg));
ok("…and to their company", /req\.auth!\.companyId/.test(reg));

/* ── 3 · the phone can actually obtain a token, and act on a tap ──────────────────────────────── */

ok("the app asks for permission before registering", /requestPermissionsAsync/.test(live));
ok("Android gets a high-importance channel", /setNotificationChannelAsync/.test(live) && /AndroidImportance\.HIGH/.test(live));
ok("a tap is routed to what it was about", /addNotificationResponseReceivedListener/.test(live));
ok(
  "…including when the tap started the app",
  /getLastNotificationResponseAsync/.test(live),
  "the listener attaches after the response is gone, so a cold start needs the stored one"
);
ok("the app wires that to navigation", /onNotificationTap\(goTo\)/.test(app));
ok("…and holds a tap that arrives before the navigator is ready", /pendingTap/.test(app));
ok("the conversation on screen does not banner its own messages", /shouldShowAlert: !forThisScreen/.test(live));

/* ── 4 · the two credentials without which none of the above matters ──────────────────────────── */

ok("the Expo project id is asked for", /EXPO_PROJECT_ID/.test(creds));
ok("…Firebase's config too", /GOOGLE_SERVICES_JSON/.test(creds));
ok("the build puts the project id where the app reads it", /extra = \{ \.\.\.\(e\.extra \|\| \{\}\), eas: \{ projectId/.test(brand));
ok("the build points app.json at the Firebase file", /googleServicesFile/.test(brand));
ok("the workflow writes that file from its secret", /GOOGLE_SERVICES_JSON/.test(wf) && /base64 -d > google-services\.json/.test(wf));
ok("the workflow passes the project id through", /EXPO_PROJECT_ID: \$\{\{ secrets\.EXPO_PROJECT_ID \}\}/.test(wf));

/* a missing credential must say so loudly rather than produce a quiet build with no notifications */
ok("a build without the project id warns", /::warning::No EXPO_PROJECT_ID/.test(brand));
ok("a build without Firebase warns", /::warning::No google-services\.json/.test(brand));
ok("…and neither failure stops the build", !/process\.exit\(1\)[\s\S]{0,80}EXPO_PROJECT_ID/.test(brand));

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
