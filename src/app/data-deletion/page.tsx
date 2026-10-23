"use client";
import { LegalPage, Contact } from "@/components/LegalPage";

export default function DataDeletion() {
  return (
    <LegalPage title="Data Deletion">
      {(p) => (
        <>
          <p>You can remove the data {p.product} holds from Facebook, Instagram, LinkedIn or Google at any time.</p>
          <h2>If your business connected a channel</h2>
          <ol className="ml-5 list-decimal space-y-1.5">
            <li>Sign in to {p.product} and open <b>Integration</b>.</li>
            <li>Open the Facebook, Instagram, LinkedIn or Google Sheets connector and click <b>Disconnect</b>.</li>
            <li>The access tokens are deleted at once and the Pages are unsubscribed. Delete the connector as well to remove its settings.</li>
          </ol>
          <p>You can also remove the app on the platform: Facebook → Settings → Business integrations; LinkedIn → Settings → Data privacy → Permitted services; Google → myaccount.google.com/permissions.</p>
          <h2>If you submitted a lead form</h2>
          <p>Write to the business you submitted the form to, or to us, with the phone number or email you used. We will delete your data, or help the business do so, and confirm in writing.</p>
          <h2>Contact</h2>
          <Contact p={p} />
        </>
      )}
    </LegalPage>
  );
}
