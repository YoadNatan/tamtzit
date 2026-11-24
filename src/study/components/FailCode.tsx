/* ── The code under an error line ──
 * Small and muted under a screen's error line, so a member's screenshot names
 * what failed (failText.ts failCode). The paragraph stays right to left, so
 * it starts under the line's start; the code itself runs left to right, in
 * English for a screen reader. Nothing for an empty code. */

export default function FailCode({ code }: { code: string }) {
  if (!code) return null;
  return (
    <p className="a-small a-muted a-fail-code">
      <bdi dir="ltr" lang="en">
        {code}
      </bdi>
    </p>
  );
}
