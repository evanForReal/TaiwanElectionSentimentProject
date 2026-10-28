import { useEffect } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { Toasts } from "./components/ui.tsx";
import { useApp } from "./lib/store.ts";
import { LibraryPage } from "./pages/LibraryPage.tsx";
import { ItemPage } from "./pages/ItemPage.tsx";
import { ProjectsPage } from "./pages/ProjectsPage.tsx";
import { ProjectPage } from "./pages/ProjectPage.tsx";
import { RoomPage } from "./pages/RoomPage.tsx";
import { BoardsPage } from "./pages/BoardsPage.tsx";
import { CollectionPage } from "./pages/CollectionPage.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";

export function App() {
  const loadSettings = useApp((s) => s.loadSettings);
  const loadItems = useApp((s) => s.loadItems);
  useEffect(() => {
    loadSettings().catch(() => {});
    loadItems().catch(() => {});
  }, [loadSettings, loadItems]);

  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Interior <span>Studio</span>
        </Link>
        <nav className="nav">
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/boards">Boards</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/library/:id" element={<ItemPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectPage />} />
          <Route path="/rooms/:id" element={<RoomPage />} />
          <Route path="/boards" element={<BoardsPage />} />
          <Route path="/boards/:id" element={<CollectionPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </main>
      <Toasts />
    </div>
  );
}
