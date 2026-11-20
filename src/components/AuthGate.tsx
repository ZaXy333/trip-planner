import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { AuthContext, type AuthUser } from '../auth/authContext';
import {
  isRememberMeEnabled,
  setRememberMeEnabled,
  supabase,
} from '../lib/supabase';
import {
  ArrowRight,
  Check,
  Compass,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  UserRound,
} from 'lucide-react';

type AuthMode = 'login' | 'register' | 'recover' | 'update-password';

interface AuthFormValues {
  name: string;
  email: string;
  password: string;
  rememberMe: boolean;
}

interface AuthScreenProps {
  initialMode: AuthMode;
  isSubmitting: boolean;
  formError: string;
  successMessage: string;
  onSubmit: (mode: AuthMode, values: AuthFormValues) => Promise<void>;
}

export const AuthGate = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const passwordRecoveryRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    // 1. Pobranie początkowej sesji przy załadowaniu aplikacji
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();

        if (session?.user && !passwordRecoveryRef.current) {
          setUser({
            id: session.user.id,
            email: session.user.email || '',
            name: session.user.user_metadata?.name,
          });
        }
      } catch (error) {
        setFormError(
          error instanceof Error ? error.message : 'Nie udało się sprawdzić sesji.'
        );
      } finally {
        setIsCheckingSession(false);
      }
    };

    void checkSession();

    // 2. Nasłuchiwanie na zmiany (logowanie/wylogowanie w innych kartach)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryRef.current = true;
        setIsPasswordRecovery(true);
        setUser(null);
        return;
      }

      if (event === 'USER_UPDATED' || event === 'SIGNED_OUT') {
        passwordRecoveryRef.current = false;
        setIsPasswordRecovery(false);
      }

      if (session?.user) {
        setUser({
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.user_metadata?.name,
        });
      } else {
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (mode: AuthMode, values: AuthFormValues) => {
    setIsSubmitting(true);
    setFormError('');
    setSuccessMessage('');

    try {
      setRememberMeEnabled(values.rememberMe);
      if (mode === 'register') {
        // Rejestracja w Supabase
        const { data, error } = await supabase.auth.signUp({
          email: values.email.trim(),
          password: values.password,
          options: {
            data: { name: values.name.trim() }, // Zapisujemy imię w metadanych użytkownika
          },
        });

        if (error) throw error;
        
        // Supabase domyślnie wymaga potwierdzenia e-mail. 
        // Jeśli sesja jest null, to znaczy, że użytkownik musi kliknąć w link.
        if (data.user && !data.session) {
          setSuccessMessage('Konto zostało utworzone! Sprawdź swoją skrzynkę e-mail, aby potwierdzić adres.');
        }
        
      } else if (mode === 'recover') {
        const { error } = await supabase.auth.resetPasswordForEmail(
          values.email.trim(),
          { redirectTo: window.location.origin }
        );
        if (error) throw error;
        setSuccessMessage('Wysłaliśmy link do ustawienia nowego hasła. Sprawdź pocztę i folder spam.');
      } else if (mode === 'update-password') {
        const { error } = await supabase.auth.updateUser({ password: values.password });
        if (error) throw error;
        setSuccessMessage('Hasło zostało zmienione.');
      } else {
        // Logowanie w Supabase
        const { error } = await supabase.auth.signInWithPassword({
          email: values.email.trim(),
          password: values.password,
        });

        if (error) {
          // Tłumaczenie najczęstszego błędu Supabase
          if (error.message.includes('Invalid login credentials')) {
            throw new Error('Nieprawidłowy adres e-mail lub hasło.');
          }
          throw error;
        }
      }
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : 'Wystąpił nieoczekiwany błąd.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const logout = async () => {
    try {
      await supabase.auth.signOut();
    } catch (error) {
      console.error('Błąd podczas wylogowywania:', error);
    }
  };

  if (isCheckingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 text-white">
        <LoaderCircle className="h-6 w-6 animate-spin text-emerald-400" aria-label="Sprawdzanie sesji" />
      </main>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        key={isPasswordRecovery ? 'password-recovery' : 'login-or-register'}
        initialMode={isPasswordRecovery ? 'update-password' : 'login'}
        isSubmitting={isSubmitting}
        formError={formError}
        successMessage={successMessage}
        onSubmit={handleSubmit}
      />
    );
  }

  return (
    <AuthContext.Provider value={{ user, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

const AuthScreen = ({
  initialMode,
  isSubmitting,
  formError,
  successMessage,
  onSubmit,
}: AuthScreenProps) => {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [rememberMe, setRememberMe] = useState(isRememberMeEnabled);

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setValidationError('');

    if ((mode === 'register' || mode === 'update-password') && password !== confirmPassword) {
      setValidationError('Hasła muszą być identyczne.');
      return;
    }

    void onSubmit(mode, { name, email, password, rememberMe });
  };

  const changeMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setValidationError('');
  };

  return (
    <main className="grid h-screen min-h-screen overflow-y-auto bg-white md:grid-cols-[1.04fr_0.96fr]">
      <section className="relative hidden min-h-screen overflow-hidden bg-slate-950 md:block">
        <img
          src="https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=1800&q=85"
          alt="Kolorowe miasteczko na włoskim wybrzeżu"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/15 to-slate-950/20" />
        <div className="absolute left-10 top-10 flex items-center gap-3 text-white">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm">
            <Compass className="h-5 w-5" />
          </span>
          <span className="text-sm font-bold">Trip Planner</span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-10 text-white lg:p-14">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
            Miejsca, które chcesz pamiętać
          </p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight lg:text-5xl">
            Zaplanuj podróż po swojemu.
          </h1>
          <p className="mt-4 max-w-md text-sm leading-6 text-white/80">
            Zbieraj punkty, układaj dni i miej cały plan wyjazdu pod ręką.
          </p>
          <div className="mt-8 flex items-center gap-2 text-xs text-white/75">
            <Check className="h-4 w-4 text-emerald-300" />
            <span>Twoje miejsca i plany w jednym miejscu</span>
          </div>
        </div>
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Compass className="h-5 w-5" />
            </span>
            <span className="text-sm font-bold text-slate-900">Trip Planner</span>
          </div>

          <div className="mb-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
              {mode === 'login'
                ? 'Witaj ponownie'
                : mode === 'register'
                  ? 'Dołącz do Trip Planner'
                  : mode === 'recover'
                    ? 'Odzyskiwanie dostępu'
                    : 'Zabezpieczenie konta'}
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
              {mode === 'login'
                ? 'Zaloguj się'
                : mode === 'register'
                  ? 'Utwórz konto'
                  : mode === 'recover'
                    ? 'Odzyskaj hasło'
                    : 'Ustaw nowe hasło'}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              {mode === 'login'
                ? 'Zaloguj się, aby otworzyć swoje plany podróży.'
                : mode === 'register'
                  ? 'Załóż konto, aby zacząć tworzyć własne trasy.'
                  : mode === 'recover'
                    ? 'Wyślemy Ci bezpieczny link do ustawienia nowego hasła.'
                    : 'Wybierz nowe hasło do swojego konta.'}
            </p>
          </div>

          {(mode === 'login' || mode === 'register') && <div className="mb-6 grid grid-cols-2 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => changeMode('login')}
              aria-pressed={mode === 'login'}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Logowanie
            </button>
            <button
              type="button"
              onClick={() => changeMode('register')}
              aria-pressed={mode === 'register'}
              className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Rejestracja
            </button>
          </div>}

          {successMessage && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs leading-5 text-emerald-900" role="status">
              {successMessage}
            </div>
          )}
          
          {(formError || validationError) && (
            <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-700" role="alert">
              {validationError || formError}
            </p>
          )}

          <form onSubmit={handleFormSubmit} className="space-y-4">
            {mode === 'register' && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Imię</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoComplete="name"
                    required
                    maxLength={80}
                    placeholder="Jak mamy się do Ciebie zwracać?"
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                  />
                </span>
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">Adres e-mail</span>
              <span className="relative block">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  required
                  maxLength={254}
                  placeholder="ty@przyklad.pl"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                />
              </span>
            </label>

            {mode !== 'recover' && <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700">
                {mode === 'update-password' ? 'Nowe hasło' : 'Hasło'}
              </span>
              <span className="relative block">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                  minLength={6}
                  maxLength={128}
                  placeholder="Minimum 6 znaków"
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-11 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                />
                <button
                  type="button"
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                  aria-label={isPasswordVisible ? 'Ukryj hasło' : 'Pokaż hasło'}
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  {isPasswordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>}

            {(mode === 'register' || mode === 'update-password') && (
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Powtórz nowe hasło</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    required
                    minLength={6}
                    maxLength={128}
                    placeholder="Wpisz hasło ponownie"
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm text-slate-900 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/15"
                  />
                </span>
              </label>
            )}

            {mode === 'login' && (
              <div className="flex items-center justify-between gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(event) => setRememberMe(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 accent-emerald-700"
                  />
                  Zapamiętaj mnie
                </label>
                <button
                  type="button"
                  onClick={() => changeMode('recover')}
                  className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                >
                  Nie pamiętasz hasła?
                </button>
              </div>
            )}

            {(mode === 'recover' || mode === 'update-password') && (
              <button
                type="button"
                onClick={() => changeMode('login')}
                className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800"
              >
                Wróć do logowania
              </button>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
            >
              {isSubmitting ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <span>
                    {mode === 'login'
                      ? 'Zaloguj się'
                      : mode === 'register'
                        ? 'Utwórz konto'
                        : mode === 'recover'
                          ? 'Wyślij link resetujący'
                          : 'Zapisz nowe hasło'}
                  </span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
};
