import { NavLink, Outlet } from 'react-router-dom';
import { useUser } from './UserContext.jsx';

export default function Layout() {
  const { username } = useUser();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">♞</span>
          <span>ChessCoach</span>
        </div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/analyzer">Analyzer</NavLink>
          <NavLink to="/puzzles">Puzzles</NavLink>
          <NavLink to="/lessons">Lessons</NavLink>
        </nav>
        <div className="user-pill">{username ? `@${username}` : 'No account linked'}</div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
