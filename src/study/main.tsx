import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// The design system first (the typeface, the tokens, then the kit's
// components), so a screen's own stylesheet, loaded after it, only places
// the kit's pieces.
import "./styles/font.css";
import "./styles/tokens.css";
import "./styles/kit.css";
import StudyApp from "./StudyApp";
import "./study.css";

// The app is served at the root. A link from the days it lived under /study/
// (vercel.json redirects those; this covers the dev server) opens the same screen.
if (/^\/study(\/|$)/.test(location.pathname)) history.replaceState(null, "", `/${location.search}${location.hash}`);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StudyApp />
  </StrictMode>,
);
