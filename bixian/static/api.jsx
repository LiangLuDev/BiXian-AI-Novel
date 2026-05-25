// API client — REST + SSE
const api = {
  projectQuery(projectId) {
    return projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  },
  async getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return r.json();
  },
  async postJSON(url, body) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
    });
    if (!r.ok) {
      let detail = "";
      try { detail = (await r.json()).detail || ""; } catch {}
      throw new Error(detail || `${url} → ${r.status}`);
    }
    return r.json();
  },
  projects: () => api.getJSON("/api/projects"),
  activate: (id) => api.postJSON(`/api/projects/${encodeURIComponent(id)}/activate`),
  renameProject: (id, title) => api.postJSON(`/api/projects/${encodeURIComponent(id)}/title`, { title }),
  updateAiBackend: (id, body) => api.postJSON(`/api/projects/${encodeURIComponent(id)}/ai-backend`, body),
  deleteProject: (id) => api.postJSON(`/api/projects/${encodeURIComponent(id)}/delete`),
  state: (projectId) => api.getJSON(`/api/state${api.projectQuery(projectId)}`),
  init: (body) => api.postJSON("/api/init", body),
  aiStatus: () => api.getJSON("/api/ai_status"),
  tags: () => api.getJSON("/api/tags"),
  themes: () => api.getJSON("/api/themes"),
  publishMetaPreview: (body) => api.postJSON("/api/publish_meta/preview", body),
  chapter: (order, projectId) => api.getJSON(`/api/chapter/${order}${api.projectQuery(projectId)}`),
  designs: (projectId) => api.getJSON(`/api/designs${api.projectQuery(projectId)}`),
  characters: (projectId) => api.getJSON(`/api/characters${api.projectQuery(projectId)}`),
  usage: (projectId) => api.getJSON(`/api/usage${api.projectQuery(projectId)}`),
  // 多本并发：run/pause/resume/stop 都接受 projectId；不传则默认 active 项目（兼容单本）。
  run: (body, projectId) => {
    const payload = { ...(body || { mode: "all" }) };
    if (projectId && !payload.project_id) payload.project_id = projectId;
    return api.postJSON("/api/run", payload);
  },
  pause: (projectId) => api.postJSON(`/api/pause${api.projectQuery(projectId)}`),
  resume: (projectId) => api.postJSON(`/api/resume${api.projectQuery(projectId)}`),
  // 注：stop 已移除。要停一本书 = 删除（自动停 + 清盘 + 让排队的本顶上）。
  settings: () => api.getJSON("/api/settings"),
  updateSettings: (body) => api.postJSON("/api/settings", body),
};

// SSE subscription hook
const SSE_EVENT_TYPES = [
  "pipeline_started", "pipeline_completed", "pipeline_failed", "pipeline_paused", "pipeline_resumed", "pipeline_stopped",
  "phase_started", "phase_completed",
  "agent_started", "agent_completed", "agent_failed", "agent_json_failed",
  "cover_image_started", "cover_image_completed", "cover_image_failed",
  "chapter_started", "chapter_body_done", "chapter_completed",
  "tokens_updated", "state_updated", "log",
];

// 多本：传入 projectId 时只收该本的事件（+ 全局无 project_id 的事件）。
// 不传 projectId（或传 null/undefined）= 收所有事件（保留旧行为）。
const useEventStream = (onEvent, projectId) => {
  React.useEffect(() => {
    const url = projectId
      ? `/api/events?project_id=${encodeURIComponent(projectId)}`
      : "/api/events";
    const es = new EventSource(url);
    const handle = (e) => {
      try {
        const payload = JSON.parse(e.data);
        onEvent({ ...payload, type: payload.type || e.type, event: e.type });
      } catch {}
    };
    es.onmessage = handle;
    SSE_EVENT_TYPES.forEach((t) => es.addEventListener(t, handle));
    es.onerror = () => { /* let browser auto-reconnect */ };
    return () => {
      SSE_EVENT_TYPES.forEach((t) => es.removeEventListener(t, handle));
      es.close();
    };
  }, [onEvent, projectId]);
};

// Polling fetch hook — refetch every `ms`, also expose manual reload()
const usePoll = (loader, ms = 4000, deps = []) => {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const reload = React.useCallback(async () => {
    try { setData(await loader()); setError(null); }
    catch (e) { setError(e); }
  }, deps);
  React.useEffect(() => {
    let live = true;
    const tick = async () => {
      try { const v = await loader(); if (live) setData(v); }
      catch (e) { if (live) setError(e); }
    };
    tick();
    const id = setInterval(tick, ms);
    return () => { live = false; clearInterval(id); };
  }, deps);
  return { data, error, reload };
};

// Async action wrapper — handles busy + error state for save/delete buttons.
// `run(fn)` returns fn's value on success, or undefined on failure.
const useAsyncAction = () => {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const run = React.useCallback(async (fn) => {
    setBusy(true); setErr("");
    try { return await fn(); }
    catch (e) { setErr(e?.message || String(e)); }
    finally { setBusy(false); }
  }, []);
  return { busy, err, setErr, run };
};

// Genre → cover class + tag color
const GENRE_MAP = {
  "玄幻": { cover: "xuan", tag: "amber", label: "玄幻" },
  "仙侠": { cover: "xuan", tag: "amber", label: "仙侠" },
  "都市": { cover: "urban", tag: "blue", label: "都市" },
  "都市言情": { cover: "urban", tag: "blue", label: "都市" },
  "科幻": { cover: "scifi", tag: "purple", label: "科幻" },
  "悬疑": { cover: "mystery", tag: "rose", label: "悬疑" },
  "悬疑推理": { cover: "mystery", tag: "rose", label: "悬疑" },
  "历史": { cover: "scifi", tag: "purple", label: "历史" },
  "通用": { cover: "urban", tag: "blue", label: "通用" },
};
const genreInfo = (g) => GENRE_MAP[g] || { cover: "urban", tag: "blue", label: g || "—" };

const audienceInfo = (a) => {
  if (a === "female" || a === "女频") return { key: "female", cover: "mystery", tag: "rose", label: "女频" };
  if (a === "male" || a === "男频") return { key: "male", cover: "scifi", tag: "blue", label: "男频" };
  return { key: "", cover: "urban", tag: "blue", label: "" };
};

const CoverBox = ({ genre, src, width, height, labelStyle, style }) => {
  const gi = genreInfo(genre);
  return (
    <div
      className={"cover " + gi.cover + (src ? " has-image" : "")}
      style={{
        width,
        height,
        flex: width ? `0 0 ${typeof width === "number" ? width + "px" : width}` : undefined,
        backgroundImage: src ? `url(${src})` : undefined,
        ...style,
      }}
    >
      <span className="label" style={labelStyle}>{gi.label}</span>
    </div>
  );
};

// Relative-ish timestamp from ISO
const relTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toISOString().slice(0, 10);
};

window.api = api;
window.useEventStream = useEventStream;
window.usePoll = usePoll;
window.useAsyncAction = useAsyncAction;
window.genreInfo = genreInfo;
window.audienceInfo = audienceInfo;
window.CoverBox = CoverBox;
window.relTime = relTime;
