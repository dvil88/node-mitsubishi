/**
 * Small XML helpers for parsing Mitsubishi device responses without pulling in
 * a full XML parser dependency.
 */

/**
 * Return the text content of the root element, i.e. the equivalent of
 * ElementTree's `root.text`: the text between the root's opening tag and the
 * first child (or its closing tag). Returns `null` when there is no text.
 */
export function getRootText(xml: string): string | null {
    const noDecl = xml.replace(/<\?xml[^>]*\?>/, '');
    const open = noDecl.match(/<([A-Za-z0-9_:.-]+)(?:\s[^>]*)?>/);
    if (!open || open.index === undefined) {
        return null;
    }
    const rest = noDecl.slice(open.index + open[0].length);
    const lt = rest.indexOf('<');
    const text = lt === -1 ? rest : rest.slice(0, lt);
    return text.length > 0 ? text : null;
}

/** Text of the first `<tag>...</tag>` element (no nested children), or null. */
export function firstTagText(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1] : null;
}

/** Inner XML between the first `<tag ...>` and its matching `</tag>`, or null. */
export function tagInner(xml: string, tag: string): string | null {
    const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
    return m ? m[1] : null;
}

/** All `<VALUE>...</VALUE>` text nodes found in the given XML fragment. */
export function allValues(xml: string): string[] {
    return [...xml.matchAll(/<VALUE>([^<]+)<\/VALUE>/g)].map((m) => m[1]);
}
