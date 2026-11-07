// Rewrite design/links.yaml (T51, box `link-design`), pure: link a story, or a box of it, to a page
// (and optionally a frame) of a design file, or unlink it. The yaml document API keeps every comment,
// the order of the entries and the style of the ones not touched; a new link is one flow line
// `S16: { file: …, page: 13, frame: …, png: … }`, like the links the owner writes.

import { isMap, isScalar, parseDocument, YAMLMap, type Document, type Node, type Pair } from 'yaml';
import type { Id } from '../types.js';
import type { DesignLink } from './links.js';

/** The top of a links.yaml that does not exist yet. */
export const NEW_LINKS_HEADER = `# Which design page each story (and, optionally, a box of it) is built to (T50).
# Not part of the signed record: edit it freely, or link from a story's Design tab (T51).
epics: {}
`;

const LINK_KEYS = ['file', 'page', 'frame', 'png'] as const;

/** The link in key order, without empty keys. */
function linkObject(link: DesignLink): Record<string, string | number> {
  return { file: link.file, page: link.page, ...(link.frame !== undefined ? { frame: link.frame } : {}), ...(link.png !== undefined ? { png: link.png } : {}) };
}

const keyOf = (pair: Pair): unknown => (isScalar(pair.key) ? pair.key.value : pair.key);

/** The map under `key`, made (block style) when missing; a non-map value is replaced. */
function childMap(doc: Document, parent: YAMLMap, key: string): YAMLMap {
  const found = parent.get(key, true);
  if (isMap(found)) return found;
  const made = new YAMLMap(doc.schema);
  parent.set(key, made);
  return made;
}

/** A flow map node for a link, carrying over the comments of the node it replaces. */
function flowLink(doc: Document, link: DesignLink, old: unknown): Node {
  const node = doc.createNode(linkObject(link), { flow: true }) as Node;
  if (old && typeof old === 'object' && 'comment' in old) {
    const o = old as { comment?: string | null; commentBefore?: string | null };
    if (o.comment) node.comment = o.comment;
    if (o.commentBefore) node.commentBefore = o.commentBefore;
  }
  return node;
}

/** Set the link keys of a story map in place: link keys first in order, then the rest (boxes). Existing pairs keep their comments. */
function setLinkKeys(doc: Document, map: YAMLMap, link: DesignLink | null): void {
  const values = link ? linkObject(link) : {};
  const old = new Map(map.items.map((p) => [keyOf(p), p] as const));
  const head: Pair[] = [];
  for (const k of LINK_KEYS) {
    if (!(k in values)) continue;
    const pair = old.get(k);
    const value = doc.createNode(values[k]);
    if (pair) {
      pair.value = value;
      head.push(pair);
    } else head.push(doc.createPair(k, values[k]) as Pair);
  }
  const rest = map.items.filter((p) => !LINK_KEYS.includes(keyOf(p) as (typeof LINK_KEYS)[number]));
  map.items = [...head, ...rest];
}

/**
 * The new text of links.yaml with the story (or its box) linked to `link`, or unlinked when `link`
 * is null. `text` undefined: the file does not exist yet. Throws when the text is not valid YAML or
 * `epics` is not a map (the caller refuses before: validate says what is wrong).
 */
export function setDesignLink(text: string | undefined, slug: string, storyId: Id, box: string | undefined, link: DesignLink | null): string {
  const doc = parseDocument(text ?? NEW_LINKS_HEADER);
  if (doc.errors.length > 0) throw new Error(`design/links.yaml is not valid YAML: ${doc.errors[0]!.message.split('\n')[0]}`);
  if (!isMap(doc.contents)) {
    if (doc.contents !== null && !(isScalar(doc.contents) && doc.contents.value === null)) throw new Error('design/links.yaml must hold `epics:`, a map');
    doc.contents = new YAMLMap(doc.schema) as never;
  }
  const root = doc.contents as YAMLMap;
  const epicsNode = root.get('epics', true);
  if (epicsNode !== undefined && !isMap(epicsNode) && !(isScalar(epicsNode) && epicsNode.value === null)) throw new Error('`epics` in design/links.yaml must be a map');
  const epics = childMap(doc, root, 'epics');
  if (epics.flow && epics.items.length === 0) epics.flow = false;
  if (link === null && !epics.has(slug)) return text ?? '';
  const stories = childMap(doc, epics, slug);
  const entry = stories.get(storyId, true);

  if (box === undefined) {
    if (link) {
      if (isMap(entry) && (!entry.flow || entry.has('boxes'))) setLinkKeys(doc, entry, link);
      else stories.set(storyId, flowLink(doc, link, entry));
    } else if (isMap(entry)) {
      setLinkKeys(doc, entry, null);
      if (entry.items.length === 0) stories.delete(storyId);
    } else if (entry !== undefined) stories.delete(storyId);
  } else {
    let story: YAMLMap;
    if (isMap(entry)) story = entry;
    else {
      if (!link) return text ?? '';
      story = new YAMLMap(doc.schema);
      stories.set(storyId, story);
    }
    if (link) {
      story.flow = false;
      const boxes = childMap(doc, story, 'boxes');
      boxes.flow = false;
      boxes.set(box, flowLink(doc, link, boxes.get(box, true)));
    } else {
      const boxes = story.get('boxes', true);
      if (isMap(boxes)) {
        boxes.delete(box);
        if (boxes.items.length === 0) story.delete('boxes');
      }
      if (story.items.length === 0) stories.delete(storyId);
    }
  }
  if (stories.items.length === 0) epics.delete(slug);
  return doc.toString({ lineWidth: 0 });
}
