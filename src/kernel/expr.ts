/**
 * Safe arithmetic expression evaluator for document parameters.
 * Supports: numbers, parameter references, + - * / % ^, parentheses,
 * and functions (sin/cos/tan in degrees, sqrt, abs, min, max, floor, ceil, round).
 * No eval(), no property access — a small recursive-descent parser.
 */

import type { CadDocument, Expr, Parameter } from "./types";

const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: (d) => Math.sin((d * Math.PI) / 180),
  cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180),
  asin: (v) => (Math.asin(v) * 180) / Math.PI,
  acos: (v) => (Math.acos(v) * 180) / Math.PI,
  atan: (v) => (Math.atan(v) * 180) / Math.PI,
  sqrt: Math.sqrt,
  abs: Math.abs,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, PI: Math.PI };

type Token =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "op"; v: string };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        // allow exponent sign: 1.5e-3
        if ((src[j] === "e" || src[j] === "E") && (src[j + 1] === "+" || src[j + 1] === "-")) j++;
        j++;
      }
      const raw = src.slice(i, j);
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Invalid number "${raw}"`);
      tokens.push({ t: "num", v });
      i = j;
    } else if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      tokens.push({ t: "ident", v: src.slice(i, j) });
      i = j;
    } else if ("+-*/%^(),".includes(c)) {
      tokens.push({ t: "op", v: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}" in expression`);
    }
  }
  return tokens;
}

class Parser {
  private pos = 0;
  constructor(
    private tokens: Token[],
    private lookup: (name: string) => number,
  ) {}

  parse(): number {
    const v = this.parseAddSub();
    if (this.pos < this.tokens.length) throw new Error("Unexpected trailing tokens");
    return v;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eatOp(op: string): boolean {
    const t = this.peek();
    if (t && t.t === "op" && t.v === op) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseAddSub(): number {
    let v = this.parseMulDiv();
    for (;;) {
      if (this.eatOp("+")) v += this.parseMulDiv();
      else if (this.eatOp("-")) v -= this.parseMulDiv();
      else return v;
    }
  }

  private parseMulDiv(): number {
    let v = this.parsePower();
    for (;;) {
      if (this.eatOp("*")) v *= this.parsePower();
      else if (this.eatOp("/")) v /= this.parsePower();
      else if (this.eatOp("%")) v %= this.parsePower();
      else return v;
    }
  }

  private parsePower(): number {
    const base = this.parseUnary();
    if (this.eatOp("^")) return Math.pow(base, this.parsePower());
    return base;
  }

  private parseUnary(): number {
    if (this.eatOp("-")) return -this.parseUnary();
    if (this.eatOp("+")) return this.parseUnary();
    return this.parseAtom();
  }

  private parseAtom(): number {
    const t = this.peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.t === "num") {
      this.pos++;
      return t.v;
    }
    if (t.t === "op" && t.v === "(") {
      this.pos++;
      const v = this.parseAddSub();
      if (!this.eatOp(")")) throw new Error("Missing closing parenthesis");
      return v;
    }
    if (t.t === "ident") {
      this.pos++;
      if (this.eatOp("(")) {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`Unknown function "${t.v}"`);
        const args: number[] = [];
        if (!this.eatOp(")")) {
          do {
            args.push(this.parseAddSub());
          } while (this.eatOp(","));
          if (!this.eatOp(")")) throw new Error("Missing closing parenthesis in call");
        }
        return fn(...args);
      }
      if (t.v in CONSTANTS) return CONSTANTS[t.v];
      return this.lookup(t.v);
    }
    throw new Error(`Unexpected token "${"v" in t ? t.v : "?"}"`);
  }
}

/** Resolve all document parameters to numbers (parameters may reference earlier parameters). */
export function resolveParameters(params: Parameter[]): Record<string, number> {
  const resolved: Record<string, number> = {};
  const resolving = new Set<string>();

  const byName = new Map(params.map((p) => [p.name, p]));

  function valueOf(name: string): number {
    if (name in resolved) return resolved[name];
    const p = byName.get(name);
    if (!p) throw new Error(`Unknown parameter "${name}"`);
    if (resolving.has(name)) throw new Error(`Circular parameter reference at "${name}"`);
    resolving.add(name);
    const v = evalExprWith(p.expr, valueOf);
    resolving.delete(name);
    resolved[name] = v;
    return v;
  }

  for (const p of params) valueOf(p.name);
  return resolved;
}

function evalExprWith(expr: Expr, lookup: (name: string) => number): number {
  if (typeof expr === "number") {
    if (!Number.isFinite(expr)) throw new Error("Non-finite numeric value");
    return expr;
  }
  const v = new Parser(tokenize(expr), lookup).parse();
  if (!Number.isFinite(v)) throw new Error(`Expression "${expr}" is not finite`);
  return v;
}

/** Evaluate an expression against a resolved parameter table. */
export function evalExpr(expr: Expr, params: Record<string, number>): number {
  return evalExprWith(expr, (name) => {
    if (name in params) return params[name];
    throw new Error(`Unknown parameter "${name}"`);
  });
}

/** Convenience: evaluate against a document's parameters. */
export function evalDocExpr(expr: Expr, doc: CadDocument): number {
  return evalExpr(expr, resolveParameters(doc.parameters));
}
