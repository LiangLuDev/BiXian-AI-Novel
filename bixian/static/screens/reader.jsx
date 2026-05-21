// Reader — chapter list + preview

const ReaderScreen = ({ onShelf, onTab, projectId }) => {
  const { data: state } = usePoll(() => api.state(projectId), 5000, [projectId]);
  const { data: designs } = usePoll(() => api.designs(projectId), 5000, [projectId]);
  const [active, setActive] = React.useState(null);
  const [chapter, setChapter] = React.useState(null);
  const [filter, setFilter] = React.useState("");

  const ds = designs?.designs || [];
  const written = ds.filter((d) => d.status === "written");

  React.useEffect(() => {
    if (active == null && written.length > 0) setActive(written[written.length - 1].order);
  }, [written.length]);

  React.useEffect(() => {
    if (active == null) return;
    let live = true;
    api.chapter(active, projectId).then((c) => { if (live) setChapter(c); }).catch(() => {});
    return () => { live = false; };
  }, [active, projectId]);

  if (!state) return <Loading onShelf={onShelf} onTab={onTab} />;
  if (!state.initialized) {
    return (
      <div className="frame">
        <TitleBar onShelf={onShelf} project="未选择项目" />
        <RailNav active="reader" onShelf={onShelf} onTab={onTab} projectMode />
        <EmptyState title="先到书架选一本小说" action={<button className="btn primary" onClick={onShelf}><I.Home size={13} /> 去书架</button>} />
      </div>
    );
  }

  const setup = state.setup || {};
  const filtered = ds.filter((d) =>
    !filter || d.title.toLowerCase().includes(filter.toLowerCase()) || String(d.order).includes(filter)
  );
  const status = pipelineStatus(state, setup.target_chapters || ds.length || 0);
  const isWriting = status === "writing";
  const writingOrder = isWriting ? (state.summary?.chapters || 0) + 1 : null;

  const prev = active != null ? written.find((w, i, arr) => arr[i + 1] && arr[i + 1].order === active) : null;
  const next = active != null ? written.find((w, i, arr) => i > 0 && arr[i - 1].order === active) : null;

  return (
    <div className="frame">
      <TitleBar onShelf={onShelf} project={state.display_title || "未命名"} status={status} crumbs={["阅读台"]} />
      <RailNav active="reader" onShelf={onShelf} onTab={onTab} projectMode />
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 0, overflow: "hidden" }}>
        <div className="subnav">
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <CoverBox genre={setup.genre} src={state.cover_image_url} width={32} height={44} labelStyle={{ fontSize: 8 }} />
              <div style={{ minWidth: 0 }}>
                <div className="display" style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.display_title || "未命名"}</div>
                <div style={{ fontSize: 10.5, color: "var(--text-3)" }} className="mono">
                  {written.length} / {setup.target_chapters} 章 · {((state.summary?.total_words || 0) / 10000).toFixed(1)}万字
                </div>
              </div>
            </div>
            <input className="input" style={{ height: 28, padding: "0 10px", fontSize: 12 }}
              placeholder="搜索章节" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <hr className="hr" />
          <div className="sec">章节 <span className="mono" style={{ color: "var(--text-3)" }}>{filtered.length} 章</span></div>
          <div style={{ overflow: "auto", flex: 1, paddingBottom: 8 }}>
            {filtered.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 11.5, color: "var(--text-3)" }}>暂无章节</div>
            )}
            {filtered.map((d) => {
              const isCurrentWriting = d.order === writingOrder;
              const clickable = d.status === "written";
              return (
                <div key={d.order}
                  className={"item " + (active === d.order ? "active" : "")}
                  onClick={() => clickable && setActive(d.order)}
                  style={{ cursor: clickable ? "pointer" : "default", opacity: clickable ? 1 : (isCurrentWriting ? 1 : 0.55) }}>
                  <span className="mono" style={{ color: "var(--text-3)", fontSize: 10.5, width: 50 }}>ch.{String(d.order).padStart(3, "0")}</span>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isCurrentWriting ? "var(--brand)" : undefined }}>{d.title}</span>
                  {isCurrentWriting ? (
                    <span className="meta" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--brand)" }}>
                      <span className="pulse" style={{ width: 6, height: 6, boxShadow: "none" }} /> 生成中
                    </span>
                  ) : (
                    <span className="meta">{d.word_count ? `${(d.word_count / 1000).toFixed(1)}k` : "—"}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="reader-spotlight" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          {chapter ? (
            <>
              <div className="head">
                <button className="btn ghost icon sm" disabled={!prev} onClick={() => prev && setActive(prev.order)}><I.ArrowLeft size={12} /></button>
                <span className="mono" style={{ color: "var(--text-3)", fontSize: 11 }}>ch.{String(chapter.order).padStart(3, "0")} / {setup.target_chapters}</span>
                <span className="title">{chapter.title}</span>
                <div className="right">
                  <span style={{ color: "var(--text-3)", fontSize: 11.5 }} className="mono">{chapter.word_count.toLocaleString()} 字 · 估读 {Math.ceil(chapter.word_count / 350)} 分钟</span>
                  <button className="btn ghost icon sm" disabled={!next} onClick={() => next && setActive(next.order)}><I.ChevronRight size={12} /></button>
                </div>
              </div>

              <div style={{ flex: 1, overflow: "auto", padding: "56px 64px 80px" }}>
                <div style={{ maxWidth: 720, margin: "0 auto" }}>
                  <div className="display" style={{ fontSize: 30, fontWeight: 700, textAlign: "center", letterSpacing: "-0.02em" }}>
                    第{chapter.order}章　{chapter.title}
                  </div>
                  <div style={{ color: "var(--text-3)", marginTop: 8, fontSize: 11.5, fontFamily: "var(--font-mono)", textAlign: "center" }}>
                    {chapter.word_count.toLocaleString()} 字
                  </div>
                  <div className="serif" style={{ marginTop: 32, fontSize: 16.5, lineHeight: 2, color: "var(--text-0)" }}>
                    {chapter.body.split(/\n\s*\n/).filter(Boolean).map((p, i) => (
                      <p key={i} style={{ textIndent: "2em", margin: "0 0 1em" }}>{p}</p>
                    ))}
                  </div>

                  <div style={{ marginTop: 64, paddingTop: 24, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <div className="card interactive" style={{ padding: 14, opacity: prev ? 1 : 0.4, cursor: prev ? "pointer" : "default" }} onClick={() => prev && setActive(prev.order)}>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>← {prev ? `ch.${String(prev.order).padStart(3, "0")}` : "—"}</div>
                      <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-0)" }}>{prev?.title || "已是第一章"}</div>
                    </div>
                    <div className="card interactive" style={{ padding: 14, textAlign: "right", opacity: next ? 1 : 0.4, cursor: next ? "pointer" : "default" }} onClick={() => next && setActive(next.order)}>
                      <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>{next ? `ch.${String(next.order).padStart(3, "0")}` : "—"} →</div>
                      <div style={{ fontSize: 13, marginTop: 4, color: "var(--text-0)" }}>{next?.title || "已是最新章"}</div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState title={written.length === 0 ? "尚无已生成章节" : "选一章开始阅读"} hint={written.length === 0 ? "去生成进度页启动 pipeline。" : null} />
          )}
        </div>
      </div>
    </div>
  );
};

window.ReaderScreen = ReaderScreen;
