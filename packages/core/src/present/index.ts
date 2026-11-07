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
  type DeckBuildOptions,
  type GateFact,
  type GroupCard,
  type GroupLine,
  type ListItem,
  type MapColumn,
  type Mark,
  type ProgressRow,
  type ProgressStep,
  type Slide,
  type StepState,
  type StoryFacts,
  type TestState,
  storyView,
} from './deck.js';
export { deckHtml, SLIDE_H, SLIDE_W, type DeckAsset, type DeckAssets } from './html.js';
export { isSlideKey, NO_INPUTS, parsePresentation, PRESENTATION_FILE, readPresentation, SLIDE_KEYS, type PresentationInputs, type SlideKey } from './inputs.js';
export { downscalePng, MAX_DECK_IMAGE_WIDTH, pngSize, solidPng, type PngSize } from './png.js';
export { ID_PATTERN, plain, plainWordProblems, sentences, YAML_KEYS } from './plain.js';
export {
  DONE_RULE,
  DONE_WORDS,
  evidenceSlide,
  LEVEL_WORDS,
  levelWords,
  proofLevel,
  summarySentence,
  viewProofLevel,
  type ProofLevel,
  missingItems,
  missingThings,
  type Actor,
  type MissingItem,
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
export { areaCard, detailsSlide, doneAreas, MAX_GROUPS, MAX_LINES, MAX_PICTURES, nextSteps, notDoneGroups, notDoneReason, proofPictures, REASON_ORDER, reasonCard, summarySlides, type Area, type Reason, type ReasonGroup, type SummaryInput } from './summary.js';
export { boxEvidence, branchLine, BUILT_WORDS, builtWords, countsBuilt, decisionTokens, isSourceFile, NO_GRAPH, trailerPath, type BoxEvidence, type BranchLine, type BuiltState, type EvidenceInput, type GraphBuilds, type GraphCode, type TrailerCommit } from './built.js';
export { filterRows, missingLine, statusRow, statusSources, statusTable, statusText, type SignedState, type StatusFilter, type StatusRow, type StatusSources, type StatusTable } from './status.js';
