import type { SearchResult } from "../../api";
import { pickerText, rowText } from "../../messages";

/** Full metadata for the highlighted reference in the wide citation pane.
 * No saved selection or source path is inferred from the highlighted row. */
export function ReferenceDetails({ reference }: { reference: SearchResult | null }) {
  if (!reference) return null;
  const type = rowText.itemType(reference.item_type);
  return <section className="reference-details" aria-label={pickerText.referenceDetails}>
    {type && <p className="reference-kind">{type}</p>}
    <h2><bdi dir="auto">{reference.title || reference.key}</bdi></h2>
    {reference.authors && <p dir="auto">{reference.authors}</p>}
    <p className="reference-publication">
      {reference.container && <><bdi dir="auto">{reference.container}</bdi><span aria-hidden="true">{" · "}</span></>}
      <bdi>{reference.year ?? pickerText.noDate}</bdi>
    </p>
    <code dir="auto">{reference.key}</code>
  </section>;
}
