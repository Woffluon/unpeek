import React from "react";

export type TokenType =
  | "comment"
  | "string"
  | "keyword"
  | "command"
  | "flag"
  | "variable"
  | "boolean"
  | "builtin-type"
  | "number"
  | "function"
  | "operator"
  | "punct"
  | "text";

export interface Token {
  type: TokenType;
  value: string;
}

export function tokenize(code: string, lang = "ts"): Token[] {
  const isBash =
    lang === "bash" || lang === "sh" || lang === "shell" || lang === "terminal";

  const tokenSpecs = isBash
    ? [
        { type: "comment" as const, regex: /#[^\r\n]*/y },
        { type: "string" as const, regex: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/y },
        { type: "flag" as const, regex: /--?[a-zA-Z0-9_-]+/y },
        { type: "variable" as const, regex: /\$[a-zA-Z0-9_{}]+/y },
        {
          type: "command" as const,
          regex: /\b(?:npx|npm|pnpm|yarn|bun|node|git|unpeek|mkdir|curl|sh|bash)\b/y,
        },
        { type: "number" as const, regex: /\b\d+\b/y },
        { type: "punct" as const, regex: /[|>&$;=]/y },
      ]
    : [
        { type: "comment" as const, regex: /\/\/[^\r\n]*|\/\*[\s\S]*?\*\//y },
        {
          type: "string" as const,
          regex: /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/y,
        },
        {
          type: "keyword" as const,
          regex:
            /\b(?:async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|instanceof|interface|let|new|of|package|private|protected|public|return|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/y,
        },
        { type: "boolean" as const, regex: /\b(?:true|false|null|undefined)\b/y },
        {
          type: "builtin-type" as const,
          regex:
            /\b(?:string|number|boolean|any|void|unknown|never|object|Array|Map|Set|Promise|Record)\b/y,
        },
        { type: "number" as const, regex: /\b0x[0-9a-fA-F]+\b|\b\d+(?:\.\d+)?\b/y },
        { type: "function" as const, regex: /\b[a-zA-Z_$][a-zA-Z0-9_$]*(?=\s*\()/y },
        {
          type: "operator" as const,
          regex:
            /=>|===|!==|==|!=|<=|>=|&&|\|\||\+\+|\-\-|\.\.\.|\+|\-|\*|\/|%|=|!|<|>|&|\||\^|~|\?|:/y,
        },
        { type: "punct" as const, regex: /[,;.{}[\]()]/y },
      ];

  const tokens: Token[] = [];
  let index = 0;
  const len = code.length;

  while (index < len) {
    let matched = false;
    for (const spec of tokenSpecs) {
      spec.regex.lastIndex = index;
      const m = spec.regex.exec(code);
      if (m && m.index === index) {
        tokens.push({ type: spec.type, value: m[0] });
        index += m[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const nextSpecial = code.slice(index).search(/[\s"'`#/=><!&|~^?%:;,.[\]()0-9-]/);
      if (nextSpecial === -1) {
        tokens.push({ type: "text", value: code.slice(index) });
        break;
      } else if (nextSpecial === 0) {
        tokens.push({ type: "text", value: code[index] });
        index++;
      } else {
        tokens.push({ type: "text", value: code.slice(index, index + nextSpecial) });
        index += nextSpecial;
      }
    }
  }

  return tokens;
}

export function tokenClass(type: TokenType): string {
  switch (type) {
    case "keyword":
    case "command":
      return "text-signal font-medium";
    case "flag":
      return "text-orange-400";
    case "string":
      return "text-[#d6cebe]";
    case "comment":
      return "text-carbon-text/45 italic";
    case "boolean":
      return "text-orange-400";
    case "builtin-type":
      return "text-carbon-text/70";
    case "number":
      return "text-orange-300";
    case "function":
      return "text-[#faf7f0] font-medium";
    case "variable":
      return "text-sky-300";
    case "operator":
      return "text-carbon-text/50";
    case "punct":
      return "text-carbon-text/40";
    case "text":
    default:
      return "text-carbon-text/90";
  }
}

export function HighlightedCode({
  code,
  language = "ts",
  className = "",
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const tokens = tokenize(code, language);

  return (
    <code className={className}>
      {tokens.map((token, idx) => (
        <span key={idx} className={tokenClass(token.type)}>
          {token.value}
        </span>
      ))}
    </code>
  );
}
