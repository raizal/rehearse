// Trust core: story hash rule 2, stale detection, gate check, approval and sign-off writers, readiness,
// and the sign-off preview (T39).

export * from './types.js';
export { boxContent, changeContent, servingBoxes, storyContent, storyContentV2, storyContentV3, storyHash, storyHashV2, storyHashV3, withoutChanges } from './story-hash.js';
export { allScenarios, detectStale, epicStatus, scenarioTrust, signOffRule } from './stale.js';
export { findingStories, gateEpic, gateItems, gateRecord, simulationFindings, type GateCheck, type GateItem, type GateOptions, type Simulate } from './gate.js';
export { approveScenarios, currentIdentity, signOff, type ApproveResult, type SignOffResult, type WriteOptions } from './write.js';
export { CORRECTIONS_FILE, countCorrectionTags, parseCorrections, readiness } from './readiness.js';
export {
  signedReadiness,
  withSignatures,
  type ScenarioSig,
  type SignedProofReason,
  type SignedReadiness,
  type SignedReadinessRequirement,
  type SignedReadinessScenario,
  type SignedReadinessStory,
} from './signed-readiness.js';
export {
  ALLOWED_SIGNERS_FILE,
  allowedSignersPath,
  approvalPayload,
  defaultVerifier,
  gitSigner,
  keyFingerprint,
  parseKeyRef,
  sign,
  SIG_NAMESPACE,
  SigningError,
  signOffPayload,
  sshKeygen,
  sshSigner,
  sshVerifier,
  verify,
  type KeyRef,
  type SigCheck,
  type SignedApproval,
  type SignedSignOff,
  type Signer,
  type SignerResult,
  type SigStatus,
  type SshKeygen,
  type SshKeygenRun,
  type Verifier,
} from './signature.js';
export {
  checkSignatures,
  gateSigners,
  signatureItems,
  signersToText,
  type ApprovalSig,
  type GateSigner,
  type RecordSignatures,
  type SignedGateReport,
  type SignOffSig,
} from './evidence.js';
export {
  diffStoryContent,
  markChanges,
  previewContent,
  previewCounts,
  wordDiff,
  type ChangePart,
  type ContentChange,
  type PreviewBox,
  type PreviewBoxRelation,
  type PreviewChange,
  type PreviewCounts,
  type PreviewScenario,
  type StoryPreviewContent,
  type WordPart,
} from './signoff-preview.js';
export { DEFAULT_COMMANDS, HOW_TO_WORK, howToWorkLines, howToWorkMarkdown, PNPM_SETUP, repoCommands, type RepoCommands } from './how-to-work.js';
export {
  briefBoxPaths,
  briefSignState,
  MAX_BRIEF_CHARS,
  MIN_CODE_ROOM,
  parseDecisionTexts,
  storyBuildBrief,
  storyChangeMessage,
  type BriefSignState,
  type BuildBrief,
  type BuildBriefOptions,
} from './build-brief.js';
export { e2eStart, NOT_WRITTEN, specTestNames, testNameOf, type E2eStart, type E2eStartError, type E2eStartOptions } from './e2e-start.js';
export { APPROVE_FIRST, isUiScenario, mainPathScenario, MAX_TEST_BRIEF_CHARS, NOT_SHOWN, scenarioBoxes, scenarioStatuses, scenarioTestBrief, TEST_NAME_RULE, testBriefBoxPaths, testTitleLine, whereShown, type TestBrief, type TestBriefOptions, type TestFixture } from './test-brief.js';
export {
  CODE_START_HEADING,
  codeStartSection,
  coverageBadge,
  MAX_CODE_COMMITS,
  MAX_CODE_FUNCTIONS,
  MAX_CODE_GUESSES,
  MAX_CODE_NEIGHBOURS,
  MAX_CODE_SECTION_CHARS,
  MAX_E2E_HELPERS,
  MAX_TEST_BRIEF_FUNCTIONS,
  testCodeSection,
  TEST_NO_CODE,
  type BoxCode,
  type CodeCommit,
  type CodeCoverage,
  type CodeFunction,
  type CodeRef,
  type CodeStartOptions,
  type TestCodeOptions,
} from './code-start.js';
export { DESIGN_HEADING, designSection, FRAME_TAG_LINE, NO_DESIGN_LINE, type BriefDesign } from './design-section.js';
