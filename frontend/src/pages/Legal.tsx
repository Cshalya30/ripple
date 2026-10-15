import { Link } from 'react-router-dom'
import { Logo } from '../components/Glyph'

function LegalFrame({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100%', padding: '24px 16px 64px' }}>
      <main style={{ width: 'min(720px, 100%)', margin: '0 auto' }}>
        <div style={{ marginBottom: 24 }}><Link to="/login" aria-label="Ripple, back to sign in"><Logo /></Link></div>
        <h1 className="h1">{title}</h1>
        <p className="small muted" style={{ marginTop: 6 }}>Last updated {updated}</p>
        <div className="stack legal" style={{ gap: 14, marginTop: 20 }}>{children}</div>
        <hr className="rule" style={{ margin: '28px 0 12px' }} />
        <nav className="small row-wrap" aria-label="Legal and sign in">
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/login">Sign in</Link>
        </nav>
      </main>
    </div>
  )
}

const H = ({ children }: { children: React.ReactNode }) => <h2 className="h2" style={{ marginTop: 10 }}>{children}</h2>

export function Privacy() {
  return (
    <LegalFrame title="Privacy" updated="15 October 2026">
      <p>Ripple is a forecasting tool for small businesses. This page says what it keeps, where your text goes, and for how long. It is written in plain words and is a summary for users, not legal advice. The team should have it checked against the Digital Personal Data Protection Act, 2023 before the app holds real customer data.</p>
      <H>What Ripple stores</H>
      <ul>
        <li>The business records you enter or import: customers, suppliers, bills, payments, orders, stock and settings.</li>
        <li>Your account: name, email address and a password stored only as a salted hash. Ripple never keeps your password itself.</li>
        <li>Your display choices (theme, text size, language) and, for each sign-in, the browser name your device sent and when the session started and ends.</li>
      </ul>
      <H>Cookies and similar storage</H>
      <p>Ripple sets one cookie, <span className="mono">ripple_session</span>. It keeps you signed in for up to 7 days, can only be read by the server, and is strictly necessary, so it does not need a consent banner. Your browser also keeps your theme and voice settings on your own device. Ripple uses no analytics, no advertising and no third-party trackers.</p>
      <H>Where your text goes</H>
      <ul>
        <li><b>Munim, the assistant, and Set up.</b> If the server is configured with an AI service, the question you type, the figures Munim looks up to answer it, and the business description you paste into Set up are sent to that service (Groq) to produce a reply. If no AI service is configured, Ripple answers from built-in templates and sends nothing out. Do not paste anything you would not want a service provider to process.</li>
        <li><b>Voice.</b> Speaking to Munim uses your browser&apos;s own speech recognition. In Chrome and Edge this sends the audio to the browser maker&apos;s speech service. Ripple itself never receives or stores the audio, only the text you confirm. Read-aloud runs on your device.</li>
      </ul>
      <H>How long it is kept</H>
      <p>A private demo business made with &quot;Open demo business&quot; is deleted after 24 hours. Your own business records stay until you remove them: Settings has a reset that erases the business data, and you can export everything first. Sign-in sessions end after 7 days or when you sign out.</p>
      <H>Who can see it</H>
      <p>Only people signed in to your business, and only what their role allows. A supervisor never receives any rupee amount. Server logs record the time, route and result of each request, not the contents of what you entered.</p>
      <H>Questions or removal</H>
      <p>Ask the person who set Ripple up for you, or the project team through the project repository, to remove an account or its records.</p>
    </LegalFrame>
  )
}

export function Terms() {
  return (
    <LegalFrame title="Terms of use" updated="15 October 2026">
      <p>By using Ripple you agree to these terms. They are short on purpose.</p>
      <H>Demo and synthetic data</H>
      <p>The demo business, Mahalakshmi Fabrics, is made-up data. Nothing in it is a real company, customer or payment. A private demo copy is deleted after 24 hours. The three shared demo accounts are for looking around and some actions on them, such as changing the team, are switched off.</p>
      <H>Forecasts are estimates</H>
      <p>Ripple projects cash, orders and payments from the records you give it and from assumptions about how customers usually pay. A forecast, a chance, a safe-to-spend figure or a suggested fix is an estimate, not a promise. Check anything important against your own books before you act on it.</p>
      <H>Not financial, legal or tax advice</H>
      <p>Ripple is not a financial adviser, accountant or lawyer. Offers such as early-payment discounts, invoice finance or supplier extensions use assumed terms shown next to each one and are indicative only. References to MSME payment rules, Income Tax Act sections 269ST and 40A(3) and similar are reminders. Check them with your CA.</p>
      <H>Messages</H>
      <p>Ripple writes message drafts and opens WhatsApp or email with the text filled in. It does not send anything on its own. You read it and choose to send.</p>
      <H>Acceptable use</H>
      <p>Do not try to break into other businesses&apos; records, overload the service, or use it to store data you have no right to hold. Accounts that do may be removed.</p>
      <H>No warranty</H>
      <p>Ripple is provided as it is, as a project and demonstration. It may be unavailable or change without notice.</p>
    </LegalFrame>
  )
}
