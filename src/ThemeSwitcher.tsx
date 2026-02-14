import { useCallback, useEffect, useState } from "react";

export type ThemeName = "default" | "obsidian" | "aurora" | "terminal" | "paper" | "dusk";

interface ThemeOption {
  key: ThemeName;
  label: string;
  swatch: string;
}

const THEMES: ThemeOption[] = [
  { key: "default", label: "Parchment", swatch: "#f6f2e7" },
  { key: "obsidian", label: "Obsidian", swatch: "#181a23" },
  { key: "aurora", label: "Aurora", swatch: "linear-gradient(135deg, #6c5ce7, #00cec9)" },
  { key: "terminal", label: "Terminal", swatch: "#0a0a0a" },
  { key: "paper", label: "Paper", swatch: "#ffffff" },
  { key: "dusk", label: "Dusk", swatch: "#1e1a28" }
];

const STORAGE_KEY = "kiingo-theme";

export function ThemeSwitcher(): JSX.Element {
  const [current, setCurrent] = useState<ThemeName>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && THEMES.some((t) => t.key === stored)) {
        return stored as ThemeName;
      }
    } catch {
      // ignore
    }
    return "default";
  });

  const applyTheme = useCallback((theme: ThemeName) => {
    if (theme === "default") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    applyTheme(current);
  }, [applyTheme, current]);

  return (
    <div className="theme-switcher-inline">
      {THEMES.map((theme) => (
        <button
          key={theme.key}
          type="button"
          className={`theme-swatch-btn${current === theme.key ? " active-theme" : ""}`}
          onClick={() => setCurrent(theme.key)}
          aria-label={theme.label}
          title={theme.label}
        >
          <span className="theme-swatch" style={{ background: theme.swatch }} />
        </button>
      ))}
    </div>
  );
}
