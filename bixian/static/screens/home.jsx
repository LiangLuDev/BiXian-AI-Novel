// Home — bookshelf + new-novel modal

const HomeScreen = ({ onOpenProject }) => {
  const { data, reload } = usePoll(() => api.projects(), 6000, []);
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);
  const [filter, setFilter] = React.useState("all");
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const projects = data?.projects || [];

  const filters = React.useMemo(() => {
    const counts = { all: projects.length, writing: 0, done: 0, paused: 0 };
    for (const p of projects) {
      if (p.chapters >= p.target_chapters && p.target_chapters > 0) counts.done++;
      else if (p.paused) counts.paused++;
      else if (p.running) counts.writing++;
      else counts.paused++;
    }
    return counts;
  }, [projects]);

  const shown = projects.filter((p) => {
    if (filter === "all") return true;
    const done = p.chapters >= p.target_chapters && p.target_chapters > 0;
    if (filter === "done") return done;
    if (filter === "writing") return !done && p.running && !p.paused;
    if (filter === "paused") return !done && (p.paused || !p.running);
    return true;
  });

  const open = (p) => onOpenProject(p.id, "reader");

  return (
    <div className="frame">
      <TitleBar project="书架" shelf />
      <RailNav onShelf={() => {}} />
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div className="shelf-hero" style={{ display: "flex", alignItems: "flex-end", gap: 18, flexWrap: "wrap" }}>
          <div>
            <div className="title">
              我的书架 <span className="spark">✦</span>
            </div>
            <div className="sub">用 AI 创作属于你的精彩故事</div>
          </div>
          <div className="pill-tabs" style={{ marginLeft: 12 }}>
            {[
              ["all", "全部", filters.all],
              ["writing", "创作中", filters.writing],
              ["done", "已完结", filters.done],
              ["paused", "未激活", filters.paused],
            ].map(([k, label, n]) => (
              <button key={k} className={"pill-tab " + (filter === k ? "active" : "")} onClick={() => setFilter(k)}>
                {label} <span className="count">{n}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={() => setSettingsOpen(true)} title="并发与运行设置"><I.Sliders size={13} /> 设置</button>
            <button className="btn ghost" onClick={reload}><I.Refresh size={13} /> 刷新</button>
            <button className="btn primary lg" onClick={() => setWizardOpen(true)}>
              <I.Plus size={14} /> 新建小说
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 32 }}>
          {projects.length === 0 ? (
            <EmptyState
              title="书架还空着"
              hint="开一本新小说，AI 会从一句话简介把世界观、人物、大纲全部接管。"
              action={<button className="btn primary lg" onClick={() => setWizardOpen(true)}><I.Plus size={14} /> 新建小说</button>}
            />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 20 }}>
              {shown.map((p) => (
                <ProjectCard
                  key={p.id}
                  p={p}
                  onOpen={() => open(p)}
                  onEdit={() => setEditing(p)}
                  onDelete={() => setDeleting(p)}
                />
              ))}
              <NewProjectTile onClick={() => setWizardOpen(true)} />
            </div>
          )}
        </div>
      </div>
      {wizardOpen && <WizardModal onClose={() => setWizardOpen(false)} onCreated={(id) => { setWizardOpen(false); reload(); onOpenProject(id, "progress"); }} />}
      {editing && <EditTitleModal project={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
      {deleting && <DeleteProjectModal project={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); reload(); }} />}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} onSaved={() => { setSettingsOpen(false); reload(); }} />}
    </div>
  );
};

// Workspace 级设置：当前只有"并发书目数"。修改后立即生效，新值落盘 .bixian-settings.json。
const SettingsModal = ({ onClose, onSaved }) => {
  const [data, setData] = React.useState(null);
  const [value, setValue] = React.useState(2);
  const { busy, err, run } = useAsyncAction();

  React.useEffect(() => {
    let live = true;
    api.settings().then((s) => {
      if (!live) return;
      setData(s);
      setValue(s.max_concurrent || 2);
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  const save = () => run(async () => {
    await api.updateSettings({ max_concurrent: value });
    onSaved();
  });

  const clamp = (v) => Math.max(1, Math.min(16, Math.round(Number(v) || 1)));

  return (
    <ModalShell
      icon={<I.Sliders size={14} />}
      title="并发与运行设置"
      subtitle="设置同一时间最多同时生成多少本小说，超出部分自动排队"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={save} disabled={busy || !data}>{busy ? "保存中…" : "保存"}</button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--text-2)" }}>同时生成上限（本）</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <button className="btn sm" onClick={() => setValue((v) => clamp(v - 1))} disabled={busy || value <= 1}>−</button>
            <input
              className="input mono"
              type="number"
              min={1}
              max={16}
              value={value}
              onChange={(e) => setValue(clamp(e.target.value))}
              style={{ width: 80, textAlign: "center" }}
            />
            <button className="btn sm" onClick={() => setValue((v) => clamp(v + 1))} disabled={busy || value >= 16}>+</button>
            <span style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              当前运行 <span className="mono" style={{ color: "var(--text-1)" }}>{data?.running_count ?? 0}</span> 本
            </span>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 8, lineHeight: 1.6 }}>
            默认 2 本。建议根据机器性能 / Codex 配额调整；超过上限的写作请求会自动排队，等前面的本完成后再启动。
          </div>
        </div>
        {err && <div style={{ color: "var(--rose)", fontSize: 12 }}>{err}</div>}
      </div>
    </ModalShell>
  );
};

const ProjectCard = ({ p, onOpen, onEdit, onDelete }) => {
  const ai = audienceInfo(p.audience);
  const coverGenre = ai.label || p.genre;
  const target = p.target_chapters || 1;
  const pct = Math.min(100, Math.round((p.chapters / target) * 100));
  const done = pct >= 100;
  const status = done ? "done" : p.paused ? "paused" : p.running ? "writing" : p.active ? "active" : "idle";
  const glowClass = status === "writing" || status === "active"
    ? " glow"
    : status === "done" ? " glow blue"
    : status === "paused" || status === "idle" ? " glow purple"
    : "";
  return (
    <div className={"card interactive" + glowClass} onClick={onOpen} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, position: "relative" }}>
      <div style={{ position: "absolute", top: 12, right: 12, display: "flex", gap: 4, zIndex: 2 }}>
        <button className="btn ghost icon sm" title="修改书名" onClick={(e) => { e.stopPropagation(); onEdit(); }}><I.Pencil size={12} /></button>
        <button className="btn ghost icon sm" title="删除小说" onClick={(e) => { e.stopPropagation(); onDelete(); }}><I.Trash size={12} /></button>
      </div>
      <div style={{ display: "flex", gap: 14, paddingRight: 54 }}>
        <CoverBox genre={coverGenre} src={p.cover_image_url} width={72} height={100} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="display" style={{ fontSize: 15, fontWeight: 600, color: "var(--text-0)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
          <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4 }} className="mono">
            {String(p.chapters).padStart(3, "0")} / {p.target_chapters} 章 · {(p.total_words / 10000).toFixed(1)}万字
          </div>
          <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" }}>
            {ai.label && <span className={"tag " + ai.tag}>{ai.label}</span>}
            {p.genre && p.genre !== "通用" && <span className={"tag " + genreInfo(p.genre).tag}>{genreInfo(p.genre).label}</span>}
            <span className={"tag " + (p.backend === "claude" ? "purple" : "")}>{p.backend === "claude" ? "Claude" : "Codex"}</span>
            {status === "writing" && <span className="tag green"><span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> 生成中</span>}
            {status === "active" && <span className="tag green">当前</span>}
            {status === "paused" && <span className="tag">已暂停</span>}
            {status === "idle" && <span className="tag">未激活</span>}
            {status === "done" && <span className="tag blue"><I.Check size={9} /> 已完结</span>}
            {p.queued && <span className="tag warn">排队中</span>}
          </div>
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontFamily: "var(--font-mono)" }}>
          <span>进度</span>
          <span style={{ color: done ? "var(--blue)" : (status === "writing" || status === "active") ? "var(--green)" : "var(--text-2)" }}>{pct}%</span>
        </div>
        <div className={"progress " + ((status === "writing" || status === "active") ? "green" : "")}>
          <div className="fill" style={{ width: `${pct}%`, background: done ? "var(--blue)" : undefined }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 10, marginTop: "auto" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 4 }}><I.Clock size={11} /> {relTime(p.updated_at)}</span>
        <span style={{ fontSize: 11.5, color: "var(--text-1)" }}>打开 <I.ChevronRight size={11} style={{ verticalAlign: -2 }} /></span>
      </div>
    </div>
  );
};

const ModalShell = ({ icon, title, subtitle, onClose, children, footer, width = 460 }) => (
  <div className="modal-overlay">
    <div className="modal-panel" style={{ width, maxWidth: "calc(100vw - 32px)" }}>
      <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border-0)" }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
          {icon}
        </div>
        <div style={{ flex: 1 }}>
          <div className="display" style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 2 }}>{subtitle}</div>}
        </div>
        <button className="btn ghost icon" onClick={onClose}><I.X size={14} /></button>
      </div>
      <div style={{ padding: "20px 24px" }}>{children}</div>
      {footer && <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-0)", background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>{footer}</div>}
    </div>
  </div>
);

const EditTitleModal = ({ project, onClose, onSaved }) => {
  const [title, setTitle] = React.useState(project.title || "");
  const { busy, err, run } = useAsyncAction();

  const save = () => run(async () => {
    await api.renameProject(project.id, title.trim());
    onSaved();
  });

  return (
    <ModalShell
      icon={<I.Pencil size={14} />}
      title="修改书名"
      subtitle="仅支持手动修改，不会重新生成书名或内容"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn primary" onClick={save} disabled={busy || !title.trim() || title.length > 80}>{busy ? "保存中…" : "保存"}</button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ fontSize: 12, color: "var(--text-2)" }}>书名</label>
        <input className="input" autoFocus value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="输入新的书名" />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-3)" }}>
          <span>修改后会立刻更新书架与阅读页标题</span>
          <span className="mono">{title.length} / 80</span>
        </div>
        {err && <div style={{ color: "var(--rose)", fontSize: 12 }}>{err}</div>}
      </div>
    </ModalShell>
  );
};

const DeleteProjectModal = ({ project, onClose, onDeleted }) => {
  const { busy, err, run } = useAsyncAction();

  const del = () => run(async () => {
    await api.deleteProject(project.id);
    onDeleted();
  });

  return (
    <ModalShell
      icon={<I.Trash size={14} />}
      title="删除小说？"
      subtitle="这是二次确认，删除后无法从书架恢复"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>取消</button>
          <button className="btn" onClick={del} disabled={busy} style={{ color: "var(--rose)", borderColor: "var(--rose)" }}>{busy ? "删除中…" : "确认删除"}</button>
        </>
      )}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
        <div>将删除：</div>
        <div className="card" style={{ padding: 12, background: "var(--bg-2)", border: "1px solid var(--border-0)" }}>
          <div className="display" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-0)" }}>{project.title}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{project.chapters} / {project.target_chapters} 章 · {(project.total_words / 10000).toFixed(1)}万字</div>
        </div>
        <div style={{ color: "var(--rose)", fontSize: 12 }}>项目状态文件和已生成封面图会被移除。</div>
        {err && <div style={{ color: "var(--rose)", fontSize: 12 }}>{err}</div>}
      </div>
    </ModalShell>
  );
};

const NewProjectTile = ({ onClick }) => (
  <div className="card" onClick={onClick} style={{
    padding: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: 220, border: "1px dashed var(--border-1)", background: "transparent",
    color: "var(--text-2)", cursor: "pointer", gap: 10,
  }}>
    <div style={{
      width: 48, height: 48, borderRadius: 12,
      background: "var(--brand-soft)", color: "var(--brand)",
      display: "grid", placeItems: "center",
    }}><I.Plus size={22} /></div>
    <div style={{ color: "var(--text-0)", fontWeight: 500 }}>新建小说</div>
    <div style={{ fontSize: 11.5, textAlign: "center", color: "var(--text-3)", lineHeight: 1.6 }}>
      一句话简介 · 选题材<br />AI 自动写完整本
    </div>
  </div>
);

const LENGTHS = [
  ["短篇", 30, "约 10 万字"],
  ["中篇", 100, "约 35 万字"],
  ["长篇", 300, "约 100 万字"],
  ["史诗", 600, "约 220 万字"],
];

const draftTitleFromDescription = (desc) => {
  const compact = (desc || "").replace(/\s+/g, "").replace(/[，。！？、；：,.!?;:]/g, "");
  return compact.slice(0, 12) || "新小说";
};

const WizardModal = ({ onClose, onCreated }) => {
  const [step, setStep] = React.useState("input");
  const [mode, setMode] = React.useState("manual"); // "manual" | "theme"
  const [desc, setDesc] = React.useState("");
  const [audience, setAudience] = React.useState(""); // "" | "male" | "female"
  const [length, setLength] = React.useState(null);
  const [selectedTheme, setSelectedTheme] = React.useState(null);
  const [backend, setBackend] = React.useState("codex"); // "codex" | "claude"
  const [aiStatus, setAiStatus] = React.useState(null); // null = loading, then { available, by_id, details }
  const { busy, err, setErr, run } = useAsyncAction();

  const refreshAiStatus = React.useCallback(() => {
    let live = true;
    setAiStatus(null);
    api.aiStatus()
      .then((s) => { if (live) setAiStatus(s); })
      .catch(() => { if (live) setAiStatus({ available: false, by_id: { codex: false, claude: false }, details: {} }); });
    return () => { live = false; };
  }, []);

  React.useEffect(() => {
    return refreshAiStatus();
  }, []);

  // 自动把默认选中切到已安装的后端（若当前选中的未安装）
  React.useEffect(() => {
    if (!aiStatus || !aiStatus.by_id) return;
    if (aiStatus.by_id[backend]) return;
    const fallback = ["codex", "claude"].find((id) => aiStatus.by_id[id]);
    if (fallback) setBackend(fallback);
  }, [aiStatus, backend]);

  const createAndStart = () => {
    if (!aiStatus || !aiStatus.available) {
      setErr("未检测到可用的 AI 后端：请先安装并登录 Codex 或 Claude Code 任意一个 CLI，然后点击重新检测。");
      return;
    }
    if (!aiStatus.by_id || !aiStatus.by_id[backend]) {
      const label = (BACKEND_OPTIONS.find(([id]) => id === backend) || BACKEND_OPTIONS[0])[1];
      setErr(`所选后端「${label}」尚未安装，请切换到已安装的后端。`);
      return;
    }
    if (mode === "manual") {
      if (!desc.trim()) { setErr("先写一句话简介"); return; }
      if (!audience) { setErr("请选择男频或女频"); return; }
    } else {
      if (!selectedTheme) { setErr("请选择一个主题"); return; }
    }
    if (length === null) { setErr("请选择总章节数"); return; }

    setStep("creating");
    return run(async () => {
      try {
        const initBody = mode === "theme" && selectedTheme ? {
          description: selectedTheme.description,
          genre: selectedTheme.genre || "通用",
          target_chapters: LENGTHS[length][1],
          target_word_count_wan: selectedTheme.target_word_count_wan || 60.0,
          generate_publish_meta_async: true,
          audience_hint: selectedTheme.audience || "",
          theme_id: selectedTheme.id,
          backend: backend,
        } : {
          description: desc.trim(),
          genre: "通用",
          target_chapters: LENGTHS[length][1],
          generate_publish_meta_async: true,
          audience_hint: audience,
          backend: backend,
        };

        const res = await api.init(initBody);
        // 多本并发：始终把 project_id 显式传给 run，路由到对应 slot；
        // 若已达并发上限会自动入队，不会拒绝。
        try { await api.run({ mode: "all" }, res.project_id); }
        catch (runErr) { console.warn("auto-run failed:", runErr); }
        onCreated(res.project_id);
      } catch (e) {
        setStep("input");
        throw e; // surfaces e.message into the hook's err state
      }
    });
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 50 }}>
      <div className="modal-panel" style={{ width: 720, maxHeight: "calc(100% - 80px)" }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border-0)" }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
            <I.Sparkles size={14} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="display" style={{ fontSize: 15, fontWeight: 600 }}>
              {step === "input" ? "新建小说" : "正在创建…"}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>
              {step === "input"
                ? "一句话简介 + 手动选择男频/女频；发布卡后台异步生成"
                : "项目已入库，AI 正在写第一章"}
            </div>
          </div>
          <button className="btn ghost icon" onClick={onClose} disabled={busy}><I.X size={14} /></button>
        </div>

        {step === "input" && (
          <WizardInput
            mode={mode} setMode={setMode}
            desc={desc} setDesc={setDesc}
            audience={audience} setAudience={setAudience}
            length={length} setLength={setLength}
            selectedTheme={selectedTheme} setSelectedTheme={setSelectedTheme}
            backend={backend} setBackend={setBackend}
            aiStatus={aiStatus}
            onRefreshAiStatus={refreshAiStatus}
            err={err} busy={busy}
            onCancel={onClose} onCreate={createAndStart}
          />
        )}
        {step === "creating" && (
          <div style={{ padding: 48, textAlign: "center", color: "var(--text-2)" }}>
            <I.Sparkles size={28} />
            <div style={{ marginTop: 12 }}>{busy ? "项目入库 + 启动写作流水线…" : "进入项目"}</div>
          </div>
        )}
      </div>
    </div>
  );
};

const BACKEND_OPTIONS = [
  ["codex", "Codex", "OpenAI GPT-5.5 / 5.4 / 5.4-mini", "npm i -g @openai/codex"],
  ["claude", "Claude Code", "Anthropic Opus / Sonnet / Haiku", "npm i -g @anthropic-ai/claude-code"],
  ["gemini", "Gemini CLI", "Google Gemini", "npm install -g @google/gemini-cli"],
  ["qwen", "Qwen Code", "Qwen Coder", "npm install -g @qwen-code/qwen-code@latest"],
  ["opencode", "OpenCode", "OpenCode providers", "npm install -g opencode-ai"],
];

const backendStatusLabel = (detail, installed, install) => {
  if (!detail) return installed ? "可用" : `暂未安装（${install}）`;
  if (detail.status === "ready") return detail.version ? `可用 · ${detail.version}` : "可用";
  if (detail.status === "found") return "已找到，待连接测试";
  if (detail.status === "broken") return detail.detail || "命令启动失败";
  if (detail.status === "unsupported") return "当前版本暂不支持";
  return `暂未安装（${detail.installCommand || install}）`;
};

const BackendSelector = ({ backend, setBackend, aiStatus, busy, onRefresh }) => {
  const byId = aiStatus?.by_id || {};
  const details = aiStatus?.details || {};
  const loading = aiStatus === null;
  const [open, setOpen] = React.useState(false);
  const selected = BACKEND_OPTIONS.find(([id]) => id === backend) || BACKEND_OPTIONS[0];
  const detail = details[backend] || null;
  const installed = Boolean(byId[backend]);
  const status = loading ? "检测中…" : backendStatusLabel(detail, installed, selected[3]);
  React.useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1 }} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className="select"
            disabled={busy}
            onClick={() => !busy && setOpen((v) => !v)}
            style={{
              height: 38, padding: "0 12px", display: "flex", alignItems: "center",
              justifyContent: "space-between", cursor: busy ? "not-allowed" : "pointer",
              textAlign: "left",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: 15, color: "var(--text-0)" }}>{selected[1]}</span>
              <span style={{ color: "var(--text-3)" }}>·</span>
              <span style={{ fontSize: 14, color: loading ? "var(--text-2)" : installed ? "var(--brand)" : "var(--rose)" }}>
                {loading ? "检测中" : installed ? "可用" : "未安装"}
              </span>
            </span>
            <I.ChevronDown size={15} />
          </button>
          {open && (
            <div style={{
              position: "absolute", zIndex: 80, top: 44, left: 0, right: 0,
              padding: 6, borderRadius: 8, background: "var(--bg-1)",
              border: "1px solid var(--border-1)", boxShadow: "var(--shadow-lg)",
            }}>
              {BACKEND_OPTIONS.map(([id, label, hint, install]) => {
                const itemInstalled = Boolean(byId[id]);
                const itemDetail = details[id] || null;
                const active = id === backend;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => { setBackend(id); setOpen(false); }}
                    style={{
                      width: "100%", height: 38, border: 0, borderRadius: 6,
                      background: active ? "var(--brand-soft)" : "transparent",
                      color: "var(--text-0)", display: "flex", alignItems: "center",
                      padding: "0 9px", cursor: "pointer", textAlign: "left",
                    }}
                  >
                    <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
                    <span style={{ fontSize: 11, color: itemInstalled ? "var(--brand)" : "var(--rose)", marginRight: 8 }}>
                      {loading ? "检测中" : itemInstalled ? "可用" : "未安装"}
                    </span>
                    {active && <I.Check size={13} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button className="btn ghost icon" title="重新检测 CLI" onClick={onRefresh} disabled={busy || loading}>
          <I.Refresh size={14} />
        </button>
      </div>
      {!loading && !installed && (
        <div style={{
          padding: "10px 12px", borderRadius: 8,
          border: "1px solid var(--rose)", background: "rgba(244,63,94,0.08)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--rose)" }}>{selected[1]} 未安装</div>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 4 }}>{status}</div>
          <div className="mono" style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-3)" }}>{detail?.installCommand || selected[3]}</div>
        </div>
      )}
    </div>
  );
};

const WizardInput = ({ mode, setMode, desc, setDesc, audience, setAudience, length, setLength, selectedTheme, setSelectedTheme, backend, setBackend, aiStatus, onRefreshAiStatus, err, busy, onCancel, onCreate }) => {
  const hasLength = length !== null;
  const aiReady = Boolean(aiStatus?.available && aiStatus?.by_id?.[backend]);
  const baseCanCreate = mode === "manual" ? Boolean(desc.trim() && audience && hasLength) : Boolean(selectedTheme && hasLength);
  const canCreate = baseCanCreate && aiReady;
  const aiBlocked = aiStatus && !aiStatus.available;

  return (
    <>
      <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border-0)", display: "flex", gap: 8 }}>
        <button
          className={"btn sm " + (mode === "manual" ? "primary" : "ghost")}
          onClick={() => { setMode("manual"); setLength(null); }}
          disabled={busy}
        >
          手动输入
        </button>
        <button
          className={"btn sm " + (mode === "theme" ? "primary" : "ghost")}
          onClick={() => { setMode("theme"); setLength(null); }}
          disabled={busy}
        >
          选择主题
        </button>
      </div>

      <div style={{ padding: "20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: 22 }}>
        {mode === "manual" ? (
          <>
            <Section num="01" title="一句话简介" hint="讲什么故事？越具体越好">
              <textarea className="textarea serif" style={{ height: 90, fontSize: 15, lineHeight: 1.7 }}
                placeholder="例：穿越成废柴七皇子，开局就被退婚，但我觉醒了满级反派模拟器。"
                value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} disabled={busy} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, color: "var(--text-3)" }}>
                <span>创建后会后台生成书名、番茄标签、爆款简介</span>
                <span className="mono">{desc.length} / 500</span>
              </div>
            </Section>

            <Section num="02" title="目标读者" hint="必选">
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  ["male", "男频", "爽点密集 / 装逼打脸 / 升级流"],
                  ["female", "女频", "情感细腻 / 双向奔赴 / 大女主"],
                ].map(([v, label, hint]) => {
                  const on = audience === v;
                  return (
                    <div key={v} className="card" onClick={() => !busy && setAudience(v)} style={{
                      flex: 1, padding: 10, cursor: busy ? "default" : "pointer",
                      border: on ? "1px solid var(--brand)" : "1px solid var(--border-0)",
                      background: on ? "var(--brand-soft)" : "var(--bg-2)",
                    }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: on ? "var(--brand)" : "var(--text-0)" }}>{label}</div>
                      <div style={{ fontSize: 10.5, color: "var(--text-3)", marginTop: 3 }}>{hint}</div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section num="03" title="AI 后端" hint="必选">
              <BackendSelector backend={backend} setBackend={setBackend} aiStatus={aiStatus} busy={busy} onRefresh={onRefreshAiStatus} />
            </Section>

            <Section num="04" title="总章节数" hint="必选">
              <ChapterLengthSelector length={length} setLength={setLength} disabled={busy} />
            </Section>
          </>
        ) : (
          <>
            <Section num="01" title="选择主题" hint="必选" sticky>
              <ThemeSelector selected={selectedTheme} onSelect={(theme) => { setSelectedTheme(theme); setLength(null); }} disabled={busy} />
            </Section>
            {selectedTheme && (
              <>
                <Section num="02" title="AI 后端" hint="必选">
                  <BackendSelector backend={backend} setBackend={setBackend} aiStatus={aiStatus} busy={busy} onRefresh={onRefreshAiStatus} />
                </Section>
                <Section num="03" title="总章节数" hint="必选">
                  <ChapterLengthSelector length={length} setLength={setLength} disabled={busy} />
                </Section>
              </>
            )}
          </>
        )}

        {aiBlocked && (
          <div style={{
            padding: "10px 12px", borderRadius: 8,
            border: "1px solid var(--rose)", background: "rgba(244,63,94,0.08)",
            color: "var(--rose)", fontSize: 12, lineHeight: 1.6,
          }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>未检测到可用的 AI 后端，无法创建小说</div>
            <div style={{ color: "var(--text-2)" }}>
              请先安装并登录以下任意一个 CLI，然后点击重新检测：
              <div className="mono" style={{ marginTop: 4 }}>· npm i -g @openai/codex</div>
              <div className="mono">· npm i -g @anthropic-ai/claude-code</div>
            </div>
          </div>
        )}
        {err && <div style={{ color: "var(--rose)", fontSize: 12 }}>{err}</div>}
      </div>

      <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-0)", background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>
          {mode === "manual" ? "创建后直接启动写作；发布卡后台异步补齐" : "选择主题后自动填充参数并开始写作"}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button className="btn" onClick={onCancel} disabled={busy}>取消</button>
          <button className={"btn lg " + (canCreate ? "primary" : "ghost")} onClick={onCreate} disabled={busy || !canCreate}>
            <I.Play size={14} /> {busy ? "创建中…" : "创建并开始写作"}
          </button>
        </div>
      </div>
    </>
  );
};

const ChapterLengthSelector = ({ length, setLength, disabled }) => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
    {LENGTHS.map(([t, n, sub], i) => {
      const on = length === i;
      return (
        <div key={t} className="card" onClick={() => !disabled && setLength(i)} style={{
          padding: "10px 8px", cursor: disabled ? "default" : "pointer", textAlign: "center",
          border: on ? "1px solid var(--brand)" : "1px solid var(--border-0)",
          background: on ? "var(--brand-soft)" : "var(--bg-2)",
        }}>
          <div style={{ fontSize: 11.5, color: "var(--text-2)" }}>{t}</div>
          <div className="mono display" style={{ fontSize: 19, fontWeight: 600, marginTop: 2, color: on ? "var(--brand)" : "var(--text-0)" }}>{n}<span style={{ fontSize: 10, color: "var(--text-3)", marginLeft: 2 }}>章</span></div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>
        </div>
      );
    })}
  </div>
);

const Section = ({ num, title, hint, children, sticky = false }) => (
  <div>
    <div style={{
      display: "flex", alignItems: "center", gap: 8, marginBottom: 8,
      ...(sticky ? {
        position: "sticky", top: -20, zIndex: 2,
        padding: "20px 0 8px", marginTop: -20,
        background: "var(--bg-1)", borderBottom: "1px solid var(--border-0)",
      } : {}),
    }}>
      <span className="mono" style={{ fontSize: 10.5, color: "var(--brand)", border: "1px solid var(--brand)", borderRadius: 4, padding: "1px 6px" }}>{num}</span>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
      {hint && <span style={{ color: "var(--text-3)", fontSize: 11 }}>{hint}</span>}
    </div>
    {children}
  </div>
);

const SelectedThemeSummary = ({ theme, onClear, disabled }) => (
  <div className="card" style={{ padding: 12, border: "1px solid var(--brand)", background: "var(--brand-soft)" }}>
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand)", flex: 1 }}>
            {theme.title}
          </span>
          <span className={"tag sm " + (theme.audience === "male" ? "blue" : "rose")}>
            {theme.audience === "male" ? "男频" : "女频"}
          </span>
          <span className="tag ghost sm">已选</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.55, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {theme.description}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 10, color: "var(--text-3)" }}>
          <span className="tag ghost sm">{theme.category}</span>
          <span className="mono">主题已收起，请继续选择章节数</span>
        </div>
      </div>
      <button className="btn sm" onClick={onClear} disabled={disabled} title="撤销当前主题选择">
        撤销
      </button>
    </div>
  </div>
);

const ThemeSelector = ({ selected, onSelect, disabled }) => {
  const [themes, setThemes] = React.useState([]);
  const [filter, setFilter] = React.useState("all"); // "all" | "male" | "female"
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let live = true;
    api.themes().then((data) => {
      if (!live) return;
      setThemes(data.themes || []);
      setLoading(false);
    }).catch((e) => {
      if (!live) return;
      console.error("failed to load themes:", e);
      setLoading(false);
    });
    return () => { live = false; };
  }, []);

  const filtered = themes.filter((t) => filter === "all" || t.audience === filter);

  if (loading) {
    return <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>加载主题库...</div>;
  }

  if (themes.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
        <div>暂无可用主题</div>
        <div style={{ fontSize: 11, marginTop: 8 }}>请先运行 <code>npm run build:themes</code> 生成主题库</div>
      </div>
    );
  }

  if (selected) {
    return <SelectedThemeSummary theme={selected} onClear={() => onSelect(null)} disabled={disabled} />;
  }

  return (
    <>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <button className={"btn sm " + (filter === "all" ? "primary" : "ghost")} onClick={() => setFilter("all")} disabled={disabled}>
          全部 · {themes.length}
        </button>
        <button className={"btn sm " + (filter === "male" ? "primary" : "ghost")} onClick={() => setFilter("male")} disabled={disabled}>
          男频 · {themes.filter(t => t.audience === "male").length}
        </button>
        <button className={"btn sm " + (filter === "female" ? "primary" : "ghost")} onClick={() => setFilter("female")} disabled={disabled}>
          女频 · {themes.filter(t => t.audience === "female").length}
        </button>
      </div>

      <div style={{ maxHeight: 400, overflow: "auto", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {filtered.map((theme) => {
          const isSelected = selected?.id === theme.id;
          return (
            <div
              key={theme.id}
              className="card"
              onClick={() => !disabled && onSelect(isSelected ? null : theme)}
              style={{
                padding: 12,
                cursor: disabled ? "default" : "pointer",
                border: isSelected ? "2px solid var(--brand)" : "1px solid var(--border-0)",
                background: isSelected ? "var(--brand-soft)" : "var(--bg-2)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: isSelected ? "var(--brand)" : "var(--text-0)", flex: 1 }}>
                  {theme.title}
                </span>
                <span className={"tag sm " + (theme.audience === "male" ? "blue" : "rose")}>
                  {theme.audience === "male" ? "男频" : "女频"}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", lineHeight: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                {theme.description}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, fontSize: 10, color: "var(--text-3)" }}>
                <span className="tag ghost sm">{theme.category}</span>
                <span className="mono">{theme.target_chapters}章</span>
                {isSelected && <span style={{ marginLeft: "auto", color: "var(--brand)" }}><I.Check size={12} /> 已选</span>}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ padding: 48, textAlign: "center", color: "var(--text-3)" }}>
          该类型暂无可用主题
        </div>
      )}
    </>
  );
};

window.HomeScreen = HomeScreen;
