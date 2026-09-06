"use client";

import { Moon, Sun } from "lucide-react";

// The only writer of the theme besides the layout's boot script; both use
// the one storage key and the one `data-theme` attribute.
function setTheme(theme: "dark" | "light") {
  document.documentElement.setAttribute("data-theme", theme === "dark" ? "cool-dark" : "cool-light");
  try {
    localStorage.setItem("cool-workflow-theme", theme);
  } catch {
    // No storage (private mode): the page still changes, the choice is not kept.
  }
}

export function HeaderControls() {
  return (
    <div className="dropdown dropdown-end">
      <button type="button" className="btn btn-ghost btn-sm" aria-label="theme">
        <Sun size={14} aria-hidden="true" />
      </button>
      <ul tabIndex={0} className="menu dropdown-content z-10 w-32 rounded-box bg-base-200 p-2 shadow">
        <li>
          <button type="button" onClick={() => setTheme("dark")}>
            <Moon size={14} aria-hidden="true" />
            Dark
          </button>
        </li>
        <li>
          <button type="button" onClick={() => setTheme("light")}>
            <Sun size={14} aria-hidden="true" />
            Light
          </button>
        </li>
      </ul>
    </div>
  );
}
