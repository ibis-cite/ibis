import { createRoot } from "react-dom/client";
import { App } from "./App";
import { galleryProvider, galleryStates } from "./gallery-fixtures";
import "./styles.css";
import "./gallery.css";

/** Separate evidence/dev entry: the normal production build omits this page. */
function Gallery() {
  return (
    <main className="gallery-catalog">
      <header>
        <h1>Picker states</h1>
        <p>Synthetic references for reviewing the picker. Open a state on its own to inspect it at full size.</p>
      </header>
      <div className="gallery-grid">
        {galleryStates.map((state) => (
          <section key={state.id} aria-label={state.label}>
            <h2><a href={`./gallery.html?state=${state.id}`}>{state.label}</a></h2>
            <iframe src={`./gallery.html?state=${state.id}`} title={state.label} tabIndex={-1} />
          </section>
        ))}
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root && (import.meta.env.DEV || import.meta.env.MODE === "evidence")) {
  const id = new URLSearchParams(window.location.search).get("state");
  const state = galleryStates.find((candidate) => candidate.id === id);
  if (state) {
    document.documentElement.dataset.galleryTheme = state.theme ?? "light";
    document.documentElement.dataset.gallerySize = state.largeText ? "large" : "normal";
    document.documentElement.dir = state.direction ?? "ltr";
    document.title = `${state.label} — Ibis picker states`;
    createRoot(root).render(<App {...galleryProvider(state)} />);
  } else {
    createRoot(root).render(<Gallery />);
  }
}
