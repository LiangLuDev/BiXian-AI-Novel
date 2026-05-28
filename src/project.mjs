import fs from 'node:fs';
import path from 'node:path';
import { Chapter, ChapterDesign, Character, CharacterRelation, Continuation, Hook, NovelState, ProjectSetup, PublishMeta, StyleGuide, Volume } from './state.mjs';

const SAFE_RE = /[^\w一-鿿-]+/gu;
const pad = (n, width = 3) => String(n).padStart(width, '0');
const slug = (name, fallback = 'x') => (String(name || '').trim().replace(SAFE_RE, '-').replace(/^-+|-+$/g, '').slice(0, 48) || fallback);

function atomicWriteText(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, content, 'utf8'); fs.renameSync(tmp, file); }
function atomicWriteJson(file, data) { atomicWriteText(file, JSON.stringify(data, null, 2)); }
function readText(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
function readJson(file, fallback = null) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback; }
function syncDir(dir, expectedNames) { if (!fs.existsSync(dir)) return; const expected = new Set(expectedNames); for (const name of fs.readdirSync(dir)) { if (!expected.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true }); } }
function stripKey(obj, key) { const out = { ...obj }; delete out[key]; return out; }

export class NovelProject {
  constructor(root) { this.root = path.resolve(String(root)); }
  get projectJson() { return path.join(this.root, 'project.json'); }
  get charactersDir() { return path.join(this.root, 'characters'); }
  get designsDir() { return path.join(this.root, 'designs'); }
  get chaptersDir() { return path.join(this.root, 'chapters'); }
  get costLogPath() { return path.join(this.root, 'cost_log.jsonl'); }
  chapterDir(order) { return path.join(this.chaptersDir, pad(order)); }
  static isProjectDir(dir) { return fs.existsSync(path.join(String(dir), 'project.json')) && fs.statSync(String(dir)).isDirectory(); }

  save(stateLike) {
    const state = new NovelState(stateLike);
    fs.mkdirSync(this.root, { recursive: true });
    atomicWriteJson(this.projectJson, {
      schema: 'bixian.project/v1',
      created_at: state.created_at || null,
      setup: state.setup,
      style_guide: state.style_guide,
      titles_proposed: state.titles_proposed,
      cover_image_path: state.cover_image_path,
      continuations: state.continuations || [],
    });
    atomicWriteText(path.join(this.root, 'theme.md'), state.philosophical_theme || '');
    atomicWriteText(path.join(this.root, 'world.md'), state.world_building || '');
    atomicWriteText(path.join(this.root, 'outline.md'), state.outline || '');
    atomicWriteText(path.join(this.root, 'arcs.md'), state.arcs || '');
    atomicWriteText(path.join(this.root, 'cover_prompt.txt'), state.cover_prompt || '');
    atomicWriteJson(path.join(this.root, 'volumes.json'), state.volumes);
    atomicWriteJson(path.join(this.root, 'relations.json'), state.relations);
    atomicWriteJson(path.join(this.root, 'hooks.json'), state.hooks);
    if (state.publish_meta) atomicWriteJson(path.join(this.root, 'publish.json'), state.publish_meta); else fs.rmSync(path.join(this.root, 'publish.json'), { force: true });
    this.#saveCharacterGroup('main', state.main_characters);
    this.#saveCharacterGroup('secondary', state.secondary_characters);
    syncDir(this.charactersDir, ['main', 'secondary']);
    this.#saveDesigns(state.chapter_designs);
    this.#saveChapters(state.chapters);
    this.#saveCostLog(state.cost_log);
  }

  load() {
    if (!fs.existsSync(this.projectJson)) throw new Error(`not a 笔仙助手 project directory: ${this.root} (missing project.json)`);
    const index = readJson(this.projectJson, {});
    const state = new NovelState({
      setup: new ProjectSetup(index.setup || {}),
      style_guide: index.style_guide ? new StyleGuide(index.style_guide) : null,
      created_at: index.created_at || undefined,
      titles_proposed: index.titles_proposed || [],
      cover_image_path: index.cover_image_path || '',
      philosophical_theme: readText(path.join(this.root, 'theme.md')),
      world_building: readText(path.join(this.root, 'world.md')),
      outline: readText(path.join(this.root, 'outline.md')),
      arcs: readText(path.join(this.root, 'arcs.md')),
      cover_prompt: readText(path.join(this.root, 'cover_prompt.txt')),
      volumes: (readJson(path.join(this.root, 'volumes.json'), []) || []).map((v) => new Volume(v)),
      relations: (readJson(path.join(this.root, 'relations.json'), []) || []).map((r) => new CharacterRelation(r)),
      hooks: (readJson(path.join(this.root, 'hooks.json'), []) || []).map((h) => new Hook(h)),
      continuations: (index.continuations || []).map((c) => new Continuation(c)),
      publish_meta: readJson(path.join(this.root, 'publish.json'), null),
      main_characters: this.#loadCharacterGroup('main'),
      secondary_characters: this.#loadCharacterGroup('secondary'),
      chapter_designs: this.#loadDesigns(),
      chapters: this.#loadChapters(),
      cost_log: this.#loadCostLog(),
    });
    return state;
  }

  #saveCharacterGroup(tier, chars) {
    const dir = path.join(this.charactersDir, tier); fs.mkdirSync(dir, { recursive: true }); const expected = [];
    chars.forEach((c, i) => { const idx = i + 1; const stem = `${pad(idx)}-${slug(c.name, `char${idx}`)}`; expected.push(`${stem}.md`, `${stem}.json`); atomicWriteText(path.join(dir, `${stem}.md`), c.raw_card || ''); atomicWriteJson(path.join(dir, `${stem}.json`), stripKey(c, 'raw_card')); });
    syncDir(dir, expected);
  }
  #saveDesigns(designs) { fs.mkdirSync(this.designsDir, { recursive: true }); const expected = []; designs.forEach((d) => { const stem = pad(d.order); expected.push(`${stem}.md`, `${stem}.json`); atomicWriteText(path.join(this.designsDir, `${stem}.md`), d.raw || ''); atomicWriteJson(path.join(this.designsDir, `${stem}.json`), stripKey(d, 'raw')); }); syncDir(this.designsDir, expected); }
  #saveChapters(chapters) { fs.mkdirSync(this.chaptersDir, { recursive: true }); const expected = []; chapters.forEach((ch) => { const stem = pad(ch.order); expected.push(stem); const dir = path.join(this.chaptersDir, stem); fs.mkdirSync(dir, { recursive: true }); atomicWriteText(path.join(dir, 'body.md'), ch.body || ''); atomicWriteJson(path.join(dir, 'meta.json'), { order: ch.order, title: ch.design.title, word_count: ch.word_count, summary: ch.summary, qa_reports: ch.qa_reports, design: ch.design, new_characters: ch.new_characters, relations_delta: ch.relations_delta }); const revDir = path.join(dir, 'revisions'); fs.mkdirSync(revDir, { recursive: true }); const revExpected = []; (ch.revisions || []).forEach((rev, i) => { const name = `r${i + 1}.md`; revExpected.push(name); atomicWriteText(path.join(revDir, name), rev); }); syncDir(revDir, revExpected); }); syncDir(this.chaptersDir, expected); }
  #saveCostLog(entries) { atomicWriteText(this.costLogPath, (entries || []).map((e) => JSON.stringify(e)).join('\n') + ((entries || []).length ? '\n' : '')); }
  #loadCharacterGroup(tier) { const dir = path.join(this.charactersDir, tier); if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort().map((n) => { const jsonPath = path.join(dir, n); const data = readJson(jsonPath, {}) || {}; data.raw_card = readText(jsonPath.replace(/\.json$/u, '.md')); data.tier ??= tier; return new Character(data); }); }
  #loadDesigns() { if (!fs.existsSync(this.designsDir)) return []; return fs.readdirSync(this.designsDir).filter((n) => n.endsWith('.json')).sort().map((n) => { const jsonPath = path.join(this.designsDir, n); const data = readJson(jsonPath, {}) || {}; data.raw = readText(jsonPath.replace(/\.json$/u, '.md')); return new ChapterDesign(data); }).sort((a, b) => a.order - b.order); }
  #loadChapters() { if (!fs.existsSync(this.chaptersDir)) return []; return fs.readdirSync(this.chaptersDir).sort().flatMap((stem) => { const dir = path.join(this.chaptersDir, stem); const metaPath = path.join(dir, 'meta.json'); if (!fs.existsSync(metaPath)) return []; const meta = readJson(metaPath, {}) || {}; const revDir = path.join(dir, 'revisions'); const revisions = fs.existsSync(revDir) ? fs.readdirSync(revDir).filter((n) => /^r\d+\.md$/u.test(n)).sort((a, b) => Number(a.match(/r(\d+)/u)[1]) - Number(b.match(/r(\d+)/u)[1])).map((n) => readText(path.join(revDir, n))) : []; return [new Chapter({ order: meta.order ?? meta.design?.order ?? 0, design: meta.design || { order: meta.order || 0 }, body: readText(path.join(dir, 'body.md')), word_count: meta.word_count || 0, summary: meta.summary || '', qa_reports: meta.qa_reports || {}, new_characters: meta.new_characters || [], relations_delta: meta.relations_delta || [], revisions })]; }).sort((a, b) => a.order - b.order); }
  #loadCostLog() { if (!fs.existsSync(this.costLogPath)) return []; return readText(this.costLogPath).split(/\r?\n/u).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
}
