import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
import { transformJavaScript } from '../src/ast/index.js';
import { applyStringVault } from '../src/ast/string-vault.js';
import { applySaltedStringVault } from '../src/ast/salted-vault.js';
import { generateCompactJs } from '../src/ast/codegen.js';
import {
  shannonEntropy,
  isSequentialAlphabet,
  looksLikeNaturalText,
  classifyPlaintextSecret,
  isLikelySecretLiteral,
  hasRegexSecretRun,
} from '../src/ast/secret-patterns.js';

function runCode<T = unknown>(code: string, sandbox: Record<string, unknown> = {}): T {
  const ctx = vm.createContext({
    Math,
    String,
    RegExp,
    Uint8Array,
    TextDecoder,
    Function,
    Array,
    Object,
    Number,
    Boolean,
    atob: globalThis.atob,
    Buffer,
    ...sandbox,
  });
  return vm.runInContext(code, ctx) as T;
}

function collectNewRegExpCalls(code: string): any[] {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const matches: any[] = [];
  walk.simple(ast, {
    NewExpression(node: any) {
      if (node.callee?.type === 'Identifier' && node.callee.name === 'RegExp') {
        matches.push(node);
      }
    },
  });
  return matches;
}

function collectRegexLiterals(code: string): string[] {
  const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
  const literals: string[] = [];
  walk.simple(ast, {
    Literal(node: any) {
      if (node.regex) {
        literals.push(`/${node.regex.pattern}/${node.regex.flags}`);
      }
    },
  });
  return literals;
}

describe('BLA Vault Hardening: secret-patterns, interpolated TemplateLiterals, and secret RegExps', () => {
  describe('secret-patterns classification and false-positive guards', () => {
    it('computes Shannon entropy accurately', () => {
      expect(shannonEntropy('')).toBe(0);
      expect(shannonEntropy('aaaaaaaaaa')).toBe(0);
      expect(shannonEntropy('5e884898da28047151d0e56f8dc62927')).toBeGreaterThan(3.5);
    });

    it('detects sequential alphabets while sparing random tokens', () => {
      expect(
        isSequentialAlphabet(
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        )
      ).toBe(true);
      expect(isSequentialAlphabet('0123456789abcdefghijklmnop')).toBe(true);
      expect(isSequentialAlphabet('abcdefg')).toBe(false);
      expect(isSequentialAlphabet('K7x9mQ2vP4nL8wR1tZ6yB3cF5hJ0sD')).toBe(false);
    });

    it('detects natural English prose and camelCase identifiers via bigram Z-score', () => {
      expect(looksLikeNaturalText('Invalid authentication credentials provided')).toBe(
        true
      );
      expect(looksLikeNaturalText('getUserAuthenticationTokenFromStorage')).toBe(true);
      expect(looksLikeNaturalText('components/auth/LoginForm')).toBe(true);
      expect(looksLikeNaturalText('K7x9mQ2vP4nL8wR1tZ6yB3cF5hJ0sD9qA')).toBe(false);
      expect(looksLikeNaturalText('ab12')).toBe(false);
    });

    it('classifies PEM headers, token prefixes, hex/base64 secrets, and high-entropy tokens', () => {
      expect(classifyPlaintextSecret('-----BEGIN RSA PRIVATE KEY-----')?.category).toBe(
        'pem-header'
      );
      expect(classifyPlaintextSecret('-----BEGIN PUBLIC KEY-----')?.category).toBe(
        'pem-header'
      );

      expect(
        classifyPlaintextSecret('sk_' + 'live_51N9x8K2abc123def456')?.category
      ).toBe('token-prefix');
      expect(
        classifyPlaintextSecret('ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6')?.category
      ).toBe('token-prefix');
      expect(
        classifyPlaintextSecret('AKIA' + 'IOSFODNN7EXAMPLE')?.category
      ).toBe('token-prefix');
      expect(
        classifyPlaintextSecret('AIza' + 'SyDaGmWKa4JsXZ-HjGw7ISLn_3namBGtQe0')?.category
      ).toBe('token-prefix');
      expect(
        classifyPlaintextSecret('FLAG{vault_hardened_2026}')?.category
      ).toBe('token-prefix');
      expect(
        classifyPlaintextSecret(
          'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'
        )?.category
      ).toBe('token-prefix');

      // 64-char SHA-256 hex digest
      expect(
        classifyPlaintextSecret(
          '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8'
        )?.category
      ).toBe('hex-or-base64');

      // Base64-like >= 28 chars with >= 15% digits/+/=/ and high entropy
      expect(
        classifyPlaintextSecret('K7x9mQ2vP4nL8wR1tZ6yB3cF5hJ0sD9qA8vX==')?.category
      ).toBe('hex-or-base64');

      // High-entropy token (20..512 chars, non-hex/non-base64 punctuation)
      expect(
        classifyPlaintextSecret('v9$K2#mQ8!pL4@wR7&zT1*xY5~nB6')?.category
      ).toBe('high-entropy');
      expect(isLikelySecretLiteral('v9$K2#mQ8!pL4@wR7&zT1*xY5~nB6')).toBe(true);
    });

    it('suppresses false positives on short strings, binary/WASM prefixes, paths, alphabets, and prose', () => {
      expect(classifyPlaintextSecret('short7')).toBeNull();
      expect(classifyPlaintextSecret('AGFzbQEAAAABBwFgAn9/AX8DAgEA')).toBeNull();
      expect(
        classifyPlaintextSecret('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==')
      ).toBeNull();
      expect(
        classifyPlaintextSecret('./chunks/a1b2c3d4e5f6a1b2c3d4e5f6.js')
      ).toBeNull();
      expect(classifyPlaintextSecret('@woffluon/internal-vault-runtime')).toBeNull();
      expect(
        classifyPlaintextSecret(
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
        )
      ).toBeNull();
      expect(classifyPlaintextSecret('getElementByIdFromDocument')).toBeNull();
      expect(classifyPlaintextSecret('AuthenticationFailedPleaseRetry')).toBeNull();
      expect(classifyPlaintextSecret('aaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
      expect(classifyPlaintextSecret('5e884898da28047151d0e56f8dc6292')).toBeNull(); // odd-length hex (31 chars)
    });

    it('detects secret runs inside regex patterns without tripping on ordinary regexes or char classes', () => {
      expect(
        hasRegexSecretRun(
          '^5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8$'
        )
      ).toBe(true);
      expect(hasRegexSecretRun('^sk_live_[0-9a-zA-Z]{24}$')).toBe(true);
      expect(hasRegexSecretRun('-----BEGIN\\s+PRIVATE KEY-----')).toBe(true);
      expect(hasRegexSecretRun('FLAG\\{secret_regex_1234\\}')).toBe(true);
      expect(hasRegexSecretRun('^(?:K7x9mQ2vP4nL8wR1tZ6yB3cF5hJ0sD9qA8vX==)$')).toBe(
        true
      );

      expect(
        hasRegexSecretRun(
          '^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=]{20,}$'
        )
      ).toBe(false);
      expect(hasRegexSecretRun('^[qwertyuiopasdfghjklzxcvbnm0123456789]+$')).toBe(
        false
      );
      expect(hasRegexSecretRun('^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$')).toBe(
        false
      );
      expect(hasRegexSecretRun('x'.repeat(4097))).toBe(false);
    });
  });

  describe('Interpolated TemplateLiteral static quasi vaulting', () => {
    const profiles = [
      { name: 'recommended', opts: { profile: 'recommended' as const, aggressive: false } },
      { name: 'strict', opts: { profile: 'strict' as const, aggressive: true } },
    ];

    for (const { name, opts } of profiles) {
      it(`${name}: encrypts static quasis, preserves TemplateLiteral structure & ToPrimitive("string") order`, () => {
        const source = `
          const formatWithProbe = (target) => \`prefix_secret_\${target}_suffix_secret\`;
          const nestedInterpolated = (flag, id) =>
            \`outer_secret_\${flag ? "branch_secret_one" : "branch_secret_two"}_\${id}_tail_secret\`;
          const shortAndEscaped = (mid) => \`\\n\${mid}_only_tail_secret\\t\`;
          const callLog = [];
          const probe = {
            toString() {
              callLog.push('toString');
              return 'STRING_REP';
            },
            valueOf() {
              callLog.push('valueOf');
              return 'VALUE_REP';
            }
          };
          globalThis.__res = {
            a: formatWithProbe(probe),
            b: nestedInterpolated(true, 42),
            c: shortAndEscaped('X'),
            calls: callLog.slice()
          };
        `;

        const result = transformJavaScript(source, {
          ...opts,
          seed: 0x4a5b6c7d,
          minStringLength: 4,
          injectRuntimeShield: false,
          ...(opts.profile === 'strict'
            ? { config: { critical: { maxFunctionsPerChunk: 0 } } }
            : {}),
        });

        expect(result.code).not.toContain('prefix_secret_');
        expect(result.code).not.toContain('_suffix_secret');
        expect(result.code).not.toContain('outer_secret_');
        expect(result.code).not.toContain('branch_secret_one');
        expect(result.code).not.toContain('branch_secret_two');
        expect(result.code).not.toContain('_tail_secret');

        // Output retains TemplateLiteral nodes with valid quasi/expression invariants
        const outAst = acorn.parse(result.code, {
          ecmaVersion: 'latest',
          sourceType: 'script',
        });
        let templateCount = 0;
        walk.simple(outAst, {
          TemplateLiteral(node: any) {
            templateCount++;
            expect(node.quasis.length).toBe(node.expressions.length + 1);
            for (let i = 0; i < node.quasis.length; i++) {
              expect(node.quasis[i].tail).toBe(i === node.quasis.length - 1);
            }
          },
        });
        expect(templateCount).toBeGreaterThanOrEqual(3);

        const globalThisMock: Record<string, any> = {};
        runCode(result.code, { globalThis: globalThisMock });
        expect(globalThisMock.__res).toEqual({
          a: 'prefix_secret_STRING_REP_suffix_secret',
          b: 'outer_secret_branch_secret_one_42_tail_secret',
          c: '\nX_only_tail_secret\t',
          calls: ['toString'],
        });
      });

      it(`${name}: exempts hot loops, tagged templates, dynamic imports, serialized workers, and RSC/bundler subtrees`, () => {
        const source = `
          function tag(strings, val) {
            return strings[0] + val + strings[1];
          }
          function runLoop(n) {
            const out = [];
            for (let i = 0; i < n; i++) {
              out.push(\`loop_plain_\${i}_end\`);
            }
            return out;
          }
          function runTagged(x) {
            return tag\`tagged_plain_\${x}_end\`;
          }
          function runImport(mod) {
            return import(\`./chunks/\${mod}_bundle.js\`);
          }
          const workerFn = function(x) {
            return \`worker_plain_\${x}_end\`;
          };
          const workerCode = workerFn.toString();
          (self.__next_f = self.__next_f || []).push([1, \`rsc_plain_\${"ok"}_end\`]);
          globalThis.__out = {
            loop: runLoop(2),
            tagged: runTagged(9),
            workerHasPlain: workerCode.includes('worker_plain_'),
          };
        `;

        const result = transformJavaScript(source, {
          ...opts,
          seed: 0x10203040,
          minStringLength: 4,
          injectRuntimeShield: false,
        });

        expect(result.code).toContain('loop_plain_');
        expect(result.code).toContain('tagged_plain_');
        expect(result.code).toContain('./chunks/');
        expect(result.code).toContain('worker_plain_');
        expect(result.code).toContain('rsc_plain_');

        const globalThisMock: Record<string, any> = {};
        runCode(result.code, {
          globalThis: globalThisMock,
          self: {},
        });
        expect(globalThisMock.__out).toEqual({
          loop: ['loop_plain_0_end', 'loop_plain_1_end'],
          tagged: 'tagged_plain_9_end',
          workerHasPlain: true,
        });
      });
    }

    it('respects direct hotExemptNodes across both applyStringVault and applySaltedStringVault', () => {
      const source = `
        function hotAnim(t) {
          return \`hot_anim_\${t}_frame\`;
        }
        function coldFmt(t) {
          return \`cold_secret_\${t}_value\`;
        }
      `;

      const ast1 = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
      applyStringVault(
        ast1,
        0x55667788,
        4,
        new WeakSet([ast1.body[0]]),
        undefined,
        undefined,
        undefined,
        undefined,
        false
      );
      const out1 = generateCompactJs(ast1);
      expect(out1).toContain('hot_anim_');
      expect(out1).not.toContain('cold_secret_');
      expect(out1).not.toContain('_value');
      expect(
        runCode<string>(`${out1}; coldFmt(7);`)
      ).toBe('cold_secret_7_value');

      const ast2 = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
      applySaltedStringVault(
        ast2,
        0x55667788,
        4,
        new WeakSet([ast2.body[0]]),
        undefined,
        undefined,
        undefined,
        undefined,
        false
      );
      const out2 = generateCompactJs(ast2);
      expect(out2).toContain('hot_anim_');
      expect(out2).not.toContain('cold_secret_');
      expect(out2).not.toContain('_value');
      expect(
        runCode<string>(`${out2}; coldFmt(7);`)
      ).toBe('cold_secret_7_value');
    });

    it('handles strict profile default (top-level & small functions), component _hX, shader quasis, and embedded secret RegExps', () => {
      const digest =
        '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
      const strictTopSource = `
        const format = (target) => \`strict_prefix_\${target}_strict_suffix\`;
        const callLog = [];
        const probe = {
          toString() {
            callLog.push('toString');
            return 'OK';
          },
          valueOf() {
            callLog.push('valueOf');
            return 'BAD';
          }
        };
        globalThis.__strictTop = {
          val: format(probe),
          calls: callLog.slice()
        };
      `;
      const strictRes = transformJavaScript(strictTopSource, {
        profile: 'strict',
        aggressive: true,
        seed: 0x33445566,
        minStringLength: 4,
        injectRuntimeShield: false,
      });
      expect(strictRes.code).not.toContain('strict_prefix_');
      expect(strictRes.code).not.toContain('_strict_suffix');
      const strictGlobal: Record<string, any> = {};
      runCode(strictRes.code, { globalThis: strictGlobal });
      expect(strictGlobal.__strictTop).toEqual({
        val: 'strict_prefix_OK_strict_suffix',
        calls: ['toString'],
      });

      const componentAndShaderSource = `
        function RenderCard(props) {
          return \`card_header_\${props.name}_card_footer\`;
        }
        function buildShader(r) {
          return \`@group(0) @binding(0) var<uniform> u: vec4f; @fragment fn main() -> @location(0) vec4f { return vec4f(\${r}, 0.0, 0.0, 1.0); }\`;
        }
        function withRegExpExpr(val) {
          return \`match_\${/^${digest}$/i.test(val)}_done\`;
        }
      `;
      const ast = acorn.parse(componentAndShaderSource, {
        ecmaVersion: 'latest',
        sourceType: 'script',
      }) as any;
      ast.body[0]._unpeekIsComponent = true;
      const res = applyStringVault(
        ast,
        0x778899aa,
        4,
        new WeakSet([ast.body[0]]),
        undefined,
        undefined,
        undefined,
        undefined,
        false
      );
      const out = generateCompactJs(ast);
      expect(res.shaderBuffersCount).toBe(1);
      expect(out).toContain('_hX(');
      expect(out).not.toContain('card_header_');
      expect(out).not.toContain('@group(0)');
      expect(out).not.toContain(digest);
      expect(
        runCode<string>(
          `${out}; [RenderCard({ name: 'Ada' }), buildShader('1.0'), withRegExpExpr('${digest.toUpperCase()}')].join('||');`
        )
      ).toBe(
        `card_header_Ada_card_footer||@group(0) @binding(0) var<uniform> u: vec4f; @fragment fn main() -> @location(0) vec4f { return vec4f(1.0, 0.0, 0.0, 1.0); }||match_true_done`
      );
    });

    it('works cleanly with fragmented vault mode in applyStringVault', () => {
      const source = `
        function buildBundle(x) {
          const a = "alpha_secret_one";
          const b = "bravo_secret_two";
          const c = "charlie_secret_three";
          const d = "delta_secret_four";
          const e = "echo_secret_five";
          const f = "foxtrot_secret_six";
          const g = \`golf_secret_\${x}_hotel_secret\`;
          return [a, b, c, d, e, f, g].join("|");
        }
      `;
      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
      applyStringVault(
        ast,
        0x99887766,
        4,
        undefined,
        undefined,
        undefined,
        undefined,
        { vault: { fragmented: true, fragmentCount: 2 } },
        false
      );
      const out = generateCompactJs(ast);
      expect(out).not.toContain('golf_secret_');
      expect(out).not.toContain('_hotel_secret');
      expect(runCode<string>(`${out}; buildBundle(99);`)).toBe(
        'alpha_secret_one|bravo_secret_two|charlie_secret_three|delta_secret_four|echo_secret_five|foxtrot_secret_six|golf_secret_99_hotel_secret'
      );
    });
  });

  describe('Secret-carrying RegExp literal vaulting', () => {
    const profiles = [
      { name: 'recommended', opts: { profile: 'recommended' as const, aggressive: false } },
      { name: 'strict', opts: { profile: 'strict' as const, aggressive: true } },
    ];

    for (const { name, opts } of profiles) {
      it(`${name}: converts secret RegExp literals to new RegExp(..., flags) and leaves ordinary/shadowed RegExps intact`, () => {
        const digest =
          '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
        const stripePrefix = 'sk_' + 'live_998877665544332211';

        const source = `
          function verifyDigest(input) {
            return /^${digest}$/i.test(input);
          }
          function matchStripe(input) {
            return /${stripePrefix}/.test(input);
          }
          function matchEmail(input) {
            return /^[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i.test(input);
          }
          function shadowedParam(RegExp, input) {
            return /${stripePrefix}/.test(input);
          }
          function shadowedVar(input) {
            var r = /${stripePrefix}/.test(input);
            var RegExp = function() { return { test: function() { return false; } }; };
            return r;
          }
          function hotLoopRegex(items) {
            let count = 0;
            for (let i = 0; i < items.length; i++) {
              if (/${stripePrefix}/.test(items[i])) count++;
            }
            return count;
          }
          globalThis.__reOut = {
            digestMatch: verifyDigest('${digest.toUpperCase()}'),
            digestMiss: verifyDigest('wrong'),
            stripeMatch: matchStripe('${stripePrefix}'),
            emailMatch: matchEmail('user@example.com'),
            shadowParam: shadowedParam(function() {}, '${stripePrefix}'),
            shadowVar: shadowedVar('${stripePrefix}'),
            hotCount: hotLoopRegex(['nope', '${stripePrefix}'])
          };
        `;

        const result = transformJavaScript(source, {
          ...opts,
          seed: 0x2468ace0,
          minStringLength: 4,
          injectRuntimeShield: false,
        });

        // Secret regex literals inside verifyDigest & matchStripe must be gone from cleartext
        // Note: shadowedParam, shadowedVar, and hotLoopRegex keep theirs intact
        const newRegExps = collectNewRegExpCalls(result.code);
        expect(newRegExps.length).toBe(2);

        // One has flags 'i' (2 arguments), the other has empty flags (1 argument)
        const argLengths = newRegExps.map((n) => n.arguments.length).sort();
        expect(argLengths).toEqual([1, 2]);
        const withFlags = newRegExps.find((n) => n.arguments.length === 2);
        expect(withFlags.arguments[1].value).toBe('i');

        // Ordinary email regex and shadowed/hot-loop regexes stay literals
        const remainingLiterals = collectRegexLiterals(result.code);
        expect(
          remainingLiterals.some((lit) => lit.includes('[a-z0-9._%+-]+'))
        ).toBe(true);
        expect(
          remainingLiterals.filter((lit) => lit.includes(stripePrefix)).length
        ).toBe(3);

        const globalThisMock: Record<string, any> = {};
        runCode(result.code, { globalThis: globalThisMock });
        expect(globalThisMock.__reOut).toEqual({
          digestMatch: true,
          digestMiss: false,
          stripeMatch: true,
          emailMatch: true,
          shadowParam: true,
          shadowVar: true,
          hotCount: 1,
        });
      });
    }

    it('exempts secret RegExp inside hotExemptNodes, exemptSubtreeRoots, and block-scoped RegExp shadowing', () => {
      const digest =
        '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8';
      const source = `
        function hotFn(s) {
          return /^${digest}$/.test(s);
        }
        function blockShadowed(s) {
          {
            const RegExp = function() {};
            if (/^${digest}$/.test(s)) return true;
          }
          return /^${digest}$/.test(s);
        }
        function rscNode(s) {
          return /^${digest}$/.test(s);
        }
      `;

      const ast = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
      applyStringVault(
        ast,
        0x11112222,
        4,
        new WeakSet([ast.body[0]]),
        undefined,
        undefined,
        undefined,
        undefined,
        false,
        false,
        new WeakSet([ast.body[2]])
      );
      const out = generateCompactJs(ast);

      // Only the unshadowed second regex inside blockShadowed should be converted
      expect(collectNewRegExpCalls(out).length).toBe(1);
      expect(collectRegexLiterals(out).length).toBe(3);
      expect(
        runCode<boolean>(`${out}; blockShadowed("${digest}") && hotFn("${digest}") && rscNode("${digest}");`)
      ).toBe(true);
    });
  });
});
