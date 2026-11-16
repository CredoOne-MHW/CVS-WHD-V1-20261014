/**
 * The secret the platform and the build share.
 *
 * `/api/public/mobile/build` cannot sit behind a login — GitHub's runner calls it from outside — and it is
 * the endpoint that decides which file a company installs as its app. `/api/public/mobile/signing/:id` is
 * worse: it hands over a company's Android keystore. Both are therefore signed, and this is the key.
 *
 * It used to be an environment variable you had to invent and set. It is now made here, the first time it is
 * needed, and kept — the panel shows it, copies it, and can write it into GitHub for you. An environment
 * variable still wins where one is set, so nothing already configured changes.
 */
import { randomBytes } from "crypto";
import { PlatformSetting } from "../models";

const KEY = "mobile.buildSecret";
const env = (k: string) => (process.env[k] || "").trim();

let cached: string | null = null;

/** Where the value in use came from, which is what the panel tells you. */
export type SecretSource = "env" | "platform" | "none";

export async function buildSecret(): Promise<{ value: string; source: SecretSource }> {
  const fromEnv = env("MOBILE_BUILD_SECRET");
  if (fromEnv) return { value: fromEnv, source: "env" };
  if (cached) return { value: cached, source: "platform" };
  const row = await PlatformSetting.findById(KEY).lean<any>();
  const stored = row?.value?.secret;
  if (stored) {
    cached = stored;
    return { value: stored, source: "platform" };
  }
  return { value: "", source: "none" };
}

/** Makes one if there is none. Called before a build is dispatched, so a first build just works. */
export async function ensureBuildSecret(by = "system") {
  const now = await buildSecret();
  if (now.value) return now;
  const value = randomBytes(32).toString("hex");
  await PlatformSetting.updateOne({ _id: KEY }, { $set: { value: { secret: value, updatedBy: by, at: new Date() } } }, { upsert: true });
  cached = value;
  return { value, source: "platform" as SecretSource };
}

/**
 * Replaces it. Every build already running will fail to report back, which is why the screen says so before
 * it is pressed — and why it cannot replace a secret that came from the environment.
 */
export async function rotateBuildSecret(by: string) {
  if (env("MOBILE_BUILD_SECRET")) throw new Error("This secret comes from MOBILE_BUILD_SECRET in the environment. Change it there, or remove it to let the platform keep one.");
  const value = randomBytes(32).toString("hex");
  await PlatformSetting.updateOne({ _id: KEY }, { $set: { value: { secret: value, updatedBy: by, at: new Date() } } }, { upsert: true });
  cached = value;
  return value;
}

/** Forgets the copy held in memory, so another instance's change is picked up. */
export const forgetBuildSecret = () => {
  cached = null;
};
