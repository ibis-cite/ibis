import { useEffect, useRef, useState } from "react";
import { referenceDetails, type RecordId, type ReferenceDetails } from "./api";

/** Render only text: metadata and URLs never become markup or network requests. */
export function Details({ id, version, close }: { id: RecordId; version: number; close: () => void }) {
  const [details, setDetails] = useState<ReferenceDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus(); }, []);
  useEffect(() => {
    let current = true;
    setDetails(null);
    setError(null);
    referenceDetails(id).then((data) => {
      if (current) setDetails(data);
    }).catch((reason: unknown) => {
      if (current) setError(String(reason));
    });
    return () => { current = false; };
  }, [id.source, id.native_key, version]);
  return (
    <section className="reference-details" aria-label="Reference details" aria-busy={!details && !error}>
      <div className="details-heading"><h2>Reference details</h2><button ref={closeButton} type="button" aria-label="Close details" onClick={close}>×</button></div>
      {error ? <p role="alert">Details unavailable: {error}</p> : details ? <>
        <h3>{details.title || "Untitled reference"}</h3>
        {details.abstract_text && <p className="abstract">{details.abstract_text}</p>}
        <dl>
          <dt>Authors</dt><dd>{details.authors || "Not recorded"}</dd>
          <dt>Year</dt><dd>{details.year ?? "Not recorded"}</dd>
          <dt>Type</dt><dd>{details.kind}</dd>
          {details.container && <><dt>Publication</dt><dd>{details.container}</dd></>}
          {details.doi && <><dt>DOI</dt><dd>{details.doi}</dd></>}
          {details.url && <><dt>URL</dt><dd>{details.url}</dd></>}
        </dl>
      </> : <p role="status">Loading details…</p>}
    </section>
  );
}
