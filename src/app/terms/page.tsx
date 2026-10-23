"use client";
import { LegalPage, Contact } from "@/components/LegalPage";

export default function Terms() {
  return (
    <LegalPage title="Terms of Service">
      {(p) => (
        <>
          <p>These terms apply to businesses and their users who use {p.product}, provided by {p.legalName}.</p>
          <h2>Using the service</h2>
          <ul>
            <li>Use {p.product} only for lawful lead management, and only collect and contact people as the DPDP Act and the rules of each connected platform (Meta, LinkedIn, Google, WhatsApp) allow.</li>
            <li>Message people on WhatsApp, SMS or email only when they have agreed to hear from you.</li>
            <li>Keep your login safe; you are responsible for what happens under your account and your users’ accounts.</li>
          </ul>
          <h2>Connected channels</h2>
          <p>When you connect Facebook, Instagram, LinkedIn or Google, you authorise us to read the lead data of the Pages, accounts or sheets you pick, for your account only. You can disconnect at any time.</p>
          <h2>Your data</h2>
          <p>Your leads belong to you. We process them to provide the service, as described in the <a href="/privacy">Privacy Policy</a>.</p>
          <h2>Availability</h2>
          <p>We work to keep the service available and to retry deliveries that fail, but third-party platforms may change or limit their APIs at any time.</p>
          <h2>Contact</h2>
          <Contact p={p} />
        </>
      )}
    </LegalPage>
  );
}
