export function nowIso() {
  return new Date().toISOString();
}

export class ProjectSetup {
  constructor(data = {}) {
    Object.assign(this, {
      title: null,
      description: '',
      genre: '通用',
      literary_style: '现代白话',
      narrative_time: '线性叙事',
      perspective: '第三人称',
      narrative_structure: ['三段式'],
      mood: '',
      era: '',
      protagonist: '',
      conflict: [],
      highlight: [],
      taboo: [],
      anti_ai_tells: [],
      custom_requirements: '',
      target_chapters: 50,
      target_word_count_wan: 30.0,
      per_chapter_min: 2500,
      per_chapter_max: 3500,
      opening_type: '',
      opening_hook: '',
      outline_type: '三段式',
      short_story: false,
      backend: 'codex',
      theme_id: null,
    }, data);
  }
  get per_chapter_target() {
    return Math.floor((this.per_chapter_min + this.per_chapter_max) / 2);
  }
  toJSON() { return { ...this }; }
}

export class StyleGuide {
  constructor(data = {}) { Object.assign(this, { role: '', context: '', task: '', constraint: '' }, data); }
  toBlock() {
    if (![this.role, this.context, this.task, this.constraint].some(Boolean)) return '';
    const lines = ['【作品宪章 / Style Guide】'];
    if (this.role) lines.push(`- 角色定位：${this.role}`);
    if (this.context) lines.push(`- 背景与约束：${this.context}`);
    if (this.task) lines.push(`- 创作目标：${this.task}`);
    if (this.constraint) lines.push(`- 硬性约束：${this.constraint}`);
    return lines.join('\n');
  }
  toJSON() { return { ...this }; }
}

export class Character {
  constructor(data = {}) { Object.assign(this, { name: '', tier: 'main', role: '', age: null, gender: null, appearance: '', personality: '', background: '', motivation: '', ability: '', speech_pattern: '', habits: '', fears: '', secret: '', arc: '', raw_card: '' }, data); }
  toJSON() { return { ...this }; }
}

export class CharacterRelation { constructor(data = {}) { Object.assign(this, { a: '', b: '', relation: '', description: '' }, data); } toJSON() { return { ...this }; } }
export class Volume { constructor(data = {}) { Object.assign(this, { order: 0, title: '', summary: '', chapter_range: [0, 0] }, data); } toJSON() { return { ...this }; } }
export class ChapterDesign { constructor(data = {}) { Object.assign(this, { order: 0, title: null, highlight: '', core_conflict: '', plot: '', emotional_tone: '', ending_hook: '', raw: '' }, data); } toJSON() { return { ...this }; } }
export class Hook { constructor(data = {}) { Object.assign(this, { id: '', text: '', planted_chapter: 0, half_life: 10, due_chapter: null, resolved_chapter: null }, data); } toJSON() { return { ...this }; } }
export class PublishMeta { constructor(data = {}) { Object.assign(this, { book_name: '', audience: '', main_category: '', themes: [], roles: [], plots: [], protagonists: [], synopsis: '', title_candidates: [], generated_at: null, locked: false }, data); } toJSON() { return { ...this }; } }

export class Chapter {
  constructor(data = {}) {
    Object.assign(this, { order: 0, design: new ChapterDesign(), body: '', word_count: 0, summary: '', new_characters: [], relations_delta: [], qa_reports: {}, revisions: [] }, data);
    this.design = new ChapterDesign(this.design);
    this.new_characters = (this.new_characters || []).map((c) => new Character(c));
    this.relations_delta = (this.relations_delta || []).map((r) => new CharacterRelation(r));
  }
  toJSON() { return { ...this }; }
}

export class NovelState {
  constructor(data = {}) {
    Object.assign(this, {
      setup: new ProjectSetup(),
      publish_meta: null,
      style_guide: null,
      philosophical_theme: '',
      world_building: '',
      outline: '',
      volumes: [],
      main_characters: [],
      secondary_characters: [],
      relations: [],
      arcs: '',
      chapter_designs: [],
      chapters: [],
      hooks: [],
      titles_proposed: [],
      cover_prompt: '',
      cover_image_path: '',
      cost_log: [],
      created_at: nowIso(),
    }, data);
    this.setup = new ProjectSetup(this.setup);
    this.publish_meta = this.publish_meta ? new PublishMeta(this.publish_meta) : null;
    this.style_guide = this.style_guide ? new StyleGuide(this.style_guide) : null;
    this.volumes = (this.volumes || []).map((v) => new Volume(v));
    this.main_characters = (this.main_characters || []).map((c) => new Character(c));
    this.secondary_characters = (this.secondary_characters || []).map((c) => new Character(c));
    this.relations = (this.relations || []).map((r) => new CharacterRelation(r));
    this.chapter_designs = (this.chapter_designs || []).map((d) => new ChapterDesign(d));
    this.chapters = (this.chapters || []).map((c) => new Chapter(c));
    this.hooks = (this.hooks || []).map((h) => new Hook(h));
  }
  allCharacters() { return [...this.main_characters, ...this.secondary_characters]; }
  characterCardsMd() { return this.allCharacters().map((c) => c.raw_card).filter(Boolean).join('\n\n'); }
  recentChapterSummaries(n = 5) { return this.chapters.slice(-n).map((c) => `## 第${c.order}章 ${c.design.title || ''}\n${c.summary || c.body.slice(0, 300)}`).join('\n\n'); }
  prevChapterEnding(chapterOrder) { return this.chapters.find((c) => c.order === chapterOrder - 1)?.body.slice(-600) || ''; }
  openHooks(beforeChapter = null) { return this.hooks.filter((h) => h.resolved_chapter == null && (beforeChapter == null || h.planted_chapter <= beforeChapter)).sort((a, b) => a.planted_chapter - b.planted_chapter); }
  findHook(id) { return this.hooks.find((h) => h.id === id) || null; }
  plantHook({ id, text, planted_chapter, half_life = 10 }) { const existing = this.findHook(id); if (existing) return existing; const h = new Hook({ id, text, planted_chapter, half_life }); this.hooks.push(h); return h; }
  resolveHook(id, chapterOrder) { const h = this.findHook(id); if (h && h.resolved_chapter == null) h.resolved_chapter = chapterOrder; return h; }
  chapterDesignFor(order) { return this.chapter_designs.find((d) => d.order === order) || null; }
}
