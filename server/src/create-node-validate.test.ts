import { describe, expect, test } from "bun:test";
import {
  ValidationError,
  validateName, validateRuntime, validateModel, validateFlagValue, RUNTIMES,
  validateEnvRefs, validateChannelsP1, serializeEnvLocal, buildAnetArgs,
  MAX_ENV_KEYS_PER_NODE,
} from "./create-node-validate.js";

const okSecret = (k: string, _net: string, key: string) => k === key ? `value-of-${k}` : undefined;
const allow = (k: string) => new Set<string>([k, "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

describe("validateName (§4.2.2)", () => {
  test("good names", () => {
    for (const n of ["a", "demo-bot", "node_1", "z2", "abc-def-ghi"]) {
      expect(() => validateName(n)).not.toThrow();
    }
  });
  test("rejects shell-injection-like names", () => {
    for (const n of [";rm -rf /", "demo bot", "Demo", "1demo", "-demo", "demo;rm", "demo$INJECT", "x".repeat(65)]) {
      expect(() => validateName(n)).toThrow(ValidationError);
    }
  });
});

describe("validateRuntime / validateModel (§4.2.2)", () => {
  test("runtime enum", () => {
    expect(() => validateRuntime("claude-agent-sdk")).not.toThrow();
    expect(() => validateRuntime("bash")).toThrow(ValidationError);
    expect(() => validateRuntime("")).toThrow(ValidationError);
  });
  test("model with dots, colons, dashes OK; bad chars rejected", () => {
    expect(() => validateModel("claude-opus-4.6")).not.toThrow();
    expect(() => validateModel("claude-opus-4-6")).not.toThrow();
    expect(() => validateModel("vendor:model")).not.toThrow();
    expect(() => validateModel("gpt-4o")).not.toThrow();
    expect(() => validateModel("bad model")).toThrow(ValidationError);
    expect(() => validateModel("x;rm")).toThrow(ValidationError);
    // provider/model(OpenCode 共存;桌面向导 0.2.61 起发这种形状,Vincent 2026-09-08 撞到 model_invalid)
    expect(() => validateModel("opencode/mimo-v2.5-free")).not.toThrow();
    expect(() => validateModel("anthropic/claude-sonnet-4")).not.toThrow();
    expect(() => validateModel("a/b/c")).toThrow(ValidationError);      // 只许一个斜杠
    expect(() => validateModel("/model")).toThrow(ValidationError);     // 不能以斜杠开头
    expect(() => validateModel("provider/")).toThrow(ValidationError);  // 不能以斜杠结尾
    expect(() => validateModel("../x")).toThrow(ValidationError);       // 纯点段(路径穿越形状)
    expect(() => validateModel("x/.")).toThrow(ValidationError);
    expect(() => validateModel("open code/m")).toThrow(ValidationError);
    expect(() => validateModel("")).toThrow(ValidationError);
  });
});

describe("validateFlagValue (§4.2.2)", () => {
  test("budget decimal allowed", () => {
    expect(() => validateFlagValue("budget", 5.5)).not.toThrow();
    expect(() => validateFlagValue("budget", 0)).not.toThrow();
    expect(() => validateFlagValue("budget", 1001)).toThrow(ValidationError);
    expect(() => validateFlagValue("budget", -1)).toThrow(ValidationError);
  });
  test("maxTurns integer 1..9999", () => {
    expect(() => validateFlagValue("maxTurns", 50)).not.toThrow();
    expect(() => validateFlagValue("maxTurns", 5.5)).toThrow(ValidationError);
    expect(() => validateFlagValue("maxTurns", 0)).toThrow(ValidationError);
    expect(() => validateFlagValue("maxTurns", "DROP TABLE")).toThrow(ValidationError);
  });
  test("dangerouslySkipPermissions boolean", () => {
    expect(() => validateFlagValue("dangerouslySkipPermissions", true)).not.toThrow();
    expect(() => validateFlagValue("dangerouslySkipPermissions", "true")).toThrow(ValidationError);
  });
  test("permissionMode enum", () => {
    expect(() => validateFlagValue("permissionMode", "plan")).not.toThrow();
    expect(() => validateFlagValue("permissionMode", "anything-else")).toThrow(ValidationError);
  });
});

describe("validateEnvRefs (§4.4.7 + B1 G7/G8 sub-cases)", () => {
  test("good keys resolve", () => {
    const env = validateEnvRefs(["ANTHROPIC_API_KEY"], {
      callerNetworkId: "n", daemonAllowList: allow("ANTHROPIC_API_KEY"),
      networkSecretsGet: (n, k) => okSecret("ANTHROPIC_API_KEY", n, k),
    });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "value-of-ANTHROPIC_API_KEY" });
  });
  test("G7: PATH rejected (exact denylist)", () => {
    expect(() => validateEnvRefs(["PATH"], {
      callerNetworkId: "n", daemonAllowList: allow("PATH"),
      networkSecretsGet: () => "evil:/tmp/bin",
    })).toThrow(ValidationError);
  });
  test("G8: LD_PRELOAD / DYLD_* / BUN_* / NPM_* / NODE_OPTIONS rejected (prefix)", () => {
    for (const k of ["LD_PRELOAD", "DYLD_INSERT_LIBRARIES", "BUN_INSTALL", "NPM_TOKEN", "NPM_CONFIG_REGISTRY", "NODE_PATH", "NODE_OPTIONS"]) {
      expect(() => validateEnvRefs([k], {
        callerNetworkId: "n", daemonAllowList: new Set([k]),
        networkSecretsGet: () => "x",
      })).toThrow(ValidationError);
    }
  });
  test("G1 bad regex (lowercase / digit-first / too long)", () => {
    for (const k of ["path", "1KEY", "_KEY", "a".repeat(65)]) {
      expect(() => validateEnvRefs([k], {
        callerNetworkId: "n", daemonAllowList: new Set([k]), networkSecretsGet: () => "x",
      })).toThrow(ValidationError);
    }
  });
  test("G2 duplicate", () => {
    expect(() => validateEnvRefs(["A_KEY", "A_KEY"], {
      callerNetworkId: "n", daemonAllowList: new Set(["A_KEY"]), networkSecretsGet: () => "x",
    })).toThrow(ValidationError);
  });
  test("G3 over max count", () => {
    const refs = Array.from({ length: MAX_ENV_KEYS_PER_NODE + 1 }, (_, i) => `KEY_${i}`);
    const allowAll = new Set(refs);
    expect(() => validateEnvRefs(refs, {
      callerNetworkId: "n", daemonAllowList: allowAll, networkSecretsGet: () => "x",
    })).toThrow(ValidationError);
  });
  test("G4 not in vault", () => {
    expect(() => validateEnvRefs(["ANTHROPIC_API_KEY"], {
      callerNetworkId: "n", daemonAllowList: allow("ANTHROPIC_API_KEY"),
      networkSecretsGet: () => undefined,
    })).toThrow(ValidationError);
  });
  test("G5 not in daemon allowlist", () => {
    expect(() => validateEnvRefs(["OPENAI_API_KEY"], {
      callerNetworkId: "n", daemonAllowList: new Set(["ANTHROPIC_API_KEY"]),
      networkSecretsGet: () => "x",
    })).toThrow(ValidationError);
  });
  test("undefined/empty refs is OK (no env at all)", () => {
    expect(validateEnvRefs(undefined, { callerNetworkId: "n", daemonAllowList: new Set(), networkSecretsGet: () => undefined })).toEqual({});
    expect(validateEnvRefs([], { callerNetworkId: "n", daemonAllowList: new Set(), networkSecretsGet: () => undefined })).toEqual({});
  });
});

describe("serializeEnvLocal (§4.4.7 G6 — safe escape)", () => {
  test("newline in secret value escapes to literal \\n, no line pollution", () => {
    const out = serializeEnvLocal({ KEY: 'foo\nevil="KEY2"' });
    // The \n must be the 2-char literal `\n` in the file, NOT an actual
    // newline. There must be NO bare `evil=` token on its own line.
    expect(out).toBe('KEY="foo\\nevil=\\"KEY2\\""\n');
    expect(out.split("\n").length).toBe(2);  // 1 data line + trailing empty
  });
  test("backslash escaped first (so subsequent escapes survive)", () => {
    expect(serializeEnvLocal({ KEY: "a\\b" })).toBe('KEY="a\\\\b"\n');
  });
  test("multi-key", () => {
    expect(serializeEnvLocal({ A: "x", B: "y" })).toBe('A="x"\nB="y"\n');
  });
});

describe("validateChannelsP1 (§4.2.5 C5)", () => {
  test("empty / omitted OK", () => {
    expect(() => validateChannelsP1([])).not.toThrow();
    expect(() => validateChannelsP1(undefined)).not.toThrow();
    expect(() => validateChannelsP1(null)).not.toThrow();
  });
  test("non-empty rejected (any element)", () => {
    expect(() => validateChannelsP1(["telegram"])).toThrow(ValidationError);
    expect(() => validateChannelsP1([null])).toThrow(ValidationError);
    expect(() => validateChannelsP1([{}])).toThrow(ValidationError);
  });
  test("not-an-array rejected", () => {
    expect(() => validateChannelsP1("telegram")).toThrow(ValidationError);
  });
});

describe("buildAnetArgs (§4.2.2 F2 — fully validated argv)", () => {
  test("happy path", () => {
    const args = buildAnetArgs({
      name: "demo-bot", runtime: "claude-agent-sdk", model: "claude-opus-4-6",
      flags: { maxTurns: 50, budget: 5 },
    });
    expect(args).toEqual(["node", "create", "demo-bot", "--runtime", "claude-agent-sdk", "--model", "claude-opus-4-6", "--max-turns", "50", "--budget", "5"]);
  });
  test("permissionMode kebab-case", () => {
    const args = buildAnetArgs({
      name: "x", runtime: "codex-sdk", model: "gpt-4o",
      flags: { permissionMode: "plan" },
    });
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
  });
  test("omitted model is allowed and does not emit --model", () => {
    const args = buildAnetArgs({
      name: "x", runtime: "codex-sdk",
      flags: { permissionMode: "plan" },
    });
    expect(args).toEqual(["node", "create", "x", "--runtime", "codex-sdk", "--permission-mode", "plan"]);
  });
  test("empty model is still rejected", () => {
    expect(() => buildAnetArgs({ name: "x", runtime: "codex-sdk", model: "" })).toThrow(ValidationError);
  });
  test("rejects bad name with shell metachar", () => {
    expect(() => buildAnetArgs({ name: ";rm -rf /", runtime: "claude-agent-sdk", model: "x" })).toThrow(ValidationError);
  });
  test("rejects bad flag key", () => {
    expect(() => buildAnetArgs({
      name: "x", runtime: "claude-agent-sdk", model: "x",
      flags: { evilKey: 1 } as any,
    })).toThrow(ValidationError);
  });
  test("rejects channels at build time too (E end-to-end injection)", () => {
    expect(() => buildAnetArgs({
      name: "x", runtime: "claude-agent-sdk", model: "x",
      channels: ["telegram"],
    } as any)).toThrow(ValidationError);
  });
});

// ─── runtime_invalid 要说清「允许哪些」和「还有什么路」 ────────────────
//
// 2026-08-28 实测：从 Dashboard 建一个 codex-app-server 节点，用户拿到的是
//   {"ok":false,"error":"runtime_invalid","value":"codex-app-server"}
// 而目标机器的 daemon 日志里一行都没有 —— 请求被 hub 拦在最前面，
// 用户无从知道①哪些允许②是不是打错了③有没有别的办法。
// 🔴 2026-08-28:这一节原本拿 `codex-app-server` / `opencode-cli` 当"非法 runtime"的例子。
//    #1298 把 hub 的 RUNTIMES 从 3 个放开到 7 个之后,那两个变成了合法值,这两条测试因此红了 ——
//    **测试正确地抓到了行为变更**。修法是换例子,不是削弱断言:
//    意图仍然是「非法 runtime 要给可操作的报错」,只是例子换成永远不会合法的字符串。
describe("validateRuntime — 报错要可操作", () => {
  function thrown(v: unknown): any {
    try { validateRuntime(v); } catch (e: any) { return e; }
    throw new Error("expected validateRuntime to throw");
  }

  test("非法 runtime 的报错带上允许集合", () => {
    const e = thrown("definitely-not-a-runtime");
    expect(e.code).toBe("runtime_invalid");
    expect(Array.isArray(e.detail?.allowed)).toBe(true);
    // 🔴 断言它等于 RUNTIMES 本身,而不是等于一份手抄的清单 ——
    //    手抄的那份会漂,漂了之后报错会理直气壮地告诉用户一组错的名字。
    expect(e.detail.allowed).toEqual([...RUNTIMES]);
  });

  test("报错带上一条出路提示", () => {
    const e = thrown("another-bogus-runtime");
    expect(typeof e.detail?.hint).toBe("string");
    expect(e.detail.hint.length).toBeGreaterThan(10);
    // 提示必须点名那条真实存在的路,否则它只是安慰话
    expect(e.detail.hint).toContain("anet node create");
  });

  test("仍然回报用户传进来的那个值（便于识别是不是打错了）", () => {
    const e = thrown("codex-app-servr");   // 故意少一个 e
    expect(e.detail.value).toBe("codex-app-servr");
  });

  test("🔴 合法 runtime 一个都不能被这次改动误伤", () => {
    for (const r of RUNTIMES) {
      expect(() => validateRuntime(r)).not.toThrow();
    }
    // 正控：非字符串必须仍然被拒 —— 否则上面那条循环全过也说明不了什么
    expect(() => validateRuntime(123 as any)).toThrow();
    expect(() => validateRuntime(undefined as any)).toThrow();
  });
});

// #1298 —— daemon 远程创建放开到 7 个 runtime（Vincent 2026-08-28 定，
// 理由是兜底排错：节点不动了，人要能进去跟 Codex / Claude Code 对话）。
describe("#1298 RUNTIMES —— 七个都放行，且与 CLI 侧一致", () => {
  test("三个共存 runtime 不再被拒", () => {
    for (const r of ["codex-app-server", "grok-build-cli", "opencode-cli"]) {
      expect(() => validateRuntime(r)).not.toThrow();
    }
  });
  test("原有四个仍然放行（放开不该顺手改坏别的）", () => {
    for (const r of ["claude-agent-sdk", "claude-code-cli", "codex-sdk", "grok-build-acp"]) {
      expect(() => validateRuntime(r)).not.toThrow();
    }
  });
  test("🔴 恰好七个 —— 多一个少一个都要有人解释", () => {
    expect(RUNTIMES.length).toBe(7);
    // 正控：不在名单里的仍然被拒，证明上面不是"什么都放行"
    expect(() => validateRuntime("definitely-not-a-runtime")).toThrow();
    expect(() => validateRuntime("")).toThrow();
  });
});
