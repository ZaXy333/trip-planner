# Trip Planner

Planuj wyjazdy na mapie: wyszukuj miejsca, układaj trasę dzień po dniu i przechowuj ulubione punkty w jednym miejscu.

## Co potrafi

- Wyszukiwanie miast, zabytków, restauracji i innych miejsc na Google Maps.
- Polecane miejsca filtrowane według kategorii i widocznego obszaru mapy.
- Wiele planów podróży z osią czasu, podziałem na dni i zmianą kolejności punktów.
- Wyznaczanie i optymalizacja tras pieszych oraz samochodowych.
- Zapisane miejsca, własne foldery, notatki i tagi.
- Rejestracja i logowanie przez Supabase Auth, reset hasła oraz sesja „Zapamiętaj mnie”.
- Synchronizacja planów, zapisanych miejsc, folderów, ustawień i historii z Supabase.
- Import starszych danych przeglądarki do konta użytkownika.
- Jasny i ciemny motyw oraz mapa standardowa i satelitarna.

## Technologie

React 19 · TypeScript · Vite · Tailwind CSS · Google Maps JavaScript API · Supabase Auth i PostgreSQL

## Dane i bezpieczeństwo

Supabase przechowuje workspace użytkownika. Dostęp do tabel powinien być chroniony przez Row Level Security z politykami opartymi o `auth.uid()`. Przeglądarka korzysta wyłącznie z klucza publishable/anon — nigdy nie umieszczaj klucza `service_role` w kodzie ani w zmiennych `VITE_`.

Przy pierwszym logowaniu aplikacja może zaproponować import starszych setów, zapisanych miejsc, folderów i ustawień z przeglądarki. Nieimportowane dane lokalne pozostają kopią w tej przeglądarce.

## Uruchomienie

Wymagany Node.js i npm. Skopiuj `.env.example` do `.env`, uzupełnij klucze Google Maps i Supabase, a następnie uruchom:

```bash
npm install
npm run dev
```

W Supabase włącz Email Auth i dodaj adres localhost oraz domenę wdrożenia do dozwolonych URL-i przekierowań. Przy nowej bazie uruchom najpierw `src/assets/gemini-code-1793812270068.sql`, a następnie `supabase/migrations/20261104_workspace_persistence.sql`.

Przydatne polecenia: `npm run lint`, `npm run build`, `npm run preview`.
