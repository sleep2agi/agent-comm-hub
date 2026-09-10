/**
 * #1856 PR-E — `anet node codex canary <alias>...`:批量只读体检,**顺序跑、第一个 FAIL 即停**。
 * 批量重启 / 换账号之前先 canary;后面的节点一个都不碰,汇总里明确写"未跑"。纯逻辑,verify 由调用方注入。
 */
export interface CanaryNodeResult {
  readonly alias: string;
  readonly verdict: "PASS" | "FAIL";
  readonly blocking: readonly string[];
  readonly receiptPath: string | null;
  readonly ms: number;
}
export interface CanarySummary {
  readonly verdict: "PASS" | "FAIL";
  readonly ran: readonly CanaryNodeResult[];
  /** 因前面 FAIL 而没跑的节点(顺序保留)。 */
  readonly skipped: readonly string[];
  readonly stoppedAt: string | null;
}

export async function runCanary(
  aliases: readonly string[],
  verifyOne: (alias: string) => Promise<Omit<CanaryNodeResult, "alias" | "ms">>,
  now: () => number = Date.now,
): Promise<CanarySummary> {
  const uniq = Array.from(new Set(aliases.map((a) => a.trim()).filter(Boolean)));
  if (uniq.length === 0) throw new Error("canary needs at least one alias");
  const ran: CanaryNodeResult[] = [];
  for (let i = 0; i < uniq.length; i++) {
    const t0 = now();
    let r: Omit<CanaryNodeResult, "alias" | "ms">;
    try { r = await verifyOne(uniq[i]); }
    catch (e: any) { r = { verdict: "FAIL", blocking: [`error: ${e?.message ?? e}`], receiptPath: null }; }
    ran.push({ alias: uniq[i], ...r, ms: now() - t0 });
    if (r.verdict !== "PASS") return { verdict: "FAIL", ran, skipped: uniq.slice(i + 1), stoppedAt: uniq[i] };
  }
  return { verdict: "PASS", ran, skipped: [], stoppedAt: null };
}

export function formatCanarySummary(s: CanarySummary): string {
  const lines = s.ran.map((r) => `${r.verdict === "PASS" ? "✅" : "❌"} ${r.alias}  ${r.ms}ms${r.blocking.length ? `  blocking: ${r.blocking.join(", ")}` : ""}${r.receiptPath ? `  receipt: ${r.receiptPath}` : ""}`);
  for (const a of s.skipped) lines.push(`⏭  ${a}  not run (stopped at ${s.stoppedAt})`);
  lines.push(`canary ${s.verdict}: ${s.ran.filter((r) => r.verdict === "PASS").length}/${s.ran.length + s.skipped.length} pass${s.skipped.length ? `, ${s.skipped.length} not run` : ""}`);
  return lines.join("\n");
}
