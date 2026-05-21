// Character — list + read-only profile

const CharacterScreen = ({ onShelf, onTab, projectId }) => {
  const { data: state } = usePoll(() => api.state(projectId), 5000, [projectId]);
  const { data: chData } = usePoll(() => api.characters(projectId), 5000, [projectId]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [filter, setFilter] = React.useState("");

  React.useEffect(() => { setActiveIdx(0); }, [filter]);

  if (!state) return <Loading onShelf={onShelf} onTab={onTab} />;
  if (!state.initialized) {
    return (
      <div className="frame">
        <TitleBar onShelf={onShelf} project="未选择项目" />
        <RailNav active="character" onShelf={onShelf} onTab={onTab} projectMode />
        <EmptyState title="先到书架选一本小说" action={<button className="btn primary" onClick={onShelf}><I.Home size={13} /> 去书架</button>} />
      </div>
    );
  }

  const chars = chData?.characters || [];
  const relations = chData?.relations || [];
  const status = pipelineStatus(state);

  const tagFor = (kind) => {
    if (!kind) return "blue";
    if (kind.includes("主角")) return "amber";
    if (kind.includes("反派") || kind.includes("敌")) return "purple";
    if (kind.includes("女")) return "rose";
    return "blue";
  };

  const filtered = chars.filter((c) => {
    const q = filter.trim();
    if (!q) return true;
    return [c.name, c.role, c.tier, c.raw_card].filter(Boolean).some((v) => String(v).includes(q));
  });
  const active = filtered[activeIdx] || filtered[0];

  return (
    <div className="frame">
      <TitleBar onShelf={onShelf} project={state.display_title || "未命名"} status={status} crumbs={["人物"]} />
      <RailNav active="character" onShelf={onShelf} onTab={onTab} projectMode />
      <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", minHeight: 0, height: "100%", overflow: "hidden" }}>
        <div className="subnav">
          <div style={{ padding: "12px 14px" }}>
            <input className="input" style={{ height: 28, padding: "0 10px", fontSize: 12 }}
              placeholder="搜索人物" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="sec">人物档案 · {filtered.length}</div>
          <div style={{ overflow: "auto", flex: 1, minHeight: 0, overscrollBehavior: "contain", WebkitOverflowScrolling: "touch" }}>
            {filtered.length === 0 && (
              <div style={{ padding: "12px 14px", fontSize: 11.5, color: "var(--text-3)" }}>暂无人物</div>
            )}
            {filtered.map((c, i) => {
              const t = tagFor(c.role || c.kind);
              const subtitle = c.role || tierLabel(c.tier) || "角色";
              return (
                <div key={c.name + i}
                  className={"item " + (i === activeIdx ? "active" : "")}
                  onClick={() => setActiveIdx(i)}
                  style={{ cursor: "pointer" }}>
                  <div className="avatar" style={{ background: `var(--${t}-soft)`, color: `var(--${t})`, width: 24, height: 24, fontSize: 11 }}>{(c.name || "?")[0]}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || "（无名）"}</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{subtitle}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {active ? <CharacterDetail c={active} relations={relations} tagFor={tagFor} /> : <EmptyState title="尚无人物档案" hint="setup 阶段完成后会自动生成。" />}
      </div>
    </div>
  );
};

const tierLabel = (tier) => ({
  main: "主要角色",
  secondary: "次要角色",
  minor: "小角色",
})[tier] || tier || "";

const formatValue = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  if (value == null) return "";
  return String(value).trim();
};

// 一行内联事实条：年龄 · 性别 · 层级 · 身份 · 势力 · 首登
const FactStrip = ({ items }) => {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px", fontSize: 12.5, color: "var(--text-2)" }}>
      {items.map(([k, v], i) => (
        <React.Fragment key={k}>
          {i > 0 && <span style={{ color: "var(--text-3)", opacity: 0.5 }}>·</span>}
          <span><span style={{ color: "var(--text-3)", marginRight: 6, fontSize: 11 }}>{k}</span><span style={{ color: "var(--text-0)" }}>{v}</span></span>
        </React.Fragment>
      ))}
    </div>
  );
};

// 文章式段落：标题 + 内文，无外框
const Para = ({ title, children, accent }) => (
  <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <h3 style={{
      margin: 0, fontSize: 12, fontWeight: 500,
      color: accent || "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em",
      display: "flex", alignItems: "center", gap: 8,
    }}>
      <span style={{ width: 3, height: 12, background: accent || "var(--brand)", borderRadius: 2, boxShadow: `0 0 6px ${accent || "var(--brand)"}` }} />
      {title}
    </h3>
    <div className="serif" style={{ fontSize: 14, lineHeight: 1.9, color: "var(--text-1)", whiteSpace: "pre-wrap" }}>
      {children}
    </div>
  </section>
);

const CharacterDetail = ({ c, relations, tagFor }) => {
  const t = tagFor(c.role || c.kind);
  const ringColor = t === "amber" || t === "green" ? "green" : t === "rose" ? "rose" : t === "purple" ? "purple" : "";
  const myRels = relations.filter((r) => r.from === c.name || r.to === c.name || r.a === c.name || r.b === c.name);

  const facts = [
    ["性别", c.gender],
    ["年龄", c.age],
    ["层级", tierLabel(c.tier)],
    ["身份", c.identity || c.background],
    ["势力", c.faction || c.affiliation],
    ["首登", c.first_chapter ? `ch.${String(c.first_chapter).padStart(3, "0")}` : null],
  ].map(([k, v]) => [k, formatValue(v)]).filter(([_, v]) => v);

  // 三组：画像（外在）/ 内核（内在）/ 弧光（长文）
  const groupAppearance = [
    ["外貌 / 形象", c.appearance || c.look],
    ["说话特点", c.speech_pattern],
    ["行为习惯", c.habits],
  ].map(([k, v]) => [k, formatValue(v)]).filter(([_, v]) => v);

  const groupInner = [
    ["性格", c.personality],
    ["核心动机", c.motivation],
    ["能力 / 限制", c.ability],
    ["内心恐惧", c.fears],
    ["软肋 / 秘密", c.secret],
  ].map(([k, v]) => [k, formatValue(v)]).filter(([_, v]) => v);

  const arc = formatValue(c.arc);
  const keywords = c.keywords || c.tags || c.traits || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
      <div className="hero-panel">
        <div className={"avatar xl ring " + ringColor}
             style={{ background: `var(--${t}-soft)`, color: `var(--${t})`, fontFamily: "var(--font-display)" }}>
          {(c.name || "?")[0]}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className={"tag " + t}>{c.role || c.kind || "角色"}</span>
            {c.tier && <span className="tag">{tierLabel(c.tier)}</span>}
            {c.faction && <span className="tag">{c.faction}</span>}
          </div>
          <div className="display" style={{ fontSize: 32, fontWeight: 700, marginTop: 10, letterSpacing: "-0.02em" }}>{c.name}</div>
          {(c.description || c.summary) && (
            <div style={{ color: "var(--text-1)", marginTop: 10, fontSize: 14.5, lineHeight: 1.7, maxWidth: 720 }} className="serif">{c.description || c.summary}</div>
          )}
          {facts.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <FactStrip items={facts} />
            </div>
          )}
        </div>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflow: "auto",
        overscrollBehavior: "contain", WebkitOverflowScrolling: "touch",
        padding: "32px 30px 80px",
      }}>
        <div style={{ maxWidth: 880, display: "flex", flexDirection: "column", gap: 32 }}>

          {groupAppearance.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <SectionLabel>外在画像</SectionLabel>
              {groupAppearance.map(([k, v]) => <Para key={k} title={k}>{v}</Para>)}
            </div>
          )}

          {groupInner.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <SectionLabel>内核</SectionLabel>
              {groupInner.map(([k, v]) => <Para key={k} title={k} accent="var(--cyan)">{v}</Para>)}
            </div>
          )}

          {arc && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <SectionLabel>角色弧光</SectionLabel>
              <Para title="成长曲线" accent="var(--purple)">{arc}</Para>
            </div>
          )}

          {myRels.length > 0 && (
            <RelationsBlock self={c} relations={myRels} tagFor={tagFor} />
          )}

          {Array.isArray(keywords) && keywords.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <SectionLabel>关键词</SectionLabel>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {keywords.map((k, i) => <span key={i} className="chip">{k}</span>)}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

// 按对方人物聚合：相同对方的多条切片合成一张大卡，内部按章节排序
const RelationsBlock = ({ self, relations, tagFor }) => {
  const groups = React.useMemo(() => {
    const map = new Map();
    for (const r of relations) {
      const other = r.from === self.name ? r.to
                  : r.to === self.name ? r.from
                  : r.a === self.name ? r.b
                  : r.a;
      if (!other) continue;
      if (!map.has(other)) map.set(other, []);
      map.get(other).push(r);
    }
    // 排序：切片数量多的优先；同数按首登
    return [...map.entries()]
      .map(([name, items]) => {
        items.sort((x, y) => (x.first_chapter || 0) - (y.first_chapter || 0));
        return { name, items };
      })
      .sort((a, b) => b.items.length - a.items.length);
  }, [self.name, relations]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionLabel>
        关系侧写 <span style={{ color: "var(--text-3)", fontWeight: 500, fontSize: 14, marginLeft: 8 }}>
          {groups.length} 位角色 · {relations.length} 段切片
        </span>
      </SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.map((g) => <RelationGroupCard key={g.name} group={g} tagFor={tagFor} />)}
      </div>
    </div>
  );
};

const RelationGroupCard = ({ group, tagFor }) => {
  const { name, items } = group;
  const [expanded, setExpanded] = React.useState(false);
  const primary = items[0];
  const primaryLabel = primary.relation || primary.type || primary.kind || "—";
  const primaryTag = tagFor(primaryLabel);

  // 去重标签集
  const labelSet = [...new Set(items.map((r) => r.relation || r.type || r.kind).filter(Boolean))];
  const shown = expanded ? items : items.slice(0, 1);
  const hasMore = items.length > 1;

  return (
    <div className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div className="avatar" style={{
          background: `var(--${primaryTag}-soft)`, color: `var(--${primaryTag})`,
          width: 40, height: 40, fontSize: 14, flex: "0 0 40px", borderColor: "transparent",
        }}>{(name || "?")[0]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }} className="mono">
            {items.length} 段关系切片
          </div>
        </div>
      </div>

      {labelSet.length > 1 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {labelSet.map((lab) => (
            <span key={lab} className={"tag " + tagFor(lab)}>{lab}</span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {shown.map((r, i) => {
          const label = r.relation || r.type || r.kind || "—";
          const rt = tagFor(label);
          const desc = r.description || r.evidence || r.change || "";
          return (
            <div key={i} style={{
              paddingTop: i > 0 ? 10 : 0,
              borderTop: i > 0 ? "1px solid oklch(0.34 0.012 230 / 0.25)" : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                {labelSet.length === 1
                  ? null
                  : <span className={"tag " + rt}>{label}</span>}
                {r.first_chapter && (
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-3)", marginLeft: labelSet.length === 1 ? 0 : "auto" }}>
                    ch.{String(r.first_chapter).padStart(3, "0")}
                  </span>
                )}
              </div>
              {desc && (
                <div className="serif" style={{ marginTop: 6, fontSize: 13, lineHeight: 1.75, color: "var(--text-2)" }}>{desc}</div>
              )}
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          className="btn ghost sm"
          onClick={() => setExpanded((v) => !v)}
          style={{ alignSelf: "flex-start", marginTop: 2, color: "var(--brand)" }}
        >
          {expanded ? "收起" : `展开剩余 ${items.length - 1} 段`}
        </button>
      )}
    </div>
  );
};

const SectionLabel = ({ children }) => (
  <div className="display" style={{
    fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em",
    color: "var(--text-0)",
    display: "flex", alignItems: "center", gap: 10,
  }}>
    {children}
    <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, oklch(0.34 0.012 230 / 0.5), transparent)" }} />
  </div>
);

window.CharacterScreen = CharacterScreen;
