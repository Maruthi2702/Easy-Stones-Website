import { Link } from 'react-router-dom';
import './PrivacyPage.css';

/**
 * The privacy policy Apple requires for the iOS app (App Store listing → Privacy
 * Policy URL: https://<site>/privacy). It states what the app and website really
 * do, as of 2026-11-19 — change it whenever what is collected changes (location
 * tracking: src/utils/locationTracking.ts). Have it read by whoever advises the
 * company on privacy before the app is submitted.
 */
export default function PrivacyPage() {
  return (
    <div className="privacy-page">
      <article className="privacy-body">
        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated November 19, 2026</p>
        <p>
          This policy explains what information the Easy Stones website and the Easy Stones app collect, why, who can see it and how long
          we keep it. The app is for Easy Stones staff and for suppliers we work with.
        </p>

        <h2>What we collect</h2>
        <ul>
          <li><b>Account details.</b> Your name, username or email, role, branch and (for suppliers) company and language. We keep your password only in a scrambled form.</li>
          <li><b>Work you enter.</b> Customer visits, notes, calendar entries, delivery records and signatures, receipts, and the photos and files you attach.</li>
          <li><b>Camera and photos.</b> Only the pictures you take or choose in the app, for example a slab tag, a receipt or a delivery photo. The app does not look at your photo library otherwise.</li>
          <li><b>Location while you use the app.</b> To show where you are on the route map and to note where a visit was logged.</li>
          <li><b>Location during work hours (staff roles that have it turned on).</b> If your role has location sharing, the app reads your phone’s location in the background between 7 AM and 6 PM on your branch’s time, on Mondays to Fridays and on a weekend day when you have a delivery or stop scheduled. It does not collect on a day you log Personal Time Off. You are asked to agree first, and we keep a record of when you agreed.</li>
          <li><b>Sign-in and device details.</b> When you sign in, when you were last active and basic device information such as your phone’s browser or app version.</li>
        </ul>

        <h2>Who can see it</h2>
        <ul>
          <li>Your location during work hours is visible to managers and directors responsible for your branch. Other staff and suppliers cannot see it.</li>
          <li>Suppliers see only their own purchase orders and photos. Staff see only the pages their role allows.</li>
          <li>We do not sell your information and we do not use it for advertising. The app does not track you across other companies’ apps or websites.</li>
        </ul>

        <h2>Services we use</h2>
        <p>
          We use trusted providers to run the service: cloud hosting and database services (including Amazon Web Services), file storage,
          email delivery, and Google Maps for maps and addresses. They process information for us and only to provide the service.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Location points are deleted automatically after 90 days.</li>
          <li>The record that you agreed to location sharing is kept as long as your account exists.</li>
          <li>Business records such as visits, deliveries and receipts are kept as long as the business needs them.</li>
        </ul>

        <h2>Your choices</h2>
        <ul>
          <li>You can turn location off for Easy Stones at any time in iPhone Settings. Location sharing then stops; tell your manager if you do.</li>
          <li>To ask about, correct or delete your information, contact us through our <Link to="/contact">Contact page</Link>.</li>
        </ul>

        <h2>Changes</h2>
        <p>If we change what we collect we will update this page, and ask you to agree again before collecting more location information.</p>
      </article>
    </div>
  );
}
