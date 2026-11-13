import { ThemeStrip } from "./theme/motifs.js";
import "./sign-in.css";

const reasons: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  state: "That sign-in link expired. Try again.",
  token: "Google did not finish signing you in. Try again.",
};

/** The signed-out screen: one button to Google. */
export function SignIn() {
  const params = new URLSearchParams(location.search);
  const error = params.get("auth_error");
  params.delete("auth_error");
  const query = params.toString();
  const next = location.pathname + (query ? `?${query}` : "");
  return (
    <section className="sign-in">
      <ThemeStrip />
      <div className="sign-in-body">
        <div className="label sign-in-kicker">Where to eat, by trip</div>
        <h1 className="display">Wayfare</h1>
        <p>Plan where to eat on your trip, on your phone and your laptop.</p>
        <a className="btn btn-primary btn-lg btn-block" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
          Sign in with Google
        </a>
        <p className="muted sign-in-note">We read your Google Calendar to see where you'll be. We never change it.</p>
        {error && (
          <p role="alert" className="sign-in-error">
            {reasons[error] ?? "Sign-in failed. Try again."}
          </p>
        )}
      </div>
    </section>
  );
}
