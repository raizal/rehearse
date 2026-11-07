export { buildEpicView, scenarioStatus, type EpicView, type ScenarioView, type SystemView } from './view.js';
export { createHandler, LISTEN_HOST, startServer, type RunningServer, type ServeOptions } from './http.js';
export { MAX_BODY_BYTES, TOKEN_HEADER } from './http.js';
export {
  compareVersions,
  desktopFigcraftVersion,
  expectedHash,
  FIGCRAFT_APPS,
  FIGCRAFT_LATEST_API,
  FIGCRAFT_RELEASES,
  FIGCRAFT_VERSION,
  FIGCRAFT_WEB_DIR,
  FigcraftFetchError,
  fetchFigcraftWeb,
  httpFetcher,
  installedFigcraftWeb,
  readZip,
  type FetchedFigcraft,
  type FetchFigcraftOptions,
  type Fetcher,
  type FigcraftFetchErrorKind,
  type ZipFile,
} from './figcraft-web.js';
export { buildStatus } from './status.js';
export { readGraphBuilds, repoFileReader, GRAPH_FILE } from './graph-built.js';
export { bbBirdviewConfig, brainstormIdea, buildDeckHtml, chromiumPrinter, deckFileName, deckSources, epicSlugOf, gatherDeckFacts, MAX_STILL_BYTES, NO_CHROMIUM, PrinterUnavailable, UncommittedError, UNIT_REPORT_FILE, type BuiltDeck, type DeckOptions, type DeckSourceOptions, type DeckSources, type DeckVideo, type Printer } from './present.js';
export { findBirdviewData, gitSpecAt, lastScreen, lastTraceFrame, mainCheckoutProject, NO_BIRDVIEW_DATA, processFfmpeg, readRecordings, readSavedResults, recordingOf, resultsFileOf, STILL_WIDTH, type BirdviewData, type Ffmpeg, type FindDataOptions, type ReadSavedOptions, type Recording, type SavedResults, type SavedRun, type SpecAt, type Still } from './saved-results.js';
export { globRegExp, NO_TEST_FILES, parseUnitReport, readTestPaths, readUnitReport, TEST_PATHS_FILE, unitCount, unitTestsOfEpic, UNIT_REPORT_UNREADABLE, UnitReportError, type EpicUnitTests, type TestPaths, type UnitReport, type UnitTest } from './unit-report.js';
export { MAX_ZIP_BYTES, writeZip, type ZipEntryIn } from './zip-write.js';
export { designView, linkPicture, FIGCRAFT_PATH, figcraftFetchCommand, MAX_DESIGN_BODY_BYTES, notFetchedPage, saveDesign, type DesignView, type LinkSource, type SaveResult } from './design-route.js';
export { FIGCRAFT_NOT_RUNNING, linkDesign, refreshDesignPictures, type LinkResult, type RefreshItem, type RefreshResult } from './design-link.js';
export { FIGCRAFT_CONTROL_HOST, FIGCRAFT_CONTROL_PORT, FigcraftNotRunning, isReadOnlyCall, listFigcraftDocs, renderFigcraftPng, type FigcraftControlAddress, type FigcraftDoc } from './figcraft-control.js';
export {
  createGraphService,
  DEBOUNCE_MS,
  graphServiceFor,
  realClock,
  repoRoot,
  watchedPath,
  watchFiles,
  type BoxesCoverage,
  type Clock,
  type CoverageQuery,
  type EdgeEnd,
  type FindAnswer,
  type GraphStatus,
  type FileWatcher,
  type GraphService,
  type GraphServiceOptions,
  type PanelAnswer,
  type PanelQuery,
  type WatchFiles,
  type WatchUpdate,
} from './graph-route.js';
/** The graph types the panel reads (S9), so the UI needs no dependency on @rehearse/graph. */
export type {
  AnswerEdge, AnswerNode, AstOutline, AstOutlineNode, CodeMap, CoverageAnswer, CoverageEntry, CoverageInfo, CoverageReport, CoverageStats, LineMark, NodeCoverage, TestRef, EdgeKind, MapBox, MapEdge, MapLevel, MapMember, MapNode, MapNodeKind, MapPlace, MapTotals, NodeKind, QueryAnswer, Trust,
} from '@rehearse/graph';
export { createSession, newToken, sessionInfo, tokenMatches, type ServerSession, type SessionInfo } from './session.js';
export { buildTrustedEpicView, type ApprovalView, type SignOffView, type TrustedEpicView } from './trust-view.js';
export {
  boxCode,
  codeIndex,
  EMPTY_TREE,
  epicBoxPaths,
  execGit,
  MAX_DIFF_LINES,
  type BoxCodeQuery,
  type BoxCodeResult,
  type BoxCodeSummary,
  type BoxCodeView,
  type BoxCommit,
  type CodeIndex,
  type GitResult,
  type GitRunner,
} from './box-code.js';
export { gatherBriefCode, guessWords, openGraphAccess, type BriefCode, type GatherOptions, type GraphAccess, type OpenGraph } from './brief-code.js';
export {
  capDiff,
  parseLog,
  parseNumstat,
  parseUnifiedDiff,
  trailerServes,
  type CappedDiff,
  type CommitRef,
  type DiffLine,
  type FileDiff,
  type FileStat,
  type Hunk,
  type LogCommit,
} from './git-parse.js';
export { parseSpawn, parseTell, parseThreadLog, parseThreadShow, statusWords, THREAD_ID, type BbThread, type ThreadMessage } from './bb-json.js';
export { bbProjectFrom, bbProjectResolver, findBbProject, matchProject, NO_BB_PROJECT, parseProjectList, type BbProjectEntry } from './bb-project.js';
export {
  briefPrompt,
  buildPrompt,
  composeMessage,
  createStoryThreads,
  earlierWork,
  parseFlowBoxLog,
  parseStoryThreads,
  parseTestThreads,
  processRunner,
  STORY_THREADS_FILE,
  StoryThreadError,
  spawnArgs,
  storyBrief,
  storyTestBrief,
  storyThreadsJson,
  exportNames,
  testFixtures,
  testsNeeded,
  testPrompt,
  testSendMessage,
  testTitle,
  withStoryThread,
  withTestThread,
  type BbState,
  type BuildState,
  type SpawnOptions,
  type StoryLink,
  type StoryThreads,
  type LinkedThread,
  type StoryThreadService,
  type EarlierWork,
  type RunResult,
  type Runner,
  type StoryBrief,
  type StoryThreadView,
  type TestLink,
  type TestThreads,
  type TestThreadView,
} from './story-thread.js';
export { createThreadMerge, listFiles, MergeConflictError, type BranchCommitSummary, type MergeDone, type MergeKind, type MergeSummary, type NewTest, type ThreadMergeOptions, type ThreadMergeService } from './thread-merge.js';
export {
  branchCommits,
  branchShas,
  epicGateItems,
  parseBranchLog,
  progressSummary,
  progressText,
  specTests,
  storyProgress,
  type BoxProgress,
  type BranchCommit,
  type GitCall,
  type ProgressInputs,
  type ProgressThread,
  type ScenarioProgress,
  type ScenarioTestState,
  type StoryProgress,
} from './story-progress.js';
export {
  activeProject,
  asProject,
  birdviewInfo,
  DEFAULT_BIRDVIEW_PORT,
  defaultProject,
  defaultPlaylistsDir,
  findTestProject,
  httpPlayerClient,
  parseSse,
  PLAYER_ACTIONS,
  PLAYER_HOST,
  playerView,
  readStoryPlaylist,
  sameProject,
  testKey,
  type BirdviewInfo,
  type BirdviewSetup,
  type PlayerAction,
  type PlayerClient,
  type PlayerProject,
  type PlayerReply,
  type PlayerView,
  type TestResult,
} from './birdview.js';
export { BIRDVIEW_BUSY, BIRDVIEW_NOT_RUNNING, BirdviewError, playAndWait, playStory, pushPlaylists, useProject, type BirdviewFailure, type PlayOutcome, type WaitOptions, type WaitResult } from './birdview-play.js';
export { epicPlaylists, storyPlaylist } from './story-playlist.js';
export { buildPlaylist, parsePlaylist, parseSpec, playlistJson, stepBox, storiesWithTests, type Playlist, type PlaylistBuild, type PlaylistTest, type SpecTest } from './playlist.js';
export { parseCorrectionLog, parseDecisions, type Correction, type CorrectionNote, type Decision } from './record-docs.js';
export { MAX_PREVIEW_STORIES, MAX_SIGNOFF_COMMITS, signOffPreview, type SignOffPreview, type SinceSignOff, type StorySignOffPreview } from './signoff-preview.js';
export { pickMainPath, type MainPathResult } from './review-main-path.js';
