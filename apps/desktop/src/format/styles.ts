// The bundled citation styles by id and title. Kept apart from the engine so
// the picker can list them without loading the engine or the style files.
export const STYLE_TITLES = {
  apa: "APA (7th edition)",
  "chicago-author-date": "Chicago (author-date)",
  "harvard-cite-them-right": "Harvard (Cite Them Right)",
  ieee: "IEEE",
  "modern-language-association": "MLA (9th edition)",
} as const;

export type StyleId = keyof typeof STYLE_TITLES;
