import { NavLink, Outlet } from 'react-router-dom';
import { useUser } from './UserContext.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';

export default function Layout() {
  const { username } = useUser();

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">♞</span>
          <span>ChessCoach</span>
        </div>
        <nav aria-label="Main">
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/analyzer">Analyzer</NavLink>
          <NavLink to="/puzzles">Puzzles</NavLink>
          <NavLink to="/lessons">Lessons</NavLink>
        </nav>
        <ThemeToggle />
        <div className="user-pill">{username ? `@${username}` : 'No account linked'}</div>
      </header>
      <main className="content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
