/**
 * No React hook may sit below an early return — anywhere in either app.
 *
 * This check already existed. It was added in v1.15.0, when a hook I put into `App.tsx` could have landed
 * under one, and it was written to look at `App.tsx`. Four days later the same fault was found in
 * `Chats.tsx`, where it had been sitting since v1.13.0, breaking the conversation list for everybody —
 * and the check that was supposed to be about exactly this said nothing, because it had been pointed at
 * one file instead of at the codebase.
 *
 * **A guard aimed at the place a bug happened, rather than at the mistake, only ever catches it once.**
 * That is the lesson this file exists to hold on to, so it reads every component in both apps.
 *
 * Why it matters: React identifies a hook by the order it was called in. A component that returns early
 * while it is loading runs the hooks above that return and no more. When the data lands, the render goes
 * further and reaches a hook that was not there before, so the count changes and React stops rather than
 * hand back the wrong state. It throws on the very render that was about to show the loaded screen — so
 * the screen opens, and then nothing on it works. The build is clean, the types are fine, and the first
 * render looks perfect, which is why this needs a machine to find it.
 *
 *   npx tsx tests/hooks.test.ts
 */
import { readFileSync, readdirSync, statSync } from "fs";

let fails = 0;
const ok = (name: string, cond: boolean, why = "") => {
  if (!cond) fails++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !why ? "" : `\n${why}`}`);
};

const walk = (dir: string): string[] => {
  const out: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = `${d}/${e}`;
      if (e === "node_modules" || e === ".next") continue;
      if (statSync(p).isDirectory()) go(p);
      else if (/\.tsx?$/.test(p)) out.push(p);
    }
  };
  try {
    go(dir);
  } catch {
    /* a directory that is not there is reported by the count check below */
  }
  return out;
};

/** Called at the top level of a component body — two spaces of indentation in this codebase. */
const HOOK =
  /^ {2}(const [\w{}[\], :]+ = )?(useState|useEffect|useCallback|useMemo|useRef|useLayoutEffect|useReducer|useContext|useWindowDimensions|useSafeAreaInsets|useRouter|useSearchParams|useParams|useNavigation|useRoute|useIsFocused)\s*[(<]/;
/** A return at that same level: the early exit a loading or empty state takes. */
const RETURN = /^ {2}(if\s*\(.*\)\s*)?return[\s(;]/;
const FUNC = /^(export )?(default )?(async )?function \w+|^(export )?const \w+\s*=\s*.*=>\s*\{|^(export )?default function/;

const files = [...walk("mobile/src"), ...walk("src")];
ok(`both apps were found and read (${files.length} files)`, files.length > 100, "a scan that reads nothing passes everything");

const offences: string[] = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split("\n");
  let returnedAt = -1;
  let inFunction = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* a new top-level function starts a new body, so the early return seen in the last one is behind us */
    if (FUNC.test(line)) {
      inFunction = true;
      returnedAt = -1;
      continue;
    }
    if (!inFunction) continue;

    if (RETURN.test(line)) {
      if (returnedAt < 0) returnedAt = i;
      continue;
    }
    /* `if (x)` on one line with its `return` on the next — how Prettier writes a longer condition */
    if (/^ {2}if\s*\(/.test(line) && / {4}return/.test(lines[i + 1] || "")) {
      if (returnedAt < 0) returnedAt = i;
      continue;
    }

    if (returnedAt >= 0 && HOOK.test(line)) {
      offences.push(
        `        ${file}:${i + 1}\n` +
          `          returns early at line ${returnedAt + 1}:  ${lines[returnedAt].trim().slice(0, 64)}\n` +
          `          hook below it:                 ${line.trim().slice(0, 64)}`
      );
      returnedAt = -1; // one report per return, rather than one per hook after it
    }
  }
}

ok(
  "no hook is called below an early return",
  offences.length === 0,
  `${offences.join("\n\n")}\n\n        Move the hook above the return and guard what it reads.\n` +
    "        React counts hooks and refuses to continue when the number changes between renders,\n" +
    "        so this throws on the render that was about to show the loaded screen."
);

/**
 * The scan has to be able to fail, or it is decoration. This is the shape that broke the chat list,
 * fed through the same matcher.
 */
const SPECIMEN = [
  "function Broken() {",
  "  const [rows, setRows] = useState(null);",
  "  if (rows === null)",
  "    return <Spinner />;",
  "  useEffect(() => {", // ← the fault
  "    setBadge(rows.length);",
  "  }, [rows]);",
  "}",
];
let caught = false;
let seenReturn = -1;
let active = false;
for (let i = 0; i < SPECIMEN.length; i++) {
  const l = SPECIMEN[i];
  if (FUNC.test(l)) {
    active = true;
    seenReturn = -1;
    continue;
  }
  if (!active) continue;
  if (RETURN.test(l)) {
    if (seenReturn < 0) seenReturn = i;
    continue;
  }
  if (/^ {2}if\s*\(/.test(l) && / {4}return/.test(SPECIMEN[i + 1] || "")) {
    if (seenReturn < 0) seenReturn = i;
    continue;
  }
  if (seenReturn >= 0 && HOOK.test(l)) caught = true;
}
ok("the scan catches the exact shape that broke the conversation list", caught, "the matcher no longer recognises the bug it was written for");

console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
