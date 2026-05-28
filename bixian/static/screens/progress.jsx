// Progress — generation hero + recent chapters + live excerpt

const ProgressScreen = ({ onShelf, onTab, projectId }) => {
  const { data: state, reload: reloadState } = usePoll(() => api.state(projectId), 3000, [projectId]);
  const { data: designs } = usePoll(() => api.designs(projectId), 5000, [projectId]);
  const { data: usage, reload: reloadUsage } = usePoll(() => api.usage(projectId), 5000, [projectId]);
  const [events, setEvents] = React.useState([]);
  const [currentAgent, setCurrentAgent] = React.useState(null);
  const [currentPhase, setCurrentPhase] = React.useState(null);
  const [currentChapter, setCurrentChapter] = React.useState(null);
  const [modelModalOpen, setModelModalOpen] = React.useState(false);
  const [continueModalOpen, setContinueModalOpen] = React.useState(false);
  const [continueTarget, setContinueTarget] = React.useState("");
  const [continueBusy, setContinueBusy] = React.useState(false);
  const [continueErr, setContinueErr] = React.useState("");

  useEventStream(React.useCallback((raw) => {
    const ev = { ...(raw?.data || {}), ...raw };
    setEvents((es) => [...es.slice(-50), ev]);

    if (ev.type === "agent_started" && ev.agent) setCurrentAgent(ev.agent);
    if (ev.type === "agent_completed") { setCurrentAgent(null); reloadState(); }
    if (ev.type === "tokens_updated") reloadUsage();
    if (ev.type === "phase_started" && ev.phase) setCurrentPhase(ev.phase);
    if (ev.type === "phase_completed") setCurrentPhase(null);
    if (ev.type === "pipeline_completed" || ev.type === "pipeline_stopped" || ev.type === "pipeline_failed") {
      setCurrentAgent(null); setCurrentPhase(null); setCurrentChapter(null);
      reloadState(); reloadUsage();
    }
    if (ev.type === "state_updated") reloadState();
    if (ev.type === "chapter_started" && ev.order != null) setCurrentChapter(ev.order);
    if (ev.type === "chapter_completed") { reloadState(); setCurrentChapter(null); }
  }, [reloadState, reloadUsage]), projectId);

  if (!state) return <Loading onShelf={onShelf} onTab={onTab} />;
  if (!state.initialized) {
    return (
      <div className="frame">
        <TitleBar onShelf={onShelf} project="未选择项目" />
        <RailNav active="progress" onShelf={onShelf} onTab={onTab} projectMode />
        <EmptyState title="先到书架选一本小说" hint="或者新建一本，再回来看进度。"
          action={<button className="btn primary" onClick={onShelf}><I.Home size={13} /> 去书架</button>} />
      </div>
    );
  }

  const setup = state.setup || {};
  const sum = state.summary || {};
  const target = setup.target_chapters || 1;
  const chapters = sum.chapters || 0;
  const totalWords = sum.total_words || 0;
  const pct = Math.min(100, (chapters / target) * 100);
  const avgWords = chapters > 0 ? Math.round(totalWords / chapters) : 0;
  const status = pipelineStatus(state, target);
  const isWriting = status === "writing";
  const isPaused = status === "paused";
  const canControl = state.can_control !== false;
  const backendLabel = (BACKEND_OPTIONS.find(([id]) => id === (state.backend || setup.backend || "codex")) || BACKEND_OPTIONS[0])[1];
  const modelLabel = state.model || setup.model || "默认分层";
  const activeChapter = isWriting && currentChapter != null ? currentChapter : null;
  const phaseLabel = {
    setup: "构建世界",
    design: "分章设计",
    write: "写正文",
    chapters: "写正文",
    finalize: "收尾打磨",
  }[currentPhase] || "";

  const ds = designs?.designs || [];
  const recent = (() => {
    const slice = ds.slice(Math.max(0, chapters - 3), chapters + 4);
    return slice.map((d) => {
      let st = d.status === "written" ? "done" : d.status === "invalid" ? "invalid" : "queue";
      if (isWriting && activeChapter && d.order === activeChapter) st = "running";
      return { ...d, st };
    });
  })();

  const openContinue = () => {
    setContinueTarget(String(Math.max(target + 1, target * 2)));
    setContinueErr("");
    setContinueModalOpen(true);
  };

  const submitContinue = async () => {
    setContinueBusy(true); setContinueErr("");
    try {
      const n = Number(continueTarget);
      if (!n || !Number.isFinite(n) || n <= target) throw new Error(`新章数必须大于当前 ${target} 章`);
      await api.continueWriting(projectId, n);
      setContinueModalOpen(false);
      reloadState();
    } catch (e) {
      setContinueErr(e.message || String(e));
    } finally {
      setContinueBusy(false);
    }
  };

  const togglePause = async () => {
    if (!canControl) return;
    try {
      if (isPaused) await api.resume(projectId);
      else if (isWriting) await api.pause(projectId);
      else await api.run({ mode: "all" }, projectId);
      reloadState();
    } catch (e) { alert(e.message); }
  };

  return (
    <div className="frame">
      <TitleBar onShelf={onShelf} project={state.display_title || "未命名"} status={status} crumbs={["自动生成"]} />
      <RailNav active="progress" onShelf={onShelf} onTab={onTab} projectMode />
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div className="head">
          <span className="title">生成进度</span>
          {isWriting && (
            <span className="tag green" title={currentAgent ? `agent: ${currentAgent}` : ""}>
              <span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} />
              {phaseLabel ? `RUNNING · ${phaseLabel}` : "RUNNING"}
              {activeChapter ? ` · ch.${String(activeChapter).padStart(3, "0")}` : ""}
            </span>
          )}
          {isPaused && <span className="tag warn">PAUSED</span>}
          {status === "done" && <span className="tag blue"><I.Check size={9} /> DONE</span>}
          {status === "ready" && <span className="tag">IDLE</span>}
          {!canControl && <span className="tag warn">只读</span>}
          <span style={{ color: "var(--text-2)", fontSize: 12 }}>已生成 {chapters} 章 · 共 {target} 章</span>
          {usage && usage.total > 0 && (
            <span className="mono" style={{ color: "var(--text-2)", fontSize: 11 }}>
              · {usage.total.toLocaleString()} tokens{usage.cost_usd > 0 ? ` · $${usage.cost_usd.toFixed(4)}` : ""}
            </span>
          )}
          <div className="right">
            <button className="btn sm" onClick={() => setModelModalOpen(true)} disabled={!canControl} title="设置本书后续生成使用的模型">
              <I.Sliders size={12} /> {backendLabel} · {modelLabel}
            </button>
            {chapters >= target && target > 0 && !isWriting && !isPaused && (
              <button className="btn sm" onClick={openContinue} disabled={!canControl} title="续写更多章节">
                <I.Plus size={12} /> 续写
              </button>
            )}
            <button className="btn sm" onClick={togglePause} disabled={!canControl}>
              {isPaused ? <><I.Play size={12} /> 继续</> : isWriting ? <><I.Pause size={12} /> 暂停</> : <><I.Play size={12} /> 启动</>}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 32 }}>
          <div style={{ maxWidth: 1000, margin: "0 auto", display: "flex", flexDirection: "column", gap: 18 }}>
            <StageFlow
              state={state}
              sum={sum}
              designs={ds}
              currentAgent={currentAgent || state.current_agent}
              currentPhase={currentPhase}
              currentChapter={currentChapter ?? state.current_chapter}
              status={status}
            />
            <div className="card" style={{ padding: 28 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 60, height: 60, borderRadius: 14, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center", border: "1px solid var(--brand-dim)" }}>
                  <I.Sparkles size={28} />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="display" style={{ fontSize: 18, fontWeight: 600 }}>
                    {isWriting
                      ? (activeChapter ? `正在生成 ch.${String(activeChapter).padStart(3, "0")}` : phaseLabel || "运行中…")
                      : isPaused ? "已暂停" : chapters >= target ? "已完结" : "等待启动"}
                  </div>
                  <div style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
                    全本 <span className="mono" style={{ color: "var(--text-0)" }}>{target} 章</span> · 已完成 <span className="mono" style={{ color: "var(--brand)" }}>{chapters} 章</span>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="mono display" style={{ fontSize: 32, color: "var(--brand)" }}>{pct.toFixed(1)}%</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-3)" }}>整本进度</div>
                </div>
              </div>

              <div style={{ marginTop: 22 }}>
                <div className="progress green" style={{ height: 8 }}><div className="fill" style={{ width: `${pct}%` }} /></div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" }}>
                <span>ch.001</span>
                <span style={{ color: isWriting && activeChapter ? "var(--brand)" : "var(--text-2)" }}>
                  {activeChapter ? `● 当前 ch.${String(activeChapter).padStart(3, "0")}` : `已完成 ch.${String(chapters).padStart(3, "0")}`}
                </span>
                <span>ch.{String(target).padStart(3, "0")}</span>
              </div>

              <ChapterStepProgress
                running={isWriting && activeChapter != null}
                chapter={activeChapter}
                currentAgent={currentAgent}
                runQa={true}
              />

              <div style={{ marginTop: 24, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[
                  ["已生成字数", `${(totalWords / 10000).toFixed(1)} 万`, "amber"],
                  ["平均章节", `${avgWords.toLocaleString()} 字`, "blue"],
                  ["主角数", `${sum.main_chars || 0}`, "green"],
                  ["设定阶段", sum.has_outline ? "已完成" : sum.has_world ? "构建中" : "未启动", "purple"],
                ].map(([k, v, c]) => (
                  <div key={k} style={{ padding: "12px 14px", background: "var(--bg-2)", borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{k}</div>
                    <div className="mono display" style={{ fontSize: 20, color: `var(--${c})`, marginTop: 4 }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card" style={{ padding: 20 }}>
              <div className="sec-title" style={{ padding: 0, marginBottom: 14 }}>近期章节</div>
              {recent.length === 0 ? (
                <div style={{ color: "var(--text-3)", fontSize: 12, padding: "8px 0" }}>分章设计尚未生成，启动后会自动建立。</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {recent.map((d) => {
                    const st = d.st;
                    return (
                      <div key={d.order} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 10px", background: st === "running" ? "var(--bg-2)" : "transparent", borderRadius: 6 }}>
                        <div style={{
                          width: 18, height: 18, borderRadius: "50%",
                          background: st === "done" ? "var(--brand-soft)" : st === "running" ? "var(--warn-soft)" : st === "invalid" ? "rgba(229,72,77,0.12)" : "var(--bg-2)",
                          color: st === "done" ? "var(--brand)" : st === "running" ? "var(--warn)" : st === "invalid" ? "var(--danger, #e5484d)" : "var(--text-3)",
                          display: "grid", placeItems: "center", flex: "0 0 18px",
                          border: `1px solid ${st === "done" ? "var(--brand-dim)" : st === "running" ? "var(--warn)" : st === "invalid" ? "var(--danger, #e5484d)" : "var(--border-0)"}`,
                        }}>
                          {st === "done" ? <I.Check size={10} /> : st === "running" ? <span className="pulse" style={{ width: 6, height: 6, boxShadow: "none" }} /> : st === "invalid" ? <I.X size={10} /> : <I.Clock size={10} />}
                        </div>
                        <span className="mono" style={{ fontSize: 11.5, color: "var(--text-3)", width: 52 }}>ch.{String(d.order).padStart(3, "0")}</span>
                        <span style={{ flex: 1, fontSize: 13, color: st === "queue" ? "var(--text-3)" : st === "invalid" ? "var(--danger, #e5484d)" : "var(--text-0)" }}>{d.title || "—"}</span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-2)", width: 100, textAlign: "right" }}>
                          {st === "done" ? `${d.word_count.toLocaleString()} 字` : st === "running" ? "正在生成…" : st === "invalid" ? "异常" : "队列中"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 16 }}>
              <div className="sec-title" style={{ padding: 0, marginBottom: 8 }}>事件流（最近 {events.length}）</div>
              <div className="mono" style={{ fontSize: 11, color: "var(--text-2)", maxHeight: 160, overflow: "auto", lineHeight: 1.7 }}>
                {events.slice(-30).reverse().map((e, i) => {
                  const isErr = e.type === "agent_failed" || e.type === "pipeline_failed" || e.type === "cover_image_failed" || e.level === "error";
                  return (
                    <div key={i} style={isErr ? { color: "var(--danger, #e5484d)" } : null}>
                      <span style={{ color: isErr ? "var(--danger, #e5484d)" : "var(--text-3)" }}>[{(e.type || "").padEnd(20)}]</span>{" "}
                      {e.phase && <span style={{ color: "var(--text-2)" }}>{e.phase}</span>}{" "}
                      {e.agent && <span style={{ color: "var(--brand)" }}>{e.agent}</span>}{" "}
                      {e.order != null && <span style={{ color: "var(--text-1)" }}>ch.{e.order}</span>}{" "}
                      {e.word_count != null && <span style={{ color: "var(--text-3)" }}>· {e.word_count} 字</span>}{" "}
                      {e.reason && <span>{e.reason}</span>}{" "}
                      {e.path && <span style={{ color: "var(--text-3)" }}>{e.path}</span>}{" "}
                      {e.message && <span>{e.message}</span>}{" "}
                      {e.error && <span style={{ color: "var(--danger, #e5484d)" }}>{e.error}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      {modelModalOpen && (
        <AiBackendModal
          state={state}
          projectId={projectId}
          onClose={() => setModelModalOpen(false)}
          onSaved={() => { setModelModalOpen(false); reloadState(); }}
        />
      )}
      {continueModalOpen && (
        <div className="modal-overlay" onClick={() => !continueBusy && setContinueModalOpen(false)}>
          <div className="modal-panel" style={{ width: 460, maxWidth: "calc(100vw - 32px)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-0)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>续写本书</div>
              <button className="iconbtn" onClick={() => !continueBusy && setContinueModalOpen(false)}><I.X size={14} /></button>
            </div>
            <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
                当前 <span className="mono" style={{ color: "var(--text-0)" }}>{target}</span> 章已完成。把目标章数改大，AI 会生成"续集卷"大纲、分卷、弧线，并按续集上下文继续写章节。
              </div>
              <label style={{ fontSize: 12, color: "var(--text-3)" }}>新目标章数</label>
              <input
                type="number"
                className="input"
                value={continueTarget}
                onChange={(e) => setContinueTarget(e.target.value)}
                min={target + 1}
                autoFocus
                style={{ padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border-0)", background: "var(--bg-2)", color: "var(--text-0)" }}
              />
              {continueErr && <div style={{ color: "var(--danger, #e5484d)", fontSize: 12 }}>{continueErr}</div>}
            </div>
            <div style={{ padding: "12px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn sm" onClick={() => setContinueModalOpen(false)} disabled={continueBusy}>取消</button>
              <button className="btn sm primary" onClick={submitContinue} disabled={continueBusy}>{continueBusy ? "提交中…" : "开始续写"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const MODEL_PLACEHOLDERS = {
  codex: "例如 gpt-5.5；留空使用强/中/轻量默认分层",
  claude: "例如 claude-sonnet-4-6；留空使用默认分层",
  gemini: "例如 gemini-3-pro-preview；留空使用默认分层",
  qwen: "例如 qwen3-coder-plus；留空使用默认分层",
  opencode: "例如 openai/gpt-5；留空使用默认分层",
};

const AiBackendModal = ({ state, projectId, onClose, onSaved }) => {
  const setup = state.setup || {};
  const initialBackend = state.backend || setup.backend || "codex";
  const initialModel = state.model || setup.model || "";
  const [backend, setBackend] = React.useState(initialBackend);
  const [model, setModel] = React.useState(initialModel);
  const [aiStatus, setAiStatus] = React.useState(null);
  const { busy, err, setErr, run } = useAsyncAction();

  const refreshAiStatus = React.useCallback(() => {
    let live = true;
    setAiStatus(null);
    api.aiStatus()
      .then((s) => { if (live) setAiStatus(s); })
      .catch(() => { if (live) setAiStatus({ available: false, by_id: {}, details: {} }); });
    return () => { live = false; };
  }, []);

  React.useEffect(() => refreshAiStatus(), []);

  React.useEffect(() => {
    if (!aiStatus?.by_id || aiStatus.by_id[backend]) return;
    const fallback = BACKEND_OPTIONS.find(([id]) => aiStatus.by_id[id]);
    if (fallback) setBackend(fallback[0]);
  }, [aiStatus, backend]);

  const selected = BACKEND_OPTIONS.find(([id]) => id === backend) || BACKEND_OPTIONS[0];
  const installed = Boolean(aiStatus?.by_id?.[backend]);
  const changed = backend !== initialBackend || model.trim() !== initialModel;
  const isRunning = Boolean(state.running || state.queued || state.paused);

  const save = () => run(async () => {
    if (!aiStatus || !aiStatus.available) {
      setErr("未检测到可用的 AI 后端，请先安装并登录 CLI。");
      return;
    }
    if (!installed) {
      setErr(`所选后端「${selected[1]}」尚未安装或不可用。`);
      return;
    }
    await api.updateAiBackend(projectId, { backend, model: model.trim() });
    onSaved();
  });

  return (
    <div className="modal-overlay">
      <div className="modal-panel" style={{ width: 560, maxWidth: "calc(100vw - 32px)" }}>
        <div style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid var(--border-0)" }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: "var(--brand-soft)", color: "var(--brand)", display: "grid", placeItems: "center" }}>
            <I.Sliders size={14} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="display" style={{ fontSize: 15, fontWeight: 600 }}>后续模型</div>
            <div style={{ fontSize: 11.5, color: "var(--text-3)" }}>只影响未生成章节；已写章节不会重写</div>
          </div>
          <button className="btn ghost icon" onClick={onClose} disabled={busy}><I.X size={14} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginBottom: 8 }}>AI 后端</div>
            <BackendSelector
              backend={backend}
              setBackend={setBackend}
              aiStatus={aiStatus}
              busy={busy}
              onRefresh={refreshAiStatus}
            />
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text-2)" }}>指定模型</span>
              <button className="btn ghost sm" onClick={() => setModel("")} disabled={busy || !model}>使用默认分层</button>
            </div>
            <input
              className="input"
              value={model}
              disabled={busy}
              onChange={(e) => setModel(e.target.value)}
              placeholder={MODEL_PLACEHOLDERS[backend] || "留空使用默认分层"}
            />
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--text-3)", lineHeight: 1.6 }}>
              留空时，系统会按任务类型自动选择强模型、普通模型和轻量模型；填写后，本书后续所有文本任务统一使用该模型。
            </div>
          </div>

          {isRunning && (
            <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--warn-soft)", color: "var(--warn)", fontSize: 12 }}>
              当前任务已创建，保存后对下一次启动或排队尚未开始的任务生效。
            </div>
          )}

          {err && <div style={{ color: "var(--rose)", fontSize: 12 }}>{err}</div>}
        </div>

        <div style={{ padding: 16, display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid var(--border-0)", background: "var(--bg-0)" }}>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-3)", alignSelf: "center" }}>
            当前：{BACKEND_OPTIONS.find(([id]) => id === initialBackend)?.[1] || initialBackend} · {initialModel || "默认分层"}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={onClose} disabled={busy}>取消</button>
            <button className="btn primary" onClick={save} disabled={busy || !changed || aiStatus === null}>
              {busy ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const CHAPTER_STEPS = [
  { key: "chapter_body", label: "正文写作", hint: "Codex 正在生成本章正文" },
  { key: "chapter_postprocess", label: "审稿入库", hint: "抽取摘要、角色、关系、伏笔并修正硬伤" },
];

const chapterOrderFromAgent = (agent) => {
  const m = String(agent || "").match(/\[(\d+)\]/);
  return m ? Number(m[1]) : null;
};

const chapterStepIndex = (agent) => {
  const a = String(agent || "");
  const idx = CHAPTER_STEPS.findIndex((s) => a.startsWith(s.key));
  return idx >= 0 ? idx : -1;
};

const ChapterStepProgress = ({ running, chapter, currentAgent }) => {
  if (!running || !chapter) return null;
  const activeIdx = chapterStepIndex(currentAgent);
  const effectiveIdx = activeIdx >= 0 ? activeIdx : 0;
  const pct = Math.max(5, Math.min(96, ((effectiveIdx + 0.35) / CHAPTER_STEPS.length) * 100));

  return (
    <div style={{ marginTop: 18, padding: 14, background: "var(--bg-2)", border: "1px solid var(--border-0)", borderRadius: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="display" style={{ fontSize: 13, fontWeight: 600 }}>当前章节进度</span>
        <span className="tag green"><span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> ch.{String(chapter).padStart(3, "0")}</span>
        {currentAgent && <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 11 }}>{currentAgent}</span>}
      </div>

      <div className="progress green" style={{ height: 6, marginBottom: 12 }}>
        <div className="fill" style={{ width: `${pct}%` }} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6 }}>
        {CHAPTER_STEPS.map((s, i) => {
          const done = activeIdx >= 0 && i < activeIdx;
          const active = i === effectiveIdx;
          const pending = !done && !active;
          return (
            <div key={s.key} title={s.hint} style={{
              padding: "8px 6px", borderRadius: 7,
              background: active ? "var(--brand-soft)" : "var(--bg-1)",
              border: `1px solid ${active ? "var(--brand-dim)" : done ? "var(--border-1)" : "var(--border-0)"}`,
              opacity: pending ? 0.55 : 1,
              minWidth: 0,
            }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 5 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: "50%",
                  background: done || active ? "var(--brand-soft)" : "var(--bg-3)",
                  color: done || active ? "var(--brand)" : "var(--text-3)",
                  border: `1px solid ${done || active ? "var(--brand-dim)" : "var(--border-0)"}`,
                  display: "grid", placeItems: "center",
                }}>
                  {done ? <I.Check size={9} stroke={2.5} /> : active ? <span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> : <span className="mono" style={{ fontSize: 9 }}>{i + 1}</span>}
                </div>
              </div>
              <div style={{ fontSize: 11, textAlign: "center", color: active ? "var(--text-0)" : done ? "var(--text-1)" : "var(--text-3)", fontWeight: active ? 600 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const Loading = ({ onShelf, onTab }) => (
  <div className="frame">
    <TitleBar />
    <RailNav onShelf={onShelf} onTab={onTab} projectMode />
    <EmptyState title="加载中…" />
  </div>
);

// ----- Stage flow: 4 macro phases (setup / design / chapters / finalize),
// expandable detail rows for the setup phase (10 agents). -----

const SETUP_STEPS = [
  ["style_guide_agent",      "风格规划",     (s) => s.has_style_guide],
  ["theme_agent",            "哲学主题",     (s) => s.has_theme],
  ["world_agent",            "背景世界",     (s) => s.has_world],
  ["outline_agent",          "全文大纲",     (s) => s.has_outline],
  ["volume_agent",           "分卷设计",     (s) => s.has_outline],
  ["main_chars_agent",       "主角档案",     (s) => (s.main_chars || 0) > 0],
  ["secondary_chars_agent",  "次角档案",     (s) => (s.secondary_chars || 0) > 0],
  ["relations_agent",        "人物关系",     (s) => (s.relations || 0) > 0],
  ["main_arcs_agent",        "角色弧光",     (s) => (s.relations || 0) > 0],
  ["book_title_agent",       "拟定书名",     (s) => s.has_title || (s.proposed_titles || []).length > 0],
];

const StageFlow = ({ state, sum, designs, currentAgent, currentPhase, currentChapter, status }) => {
  const isWriting = status === "writing";
  const isPaused = status === "paused";
  const setupDone   = SETUP_STEPS.every(([, , done]) => done(sum));
  const target = sum.target_chapters || state.setup?.target_chapters || 0;
  const designedCount = sum.designs || 0;
  const hasFullDesignList = target > 0
    ? designedCount >= target
    : designs.length > 0 && designs.every((d) => d.status !== "pending");
  const hasPendingDesigns = designs.some((d) => d.status === "pending");
  const designDone  = hasFullDesignList && !hasPendingDesigns;
  const chaptersDone = target > 0 && (sum.chapters || 0) >= target;
  const titlesProposed = sum.has_title || (sum.proposed_titles || []).length > 1;
  const normalizedPhase = currentPhase === "write" ? "chapters" : currentPhase;
  const chapterAgentActive = /^chapter_body(?:$|\[)/u.test(String(currentAgent || ""));
  const chapterActive = isWriting && (normalizedPhase === "chapters" || currentChapter != null || chapterAgentActive);

  const macroPhases = [
    { key: "setup",     label: "构建世界",   done: setupDone,    active: isWriting && normalizedPhase === "setup" },
    { key: "design",    label: "分章设计",   done: designDone,   active: isWriting && normalizedPhase === "design" },
    { key: "chapters",  label: "章节正文",   done: chaptersDone, active: chapterActive },
    { key: "finalize",  label: "收尾打磨",   done: titlesProposed && chaptersDone, active: isWriting && normalizedPhase === "finalize" },
  ];

  // Determine which macro phase is "current" for layout emphasis
  const activePhaseIdx = macroPhases.findIndex((p) => p.active);
  const activeIdx = isWriting
    ? (activePhaseIdx >= 0 ? activePhaseIdx : macroPhases.findIndex((p) => !p.done))
    : -1;

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <span className="display" style={{ fontSize: 14, fontWeight: 600 }}>流水线</span>
        {isWriting && currentAgent && (
          <span className="tag green" style={{ fontFamily: "var(--font-mono)" }}>
            <span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} />
            {currentAgent}
          </span>
        )}
        {isPaused && !chaptersDone && <span className="tag warn">已暂停</span>}
      </div>

      {/* Macro phase bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 18 }}>
        {macroPhases.map((p, i) => {
          const st = p.done ? "done" : i === activeIdx ? "active" : "pending";
          return (
            <div key={p.key} style={{
              padding: "10px 12px", borderRadius: 8,
              background: st === "active" ? "var(--brand-soft)" : "var(--bg-2)",
              border: `1px solid ${st === "active" ? "var(--brand-dim)" : "var(--border-0)"}`,
              opacity: st === "pending" ? 0.55 : 1,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  background: st === "done" ? "var(--brand-soft)" : st === "active" ? "var(--brand-soft)" : "var(--bg-3)",
                  color: st === "done" ? "var(--brand)" : st === "active" ? "var(--brand)" : "var(--text-3)",
                  border: `1px solid ${st === "done" || st === "active" ? "var(--brand-dim)" : "var(--border-0)"}`,
                  display: "grid", placeItems: "center", flex: "0 0 18px",
                }}>
                  {st === "done" ? <I.Check size={10} stroke={2.5} /> : st === "active" ? <span className="pulse" style={{ width: 6, height: 6, boxShadow: "none" }} /> : <span className="mono" style={{ fontSize: 10 }}>{i + 1}</span>}
                </div>
                <span style={{ fontSize: 12.5, color: st === "pending" ? "var(--text-2)" : "var(--text-0)", fontWeight: st === "active" ? 600 : 500 }}>{p.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail: setup sub-steps (only show until setup completes) */}
      {!setupDone && (
        <div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>
            构建世界 · {SETUP_STEPS.filter(([, , d]) => d(sum)).length} / {SETUP_STEPS.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {SETUP_STEPS.map(([agent, label, done]) => {
              const isDone = done(sum);
              const isRunning = isWriting && !isDone && currentAgent === agent;
              return (
                <div key={agent} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 5, background: isRunning ? "var(--bg-2)" : "transparent" }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: "50%",
                    background: isDone ? "var(--brand-soft)" : isRunning ? "var(--brand-soft)" : "var(--bg-2)",
                    color: isDone ? "var(--brand)" : isRunning ? "var(--brand)" : "var(--text-3)",
                    border: `1px solid ${isDone || isRunning ? "var(--brand-dim)" : "var(--border-0)"}`,
                    display: "grid", placeItems: "center", flex: "0 0 16px",
                  }}>
                    {isDone ? <I.Check size={9} stroke={2.5} /> : isRunning ? <span className="pulse" style={{ width: 5, height: 5, boxShadow: "none" }} /> : null}
                  </div>
                  <span style={{ fontSize: 12.5, color: isDone ? "var(--text-1)" : isRunning ? "var(--text-0)" : "var(--text-3)", fontWeight: isRunning ? 600 : 400 }}>{label}</span>
                  <span className="mono" style={{ marginLeft: "auto", color: "var(--text-3)", fontSize: 10.5 }}>{agent}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

window.ProgressScreen = ProgressScreen;
