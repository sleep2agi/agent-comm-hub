// #1469 finding-2 — the persist shape for a node's config.json (extracted
// from bin/cli.ts saveProfile so a witnessed-red test can exercise the exact
// whitelist without spawning a real filesystem write or booting the CLI).
//
// 🔴 The bug this closes: `network_id` was set into the profile at node
// creation time (createProfileFromOpts) but was NOT in the persist whitelist
// this file's shape defines, so `config.json` never carried it. Reloading
// the profile then returned no network_id, and every consumer of
// `profile.network_id` silently fell back to the mutable global
// `gc.network_id`. Bind a node to network X, then run
// `anet network use Y`, and that node quietly starts speaking to Y with an
// ntok_ token still scoped to X — a half-right rule (works until the
// global network changes, then breaks silently).
//
// Keep this function additive-only: every consumer of a persisted field
// treats a missing key as "not set", so adding entries never breaks any
// existing reader.
//
// Typing: uses structural `any` shapes rather than importing Profile from
// bin/cli.ts, so this module has zero side-effect imports and can be
// unit-tested cleanly. The shape it accepts is defined by which keys it
// reads (see the whitelist below).

export function serializeProfileForConfigJson(
  normalized: Record<string, any>,
  profile: Record<string, any>,
): Record<string, any> {
  return {
    anet_version: normalized.anet_version,
    node_id: normalized.node_id,
    node_name: normalized.node_name,
    runtime: normalized.runtime,
    // #1469 finding-2 — network binding is part of node IDENTITY: which
    // Agent Network the ntok_ is scoped to. Persist it so it survives
    // `anet network use <other>` (which mutates gc.network_id and would
    // otherwise silently repoint the node's config while its token stays
    // bound to the original). normalizeStoredProfile preserves this via
    // its `...project` spread; we also read from `profile` as a defensive
    // fallback for callers that hand a stitched-up profile in.
    ...((normalized.network_id ?? profile.network_id)
      ? { network_id: normalized.network_id ?? profile.network_id }
      : {}),
    ...(normalized.hub ? { hub: normalized.hub } : {}),
    ...(normalized.token ? { token: normalized.token } : {}),
    ...(normalized.model ? { model: normalized.model } : {}),
    ...(normalized.tools ? { tools: normalized.tools } : {}),
    channels: normalized.channels || [],
    env: normalized.env || {},
    flags: normalized.flags || {},
    ...(normalized.session ? { session: normalized.session } : {}),
    ...((normalized.codexAppServerUrl ?? profile.codexAppServerUrl)
      ? { codexAppServerUrl: normalized.codexAppServerUrl ?? profile.codexAppServerUrl }
      : {}),
    ...((normalized.codexThreadId ?? profile.codexThreadId)
      ? { codexThreadId: normalized.codexThreadId ?? profile.codexThreadId }
      : {}),
    // #1856 PR-C/D — 共存节点工作目录;fork --workdir 写入,lifecycle 命令在此目录里才肯动作。漏在这张白名单里 = 一存就丢。
    ...((normalized.codexProjectDir ?? profile.codexProjectDir)
      ? { codexProjectDir: normalized.codexProjectDir ?? profile.codexProjectDir }
      : {}),
    ...((normalized.opencodeMode ?? profile.opencodeMode)
      ? { opencodeMode: normalized.opencodeMode ?? profile.opencodeMode }
      : {}),
    ...(normalized.grokSession ? { grokSession: normalized.grokSession } : {}),
    ...(normalized.grokCliSession ? { grokCliSession: normalized.grokCliSession } : {}),
    ...(typeof normalized.grokCopresence === "boolean"
      ? { grokCopresence: normalized.grokCopresence }
      : {}),
    ...(typeof (normalized.codexCopresence ?? profile.codexCopresence) === "boolean"
      ? { codexCopresence: normalized.codexCopresence ?? profile.codexCopresence }
      : {}),
    ...(typeof (normalized.codexCopresenceFullAccess ?? profile.codexCopresenceFullAccess) === "boolean"
      ? { codexCopresenceFullAccess: normalized.codexCopresenceFullAccess ?? profile.codexCopresenceFullAccess }
      : {}),
    ...(normalized.grokLeaderSocket ? { grokLeaderSocket: normalized.grokLeaderSocket } : {}),
    ...(normalized.grokAttachSocket ? { grokAttachSocket: normalized.grokAttachSocket } : {}),
    // RFC-008 / issue #51 team-scale demo metadata. Optional on every node;
    // present only when set by `anet demo sci-team` (Phase 1 scaffold) or
    // a future RFC-008 client. Without this persist, agent-node reads back a
    // config.json missing systemPrompt / team / role and the scaffold's
    // placeholder leader/researcher prompts are silently dropped.
    ...(normalized.systemPrompt ? { systemPrompt: normalized.systemPrompt } : {}),
    ...(normalized.team ? { team: normalized.team } : {}),
    ...(normalized.role ? { role: normalized.role } : {}),
  };
}
