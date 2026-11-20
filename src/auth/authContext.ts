import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface AuthContextValue {
  user: AuthUser;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuth = () => {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside AuthGate');
  return auth;
};
