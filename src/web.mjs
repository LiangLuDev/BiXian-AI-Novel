import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NovelProject } from './project.mjs';
import { NovelState, ProjectSetup, PublishMeta, isChapterBodyValid } from './state.mjs';
import { LLM, LLMConfig, detectAiBackends, aiCapabilityError } from './llm/index.mjs';
import { KNOWN_BACKENDS } from './llm/config.mjs';
import { usageSummary } from './services/costing.mjs';
import { fanqieTagPayload } from './services/fanqie_tags.mjs';
import { publishMetaAgent } from './agents.mjs';
import { TaskRegistry, resolveCoverFile } from './runner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATIC_DIR = path.join(ROOT, 'bixian', 'static');
const DATA_DIR = path.join(ROOT, 'data');

const MIME_BY_EXT = {
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

// ---------- low-level helpers ----------
function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  if (Buffer.isBuffer(body)) return res.end(body);
  return res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveFile(res, file) {
  if (!fs.existsSync(file)) return send(res, 404, 'not found', 'text/plain');
  const ext = path.extname(file).toLowerCase();
  return send(res, 200, fs.readFileSync(file), MIME_BY_EXT[ext] || 'application/octet-stream');
}

function readBody(req) {
  return new Promise((resolve) => {
    let s = '';
    req.on('data', (c) => { s += c; });
    req.on('end', () => {
      try { resolve(s ? JSON.parse(s) : {}); }
      catch { resolve({}); }
    });
  });
}

// ---------- project helpers ----------
const projectIdFor = (dir) => path.basename(dir);
const resolveProject = (workspace, id) => path.join(workspace, id);

function requireState(workspace, id) {
  if (!id) throw new Error('no project specified');
  return new NovelProject(resolveProject(workspace, id)).load();
}

function safeProjectId(value) {
  return String(value || '').trim()
    .replace(/[^\w\-一-鿿]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48) || 'novel';
}

function uniqueProjectDir(workspace, title) {
  const base = safeProjectId(title || 'novel');
  const stamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  let candidate = path.join(workspace, `${base}-${stamp}`);
  let idx = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(workspace, `${base}-${stamp}-${idx}`);
    idx += 1;
  }
  return candidate;
}

function readThemesFile(file) {
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : (Array.isArray(data.themes) ? data.themes : []);
  } catch {
    return [];
  }
}

function loadThemes(workspace) {
  const sources = [path.join(DATA_DIR, 'themes.json'), path.join(workspace, 'themes.json')];
  const userThemesDir = path.join(workspace, 'themes');
  if (fs.existsSync(userThemesDir)) {
    for (const name of fs.readdirSync(userThemesDir).sort()) {
      if (name.endsWith('.json')) sources.push(path.join(userThemesDir, name));
    }
  }

  const byId = new Map();
  for (const file of sources) {
    for (const theme of readThemesFile(file)) {
      if (!theme?.id) continue;
      byId.set(theme.id, { ...theme, source_path: file });
    }
  }
  const themes = [...byId.values()];
  return {
    meta: { version: '1.1', total: themes.length, user_theme_dir: userThemesDir },
    themes,
  };
}

function loadThemeById(workspace, themeId) {
  return loadThemes(workspace).themes.find((t) => t.id === themeId) || null;
}

// ---------- display/state shaping ----------
function displayTitleFor(state, fallback = '（命名中…）') {
  return state.setup.title
    || state.publish_meta?.book_name
    || state.titles_proposed?.[0]
    || fallback;
}

function inferAudience(state) {
  if (state.publish_meta?.audience) return state.publish_meta.audience;
  if (state.setup.audience_hint) return state.setup.audience_hint;
  const source = [state.setup.description, state.setup.custom_requirements, state.setup.genre]
    .filter(Boolean).join(' ');
  if (source.includes('女频')) return 'female';
  if (source.includes('男频')) return 'male';
  return '';
}

function normalizeAiSettings(body = {}, currentBackend = '') {
  const backend = String(body.backend || currentBackend || '').trim();
  if (!backend) return null;
  if (!KNOWN_BACKENDS.includes(backend)) {
    const known = KNOWN_BACKENDS.join(', ');
    throw new Error(`unknown backend "${backend}" (known: ${known})`);
  }
  return {
    backend,
    model: String(body.model || '').trim(),
  };
}

function applyAiSettings(project, body, registry, projectId) {
  const currentState = project.load();
  const settings = normalizeAiSettings(body, currentState.setup.backend || 'codex');
  if (!settings) return null;
  const capErr = aiCapabilityError(settings.backend);
  if (capErr) {
    capErr.statusCode = 412;
    capErr.backend = settings.backend;
    throw capErr;
  }
  currentState.setup.backend = settings.backend;
  currentState.setup.model = settings.model;
  project.save(currentState);
  registry.bus.emit('event', {
    type: 'state_updated',
    project_id: projectId,
    ts: Date.now(),
    backend: settings.backend,
    model: settings.model,
  });
  return { state: currentState, ...settings };
}

function stateSummary(state) {
  const validChapters = state.chapters.filter((c) => isChapterBodyValid(c, state.setup));
  const invalidChapters = state.chapters.length - validChapters.length;
  return {
    title: state.setup.title || '未命名',
    target_chapters: state.setup.target_chapters || 0,
    has_title: Boolean(state.setup.title?.trim()),
    has_style_guide: state.style_guide != null,
    has_theme: Boolean(state.philosophical_theme),
    has_world: Boolean(state.world_building),
    has_outline: Boolean(state.outline),
    has_arcs: Boolean(state.arcs),
    main_chars: state.main_characters.length,
    secondary_chars: state.secondary_characters.length,
    relations: state.relations.length,
    designs: state.chapter_designs.length,
    chapters: validChapters.length,
    invalid_chapters: invalidChapters,
    total_words: validChapters.reduce((sum, c) => sum + Number(c.word_count || 0), 0),
    proposed_titles: state.titles_proposed || [],
    cover_prompt: state.cover_prompt || '',
    cover_image_path: state.cover_image_path || '',
    has_cover_prompt: Boolean(state.cover_prompt),
  };
}

function projectProgress(summary) {
  const target = summary.target_chapters || 0;
  if (target) return Math.min(100, Math.round(((summary.chapters || 0) / target) * 100));
  const milestones = ['has_style_guide', 'has_theme', 'has_world', 'has_outline'];
  return Math.min(99, milestones.filter((k) => summary[k]).length * 12);
}

function coverUrl(workspace, id, state) {
  const file = resolveCoverFile(state, resolveProject(workspace, id));
  if (!file) return '';
  const mtime = Math.floor(fs.statSync(file).mtimeMs);
  return `/api/projects/${encodeURIComponent(id)}/cover?v=${mtime}`;
}

function projectSummary(workspace, id, activeId, registry) {
  const dir = resolveProject(workspace, id);
  const state = new NovelProject(dir).load();
  const summary = stateSummary(state);
  const stat = fs.statSync(path.join(dir, 'project.json'));
  const taskState = registry.stateOf(id);
  return {
    id,
    path: dir,
    active: id === activeId,
    title: displayTitleFor(state, id),
    display_title: displayTitleFor(state, id),
    genre: state.setup.genre || '通用',
    audience: inferAudience(state),
    backend: state.setup.backend || 'codex',
    model: state.setup.model || '',
    style: state.setup.literary_style || '',
    description: state.setup.description || '',
    created_at: state.created_at,
    updated_at: stat.mtime.toISOString(),
    running: taskState.running,
    paused: taskState.paused,
    queued: taskState.queued,
    current_agent: taskState.current_agent,
    current_chapter: taskState.current_chapter,
    chapters: state.chapters.length,
    target_chapters: state.setup.target_chapters || 0,
    target_word_count_wan: state.setup.target_word_count_wan || 0,
    total_words: summary.total_words,
    main_chars: summary.main_chars,
    progress: projectProgress(summary),
    cover_image_url: coverUrl(workspace, id, state),
  };
}

function listProjects(workspace, activeId, registry) {
  if (!fs.existsSync(workspace)) return [];
  return fs.readdirSync(workspace)
    .sort((a, b) => fs.statSync(path.join(workspace, b)).mtimeMs - fs.statSync(path.join(workspace, a)).mtimeMs)
    .flatMap((name) => {
      const dir = path.join(workspace, name);
      return NovelProject.isProjectDir(dir) ? [projectSummary(workspace, name, activeId, registry)] : [];
    });
}

function statePayload(state, { workspace, projectId, activeId, registry }) {
  const taskState = registry.stateOf(projectId);
  const sum = registry.summary();
  const clone = JSON.parse(JSON.stringify(state));
  return {
    ...clone,
    initialized: true,
    running: taskState.running,
    paused: taskState.paused,
    queued: taskState.queued,
    current_agent: taskState.current_agent,
    current_chapter: taskState.current_chapter,
    can_control: true,
    project_id: projectId,
    active_project_id: activeId,
    backend: state.setup.backend || 'codex',
    model: state.setup.model || '',
    global_running: sum.running_count > 0,
    running_count: sum.running_count,
    queued_count: sum.queued_count,
    max_concurrent: sum.max_concurrent,
    state_path: projectId ? resolveProject(workspace, projectId) : workspace,
    setup: clone.setup,
    summary: stateSummary(state),
    display_title: displayTitleFor(state, projectId || '未命名'),
    publish_meta: clone.publish_meta || null,
    titles_proposed: state.titles_proposed || [],
    cover_prompt: state.cover_prompt || '',
    cover_image_path: state.cover_image_path || '',
    cover_image_url: projectId ? coverUrl(workspace, projectId, state) : '',
  };
}

function designsPayload(state) {
  const chapterByOrder = new Map(state.chapters.map((c) => [c.order, c]));
  const maxOrder = Math.max(
    state.setup.target_chapters || 0,
    ...state.chapter_designs.map((d) => d.order),
    ...state.chapters.map((c) => c.order),
    0,
  );
  const designs = [];
  for (let order = 1; order <= maxOrder; order += 1) {
    const existingDesign = state.chapter_designs.find((x) => x.order === order);
    const d = existingDesign || { order, title: null, raw: '' };
    const c = chapterByOrder.get(order);
    designs.push({
      order,
      title: d.title || c?.design?.title || `第${order}章`,
      raw: d.raw || '',
      highlight: d.highlight || '',
      core_conflict: d.core_conflict || '',
      plot: d.plot || '',
      emotional_tone: d.emotional_tone || '',
      ending_hook: d.ending_hook || '',
      status: c ? (isChapterBodyValid(c, state.setup) ? 'written' : 'invalid') : existingDesign ? 'designed' : 'pending',
      word_count: c?.word_count || 0,
    });
  }
  return { designs };
}

function chapterPayload(state, order) {
  const c = state.chapters.find((x) => x.order === order);
  if (c) {
    const valid = isChapterBodyValid(c, state.setup);
    return {
      order: c.order,
      title: c.design?.title || `第${c.order}章`,
      body: c.body,
      word_count: c.word_count || 0,
      summary: c.summary || '',
      qa_reports: c.qa_reports || {},
      design: c.design,
      new_characters: c.new_characters || [],
      relations_delta: c.relations_delta || [],
      revisions: c.revisions?.length || 0,
      status: valid ? 'written' : 'invalid',
    };
  }
  const d = state.chapterDesignFor(order);
  if (d) {
    return {
      order: d.order,
      title: d.title || `第${order}章`,
      body: '',
      word_count: 0,
      summary: '',
      qa_reports: {},
      design: d,
      new_characters: [],
      relations_delta: [],
      revisions: 0,
      status: 'designed',
    };
  }
  return null;
}

// ---------- server ----------
export function runServer(projectDir, { host = '127.0.0.1', port = 8000 } = {}) {
  const initialPath = path.resolve(projectDir);
  const workspace = NovelProject.isProjectDir(initialPath) ? path.dirname(initialPath) : initialPath;
  let activeId = NovelProject.isProjectDir(initialPath) ? projectIdFor(initialPath) : null;
  fs.mkdirSync(workspace, { recursive: true });

  const settingsPath = path.join(workspace, '.bixian-settings.json');
  const legacySettingsPath = path.join(workspace, '.bihua-settings.json');
  let maxConcurrent = 2;
  try {
    const readableSettingsPath = fs.existsSync(settingsPath) ? settingsPath : legacySettingsPath;
    if (fs.existsSync(readableSettingsPath)) {
      const raw = JSON.parse(fs.readFileSync(readableSettingsPath, 'utf8'));
      maxConcurrent = Math.max(1, Math.min(16, Number(raw.max_concurrent || 2)));
    }
  } catch {}

  const registry = new TaskRegistry({ workspace, maxConcurrent });

  const pidFrom = (url, body = {}) =>
    url.searchParams.get('project_id') || body.project_id || activeId;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const { pathname } = url;
    const { method } = req;

    try {
      // ----- static -----
      if (method === 'GET' && pathname === '/') {
        return send(res, 200, fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf8'), 'text/html; charset=utf-8');
      }
      if (method === 'GET' && pathname.startsWith('/static/')) {
        return serveFile(res, path.join(STATIC_DIR, pathname.slice('/static/'.length)));
      }

      // ----- projects index + lifecycle -----
      if (method === 'GET' && pathname === '/api/projects') {
        const sum = registry.summary();
        return send(res, 200, {
          active_id: activeId,
          projects: listProjects(workspace, activeId, registry),
          running_count: sum.running_count,
          queued_count: sum.queued_count,
          max_concurrent: sum.max_concurrent,
        });
      }

      if (method === 'POST' && pathname === '/api/init') {
        const body = await readBody(req);
        const backend = body?.backend || 'codex';
        const capErr = aiCapabilityError(backend);
        if (capErr) return send(res, 412, { detail: capErr.message, code: 'ai_unavailable', backend });
        const result = handleInit(body, { workspace, registry });
        activeId = result.project_id;
        return send(res, 200, { ok: true, project_id: result.project_id, state: result.state });
      }

      if (method === 'GET' && pathname === '/api/ai_status') {
        const info = detectAiBackends({ force: true });
        return send(res, 200, {
          available: info.available,
          providers: info.providers,
          by_id: info.by_id,
          details: info.details,
        });
      }

      const activate = pathname.match(/^\/api\/projects\/([^/]+)\/activate$/u);
      if (method === 'POST' && activate) {
        activeId = decodeURIComponent(activate[1]);
        return send(res, 200, { ok: true, active_id: activeId });
      }

      const rename = pathname.match(/^\/api\/projects\/([^/]+)\/title$/u);
      if (method === 'POST' && rename) {
        const id = decodeURIComponent(rename[1]);
        const body = await readBody(req);
        const title = String(body.title || '').trim();
        if (!title) return send(res, 400, { detail: 'title required' });
        if (title.length > 80) return send(res, 400, { detail: 'title too long' });
        const proj = new NovelProject(resolveProject(workspace, id));
        const st = proj.load();
        st.setup.title = title;
        if (st.publish_meta) {
          st.publish_meta.book_name = title;
          st.publish_meta.title_candidates = [title, ...(st.publish_meta.title_candidates || []).filter((t) => t !== title)];
        }
        proj.save(st);
        registry.bus.emit('event', { type: 'state_updated', project_id: id, ts: Date.now() });
        return send(res, 200, { ok: true, title: st.setup.title });
      }

      const aiSettings = pathname.match(/^\/api\/projects\/([^/]+)\/ai-backend$/u);
      if (method === 'POST' && aiSettings) {
        const id = decodeURIComponent(aiSettings[1]);
        const body = await readBody(req);
        if (!body.backend && !Object.prototype.hasOwnProperty.call(body, 'model')) {
          return send(res, 400, { detail: 'backend or model required' });
        }
        try {
          const result = applyAiSettings(new NovelProject(resolveProject(workspace, id)), body, registry, id);
          return send(res, 200, {
            ok: true,
            backend: result.backend,
            model: result.model,
            running: registry.stateOf(id).running,
            queued: registry.stateOf(id).queued,
          });
        } catch (e) {
          return send(res, e.statusCode || 400, { detail: e.message, code: e.statusCode === 412 ? 'ai_unavailable' : 'bad_ai_backend', backend: e.backend || body.backend || '' });
        }
      }

      const cover = pathname.match(/^\/api\/projects\/([^/]+)\/cover$/u);
      if (method === 'GET' && cover) {
        const id = decodeURIComponent(cover[1]);
        const projDir = resolveProject(workspace, id);
        if (!fs.existsSync(projDir)) return send(res, 404, 'not found', 'text/plain');
        const file = resolveCoverFile(new NovelProject(projDir).load(), projDir);
        if (!file) return send(res, 404, 'cover image not found', 'text/plain');
        return serveFile(res, file);
      }

      const del = pathname.match(/^\/api\/projects\/([^/]+)\/delete$/u);
      if (method === 'POST' && del) {
        const id = decodeURIComponent(del[1]);
        registry.cancel(id);
        registry.cancelCover(id);
        await registry.waitForTask(id, 15_000);
        await registry.waitForCover(id, 15_000);
        fs.rmSync(resolveProject(workspace, id), { recursive: true, force: true });
        if (activeId === id) activeId = null;
        registry.bus.emit('event', { type: 'state_updated', project_id: null, ts: Date.now(), deleted_project: id });
        return send(res, 200, { ok: true, deleted: id });
      }

      // ----- read-only views -----
      if (method === 'GET' && pathname === '/api/state') {
        const pid = url.searchParams.get('project_id') || activeId;
        if (!pid) {
          const sum = registry.summary();
          return send(res, 200, {
            initialized: false,
            projects: listProjects(workspace, activeId, registry),
            active_project_id: activeId,
            running_count: sum.running_count,
            queued_count: sum.queued_count,
            max_concurrent: sum.max_concurrent,
          });
        }
        const st = requireState(workspace, pid);
        return send(res, 200, statePayload(st, { workspace, projectId: pid, activeId, registry }));
      }

      if (method === 'GET' && pathname === '/api/designs') {
        return send(res, 200, designsPayload(requireState(workspace, pidFrom(url))));
      }

      if (method === 'GET' && pathname === '/api/characters') {
        const st = requireState(workspace, pidFrom(url));
        return send(res, 200, {
          characters: [...st.main_characters, ...st.secondary_characters],
          main: st.main_characters,
          secondary: st.secondary_characters,
          relations: st.relations,
        });
      }

      if (method === 'GET' && pathname === '/api/usage') {
        return send(res, 200, usageSummary(requireState(workspace, pidFrom(url)).cost_log));
      }

      const chMatch = pathname.match(/^\/api\/chapter\/(\d+)$/u);
      if (method === 'GET' && chMatch) {
        const order = Number(chMatch[1]);
        const payload = chapterPayload(requireState(workspace, pidFrom(url)), order);
        return payload
          ? send(res, 200, payload)
          : send(res, 404, { detail: `chapter ${order} not found` });
      }

      if (method === 'GET' && pathname === '/api/themes') {
        return send(res, 200, loadThemes(workspace));
      }

      if (method === 'GET' && pathname === '/api/tags') {
        return send(res, 200, fanqieTagPayload());
      }

      // ----- workspace settings -----
      if (method === 'GET' && pathname === '/api/settings') {
        const sum = registry.summary();
        return send(res, 200, { max_concurrent: sum.max_concurrent, running_count: sum.running_count, queued_count: sum.queued_count });
      }
      if (method === 'POST' && pathname === '/api/settings') {
        const body = await readBody(req);
        maxConcurrent = Math.max(1, Math.min(16, Number(body.max_concurrent || maxConcurrent || 1)));
        registry.setMaxConcurrent(maxConcurrent);
        fs.writeFileSync(settingsPath, JSON.stringify({ max_concurrent: maxConcurrent }, null, 2), 'utf8');
        const sum = registry.summary();
        return send(res, 200, { ok: true, max_concurrent: sum.max_concurrent, running_count: sum.running_count, queued_count: sum.queued_count });
      }

      // ----- pipeline control -----
      if (method === 'POST' && pathname === '/api/run') {
        const body = await readBody(req);
        const pid = body.project_id || activeId;
        if (!pid) return send(res, 400, { detail: 'no project_id' });
        if (body.backend || Object.prototype.hasOwnProperty.call(body, 'model')) {
          try {
            applyAiSettings(new NovelProject(resolveProject(workspace, pid)), body, registry, pid);
          } catch (e) {
            return send(res, e.statusCode || 400, { detail: e.message, code: e.statusCode === 412 ? 'ai_unavailable' : 'bad_ai_backend', backend: e.backend || body.backend || '' });
          }
        } else {
          const stForBackend = requireState(workspace, pid);
          const capErr = aiCapabilityError(stForBackend.setup.backend || null);
          if (capErr) return send(res, 412, { detail: capErr.message, code: 'ai_unavailable', backend: stForBackend.setup.backend || '' });
        }
        const st = registry.enqueue(pid, {
          mode: body.mode || 'all',
          fromChapter: Number(body.from || 1),
          toChapter: body.to ? Number(body.to) : null,
          cap: body.cap ? Number(body.cap) : null,
        });
        return send(res, 200, { ok: true, ...st });
      }

      if (method === 'POST' && pathname === '/api/continue') {
        const body = await readBody(req);
        const pid = body.project_id || activeId;
        if (!pid) return send(res, 400, { detail: 'no project_id' });
        const newTarget = Number(body.target_chapters || 0);
        if (!newTarget || newTarget <= 0) return send(res, 400, { detail: 'target_chapters required' });
        let state;
        try { state = requireState(workspace, pid); }
        catch (e) { return send(res, 404, { detail: e.message }); }
        // 校验：newTarget 不能低于已写章节最大值（否则没意义）。
        // 至于是否大于 setup.target_chapters / 已有 continuation —— 交给 ensureContinuation 判断
        // （它会先尝试复用 to_chapter 完全匹配的 continuation，避免重复跑 4 个续集 agent）。
        const writtenMax = state.chapters
          .filter((c) => c?.body && String(c.body).trim())
          .reduce((m, c) => Math.max(m, c.order || 0), 0);
        if (newTarget < writtenMax) {
          return send(res, 400, { detail: `target_chapters cannot be less than already-written ${writtenMax}` });
        }
        const taskState = registry.stateOf(pid);
        if (taskState.running || taskState.queued) {
          return send(res, 400, { detail: 'project is busy; stop or wait before continuing' });
        }
        const capErr = aiCapabilityError(state.setup.backend || null);
        if (capErr) return send(res, 412, { detail: capErr.message, code: 'ai_unavailable', backend: state.setup.backend || '' });
        const st = registry.enqueue(pid, { mode: 'continue', newTarget });
        return send(res, 200, { ok: true, ...st });
      }

      if (method === 'POST' && (pathname === '/api/pause' || pathname === '/api/resume')) {
        const body = await readBody(req).catch(() => ({}));
        const pid = pidFrom(url, body);
        if (!pid) return send(res, 400, { detail: 'no project_id' });
        if (pathname === '/api/pause') registry.pause(pid); else registry.resume(pid);
        return send(res, 200, { ok: true, ...registry.stateOf(pid) });
      }

      // ----- publish meta preview -----
      if (method === 'POST' && pathname === '/api/publish_meta/preview') {
        const body = await readBody(req);
        const description = String(body.description || '').trim();
        if (!description) return send(res, 400, { detail: 'description required' });
        try {
          const llm = new LLM(LLMConfig.forBackend(body.backend || 'codex', { model: body.model || null }));
          const meta = await publishMetaAgent(description, llm, { audienceHint: String(body.audience_hint || '') });
          return send(res, 200, { ok: true, publish_meta: meta });
        } catch (e) {
          return send(res, 500, { detail: `publish_meta generation failed: ${e.message}` });
        }
      }

      // ----- SSE event stream -----
      if (method === 'GET' && pathname === '/api/events') {
        return openEventStream(req, res, registry, url.searchParams.get('project_id') || null);
      }

      return send(res, 404, { detail: 'not found' });
    } catch (e) {
      return send(res, 500, { detail: e.message });
    }
  });

  server.listen(port, host, () => console.log(`笔仙助手: http://${host}:${port}`));
  server.registry = registry;
  return server;
}

// ---------- request handlers extracted for clarity ----------

function handleInit(body, { workspace, registry }) {
  const payload = { ...body };
  const pmPayload = payload.publish_meta; delete payload.publish_meta;
  const generateMetaAsync = Boolean(payload.generate_publish_meta_async);
  delete payload.generate_publish_meta_async;
  let audienceHint = String(payload.audience_hint || ''); delete payload.audience_hint;
  const themeId = payload.theme_id || null; delete payload.theme_id;

  if (themeId) {
    const theme = loadThemeById(workspace, themeId);
    if (theme) {
      if (!payload.description) payload.description = theme.description || '';
      if (!payload.target_chapters) payload.target_chapters = theme.target_chapters || 100;
      if (!payload.target_word_count_wan) payload.target_word_count_wan = theme.target_word_count_wan || 60.0;
      if (!audienceHint) audienceHint = theme.audience || '';
      if (!payload.title) payload.title = theme.title || '';
      if (!payload.genre) payload.genre = theme.genre || '通用';
    }
  }

  const pm = pmPayload ? new PublishMeta(pmPayload) : null;
  if (pm) {
    if (pm.book_name && !payload.title) payload.title = pm.book_name;
    if (pm.protagonists?.length) payload.protagonist = pm.protagonists.join('、');
  }
  if (audienceHint) payload.audience_hint = audienceHint;

  const setup = new ProjectSetup(payload);
  const state = new NovelState({ setup, publish_meta: pm });
  const dir = uniqueProjectDir(workspace, setup.title);
  new NovelProject(dir).save(state);
  const newId = path.basename(dir);

  if (generateMetaAsync && !state.publish_meta) {
    spawnPublishMetaWorker(dir, newId, setup.description || '', audienceHint, registry, setup.backend || 'codex');
  }
  return { project_id: newId, state };
}

function spawnPublishMetaWorker(dir, projectId, description, audienceHint, registry, backend = 'codex') {
  (async () => {
    try {
      const llm = new LLM(LLMConfig.forBackend(backend, {}));
      const meta = await publishMetaAgent(description, llm, { audienceHint });
      const proj = new NovelProject(dir);
      const st = proj.load();
      st.publish_meta = meta;
      if (!st.setup.title && meta.book_name) st.setup.title = meta.book_name;
      proj.save(st);
      registry.bus.emit('event', {
        type: 'state_updated', project_id: projectId, ts: Date.now(), publish_meta_ready: true,
      });
    } catch (e) {
      registry.bus.emit('event', {
        type: 'log', project_id: projectId, ts: Date.now(),
        level: 'warn', message: `publish_meta async failed: ${e.message}`,
      });
    }
  })();
}

function openEventStream(req, res, registry, filterId) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ project_id: filterId, ts: Date.now() })}\n\n`);

  const onEvent = (evt) => {
    if (filterId && evt.project_id && evt.project_id !== filterId) return;
    try { res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`); } catch {}
  };
  registry.bus.on('event', onEvent);
  const keepalive = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15_000);
  req.on('close', () => {
    registry.bus.off('event', onEvent);
    clearInterval(keepalive);
  });
}
