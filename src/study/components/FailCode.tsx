/* ── The code under an error line ──
 * Small, muted and left to right under a screen's error line, so a member's
 * screenshot names what failed (failText.ts failCode). Nothing for an empty
 * code. */

export default function FailCode({ code }: { code: string }) {
  if (!code) return null;
  return (
    <p className="a-small a-muted a-fail-code" dir="ltr">
      {code}
    </p>
  );
}
