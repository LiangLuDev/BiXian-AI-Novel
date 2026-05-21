// App — two-level hash router
//   #/                    → bookshelf (top level)
//   #/p/:projectId/:tab   → project-internal view (tab ∈ progress|reader|outline|character)

const parseHash = () => {
  const raw = (location.hash || "#/").replace(/^#\/?/, "");
  const parts = raw.split("?")[0].split("/").filter(Boolean);
  if (parts.length === 0) return { level: "shelf" };
  if (parts[0] === "p" && parts[1]) {
    return { level: "project", projectId: decodeURIComponent(parts[1]), tab: parts[2] || "reader" };
  }
  return { level: "shelf" };
};

const App = () => {
  const [route, setRoute] = React.useState(parseHash);
  useTweaks();
  const [activating, setActivating] = React.useState(false);

  React.useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // When entering a project route, ensure that project is active on the backend.
  React.useEffect(() => {
    if (route.level !== "project") return;
    let live = true;
    setActivating(true);
    (async () => {
      try {
        const st = await api.state(route.projectId);
        if (!live) return;
        if (st.project_id !== route.projectId) {
          location.hash = "#/";
          return;
        }
        // 多本并发：激活永远允许，只是切"当前选中"的项目；不再因有别本在跑而拒绝。
        if (st.active_project_id !== route.projectId) {
          try { await api.activate(route.projectId); }
          catch (e) { console.warn("activate failed:", e); }
        }
      } catch (e) {
        if (live) { location.hash = "#/"; return; }
      } finally {
        if (live) setActivating(false);
      }
    })();
    return () => { live = false; };
  }, [route.level, route.projectId]);

  const goShelf = () => { location.hash = "#/"; };
  const goTab = (tab) => {
    if (route.level === "project") location.hash = `#/p/${encodeURIComponent(route.projectId)}/${tab}`;
    else goShelf();
  };
  const openProject = (id, tab = "reader") => { location.hash = `#/p/${encodeURIComponent(id)}/${tab}`; };

  let screen;
  if (route.level === "shelf") {
    screen = <HomeScreen onOpenProject={openProject} />;
  } else if (activating) {
    screen = (
      <div className="frame">
        <TitleBar project="切换中…" />
        <RailNav active={route.tab} onShelf={goShelf} onTab={goTab} projectMode />
        <EmptyState title="切换项目中…" />
      </div>
    );
  } else {
    const common = { onShelf: goShelf, onTab: goTab, tab: route.tab, projectId: route.projectId };
    switch (route.tab) {
      case "progress":  screen = <ProgressScreen  {...common} />; break;
      case "reader":    screen = <ReaderScreen    {...common} />; break;
      case "outline":   screen = <OutlineScreen   {...common} />; break;
      case "character": screen = <CharacterScreen {...common} />; break;
      default:          screen = <ReaderScreen    {...common} />;
    }
  }

  return (
    <div className="app">
      {screen}
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
