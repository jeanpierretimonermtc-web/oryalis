# Migrations historiques

Ces 52 scripts (`migrate4.mjs` → `migrate56.mjs`, `migrate_agenda*.mjs`) étaient à la racine du repo.
Déplacés ici le 2026-08-16 pour désencombrer la racine — non supprimés car il n'existe aucun registre
fiable de ce qui a été réellement appliqué en prod (voir `CLAUDE.md`, section Migrations).

Ne pas se fier à cette liste pour connaître le schéma réel : interroger `information_schema` sur
Supabase directement.

Pour toute nouvelle migration, utiliser la convention datée `supabase/migrations/YYYYMMDD_nom.sql`
plutôt qu'un nouveau `migrateNN.mjs`.

⚠️ `migrate28.mjs` crée la table `upline_nodes`, qui **n'existe pas** dans la DB live (vérifié le
2026-08-16) — cette migration spécifique semble n'avoir jamais été appliquée, ce qui casse le module
réseau/MLM (`features/network/uplineService.ts`) en prod.
