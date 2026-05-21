// RailNav + TitleBar — Supabase-style chrome

const PROJECT_TABS = [
  ["reader", I.Book, "阅读台"],
  ["progress", I.Sparkles, "生成进度"],
  ["outline", I.Outline, "大纲"],
  ["character", I.Users, "人物"],
];

const pipelineStatus = (state, target) => {
  if (!state) return "ready";
  if (state.paused) return "paused";
  if (state.running) return "writing";
  const chapters = state.summary?.chapters || 0;
  const total = target || state.setup?.target_chapters || state.summary?.target_chapters || 0;
  if (total > 0 && chapters >= total) return "done";
  return "ready";
};

// RailNav has two modes:
//   shelf  → only logo (→ shelf)
//   project → logo (→ shelf), divider, 4 project tabs
const RailNav = ({ active, onShelf, onTab, projectMode = false }) => (
  <div className={"railnav" + (projectMode ? "" : " shelf-mode")}>
    {projectMode && (
      <>
        <div className="logo" onClick={onShelf} title="回到书架" style={{ cursor: "pointer" }}>笔</div>
        <div className="divider" />
        {PROJECT_TABS.map(([k, Ic, label]) => (
          <div key={k}
            className={"item " + (active === k ? "active" : "")}
            title={label}
            onClick={() => onTab && onTab(k)}>
            <Ic size={18} />
          </div>
        ))}
      </>
    )}
    <div className="spacer" />
  </div>
);

const TitleBar = ({ project = "未选择项目", status = "ready", crumbs = [], right, onShelf, shelf = false }) => (
  <div className={"titlebar" + (shelf ? " shelf-mode" : "")}>
    {!shelf && onShelf && (
      <button type="button" className="backbtn" onClick={onShelf} title="返回书架" aria-label="返回书架">
        <I.ArrowLeft size={14} />
      </button>
    )}
    <div className="crumb">
      {!shelf && (
        <span className="org-badge" onClick={onShelf} style={{ cursor: onShelf ? "pointer" : "default" }} title={onShelf ? "回到书架" : null}>BX</span>
      )}
      <span style={{ color: "var(--text-1)", cursor: onShelf ? "pointer" : "default" }} onClick={onShelf}>笔仙助手</span>
      <span className="sep">/</span>
      <span className="name">{project}</span>
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          <span className="sep">/</span>
          <span style={{ color: "var(--text-1)" }}>{c}</span>
        </React.Fragment>
      ))}
      <I.ChevronDown size={12} style={{ color: "var(--text-3)", marginLeft: 2 }} />
    </div>

    {status === "writing" && (
      <span className="tag green" style={{ marginLeft: 4 }}>
        <span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> 生成中
      </span>
    )}
    {status === "paused" && (
      <span className="tag" style={{ marginLeft: 4 }}>已暂停</span>
    )}
    {status === "done" && (
      <span className="tag blue" style={{ marginLeft: 4 }}><I.Check size={9} /> 已完结</span>
    )}

    <div className="right">
      {right}
      <div className="iconbtn" title="刷新" onClick={() => location.reload()}><I.Refresh size={14} /></div>
    </div>
  </div>
);

// Big placeholder for empty states
const EmptyState = ({ title = "暂无内容", hint, action }) => (
  <div style={{
    flex: 1, display: "grid", placeItems: "center",
    color: "var(--text-2)", textAlign: "center", padding: 32,
  }}>
    <div>
      <div style={{
        width: 56, height: 56, borderRadius: 14, margin: "0 auto 14px",
        background: "var(--bg-2)", color: "var(--text-3)",
        display: "grid", placeItems: "center",
      }}><I.Book size={26} /></div>
      <div className="display" style={{ fontSize: 16, fontWeight: 600, color: "var(--text-0)" }}>{title}</div>
      {hint && <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--text-3)" }}>{hint}</div>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  </div>
);

window.RailNav = RailNav;
window.TitleBar = TitleBar;
window.EmptyState = EmptyState;
window.pipelineStatus = pipelineStatus;
