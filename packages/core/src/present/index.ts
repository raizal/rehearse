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
  type DeckFacts,
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
export { escapeXml, storyFlowSvg, wrapText } from './svg.js';
