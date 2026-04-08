import { useState } from "react";

export function LoginPage({ onSubmit, error = "", loading = false }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  return (
    <div className="crm-loading-screen">
      <div className="app-shell" style={{ gridTemplateColumns: "1.1fr 0.9fr", gridTemplateRows: "1fr", gridTemplateAreas: "\"sidebar content\"" }}>
        <section className="sidebar" style={{ borderRight: "1px solid var(--line)" }}>
          <div className="brand">
            <div className="brand-mark">AI</div>
            <div>
              <h1>Ali CRM</h1>
              <span>Dealership command center</span>
            </div>
          </div>
          <div className="card">
            <p className="sub" style={{ marginTop: 0 }}>Automotive CRM</p>
            <h2 className="page-title">Close leads faster from a desk built for dealerships.</h2>
            <p className="sub">Track inbound shoppers, manage appointments, and move every opportunity from first touch to delivery with one live command center.</p>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {[
              ["Live Pipeline", "Every lead stage in one dark command view."],
              ["Desk Visibility", "See calls, notes, and lead ownership instantly."],
              ["Fast Follow-Up", "Work hot shoppers before they cool off."],
            ].map(([title, copy]) => (
              <div key={title} className="card">
                <h3>{title}</h3>
                <div className="tiny">{copy}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="content" style={{ padding: "32px" }}>
          <div className="card" style={{ maxWidth: "560px", margin: "40px auto" }}>
            <div className="chip green">Secure access</div>
            <h2 className="page-title" style={{ marginTop: "20px" }}>Sign in to Ali CRM</h2>
            <p className="sub">Managers and admins can review the full store pipeline. Sales users see only their assigned opportunities.</p>
            {error ? <div className="error-banner">{error}</div> : null}
            <form
              className="list"
              onSubmit={(event) => {
                event.preventDefault();
                onSubmit?.(email, password);
              }}
            >
              <label className="field">
                <span>Email</span>
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@dealership.com" autoComplete="username" required />
              </label>
              <label className="field">
                <span>Password</span>
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" autoComplete="current-password" required />
              </label>
              <button type="submit" className="cta" disabled={loading}>
                {loading ? "Signing in..." : "Enter dashboard"}
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
