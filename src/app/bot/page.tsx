import type { Metadata } from "next";

export const metadata: Metadata = { title: "LeadHiveBot — our web reader", description: "What LeadHiveBot reads, how it behaves, and how to opt out." };

/** Linked from the crawler's user-agent (LeadHiveBot/1.0 (+…/bot)) so site owners can see what it does and opt out. */
export default function BotPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-ink-900">
      <h1 className="text-3xl font-bold">LeadHiveBot</h1>
      <p className="mt-4 text-ink-700">
        LeadHiveBot reads public pages that businesses on this platform list, or that a search engine returns for their keywords. It looks for people
        who publicly asked for a product or service, and the contact details those people published themselves.
      </p>
      <h2 className="mt-8 text-xl font-bold">How it behaves</h2>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-ink-700">
        <li>It obeys robots.txt, first for <code>LeadHiveBot</code>, then for <code>*</code>.</li>
        <li>It skips pages marked <code>noai</code> in a robots meta tag or the X-Robots-Tag header.</li>
        <li>It never signs in, never solves CAPTCHAs, and never rotates IP addresses.</li>
        <li>It waits at least one second between requests to a site, and reads at most five pages per site per run.</li>
        <li>It does not keep health, religious, financial or other sensitive details.</li>
      </ul>
      <h2 className="mt-8 text-xl font-bold">Opting out</h2>
      <p className="mt-3 text-ink-700">To block it from your site, add this to your robots.txt:</p>
      <pre className="mono mt-3 rounded-xl bg-[#0f1a0d] p-4 text-sm text-[#d7f0cc]">{"User-agent: LeadHiveBot\nDisallow: /"}</pre>
      <p className="mt-4 text-ink-700">
        If your details were collected and you want them removed, contact the business that reached out to you, or write to the operator of this
        platform.
      </p>
    </main>
  );
}
