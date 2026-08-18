import { createContext, useContext, useEffect, useState } from 'react';

const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [username, setUsername] = useState(() => localStorage.getItem('chess_username') || '');

  useEffect(() => {
    if (username) localStorage.setItem('chess_username', username);
    else localStorage.removeItem('chess_username');
  }, [username]);

  return <UserContext.Provider value={{ username, setUsername }}>{children}</UserContext.Provider>;
}

export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error('useUser must be used within UserProvider');
  return ctx;
}
