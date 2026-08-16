import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connected to Supabase')

// ── 1. Tables catalogs + catalog_products ────────────────────────────────────
await client.query(`
  CREATE TABLE IF NOT EXISTS catalogs (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    slug       text UNIQUE,
    name       text NOT NULL,
    brand      text,
    type       text NOT NULL DEFAULT 'official',
    user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    color      text NOT NULL DEFAULT '#007AFF',
    icon       text NOT NULL DEFAULT '📦',
    created_at timestamptz DEFAULT now()
  );
`)
console.log('✓ Table catalogs')

await client.query(`
  CREATE TABLE IF NOT EXISTS catalog_products (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    catalog_id uuid REFERENCES catalogs(id) ON DELETE CASCADE NOT NULL,
    sku        text,
    name       text NOT NULL,
    category   text,
    created_at timestamptz DEFAULT now()
  );
`)
console.log('✓ Table catalog_products')

// ── 2. Colonnes sur recommendations ─────────────────────────────────────────
await client.query(`ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES catalogs(id) ON DELETE SET NULL;`)
await client.query(`ALTER TABLE recommendations ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES catalog_products(id) ON DELETE SET NULL;`)
console.log('✓ Colonnes catalog_id + product_id sur recommendations')

// ── 3. RLS catalogs ──────────────────────────────────────────────────────────
await client.query(`ALTER TABLE catalogs ENABLE ROW LEVEL SECURITY;`)
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='catalogs' AND policyname='official catalogs visible to all') THEN
      CREATE POLICY "official catalogs visible to all" ON catalogs
        FOR SELECT USING (type = 'official' OR auth.uid() = user_id);
    END IF;
  END $$;
`)
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='catalogs' AND policyname='users manage own catalogs') THEN
      CREATE POLICY "users manage own catalogs" ON catalogs
        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
    END IF;
  END $$;
`)
console.log('✓ RLS catalogs')

// ── 4. RLS catalog_products ──────────────────────────────────────────────────
await client.query(`ALTER TABLE catalog_products ENABLE ROW LEVEL SECURITY;`)
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='catalog_products' AND policyname='products visible via catalog') THEN
      CREATE POLICY "products visible via catalog" ON catalog_products
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM catalogs c
            WHERE c.id = catalog_id
            AND (c.type = 'official' OR c.user_id = auth.uid())
          )
        );
    END IF;
  END $$;
`)
await client.query(`
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='catalog_products' AND policyname='users manage custom products') THEN
      CREATE POLICY "users manage custom products" ON catalog_products
        FOR ALL USING (
          EXISTS (SELECT 1 FROM catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid())
        ) WITH CHECK (
          EXISTS (SELECT 1 FROM catalogs c WHERE c.id = catalog_id AND c.user_id = auth.uid())
        );
    END IF;
  END $$;
`)
console.log('✓ RLS catalog_products')

// ── 5. Seed catalogue doTERRA ────────────────────────────────────────────────
const { rows } = await client.query(`
  INSERT INTO catalogs (slug, name, brand, type, user_id, color, icon)
  VALUES ('doterra', 'doTERRA', 'doterra', 'official', null, '#3D8B37', '🌿')
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
  RETURNING id;
`)
const doterraId = rows[0].id
console.log('✓ Catalogue doTERRA :', doterraId)

// Supprimer les anciens produits doTERRA pour re-seeder proprement
await client.query(`DELETE FROM catalog_products WHERE catalog_id = $1`, [doterraId])

const products = [
  // Huiles essentielles
  { sku: 'lavender',     name: 'Lavande',                       category: 'Huile essentielle' },
  { sku: 'peppermint',   name: 'Menthe poivrée',                category: 'Huile essentielle' },
  { sku: 'lemon',        name: 'Citron',                        category: 'Huile essentielle' },
  { sku: 'oregano',      name: 'Origan',                        category: 'Huile essentielle' },
  { sku: 'frankincense', name: 'Encens (Frankincense)',         category: 'Huile essentielle' },
  { sku: 'tea-tree',     name: 'Tea Tree (Melaleuca)',          category: 'Huile essentielle' },
  { sku: 'bergamot',     name: 'Bergamote',                     category: 'Huile essentielle' },
  { sku: 'eucalyptus',   name: 'Eucalyptus radié',              category: 'Huile essentielle' },
  { sku: 'rosemary',     name: 'Romarin',                       category: 'Huile essentielle' },
  { sku: 'ylang-ylang',  name: 'Ylang Ylang',                   category: 'Huile essentielle' },
  { sku: 'geranium',     name: 'Géranium',                      category: 'Huile essentielle' },
  { sku: 'clary-sage',   name: 'Sauge sclarée',                 category: 'Huile essentielle' },
  { sku: 'ginger',       name: 'Gingembre',                     category: 'Huile essentielle' },
  { sku: 'cinnamon',     name: 'Cannelle écorce',               category: 'Huile essentielle' },
  { sku: 'clove',        name: 'Clou de girofle',               category: 'Huile essentielle' },
  { sku: 'thyme',        name: 'Thym',                          category: 'Huile essentielle' },
  { sku: 'cardamom',     name: 'Cardamome',                     category: 'Huile essentielle' },
  { sku: 'copaiba',      name: 'Copaïba',                       category: 'Huile essentielle' },
  { sku: 'helichrysum',  name: 'Hélichryse',                    category: 'Huile essentielle' },
  { sku: 'vetiver',      name: 'Vétiver',                       category: 'Huile essentielle' },
  { sku: 'sandalwood',   name: 'Santal',                        category: 'Huile essentielle' },
  { sku: 'rose',         name: 'Rose',                          category: 'Huile essentielle' },
  { sku: 'jasmine',      name: 'Jasmin',                        category: 'Huile essentielle' },
  { sku: 'lime',         name: 'Lime',                          category: 'Huile essentielle' },
  { sku: 'grapefruit',   name: 'Pamplemousse',                  category: 'Huile essentielle' },
  { sku: 'wild-orange',  name: 'Orange sauvage',                category: 'Huile essentielle' },
  { sku: 'cypress',      name: 'Cyprès',                        category: 'Huile essentielle' },
  { sku: 'marjoram',     name: 'Marjolaine',                    category: 'Huile essentielle' },
  { sku: 'cedarwood',    name: 'Cèdre',                         category: 'Huile essentielle' },
  { sku: 'black-pepper', name: 'Poivre noir',                   category: 'Huile essentielle' },
  { sku: 'basil',        name: 'Basilic',                       category: 'Huile essentielle' },
  { sku: 'arborvitae',   name: 'Arborvitae',                    category: 'Huile essentielle' },
  // Mélanges
  { sku: 'deep-blue',    name: 'Deep Blue',                     category: 'Mélange' },
  { sku: 'on-guard',     name: 'On Guard',                      category: 'Mélange' },
  { sku: 'breathe',      name: 'Breathe',                       category: 'Mélange' },
  { sku: 'digest-zen',   name: 'DigestZen',                     category: 'Mélange' },
  { sku: 'past-tense',   name: 'Past Tense',                    category: 'Mélange' },
  { sku: 'serenity',     name: 'Serenity',                      category: 'Mélange' },
  { sku: 'elevation',    name: 'Elevation',                     category: 'Mélange' },
  { sku: 'balance',      name: 'Balance',                       category: 'Mélange' },
  { sku: 'motivate',     name: 'Motivate',                      category: 'Mélange' },
  { sku: 'cheer',        name: 'Cheer',                         category: 'Mélange' },
  { sku: 'console',      name: 'Console',                       category: 'Mélange' },
  { sku: 'forgive',      name: 'Forgive',                       category: 'Mélange' },
  { sku: 'zendocrine',   name: 'Zendocrine',                    category: 'Mélange' },
  { sku: 'purify',       name: 'Purify',                        category: 'Mélange' },
  { sku: 'adaptiv',      name: 'Adaptiv',                       category: 'Mélange' },
  // Compléments
  { sku: 'llv',          name: 'LifeLong Vitality Pack',        category: 'Complément' },
  { sku: 'ddpdr',        name: 'dōTERRA Digestive Blend',       category: 'Complément' },
  { sku: 'mito2max',     name: 'Mito2Max',                      category: 'Complément' },
  { sku: 'phytoestrogen',name: 'PhytoEstrogen Complex',         category: 'Complément' },
  { sku: 'bone-nutrient',name: 'Bone Nutrient Complex',         category: 'Complément' },
]

for (const p of products) {
  await client.query(
    `INSERT INTO catalog_products (catalog_id, sku, name, category) VALUES ($1, $2, $3, $4)`,
    [doterraId, p.sku, p.name, p.category]
  )
}
console.log(`✓ ${products.length} produits doTERRA seedés`)

  console.log('\n✅ Migration 4 terminée')
} finally {
  await client.end()
}
