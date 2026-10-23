"use client";
import { LegalPage, Contact } from "@/components/LegalPage";

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      {(p) => (
        <>
          <p>
            This policy explains how {p.legalName} (“we”) handles personal data in {p.product}, a lead management platform used by businesses (“companies”) to receive and follow up enquiries. It is written for the Digital Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules.
          </p>
          <h2>Who decides what happens to the data</h2>
          <p>Each company decides why and how it uses its own leads, and is the Data Fiduciary for them. We process that data on the company’s instructions. For the accounts of people who sign in to {p.product}, we are the Data Fiduciary.</p>
          <h2>What we collect</h2>
          <ul>
            <li>Leads a company receives: name, phone, WhatsApp number, email, city, the answers given on a form, and where the lead came from.</li>
            <li>When a company connects Facebook, Instagram, LinkedIn or Google: the Page, account or sheet names and IDs it picks, and an access token. We never see or store the platform password — sign-in happens on the platform’s own page.</li>
            <li>Sign-in and audit data for users of {p.product}: name, email, phone, IP address and activity logs.</li>
          </ul>
          <h2>Why we use it</h2>
          <ul>
            <li>To receive lead form submissions and create or update leads for the company.</li>
            <li>To list the Pages, ad accounts or sheets a company can connect, so it can choose.</li>
            <li>To keep the connection working (tokens are encrypted at rest and used only for these purposes).</li>
          </ul>
          <h2>Consent</h2>
          <p>
            Before a channel is connected, the person connecting it reads a notice listing these purposes and agrees with a clear action (nothing is pre-ticked). We record who agreed, when, from which IP address and the notice version{p.consentVersion ? ` (${p.consentVersion})` : ""}. Consent can be withdrawn at any time with <b>Disconnect</b> on the channel in Integration — the stored tokens are deleted immediately and no further data is fetched.
          </p>
          <h2>Sharing</h2>
          <p>We do not sell personal data. We share it only with service providers that run the platform (cloud hosting, database, file storage, WhatsApp/email delivery chosen by the company), under contract, and when the law requires.</p>
          <h2>Retention</h2>
          <p>Leads are kept while the company’s account is active or until the company deletes them. When a company account is deleted, its leads, tokens, files and logs are erased, except where the law requires us to keep records.</p>
          <h2>Your rights</h2>
          <p>You may ask for a summary of your data, correction, completion, updating or erasure, nominate someone to act for you, and raise a grievance. If you are a lead of one of our companies, you can contact that company or us; we will pass the request on and help it respond.</p>
          <h2>Security</h2>
          <p>Data is encrypted in transit (HTTPS) and secrets and tokens are encrypted at rest. Access is role-based and logged.</p>
          <h2>Contact and grievances</h2>
          <Contact p={p} />
          <p>
            We aim to respond within 7 days and resolve grievances within the time the DPDP Rules allow. If you are not satisfied, you may approach the Data Protection Board of India. See also <a href="/data-deletion">data deletion</a> and <a href="/terms">terms</a>.
          </p>
        </>
      )}
    </LegalPage>
  );
}
