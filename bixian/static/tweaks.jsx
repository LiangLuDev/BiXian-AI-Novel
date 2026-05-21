// Fixed appearance: accent hue / density / font mode
const TWEAK_DEFAULTS = { accentHue: 150, density: "comfortable", fontMode: "literary" };

const loadTweaks = () => {
  return { ...TWEAK_DEFAULTS };
};

const applyTweaks = (t) => {
  const r = document.documentElement;
  r.style.setProperty("--brand", `oklch(0.79 0.17 ${t.accentHue})`);
  r.style.setProperty("--brand-hover", `oklch(0.83 0.17 ${t.accentHue})`);
  r.style.setProperty("--brand-dim", `oklch(0.65 0.17 ${t.accentHue})`);
  r.style.setProperty("--brand-soft", `oklch(0.79 0.17 ${t.accentHue} / 0.14)`);
  r.style.setProperty("--brand-fg", `oklch(0.18 0.04 ${t.accentHue})`);
  if (t.fontMode === "literary") {
    r.style.setProperty("--font-sans", '"Noto Serif SC","Source Han Serif SC","Songti SC", serif');
    r.style.setProperty("--font-display", '"Noto Serif SC","Source Han Serif SC","Songti SC", serif');
  } else {
    r.style.setProperty("--font-sans", '"Geist","Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif');
    r.style.setProperty("--font-display", '"Geist","Plus Jakarta Sans", -apple-system, sans-serif');
  }
  document.body.dataset.density = t.density;
};

const useTweaks = () => {
  const t = React.useMemo(loadTweaks, []);
  React.useEffect(() => { applyTweaks(t); }, [t]);
  return t;
};

window.useTweaks = useTweaks;
