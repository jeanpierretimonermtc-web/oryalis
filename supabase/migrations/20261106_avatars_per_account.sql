-- STORAGE-1 — bucket avatars : chaque compte n'écrit que dans son dossier <user_id>/, images seulement.
-- Avant : tout compte connecté pouvait déposer ou remplacer un fichier n'importe où, de n'importe quel
-- type. La lecture reste publique (bucket public), les liens existants continuent de fonctionner.

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'avatars';

DROP POLICY IF EXISTS avatars_auth_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_auth_update ON storage.objects;

CREATE POLICY avatars_own_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY avatars_own_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY avatars_own_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY avatars_own_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);
