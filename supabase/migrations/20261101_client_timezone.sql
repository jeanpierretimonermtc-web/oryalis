-- CLIENT-TZ-1 — Fuseau horaire d'un contact (identifiant IANA, ex. 'America/Montreal').
-- null = même fuseau que l'utilisateur : aucun affichage supplémentaire. Les heures restent
-- stockées en UTC partout ; ce champ ne sert qu'à afficher "l'heure chez le contact".

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS timezone text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clients_timezone_format_check') THEN
    ALTER TABLE public.clients ADD CONSTRAINT clients_timezone_format_check
      CHECK (timezone IS NULL OR timezone ~ '^[A-Za-z]+(/[A-Za-z0-9_+\-]+)+$');
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
