// Icons — line-style, 1.5px stroke
const Icon = ({ d, size = 16, stroke = 1.5, fill }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"}
       stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
       style={{ flex: "0 0 auto", display: "block" }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const I = {
  Home: (p) => <Icon size={p?.size} d="M3 11.5l9-7 9 7V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" />,
  Book: (p) => <Icon size={p?.size} d={["M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1 0-4h13", "M9 7h7"]} />,
  Outline: (p) => <Icon size={p?.size} d={["M4 6h16","M4 12h16","M4 18h10"]} />,
  Users: (p) => <Icon size={p?.size} d={["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M22 21v-2a4 4 0 0 0-3-3.87","M16 3.13a4 4 0 0 1 0 7.75","M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"]} />,
  Sparkles: (p) => <Icon size={p?.size} d={["M12 3v4","M12 17v4","M3 12h4","M17 12h4","M5.6 5.6l2.8 2.8","M15.6 15.6l2.8 2.8","M18.4 5.6l-2.8 2.8","M8.4 15.6l-2.8 2.8"]} />,
  Plus: (p) => <Icon size={p?.size} d={["M12 5v14","M5 12h14"]} />,
  Search: (p) => <Icon size={p?.size} d={["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z","M20 20l-3.5-3.5"]} />,
  ChevronRight: (p) => <Icon size={p?.size} d="M9 6l6 6-6 6" />,
  ChevronDown: (p) => <Icon size={p?.size} d="M6 9l6 6 6-6" />,
  Play: (p) => <Icon size={p?.size} d="M6 4l14 8-14 8z" />,
  Pause: (p) => <Icon size={p?.size} d={["M7 5v14","M17 5v14"]} />,
  Stop: (p) => <Icon size={p?.size} d="M6 6h12v12H6z" />,
  Check: (p) => <Icon size={p?.size} d="M5 12l4 4 10-10" stroke={2} />,
  X: (p) => <Icon size={p?.size} d={["M6 6l12 12","M18 6L6 18"]} />,
  Clock: (p) => <Icon size={p?.size} d={["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M12 7v5l3 2"]} />,
  Eye: (p) => <Icon size={p?.size} d={["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z","M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"]} />,
  Globe: (p) => <Icon size={p?.size} d={["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z","M3 12h18","M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"]} />,
  Bookmark: (p) => <Icon size={p?.size} d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />,
  Sliders: (p) => <Icon size={p?.size} d={["M4 21v-7","M4 10V3","M12 21v-9","M12 8V3","M20 21v-5","M20 12V3","M1 14h6","M9 8h6","M17 16h6"]} />,
  Refresh: (p) => <Icon size={p?.size} d={["M21 12a9 9 0 1 1-3-6.7","M21 4v5h-5"]} />,
  Pencil: (p) => <Icon size={p?.size} d={["M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z","M13.5 7.5l3 3"]} />,
  Trash: (p) => <Icon size={p?.size} d={["M4 7h16","M10 11v6","M14 11v6","M6 7l1 14h10l1-14","M9 7V4h6v3"]} />,
  ArrowLeft: (p) => <Icon size={p?.size} d="M15 6l-6 6 6 6" />,
};

window.I = I;
window.Icon = Icon;
