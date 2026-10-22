import type { SearchResult } from "../../api";
import { pickerText, rowText } from "../../messages";

/** The highlighted search result's supplied metadata, without row truncation.
 * SearchResult already summarizes names/publications; this does not enrich
 * those fields or infer a saved selection or source path. */
export function ReferenceDetails({ reference }: { reference: SearchResult | null }) {
  if (!reference) return null;
  const type = rowText.itemType(reference.item_type);
  return <section className="reference-details" aria-label={pickerText.referenceDetails}>
    {type && <p className="reference-kind">{type}</p>}
    <h2><bdi dir="auto">{reference.title.trim() ? reference.title : reference.key}</bdi></h2>
    {reference.authors.trim() && <p dir="auto">{reference.authors}</p>}
    <p className="reference-publication">
      {reference.container?.trim() && <><bdi dir="auto">{reference.container}</bdi><span aria-hidden="true">{" · "}</span></>}
      <bdi>{reference.year ?? pickerText.noDate}</bdi>
    </p>
    <code dir="auto">{reference.key}</code>
  </section>;
}
