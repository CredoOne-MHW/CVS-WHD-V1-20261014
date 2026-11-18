/**
 * The navigation drawer, and the four ways a custom one goes wrong.
 *
 * Replacing a library's drawer with your own buys the look and takes on the library's responsibilities.
 * Each check below is one of those responsibilities, and each failure is silent in a way that a build does
 * not catch and a quick look at the app does not either:
 *
 *   1  **A hardcoded item list.** The classic. A screen is added to the navigator, nobody edits the drawer,
 *      and the screen is unreachable while the code declaring it looks perfectly correct.
 *   2  **An icon name that is not in the font.** Renders as a blank or a box. Nothing fails, nothing logs.
 *   3  **A width that is not actually narrower.** The whole point of the change; `screen − 64` looks like a
 *      sensible rule and is *wider* than the stock default on a large phone.
 *   4  **A hook below an early return.** Crashes with "rendered more hooks than during the previous render"
 *      only when the app moves from loading to signed-in — never on first paint, so it survives a glance.
 *
 *   npx tsx tests/drawer.test.ts
 */
import { readFileSync, existsSync } from "fs";

let fails = 0;
const ok = (name: string, cond: boolean, why = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !why ? "" : `\n        ${why}`}`);
};

const drawer = readFileSync("mobile/src/components/AppDrawer.tsx", "utf8");
const app = readFileSync("mobile/src/App.tsx", "utf8");

/* ---------------------------------------------------------------- 1 · items come from the navigator */

ok(
  "the drawer builds its items from the navigator's own routes",
  /state\.routes\.map/.test(drawer),
  "a hand-written list is how a newly added screen becomes unreachable without anything failing"
);
ok(
  "every group of routes is rendered, not just the first",
  /main\.map\(/.test(drawer) && /account\.map\(/.test(drawer),
  "splitting routes into groups must not drop one of the groups"
);
ok(
  "a screen with no icon mapped still gets one",
  /ICONS\[[^\]]+\]\s*\|\|\s*FALLBACK/.test(drawer),
  "without a fallback, an unmapped screen renders with an empty space where its icon should be"
);

/* the navigator and the drawer must agree that the drawer is in use at all */
ok(
  "the navigator is actually told to use it",
  /drawerContent=\{\(p\)\s*=>\s*<AppDrawer/.test(app),
  "the component can be perfect and still never render"
);
ok(
  "…and it is handed the signed-in user",
  /<AppDrawer\s*\{\.\.\.p\}\s*me=\{me\}/.test(app),
  "the header block shows who is signed in; without `me` it renders blank rather than failing"
);

/* ---------------------------------------------------------------- 2 · every glyph exists in the font */

const GLYPHS = "mobile/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
ok(
  "the Ionicons glyph map is available to check against",
  existsSync(GLYPHS),
  "run `npm ci` in mobile/ — the icon names cannot be verified without it, and an unchecked name ships blank"
);

if (existsSync(GLYPHS)) {
  const glyphs = JSON.parse(readFileSync(GLYPHS, "utf8"));

  /* names used in the icon table, in the fallback, and on any <Ionicons name="…"> written by hand */
  const table = drawer.slice(drawer.indexOf("const ICONS"), drawer.indexOf("const ACCOUNT"));
  const used = new Set<string>([
    ...[...table.matchAll(/"([a-z][a-z0-9-]+)"/g)].map((m) => m[1]),
    ...[...drawer.matchAll(/<Ionicons[^>]*name="([a-z][a-z0-9-]+)"/g)].map((m) => m[1]),
  ]);

  ok("some icon names were found to check", used.size > 0, "the extraction above matched nothing — fix it rather than pass");

  const missing = [...used].filter((n) => !(n in glyphs));
  ok(
    `every icon name exists in the font (${used.size} checked)`,
    missing.length === 0,
    `not in Ionicons: ${missing.join(", ")} — these render as a blank box on the device, silently`
  );

  /* the dependency itself, declared rather than inherited — the netinfo lesson, row 10 */
  const mpkg = JSON.parse(readFileSync("mobile/package.json", "utf8"));
  ok(
    "@expo/vector-icons is declared in mobile/package.json",
    !!mpkg.dependencies?.["@expo/vector-icons"],
    "it resolves today only because Expo happens to pull it in; a release that changes that breaks the bundle"
  );
  const lock = JSON.parse(readFileSync("mobile/package-lock.json", "utf8"));
  ok(
    "…and the lockfile agrees, so `npm ci` stays reproducible",
    lock.packages?.[""]?.dependencies?.["@expo/vector-icons"] === mpkg.dependencies["@expo/vector-icons"],
    "a package.json the lockfile does not match sends CI down the `npm install` fallback"
  );
}

/* ------------------------------------------------- 2b · the selected row matches the company's colour */

const theme = readFileSync("mobile/src/theme.ts", "utf8");
ok(
  "the selected row is tinted from the brand colour, not a literal",
  /const TINT = withAlpha\(T\.brand/.test(drawer) && !/rowOn: \{ backgroundColor: T\.tint \}/.test(drawer),
  "T.tint is a hardcoded rgba(47,92,36,…) — the default green — under a header that may be any colour"
);

/* withAlpha has no imports, so the real source can be evaluated rather than reimplemented here */
const fn = theme
  .slice(theme.indexOf("export const withAlpha"), theme.indexOf("/** The type scale."))
  .replace(/:\s*(string|number)\b/g, ""); // eval runs JavaScript, so the type annotations come off first
const withAlpha = eval(`(${fn.replace("export const withAlpha =", "").replace(/;\s*$/, "")})`) as (h: string, a: number) => string;
ok("withAlpha expands #rgb", withAlpha("#2f5c24", 0.1) === "rgba(47,92,36,0.1)", `got ${withAlpha("#2f5c24", 0.1)}`);
ok("withAlpha handles the short form", withAlpha("#28a", 0.5) === "rgba(34,136,170,0.5)", `got ${withAlpha("#28a", 0.5)}`);
ok(
  "withAlpha leaves anything it does not understand alone",
  withAlpha("rgba(1,2,3,0.4)", 0.2) === "rgba(1,2,3,0.4)" && withAlpha("", 0.2) === "",
  "a mangled colour string is worse than an unchanged one — React Native ignores or throws on it"
);

/* ---------------------------------------------------------------- 3 · the width is genuinely narrower */

const share = Number(/screenWidth \* ([\d.]+)/.exec(app)?.[1]);
const ceiling = Number(/Math\.min\(screenWidth \* [\d.]+, (\d+)\)/.exec(app)?.[1]);
ok("the drawer width rule is a proportion with a ceiling", share > 0 && ceiling > 0, "could not read the rule out of App.tsx");

if (share > 0 && ceiling > 0) {
  /** What React Navigation would have used: min(smaller axis − app bar, 280 phone / 320 tablet). */
  const stock = (w: number) => Math.min(w - 56, w >= 600 ? 320 : 280);
  const mine = (w: number) => Math.min(w * share, ceiling);
  const WIDTHS = [320, 360, 393, 412, 428, 768];

  ok(
    "it is never wider than the default it replaces",
    WIDTHS.every((w) => mine(w) <= stock(w)),
    WIDTHS.map((w) => `${w}: stock ${Math.round(stock(w))} vs ours ${Math.round(mine(w))}`).join("; ")
  );
  ok(
    "it always leaves at least 30% of the app visible",
    WIDTHS.every((w) => mine(w) / w <= 0.7 + 1e-9),
    "a panel with nothing visible beside it is the thing being fixed"
  );
  ok(
    "it is meaningfully narrower on the small screens where this was reported",
    stock(360) - mine(360) >= 20 && stock(320) - mine(320) >= 20,
    "a fixed subtraction takes a larger share the narrower the phone — that is the case that must improve"
  );
}

/* ---------------------------------------------------------------- 4 · hook order */

const hook = app.indexOf("useWindowDimensions()");
const firstReturn = app.search(/\n\s{2}if \(stage === /);
ok(
  "the width hook is read above the first early return",
  hook > 0 && firstReturn > 0 && hook < firstReturn,
  "a hook below an early return is skipped while loading and runs once signed in — React refuses to continue"
);

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
