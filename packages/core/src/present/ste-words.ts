// The word data of the STE checker (T60). One data file: the words that ASD-STE100 does not approve,
// with the approved word, and the plan terms that the checker treats as technical names.
//
// Source and limits: the full ASD-STE100 dictionary (Issue 9) is not public. This list has 58
// entries. Each entry has a source:
// - "public": the entry is in a public excerpt of the STE rules or the dictionary (the ASD-STE100
//   page on Wikipedia, which gives "start" for "begin", "commence", "initiate" and "originate", and
//   dictionary excerpts that give "use" for "utilize").
// - "guidance": the entry is in common STE writing guidance, and the approved word is an STE
//   word. The official dictionary can give a different approved word for some of these entries.
// The checker finds only the words in this list. A word that is not in the list is not checked.

/** One word that STE does not approve. `forms` are other spellings or forms to find. */
export interface SteWord {
  word: string;
  use: string;
  source: 'public' | 'guidance';
  forms?: readonly string[];
}

export const STE_WORDS: readonly SteWord[] = [
  { word: 'utilize', use: 'use', source: 'public', forms: ['utilise', 'utilises', 'utilised', 'utilisation', 'utilization'] },
  { word: 'initiate', use: 'start', source: 'public' },
  { word: 'commence', use: 'start', source: 'public' },
  { word: 'begin', use: 'start', source: 'public', forms: ['begins', 'began', 'begun', 'beginning'] },
  { word: 'originate', use: 'start', source: 'public' },
  { word: 'ensure', use: 'make sure', source: 'guidance' },
  { word: 'terminate', use: 'stop', source: 'guidance' },
  { word: 'via', use: 'through', source: 'guidance' },
  { word: 'prior to', use: 'before', source: 'guidance' },
  { word: 'subsequent to', use: 'after', source: 'guidance' },
  { word: 'subsequently', use: 'then, or after', source: 'guidance' },
  { word: 'in order to', use: 'to', source: 'guidance' },
  { word: 'approximately', use: 'about', source: 'guidance' },
  { word: 'additional', use: 'more', source: 'guidance' },
  { word: 'accomplish', use: 'do', source: 'guidance' },
  { word: 'assist', use: 'help', source: 'guidance' },
  { word: 'attempt', use: 'try', source: 'guidance' },
  { word: 'comprehend', use: 'understand', source: 'guidance' },
  { word: 'demonstrate', use: 'show', source: 'guidance' },
  { word: 'illustrate', use: 'show', source: 'guidance' },
  { word: 'indicate', use: 'show', source: 'guidance' },
  { word: 'facilitate', use: 'help, or make easy', source: 'guidance' },
  { word: 'maintain', use: 'keep', source: 'guidance' },
  { word: 'retain', use: 'keep', source: 'guidance' },
  { word: 'modify', use: 'change', source: 'guidance', forms: ['modifies', 'modified', 'modifying', 'modification', 'modifications'] },
  { word: 'obtain', use: 'get', source: 'guidance' },
  { word: 'acquire', use: 'get', source: 'guidance' },
  { word: 'retrieve', use: 'get', source: 'guidance' },
  { word: 'perform', use: 'do', source: 'guidance' },
  { word: 'provide', use: 'give', source: 'guidance' },
  { word: 'purchase', use: 'buy', source: 'guidance' },
  { word: 'possess', use: 'have', source: 'guidance' },
  { word: 'proceed', use: 'continue, or go', source: 'guidance' },
  { word: 'sufficient', use: 'enough', source: 'guidance' },
  { word: 'insufficient', use: 'not enough', source: 'guidance' },
  { word: 'numerous', use: 'many', source: 'guidance' },
  { word: 'inform', use: 'tell', source: 'guidance' },
  { word: 'notify', use: 'tell', source: 'guidance', forms: ['notifies', 'notified', 'notifying', 'notification', 'notifications'] },
  { word: 'transmit', use: 'send', source: 'guidance', forms: ['transmits', 'transmitted', 'transmitting'] },
  { word: 'eliminate', use: 'remove', source: 'guidance' },
  { word: 'endeavor', use: 'try', source: 'guidance', forms: ['endeavour'] },
  { word: 'regarding', use: 'about', source: 'guidance' },
  { word: 'upon', use: 'on, or when', source: 'guidance' },
  { word: 'whilst', use: 'while', source: 'guidance' },
  { word: 'amongst', use: 'among', source: 'guidance' },
  { word: 'appropriate', use: 'correct, or applicable', source: 'guidance' },
  { word: 'relevant', use: 'applicable', source: 'guidance' },
  { word: 'adjacent', use: 'near, or next to', source: 'guidance' },
  { word: 'necessitate', use: 'make necessary', source: 'guidance' },
  { word: 'reside', use: 'be in', source: 'guidance' },
  { word: 'e.g.', use: 'for example', source: 'guidance' },
  { word: 'i.e.', use: 'that is', source: 'guidance' },
  { word: 'etc.', use: 'a full list', source: 'guidance' },
  { word: 'in addition', use: 'also', source: 'guidance' },
  { word: 'in the event that', use: 'if', source: 'guidance' },
  { word: 'a number of', use: 'some, or many', source: 'guidance' },
  { word: 'at this point in time', use: 'now', source: 'guidance' },
  { word: 'whether or not', use: 'if', source: 'guidance' },
];

/**
 * Words that end in "-ing" but are nouns or prepositions, not verb forms. STE approves some of these
 * (for example "warning", "during", "thing"). The checker does not report them.
 */
export const ING_NOUNS: readonly string[] = [
  'thing', 'nothing', 'something', 'anything', 'everything', 'string', 'during', 'ring', 'spring', 'ceiling',
  'warning', 'morning', 'evening', 'king', 'wing', 'bring', 'sing', 'swing', 'sting', 'ping', 'bing', 'ding',
  // A plan entity (Finding in entities.yaml): a noun.
  'finding',
  // A noun in the words of the owner (S25: "one clear meaning").
  'meaning',
];

/**
 * Plan terms that the product uses as technical names. STE lets a writer use an unapproved word when
 * it is a technical name, so the checker does not read these names. Each name is in the signed plan.
 * Limit: the checker masks these names in all positions. Thus it does not find a verb use, for
 * example "signing" in "Start signing the record".
 */
export const STE_TECHNICAL_NAMES: readonly string[] = [
  'sign-off', 'sign-offs', 'signoff', 'storyboard', 'storyboards', 'playlist', 'playlists', 'playback', 'Flow-Box',
  // The done state "done · seen working" and the Status column "What's missing" (R34, S23).
  'seen working', "what's missing", 'missing tests', 'missing test',
  // The git signing key of the owner (R26) and the recordings that Birdview keeps of a test run (R28).
  'signing key', 'signing', 'recording', 'recordings',
  // The UI page "Settings".
  'setting', 'settings',
];
