/**
 * Take the "who is filling this in" field off an ops form and answer it from the sign-in.
 *
 * Every ops form marks that field `data-ops-who`. Once a form is only reachable through the
 * authenticated /forms proxy, the question is already answered before the page is drawn, so the
 * field is replaced with a hidden input of the same name carrying the signed-in person's name.
 * The form submits exactly the key it always submitted, which is why none of the 67 submit
 * workflows that read that key had to be touched — editing those was the one genuinely dangerous
 * part of this, since a bad edit there loses a booking rather than looking wrong.
 *
 * Every uncertainty is a skip. A field this cannot confidently take apart is left exactly as the
 * page drew it: the form still asks, which is where it started, and nothing is mangled.
 */

const MARK = "data-ops-who";

/** Index of the char after this tag's closing `>`, respecting quoted attribute values. */
function endOfTag(html: string, tagStart: number): number {
  let quote: string | null = null;
  for (let i = tagStart; i < html.length; i++) {
    const c = html[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === ">") {
      return i + 1;
    }
  }
  return -1;
}

function attr(tag: string, key: string): string | null {
  const m = new RegExp(`\\b${key}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

/** Is this offset inside a <script> or <style> block, where markup is not markup? */
function inRawTextElement(html: string, at: number): boolean {
  for (const tag of ["script", "style"]) {
    const open = new RegExp(`<${tag}\\b`, "gi");
    let m: RegExpExecArray | null;
    while ((m = open.exec(html))) {
      if (m.index > at) break;
      const close = html.toLowerCase().indexOf(`</${tag}`, m.index);
      if (close === -1 || close > at) return m.index < at;
    }
  }
  return false;
}

/** The `<div …>` enclosing `[from,to)` whose matching `</div>` closes after it, innermost first. */
function enclosingDiv(html: string, from: number, to: number): { start: number; end: number } | null {
  let search = from;
  for (let guard = 0; guard < 40; guard++) {
    const open = html.lastIndexOf("<div", search - 1);
    if (open < 0) return null;
    search = open;
    const afterOpen = endOfTag(html, open);
    if (afterOpen < 0 || afterOpen > from) continue;

    // Walk forward counting depth to find this div's own closing tag.
    let depth = 1;
    let i = afterOpen;
    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf("<div", i);
      const nextClose = html.indexOf("</div>", i);
      if (nextClose < 0) return null;
      if (nextOpen >= 0 && nextOpen < nextClose) { depth++; i = nextOpen + 4; }
      else { depth--; i = nextClose + 6; }
    }
    if (depth !== 0) return null;
    if (i >= to) return { start: open, end: i };
  }
  return null;
}

export type WhoFieldResult = { html: string; replaced: number; skipped: number };

export function replaceWhoField(html: string, name: string): WhoFieldResult {
  if (!name) return { html, replaced: 0, skipped: 0 };
  let out = html;
  let replaced = 0;
  let skipped = 0;
  let cursor = 0;

  for (let guard = 0; guard < 20; guard++) {
    const at = out.indexOf(MARK, cursor);
    if (at < 0) break;

    const tagStart = out.lastIndexOf("<", at);
    if (tagStart < 0) { cursor = at + MARK.length; skipped++; continue; }
    const tagEnd = endOfTag(out, tagStart);
    if (tagEnd < 0 || tagEnd < at) { cursor = at + MARK.length; skipped++; continue; }

    const tag = out.slice(tagStart, tagEnd);
    const isSelect = /^<select\b/i.test(tag);
    const isInput = /^<input\b/i.test(tag);
    if ((!isSelect && !isInput) || inRawTextElement(out, tagStart)) {
      cursor = at + MARK.length; skipped++; continue;
    }

    let elEnd = tagEnd;
    if (isSelect) {
      const close = out.toLowerCase().indexOf("</select>", tagEnd);
      if (close < 0) { cursor = at + MARK.length; skipped++; continue; }
      elEnd = close + "</select>".length;
    }

    const fieldName = attr(tag, "name");
    const fieldId = attr(tag, "id");
    if (!fieldName && !fieldId) { cursor = elEnd; skipped++; continue; }

    /* Walk outward taking any wrapper whose only control was this one.
     *
     * One level is not enough. On several forms the field is the sole occupant of its own card,
     * with a heading of its own — remove just the row and what is left is a card titled
     * "Added By *" containing nothing, which looks more broken than the question did. Stop at the
     * first wrapper that still holds something the person has to fill in. */
    let blockStart = tagStart;
    let blockEnd = elEnd;
    for (let level = 0; level < 4; level++) {
      const div = enclosingDiv(out, blockStart, blockEnd);
      if (!div) break;
      const inner = out.slice(div.start, div.end);
      const controls =
        (inner.match(/<input\b/gi) || []).length +
        (inner.match(/<select\b/gi) || []).length +
        (inner.match(/<textarea\b/gi) || []).length +
        (inner.match(/<button\b/gi) || []).length;
      if (controls !== 1) break;      // something else lives here; leave the wrapper standing
      blockStart = div.start;
      blockEnd = div.end;
    }
    /* A heading that only ever described this field goes with it.
     *
     * Where the card holds other fields too the card rightly stays — but its title does not:
     * "Who" heading a card whose only remaining content is a "Why" box reads like something
     * went wrong. Only titles that are purely this question are taken; a generic one like
     * "Request" is left alone, and every remaining field has its own label regardless, so
     * nothing is lost by dropping it. */
    const beforeBlock = out.slice(Math.max(0, blockStart - 200), blockStart);
    const titleMatch = /<div[^>]*class=["']?[^"'>]*section-title[^"'>]*["']?[^>]*>([^<]*(?:<span[^>]*>[^<]*<\/span>)?[^<]*)<\/div>\s*$/i.exec(beforeBlock);
    if (titleMatch) {
      const text = titleMatch[1].replace(/<[^>]*>/g, "").replace(/[*\s]+/g, " ").trim().toLowerCase();
      const purelyThisQuestion =
        // "Who", "Who is recording this" — but not "Who and what", which heads this field AND
        // another one, so dropping it would strand the other.
        (/^who\b/.test(text) && !/\band\b/.test(text)) ||
        /^your name$/.test(text) ||
        /^(logged|submitted|added|requested|reviewed|recorded|processed|updated|completed|handled|raised) by$/.test(text);
      if (purelyThisQuestion) {
        blockStart = Math.max(0, blockStart - 200) + titleMatch.index;
      }
    }

    if (blockStart === tagStart) {
      // No clean row: take an immediately preceding <label>…</label> with it if there is one.
      const labelClose = out.lastIndexOf("</label>", tagStart);
      if (labelClose > 0 && /^[\s]*(<script\b[^>]*>\s*<\/script>)?[\s]*$/i.test(
        out.slice(labelClose + "</label>".length, tagStart))) {
        const labelOpen = out.lastIndexOf("<label", labelClose);
        if (labelOpen >= 0) blockStart = labelOpen;
      }
    }

    const esc = (v: string) => v.replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const hidden =
      `<input type="hidden"` +
      (fieldName ? ` name="${esc(fieldName)}"` : "") +
      (fieldId ? ` id="${esc(fieldId)}"` : "") +
      ` value="${esc(name)}" data-ops-who-filled>`;

    out = out.slice(0, blockStart) + hidden + out.slice(blockEnd);
    cursor = blockStart + hidden.length;
    replaced++;
  }

  return { html: out, replaced, skipped };
}
