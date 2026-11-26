import { SETS } from "../lib/setsCopy";

/* ── A set's link, opened signed out (practice sets, design §5.6) ──
 * A WhatsApp link on an iPhone opens Safari, whose storage is not the
 * home-screen app's: above Join, how a member reaches the set. The address
 * keeps the set (k), and the personal code's sign-in lands on it. */
export default function SetJoinNote() {
  return (
    <p className="a-callout quiet join-set" role="note">
      {SETS.set.signedOut}
    </p>
  );
}
