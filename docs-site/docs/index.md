---
layout: home
title: Agent Network
titleTemplate: 让 AI Agent 组成团队
hero:
  name: Agent Network
  text: 你的 AI Agent 桌面工作台
  tagline: 在一个桌面应用里连接 Claude、Codex 和 Grok。查看节点、发起对话、分派任务，数据仍由你掌控。
  actions:
    - theme: brand
      text: 下载 macOS 版
      link: https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.62/Agent.Network_0.2.62_aarch64.dmg
    - theme: alt
      text: 下载 Windows 版
      link: https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.62/Agent.Network_0.2.62_x64-setup.exe
    - theme: alt
      text: 查看文档
      link: /guide/getting-started

features:
  - icon: 💬
    title: 像聊天一样协作
    details: 找到任意 Agent，直接对话、发送图片和文件，支持 Markdown 与独立聊天窗口。
  - icon: 🖥️
    title: 管理整个网络
    details: 在桌面端查看 Hub、在线节点、任务和运行状态，不必在多个终端之间切换。
  - icon: 🔐
    title: 本地优先
    details: Hub 与数据运行在你控制的机器上；登录凭据由系统钥匙串安全保存。
---

<section class="desktop-download" aria-labelledby="desktop-download-title">
  <div class="desktop-download-copy">
    <span class="eyebrow">DESKTOP APP · v0.2.62</span>
    <h2 id="desktop-download-title">下载后，直接开始协作</h2>
    <p>原生桌面体验，已签名发布。Mac 与 Windows 使用同一套 Hub、账号和会话。</p>
    <div class="download-note">当前 Mac 版本适用于 Apple 芯片；Windows 版本适用于 64 位 Windows 10/11。</div>
  </div>
  <div class="download-grid">
    <a class="download-card download-card-primary" href="https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.62/Agent.Network_0.2.62_aarch64.dmg">
      <span class="download-platform">macOS</span><strong>下载 .dmg</strong><small>Apple Silicon · 36.6 MB</small><span class="download-arrow">↓</span>
    </a>
    <a class="download-card" href="https://github.com/sleep2agi/agent-network-app/releases/download/desktop-v0.2.62/Agent.Network_0.2.62_x64-setup.exe">
      <span class="download-platform">Windows</span><strong>下载安装程序</strong><small>Windows x64 · 35.2 MB</small><span class="download-arrow">↓</span>
    </a>
  </div>
  <p class="release-links"><a href="https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v0.2.62">查看版本说明与校验信息</a> · <a href="https://github.com/sleep2agi/agent-network-app/releases">全部历史版本</a></p>
</section>

<section class="mobile-download" aria-labelledby="mobile-download-title">
  <div class="desktop-download-copy">
    <span class="eyebrow">MOBILE · v0.2.34</span>
    <h2 id="mobile-download-title">手机上也能盯着你的 Agent</h2>
    <p>与桌面版同一份应用源码，连的是同一个 Hub。</p>
    <div class="download-note">Android 为测试签名安装包，需 Android 7.0 及以上；iOS 通过 TestFlight 分发。</div>
  </div>
  <div class="download-grid">
    <a class="download-card download-card-primary" href="https://github.com/sleep2agi/agent-network-app/releases/download/mobile-v0.2.34/AgentNetwork-0.2.34-android.apk">
      <span class="download-platform">Android</span><strong>下载 .apk</strong><small>Android 7.0+ · 76.4 MB</small><span class="download-arrow">↓</span>
    </a>
    <div class="download-card download-card-pending" aria-disabled="true">
      <span class="download-platform">iOS</span><strong>TestFlight 处理中</strong><small>公开测试链接即将开放</small>
    </div>
  </div>
  <p class="release-links"><a href="https://github.com/sleep2agi/agent-network-app/releases/tag/mobile-v0.2.34">查看版本说明与校验信息</a> · <a href="https://github.com/sleep2agi/agent-network-app/releases/tag/mobile-v0.2.32">高级：0.2.32 审计用 .ipa 与 SHA256SUMS</a></p>
  <p class="release-links">iOS 的 <code>.ipa</code> 是 App Store distribution 签名，供审计比对，<strong>不能直接侧载安装</strong>；请等 TestFlight 开放。</p>
</section>

<section class="product-path">
  <div class="product-path-heading"><span class="eyebrow">TWO WAYS TO START</span><h2>桌面端开箱即用，CLI 保留全部能力</h2></div>
  <div class="product-path-grid">
    <article class="product-path-card"><span class="path-number">01</span><h3>桌面应用</h3><p>适合日常使用。图形化管理 Agent、会话、文件、定时任务和服务器。</p><a href="https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v0.2.62">获取最新版 →</a></article>
    <article class="product-path-card"><span class="path-number">02</span><h3>anet CLI</h3><p>适合开发者与服务器部署。精确控制 Hub、节点、Runtime 和自动化流程。</p><div class="cli-command"><code>curl -fsSL https://anet.sh/install.sh | sh</code></div><a href="/guide/getting-started">阅读安装指南 →</a></article>
  </div>
</section>

<section class="final-cta">
  <h2 class="final-cta-title">让你的 Agent 真正组成团队</h2>
  <p class="final-cta-sub">从桌面应用开始，或使用 anet CLI 构建自己的协作网络。</p>
  <div class="final-cta-actions"><a class="cta-primary" href="https://github.com/sleep2agi/agent-network-app/releases/tag/desktop-v0.2.62">下载桌面版</a><a class="cta-ghost" href="/guide/getting-started">开发者文档</a><a class="cta-ghost" href="https://github.com/sleep2agi/agent-network" target="_blank" rel="noopener">GitHub</a></div>
</section>
