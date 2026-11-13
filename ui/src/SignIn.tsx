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
      <h1>Dining planner</h1>
      <p>Plan where to eat on your trip, on your phone and your laptop.</p>
      <a className="sign-in-button" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
        Sign in with Google
      </a>
      <p className="sign-in-note">We read your Google Calendar to see where you'll be. We never change it.</p>
      {error && <p role="alert">{reasons[error] ?? "Sign-in failed. Try again."}</p>}
    </section>
  );
}
