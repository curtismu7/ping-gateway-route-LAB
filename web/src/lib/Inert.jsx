import React from "react";

// Everything user-typed or server-echoed is rendered only as React text nodes (never innerHTML), so markup is shown, not run.
// Control and bidi characters are not rendered raw: each becomes a visible [U+XXXX] chip.
const HIDDEN = /([\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩])/;

export function reveal(text) {
  return String(text ?? "").split(HIDDEN).map((part, i) => (i % 2 ? { chip: `[U+${part.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}]` } : { text: part })).filter((p) => p.chip || p.text);
}

export function Inert({ text, block = false, mark = false, testid = "inert" }) {
  const Tag = block ? "pre" : "span";
  return (
    <Tag className={`inert${block ? " inert--block" : ""}`} data-testid={testid}>
      {reveal(text).map((p, i) => (p.chip ? <span key={i} className="chip" title="Invisible or look-alike character, shown instead of run">{p.chip}</span> : mark ? <mark key={i}>{p.text}</mark> : <React.Fragment key={i}>{p.text}</React.Fragment>))}
    </Tag>
  );
}

export const pretty = (v) => JSON.stringify(v, null, 2);
