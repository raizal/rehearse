// Identifier words for the BM25 search (G2): getOrderById → get order by id; get_order_by_id too.

/** Lower-case words of an identifier, a path or a sentence, joined by one space. */
export function splitWords(text: string): string {
  return text
    // camelCase and PascalCase: getOrderById → get Order By Id; HTTPServer → HTTP Server
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    // snake_case, kebab-case, paths, dots and every other non-word character
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w !== '')
    .map((w) => w.toLowerCase())
    .join(' ');
}
