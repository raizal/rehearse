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
export { DEFAULT_COMMANDS, HOW_TO_WORK, howToWorkLines, howToWorkMarkdown, PNPM_SETUP, repoCommands, type RepoCommands } from './how-to-work.js';
export {
  briefSignState,
  parseDecisionTexts,
  storyBuildBrief,
  storyChangeMessage,
  type BriefSignState,
  type BuildBrief,
  type BuildBriefOptions,
} from './build-brief.js';
export { APPROVE_FIRST, isUiScenario, NOT_SHOWN, scenarioStatuses, scenarioTestBrief, TEST_NAME_RULE, testTitleLine, whereShown, type TestBrief, type TestBriefOptions, type TestFixture } from './test-brief.js';
