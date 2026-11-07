// Presentation mode (T52): an EPIC as a deck for a supervisor who is not technical.

export {
  GLOSSARY,
  presentationDeck,
  PROGRESS_STEPS,
  storyTitle,
  UNCOMMITTED_NOTICE,
  type Block,
  type CheckRow,
  type Deck,
  type DeckEvidence,
  type DeckFacts,
  type Link,
  type ProofRow,
  type RecapItem,
  type SignatureState,
  type StoryView,
  type TestRun,
  type GateFact,
  type ListItem,
  type MapColumn,
  type Mark,
  type ProgressRow,
  type ProgressStep,
  type Slide,
  type StepState,
  type StoryFacts,
  type TestState,
} from './deck.js';
export { deckHtml, SLIDE_H, SLIDE_W, type DeckAsset, type DeckAssets } from './html.js';
export { isSlideKey, NO_INPUTS, parsePresentation, PRESENTATION_FILE, readPresentation, SLIDE_KEYS, type PresentationInputs, type SlideKey } from './inputs.js';
export { downscalePng, MAX_DECK_IMAGE_WIDTH, pngSize, solidPng, type PngSize } from './png.js';
export { ID_PATTERN, plain, plainWordProblems, sentences, YAML_KEYS } from './plain.js';
export {
  DONE_RULE,
  DONE_WORDS,
  evidenceSlide,
  missingThings,
  NO_EVIDENCE,
  plainStep,
  proofRows,
  RECAP_MAX,
  RECAP_ROOMY,
  recapItem,
  recapSlides,
  shortDate,
  standing,
  standingSentence,
  storyDoneState,
  TRUST_SENTENCE,
  viewDoneState,
  type DoneInput,
  type DoneState,
  type ProofContext,
  type Standing,
} from './proof.js';
export { escapeXml, storyFlowSvg, wrapText } from './svg.js';
