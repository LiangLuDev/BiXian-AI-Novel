import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { NovelProject } from './project.mjs';
import { LLM, LLMConfig } from './llm/index.mjs';
import { Orchestrator, PipelineController, PipelineOptions, PipelineAbort } from './orchestrator.mjs';

const MODES = new Set(['all', 'resume', 'setup', 'design', 'write', 'finalize', 'continue']);

function buildLlm(state) {
  const backend = state?.setup?.backend || 'codex';
  const model = state?.setup?.model || null;
  return new LLM(LLMConfig.forBackend(backend, { model }));
}

// 封面落点：状态字段优先，未填则回退到 <projectDir>/cover.png。
// 越界路径（指到项目外）一律视为不存在，防止读到任意盘。
export function resolveCoverFile(state, projectDir) {
  const raw = (state?.cover_image_path || '').trim();
  if (!raw) {
    const def = path.join(projectDir, 'cover.png');
    return fs.existsSync(def) ? def : null;
  }
  const p = path.isAbsolute(raw) ? raw : path.join(projectDir, raw);
  try {
    const resolved = path.resolve(p);
    const root = path.resolve(projectDir);
    if (!resolved.startsWith(root)) return null;
    return fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

export class TaskRegistry {
  constructor({ workspace, maxConcurrent = 2 } = {}) {
    this.workspace = workspace;
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.bus = new EventEmitter();
    this.bus.setMaxListeners(0);
    this.tasks = new Map();   // projectId -> task
    this.order = [];          // FIFO queue of projectIds
    this.covers = new Map();  // projectId -> in-flight cover Promise
  }

  // ---------- introspection ----------
  runningCount() { return [...this.tasks.values()].filter((t) => t.status === 'running').length; }
  queuedCount() { return [...this.tasks.values()].filter((t) => t.status === 'queued').length; }

  stateOf(projectId) {
    const t = this.tasks.get(projectId);
    const coverRunning = this.covers.has(projectId);
    if (!t) {
      return { running: false, paused: false, queued: false, current_agent: null, current_chapter: null, cover_running: coverRunning };
    }
    return {
      running: t.status === 'running',
      paused: t.paused,
      queued: t.status === 'queued',
      current_agent: t.currentAgent,
      current_chapter: t.currentChapter,
      mode: t.mode,
      cover_running: coverRunning,
    };
  }

  summary() {
    return {
      running_count: this.runningCount(),
      queued_count: this.queuedCount(),
      max_concurrent: this.maxConcurrent,
    };
  }

  async waitForTask(projectId, timeoutMs = 90_000) {
    const t = this.tasks.get(projectId);
    if (!t?.promise) return;
    await Promise.race([t.promise, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  // ---------- mutation ----------
  setMaxConcurrent(n) {
    this.maxConcurrent = Math.max(1, Math.min(16, Number(n) || 1));
    this._pump();
  }

  enqueue(projectId, { mode = 'all', fromChapter = 1, toChapter = null, cap = null, newTarget = null } = {}) {
    if (!MODES.has(mode)) throw new Error(`unknown mode: ${mode}`);
    const existing = this.tasks.get(projectId);
    if (existing && (existing.status === 'running' || existing.status === 'queued')) {
      // Re-enqueue while running/queued is a no-op except: a paused task auto-resumes.
      if (existing.paused) {
        existing.controller.resume();
        existing.paused = false;
        this._emit('pipeline_resumed', projectId);
      }
      return this.stateOf(projectId);
    }
    const task = {
      projectId, mode, fromChapter, toChapter, cap, newTarget,
      status: 'queued', paused: false, cancelled: false,
      currentAgent: null, currentChapter: null,
      controller: null, promise: null,
    };
    this.tasks.set(projectId, task);
    this.order.push(projectId);
    this._emit('queued', projectId, { mode });
    this._pump();
    return this.stateOf(projectId);
  }

  pause(projectId) {
    const t = this.tasks.get(projectId);
    if (!t) return false;
    if (t.status === 'queued') {
      this._removeFromQueue(projectId);
      this.tasks.delete(projectId);
      this._emit('pipeline_stopped', projectId, { reason: 'unqueued' });
      this._pump();
      return true;
    }
    if (t.status === 'running' && t.controller && !t.paused) {
      t.paused = true;
      t.controller.pause();
      this._emit('pipeline_paused', projectId);
      return true;
    }
    return false;
  }

  resume(projectId) {
    const t = this.tasks.get(projectId);
    if (!t) return this.enqueue(projectId, { mode: 'all' });
    if (t.status !== 'running' || !t.paused) return this.stateOf(projectId);
    t.paused = false;
    t.controller.resume();
    this._emit('pipeline_resumed', projectId);
    return this.stateOf(projectId);
  }

  cancel(projectId) {
    const t = this.tasks.get(projectId);
    if (!t) return false;
    if (t.status === 'queued') {
      this._removeFromQueue(projectId);
      this.tasks.delete(projectId);
      this._emit('pipeline_stopped', projectId, { reason: 'cancelled' });
      this._pump();
      return true;
    }
    t.cancelled = true;
    if (t.controller) t.controller.abort();
    return true;
  }

  cancelCover(projectId) {
    const cover = this.covers.get(projectId);
    if (!cover) return false;
    cover.controller?.abort();
    return true;
  }

  async waitForCover(projectId, timeoutMs = 30_000) {
    const cover = this.covers.get(projectId);
    if (!cover?.promise) return;
    await Promise.race([cover.promise, new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  // Cancel every running / queued task and every in-flight cover worker, then
  // wait (bounded) for their child processes to terminate via SIGTERM.
  // Used by Electron main on app quit to avoid orphaned codex/claude children.
  async shutdown({ timeoutMs = 3000 } = {}) {
    const taskIds = [...this.tasks.keys()];
    const coverIds = [...this.covers.keys()];
    for (const id of taskIds) this.cancel(id);
    for (const id of coverIds) this.cancelCover(id);
    await Promise.all([
      ...taskIds.map((id) => this.waitForTask(id, timeoutMs)),
      ...coverIds.map((id) => this.waitForCover(id, timeoutMs)),
    ]);
  }

  // ---------- internals ----------
  _emit(event, projectId, payload = {}) {
    const evt = { type: event, project_id: projectId, ts: Date.now(), ...payload };
    this.bus.emit('event', evt);
    this.bus.emit(event, evt);
  }

  _removeFromQueue(id) {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  _pump() {
    while (this.runningCount() < this.maxConcurrent && this.order.length > 0) {
      const id = this.order.shift();
      const t = this.tasks.get(id);
      if (!t || t.status !== 'queued') continue;
      this._launch(t);
    }
  }

  _launch(task) {
    task.status = 'running';
    const { projectId } = task;
    const projectDir = path.join(this.workspace, projectId);
    const proj = new NovelProject(projectDir);
    const state = proj.load();
    const llm = buildLlm(state);
    const controller = new PipelineController();
    llm.setAbortSignal(controller.signal);
    task.controller = controller;

    this._wireControllerEvents(controller, task, llm);

    const orch = new Orchestrator(llm, new PipelineOptions({
      autosavePath: projectDir,
      chapterCountOverride: task.cap || null,
      controller,
    }));

    this._emit('pipeline_started', projectId, { mode: task.mode });
    const coverEligible = task.mode === 'all' || task.mode === 'resume' || task.mode === 'finalize';
    if (coverEligible) this.maybeStartCoverWorker(projectId, { reason: 'pre-run' });

    task.promise = this._runTask(task, orch, proj, state, coverEligible);
  }

  _wireControllerEvents(controller, task, llm) {
    const { projectId } = task;
    controller.on('agent_started', ({ agent }) => {
      task.currentAgent = agent;
      this._emit('agent_started', projectId, { agent });
    });
    controller.on('agent_completed', ({ agent, usage_delta }) => {
      task.currentAgent = null;
      this._emit('agent_completed', projectId, { agent });
      this._emit('tokens_updated', projectId, {
        totals: llm.totalTokens(),
        delta_entries: usage_delta?.length || 0,
      });
    });
    controller.on('agent_failed', ({ agent, error }) => {
      console.error(`[pipeline:${projectId}] agent_failed ${agent}: ${error}`);
      this._emit('agent_failed', projectId, { agent, error });
      this._emit('log', projectId, { level: 'error', message: `agent ${agent} failed: ${error}` });
    });
    controller.on('phase_started', ({ phase }) => this._emit('phase_started', projectId, { phase }));
    controller.on('phase_completed', ({ phase }) => this._emit('phase_completed', projectId, { phase }));
    controller.on('chapter_started', ({ order }) => {
      task.currentChapter = order;
      this._emit('chapter_started', projectId, { order });
    });
    controller.on('chapter_completed', ({ order, word_count }) => {
      task.currentChapter = null;
      this._emit('chapter_completed', projectId, { order, word_count });
    });
    controller.on('state_updated', () => this._emit('state_updated', projectId, {}));
  }

  async _runTask(task, orch, proj, state, coverEligible) {
    const { projectId } = task;
    try {
      if (task.mode === 'all' || task.mode === 'resume') await orch.runAll(state);
      else if (task.mode === 'setup') await orch.runSetup(state);
      else if (task.mode === 'design') await orch.runDesign(state);
      else if (task.mode === 'write') await orch.runChapters(state, { fromChapter: task.fromChapter, toChapter: task.toChapter });
      else if (task.mode === 'finalize') await orch.runFinalize(state);
      else if (task.mode === 'continue') await orch.runContinuation(state, { newTarget: task.newTarget });
      orch.flushUsageToState(state);
      proj.save(state);
      this._emit('pipeline_completed', projectId, { mode: task.mode });
    } catch (e) {
      try { orch.flushUsageToState(state); proj.save(state); } catch {}
      if (e instanceof PipelineAbort) {
        this._emit('pipeline_stopped', projectId, { reason: 'aborted' });
      } else {
        const msg = String(e?.message || e);
        const stack = String(e?.stack || '').slice(0, 2000);
        console.error(`[pipeline:${projectId}] FAILED: ${msg}\n${stack}`);
        this._emit('pipeline_failed', projectId, { error: msg, stack });
        this._emit('log', projectId, { level: 'error', message: msg });
      }
    } finally {
      this.tasks.delete(projectId);
      if (coverEligible && !task.cancelled) this.maybeStartCoverWorker(projectId, { reason: 'post-run' });
      this._pump();
    }
  }

  // Spawn an async cover-image worker. Idempotent: skips when already running,
  // when no prompt is set, or when a cover file already exists on disk.
  maybeStartCoverWorker(projectId, { reason = 'post-run' } = {}) {
    if (this.covers.has(projectId)) return false;
    const projectDir = path.join(this.workspace, projectId);
    if (!fs.existsSync(projectDir)) return false;

    let state;
    try { state = new NovelProject(projectDir).load(); } catch { return false; }
    if (!(state.cover_prompt || '').trim()) return false;
    if (resolveCoverFile(state, projectDir)) return false;

    const controller = new PipelineController();
    const promise = (async () => {
      this._emit('cover_image_started', projectId, { reason });
      try {
        const llm = buildLlm(state);
        llm.setAbortSignal(controller.signal);
        const orch = new Orchestrator(llm, new PipelineOptions({
          autosavePath: projectDir,
          generateCoverImage: true,
          controller,
        }));
        const err = await orch.generateCoverImage(state, { logPrefix: `${reason} async cover image` });
        if (err) {
          this._emit('cover_image_failed', projectId, { error: String(err.message || err) });
        } else {
          try { new NovelProject(projectDir).save(state); } catch {}
          this._emit('cover_image_completed', projectId, { path: state.cover_image_path });
          this._emit('state_updated', projectId, {});
        }
      } catch (e) {
        this._emit('cover_image_failed', projectId, { error: String(e?.message || e) });
      } finally {
        this.covers.delete(projectId);
      }
    })();
    this.covers.set(projectId, { promise, controller });
    return true;
  }
}
