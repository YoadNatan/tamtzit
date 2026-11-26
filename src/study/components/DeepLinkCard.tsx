import { useState } from "react";
import "../styles/sheets.css";

/* ── An upload's link opened without a member on the device (uploaded
 *    sheets, design-exams §5.12, OD14) ──
 * A WhatsApp link on an iPhone opens Safari, whose storage is not the
 * home-screen app's, so the link lands on the join screen. Above it, this
 * card says so and offers the two ways in: the app from its icon (an iPhone
 * cannot open the home-screen app from Safari: two lines say how to get to
 * the upload there), or signing in here with the personal code, after which
 * the address's upload opens (StudyApp's restore keeps ?v=exams&e=). Never
 * an empty list. */
export default function DeepLinkCard({ onCode }: { onCode?: () => void }) {
  const [how, setHow] = useState(false);
  return (
    <div className="a-callout join-deep" role="note">
      <b>הקישור נפתח בדפדפן, לא באפליקציה.</b>
      <button type="button" className="a-btn primary small" aria-expanded={how} onClick={() => setHow((h) => !h)}>
        לפתוח את תמצית מהאייקון במסך הבית
      </button>
      {how ? (
        <ol className="a-small join-deep-how">
          <li>לפתוח את תמצית מהאייקון שלה במסך הבית.</li>
          <li>בעמוד הקורס, ״מבחנים ותרגילים״, ושם המבחן או הדף.</li>
        </ol>
      ) : null}
      {onCode ? (
        <button type="button" className="a-btn small" onClick={onCode}>
          להמשיך כאן: כניסה עם הקוד האישי
        </button>
      ) : null}
      <span className="a-small a-muted">אין קוד אישי? הקישור הוא לחברי הקבוצה.</span>
    </div>
  );
}
