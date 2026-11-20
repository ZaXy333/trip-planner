-- 1. Ustawienia użytkownika
CREATE TABLE public.user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    theme TEXT DEFAULT 'system',
    day_view TEXT DEFAULT 'compact',
    map_style TEXT DEFAULT 'standard',
    travel_mode TEXT DEFAULT 'driving',
    preferences JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Zestawy podróży (Trip Sets)
CREATE TABLE public.trip_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Miejsca (Places - lokalny cache i dane użytkownika)
CREATE TABLE public.places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    source TEXT DEFAULT 'google',
    source_place_id TEXT, -- Google Place ID
    name TEXT NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lng DOUBLE PRECISION NOT NULL,
    category TEXT,
    user_description TEXT,
    tags TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Oś czasu (Timeline / Trip Entries)
CREATE TYPE entry_type AS ENUM ('place', 'day_break');

CREATE TABLE public.trip_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trip_set_id UUID NOT NULL REFERENCES public.trip_sets(id) ON DELETE CASCADE,
    entry_type entry_type NOT NULL,
    place_id UUID REFERENCES public.places(id) ON DELETE CASCADE, -- null dla day_break
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Trasy (Routes)
CREATE TABLE public.trip_routes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    trip_set_id UUID NOT NULL REFERENCES public.trip_sets(id) ON DELETE CASCADE,
    day_number INTEGER NOT NULL,
    route_data JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Zapisane foldery i miejsca
CREATE TABLE public.saved_folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.saved_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    place_id UUID NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.saved_folder_places (
    folder_id UUID NOT NULL REFERENCES public.saved_folders(id) ON DELETE CASCADE,
    saved_place_id UUID NOT NULL REFERENCES public.saved_places(id) ON DELETE CASCADE,
    PRIMARY KEY (folder_id, saved_place_id)
);

-- 7. Historia i polecane
CREATE TABLE public.search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    search_type TEXT,
    selected_place_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.recommendation_searches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    region TEXT,
    categories TEXT[],
    criteria JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indeksy dla wydajności relacji
CREATE INDEX idx_trip_sets_user ON public.trip_sets(user_id);
CREATE INDEX idx_places_user ON public.places(user_id);
CREATE INDEX idx_trip_entries_set ON public.trip_entries(trip_set_id);
CREATE INDEX idx_trip_entries_place ON public.trip_entries(place_id);

-- Włączenie Row Level Security (RLS)
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_folder_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_searches ENABLE ROW LEVEL SECURITY;

-- Generowanie polityk RLS dla wszystkich tabel (wymaga auth.uid() = user_id)
DO $$
DECLARE
    t_name TEXT;
    tables TEXT[] := ARRAY['user_settings', 'trip_sets', 'places', 'trip_entries', 'trip_routes', 'saved_folders', 'saved_places', 'search_history', 'recommendation_searches'];
BEGIN
    FOREACH t_name IN ARRAY tables LOOP
        EXECUTE format('
            CREATE POLICY "Users can manage their own %I" ON public.%I
            FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
        ', t_name, t_name);
    END LOOP;
END $$;

-- RLS dla tabeli łączącej (saved_folder_places) na podstawie właściciela folderu
CREATE POLICY "Users can manage their folder relationships" ON public.saved_folder_places
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.saved_folders f WHERE f.id = folder_id AND f.user_id = auth.uid())
) WITH CHECK (
    EXISTS (SELECT 1 FROM public.saved_folders f WHERE f.id = folder_id AND f.user_id = auth.uid())
);