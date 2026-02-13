import { useCallback, useEffect, useState } from "react";

export type ThemeName = "default" | "obsidian" | "aurora" | "terminal" | "paper" | "dusk";

interface ThemeOption {
  key: ThemeName;
  label: string;
  description: string;
  swatch: string;
}

const THEMES: ThemeOption[] = [
  { key: "default", label: "Parchment", description: "Original warm serif", swatch: "#f6f2e7" },
  { key: "obsidian", label: "Obsidian", description: "Dark professional", swatch: "#181a23" },
  { key: "aurora", label: "Aurora", description: "Vibrant gradients", swatch: "linear-gradient(135deg, #6c5ce7, #00cec9)" },
  { key: "terminal", label: "Terminal", description: "Hacker aesthetic", swatch: "#0a0a0a" },
  { key: "paper", label: "Paper", description: "Clean editorial", swatch: "#ffffff" },
  { key: "dusk", label: "Dusk", description: "Warm amber dark", swatch: "#1e1a28" }
];

const STORAGE_KEY = "kiingo-theme";

export function ThemeSwitcher(): JSX.Element {
  const [open, setOpen] = useState(false);
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

  function selectTheme(theme: ThemeName): void {
    setCurrent(theme);
    setOpen(false);
  }

  return (
    <div className="theme-switcher">
      {open && (
        <div className="theme-switcher-panel">
          {THEMES.map((theme) => (
            <button
              key={theme.key}
              type="button"
              className={current === theme.key ? "active-theme" : ""}
              onClick={() => selectTheme(theme.key)}
            >
              <span
                className="theme-swatch"
                style={{ background: theme.swatch }}
              />
              <span className="theme-label">
                <span>{theme.label}</span>
                <span>{theme.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        className="theme-switcher-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-label="Switch theme"
        title="Switch theme"
      >
        {open ? "\u2715" : "\u25D0"}
      </button>
    </div>
  );
}
