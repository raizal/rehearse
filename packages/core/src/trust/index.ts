// Trust core: story hash rule 2, stale detection, gate check, approval and sign-off writers, readiness,
// and the sign-off preview (T39).

export * from './types.js';
export { boxContent, servingBoxes, storyContentV2, storyHash, storyHashV2 } from './story-hash.js';
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
  previewContent,
  previewCounts,
  wordDiff,
  type ChangePart,
  type ContentChange,
  type PreviewBox,
  type PreviewBoxRelation,
  type PreviewCounts,
  type PreviewScenario,
  type StoryPreviewContent,
  type WordPart,
} from './signoff-preview.js';
export { HOW_TO_WORK, howToWorkMarkdown } from './how-to-work.js';
export {
  briefBoxPaths,
  briefSignState,
  MAX_BRIEF_CHARS,
  parseDecisionTexts,
  storyBuildBrief,
  storyChangeMessage,
  type BriefSignState,
  type BuildBrief,
  type BuildBriefOptions,
} from './build-brief.js';
export { APPROVE_FIRST, scenarioBoxes, scenarioStatuses, scenarioTestBrief, TEST_NAME_RULE, testBriefBoxPaths, testTitleLine, type TestBrief, type TestBriefOptions } from './test-brief.js';
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
  type BoxCode,
  type CodeCommit,
  type CodeCoverage,
  type CodeFunction,
  type CodeRef,
  type CodeStartOptions,
  type TestCodeOptions,
} from './code-start.js';
