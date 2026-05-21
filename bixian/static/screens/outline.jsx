// Outline — kanban of chapter designs grouped into pseudo-volumes

const OutlineScreen = ({ onShelf, onTab, projectId }) => {
  const { data: state } = usePoll(() => api.state(projectId), 5000, [projectId]);
  const { data: designs } = usePoll(() => api.designs(projectId), 5000, [projectId]);

  if (!state) return null;
  if (!state.initialized) {
    return (
      <div className="frame">
        <TitleBar onShelf={onShelf} project="未选择项目" />
        <RailNav active="outline" onShelf={onShelf} onTab={onTab} projectMode />
        <EmptyState title="先到书架选一本小说" action={<button className="btn primary" onClick={onShelf}><I.Home size={13} /> 去书架</button>} />
      </div>
    );
  }

  const setup = state.setup || {};
  const ds = designs?.designs || [];
  const target = setup.target_chapters || ds.length || 1;
  const status = pipelineStatus(state, target);
  const isWriting = status === "writing";
  const writingOrder = isWriting ? (state.summary?.chapters || 0) + 1 : null;

  // Split designs into 3 acts evenly
  const acts = (() => {
    if (ds.length === 0) return [];
    const total = ds.length;
    const a = Math.ceil(total / 3);
    const b = Math.ceil((total * 2) / 3);
    return [
      { name: "第一卷 · 起", color: "amber", glow: "",       chs: ds.slice(0, a) },
      { name: "第二卷 · 承", color: "warn",  glow: "orange", chs: ds.slice(a, b) },
      { name: "第三卷 · 转合", color: "purple", glow: "purple", chs: ds.slice(b) },
    ].filter((act) => act.chs.length);
  })();

  return (
    <div className="frame">
      <TitleBar onShelf={onShelf} project={state.display_title || "未命名"} status={status} crumbs={["大纲"]} />
      <RailNav active="outline" onShelf={onShelf} onTab={onTab} projectMode />
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div className="head">
          <span className="title">大纲一览</span>
          <span className="tag">只读 · AI 生成</span>
          <span style={{ color: "var(--text-2)", fontSize: 12 }}>三幕 · {ds.length} 章 / 目标 {target} 章</span>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
          {acts.length === 0 ? (
            <EmptyState title="分章设计尚未生成" hint="启动 pipeline 完成 design 阶段后会出现章节卡。" />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
              {acts.map((act) => (
                <div key={act.name} className={"card glow " + act.glow} style={{ display: "flex", flexDirection: "column", gap: 10, padding: 14, background: "oklch(0.165 0.012 230 / 0.6)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: `var(--${act.color})`, boxShadow: `0 0 10px var(--${act.color})` }} />
                    <div className="display" style={{ fontWeight: 700, fontSize: 15, color: `var(--${act.color})` }}>{act.name}</div>
                    <span className="tag" style={{ marginLeft: "auto", color: `var(--${act.color})`, background: `var(--${act.color}-soft)`, borderColor: "transparent" }}>{act.chs.length} 章</span>
                  </div>
                  {act.chs.map((d) => {
                    const chapterWriting = d.order === writingOrder;
                    const st = d.status === "written" ? "done" : chapterWriting ? "writing" : "queued";
                    return (
                      <div key={d.order} className="card" style={{
                        padding: 12,
                        border: st === "writing" ? "1px solid var(--brand)" : "1px solid var(--border-0)",
                        background: st === "queued" ? "transparent" : "var(--bg-1)",
                        borderStyle: st === "queued" ? "dashed" : "solid",
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-3)" }}>
                          <span className="mono">ch.{String(d.order).padStart(3, "0")}</span>
                          <span style={{ marginLeft: "auto" }}>
                            {st === "done" && <span className="tag green"><I.Check size={9} /> 已生成</span>}
                            {st === "writing" && <span className="tag amber"><span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> 生成中</span>}
                            {st === "queued" && <span className="tag"><I.Clock size={9} /> 待生成</span>}
                          </span>
                        </div>
                        <div className="display" style={{ fontWeight: 600, fontSize: 14, marginTop: 8, color: st === "queued" ? "var(--text-2)" : "var(--text-0)" }}>{d.title}</div>
                        {d.highlight && <div className="t3" style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, lineHeight: 1.6 }}>{d.highlight}</div>}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

window.OutlineScreen = OutlineScreen;
