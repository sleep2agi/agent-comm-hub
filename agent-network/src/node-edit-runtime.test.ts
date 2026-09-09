// #1698 —— `anet node edit <node> --runtime <id>` 的契约。
//
// 这些断言扫的是 cli.ts 的源码，因为 nodeEditCommand 读 argv / 写盘 / 探进程表，
// 不是纯函数。**它们管的是接线与设计决定**，不是行为：
//   · 校验必须走 normalizeRuntimeStrict —— 不许在这里出现第四份 runtime 白名单
//   · 空值必须先被挡掉 —— normalizeRuntimeStrict 对空串返回 DEFAULT_RUNTIME，
//     那是「配置里没写」的语义；用户显式敲 `--runtime ""` 是打错了，
//     不该被悄悄解释成 claude-agent-sdk（兜底不许指向「好」的那一侧）
//   · 必须说清何时生效 —— 改配置不等于改运行中的进程
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUPPORTED_RUNTIME_NAMES, normalizeRuntimeStrict } from "./normalize-runtime.js";

const cli = readFileSync(new URL("../bin/cli.ts", import.meta.url), "utf8");
const body = (() => {
  const i = cli.indexOf("async function nodeEditCommand()");
  expect(i).toBeGreaterThan(-1);
  const j = cli.indexOf("\nasync function ", i + 10);
  return cli.slice(i, j > 0 ? j : undefined);
})();

describe("#1698 anet node edit —— 接线", () => {
  test("挂进了 node 的分发表", () => {
    expect(cli).toContain('case "edit": args.splice(0, 1); await nodeEditCommand(); break;');
  });
  test("两条用法行都列了 edit（同一串出现两次，漏一处就不一致）", () => {
    const m = cli.match(/anet node <create\|start\|stop\|restart\|resume\|delete\|ls\|rename\|edit\|loop\|codex\|migrate-token-to-envref>/g);
    expect(m?.length).toBe(2);
  });
  test("用现成件解析节点与读写配置，不自己拼路径", () => {
    for (const helper of ["resolveNodeRef(", "loadProfile(", "saveProfile(", "nodeNotFound("]) {
      expect(body).toContain(helper);
    }
    // 判据是「有没有自己拼路径」，不是「有没有出现 config.json 这个词」——
    // 报错文案里正当地提到它（"has no readable config.json"）。
    expect(body).not.toContain(".anet/nodes");
    expect(body).not.toContain("nodesDir(");
  });
});

describe("#1698 校验判据只有一份", () => {
  test("走 normalizeRuntimeStrict", () => {
    expect(body).toContain("normalizeRuntimeStrict(");
  });
  // 🔴 本仓同一个 runtime 全集已经有四处（hub / CLI / agent-node / 桌面端）。
  //    这条断言防的是「第五份」：任何 runtime id 字面量出现在这个函数体里，
  //    都说明有人开始在这里手写名单。
  test("函数体里没有硬编码的 runtime id", () => {
    for (const id of SUPPORTED_RUNTIME_NAMES) {
      expect(body.includes(`"${id}"`)).toBe(false);
    }
  });
  test("supported 列表从 SUPPORTED_RUNTIME_NAMES 渲染", () => {
    expect(body).toContain("SUPPORTED_RUNTIME_NAMES.join(");
  });
});

describe("#1698 --model：与 --runtime 走同一条路", () => {
  // 触发这一格的是 TM 的一条真实 P0：节点撞上
  // "Selected model is at capacity"，而换模型**没有命令可用**。
  test("挂在同一个子命令上，两个 flag 至少给一个", () => {
    expect(body).toContain('args.indexOf("--model")');
    expect(body).toContain("flagIdx < 0 && modelIdx < 0");
  });
  // 🔴 复用创建路径已经在用的那个校验器（#1469 finding-3），不新写一套。
  test("校验走 validateModel，不自造", () => {
    expect(body).toContain("validateModel(");
    // 自己写长度/字符判断就是新开一份判据
    expect(body).not.toMatch(/model[^\n]*\.length\s*[<>]/);
  });
  test("--model 也先自己挡掉空值/漏值", () => {
    expect(body).toContain('rawModel.startsWith("--")');
  });
  // 🔴 两个字段都可能改 ⇒ 必须**先全校验完再一次写盘**，
  //    否则第二个字段校验失败时会留下只改了一半的 config。
  test("先全校验再一次写盘：saveProfile 只出现一次，且在两次校验之后", () => {
    expect((body.match(/saveProfile\(/g) || []).length).toBe(1);
    const iModel = body.indexOf("validateModel(");
    const iSave = body.indexOf("saveProfile(");
    expect(iModel).toBeGreaterThan(-1);
    expect(iSave).toBeGreaterThan(iModel);
  });
});

describe("#1698 兜底方向", () => {
  // normalizeRuntimeStrict("") === DEFAULT_RUNTIME —— 先把这个前提钉住，
  // 否则下面那条「必须先挡空值」的断言会失去理由。
  test("前提：normalizeRuntimeStrict 对空串返回默认 runtime（不抛）", () => {
    expect(normalizeRuntimeStrict("")).toBe("claude-agent-sdk");
  });
  test("所以 nodeEditCommand 必须在调用前自己挡掉空值", () => {
    expect(body).toContain('raw.trim() === ""');
    expect(body).toContain('raw.startsWith("--")');
  });
});

describe("#1698 说清何时生效", () => {
  test("三种现实各有一句话：在跑 / 没在跑 / 读不到进程表", () => {
    expect(body).toContain("findNodeStopCandidates(");
    expect(body).toContain("running === null");          // 读不到进程表
    expect(body).toContain("anet node restart ");        // 在跑
    expect(body).toContain("anet node start ");          // 没在跑
  });
  // 🔴 第一版这条钉的是 `current === next` 这个**变量名** —— 实现从单字段
  //    （只改 runtime）扩成多字段（runtime + model）之后它就红了，而**行为没变**。
  //    断言要钉的是「同值时不写盘、并且说清没有变化」这个行为，不是某一行的写法。
  test("同值是 no-op：不调 saveProfile，并说清没有变化", () => {
    const noop = body.slice(body.indexOf("nothing to change"));
    // 「nothing to change」那句之后必须紧跟 return —— 也就是这条路径不落盘。
    const upToReturn = noop.slice(0, noop.indexOf("return;"));
    expect(upToReturn).not.toContain("saveProfile(");
    // 而正常路径是会落盘的（否则上面那条会因为整段都没有 saveProfile 而恒真）。
    expect(body).toContain("saveProfile(");
  });
});
