// migrate11.mjs — Configure le bucket Supabase Storage "doterra-products" + peuple image_url
//
// Ce script :
//   - Rend le bucket "doterra-products" public et fixe les MIME types autorisés
//   - Met à jour la colonne image_url de chaque produit doTERRA avec l'URL publique Supabase
//   - L'URL suit le pattern : https://{PROJECT_REF}.supabase.co/storage/v1/object/public/doterra-products/images/{sku}.webp
//
// Reste à faire manuellement après ce script :
//   Uploader les images dans Supabase Dashboard > Storage > doterra-products > images/
//   avec la convention de nommage doterra-products/images/{sku}.webp (ex: lavender.webp, on-guard.webp)

import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const PROJECT_REF = 'nhpvjfyjyculnijipzoa'
const BUCKET = 'doterra-products'
const BASE_URL = `https://${PROJECT_REF}.supabase.co/storage/v1/object/public/${BUCKET}/images`

const client = new Client({
  connectionString: `postgresql://postgres.${PROJECT_REF}:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connecté à Supabase')

await client.query(`
  INSERT INTO storage.buckets (id, name, public, allowed_mime_types)
  VALUES ($1, $1, true, ARRAY['image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = true, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
`, [BUCKET])
console.log(`Bucket "${BUCKET}" configuré (public, MIME jpeg/png/webp)`)

const { rows } = await client.query('SELECT id, sku FROM catalog_products WHERE catalog_id = $1', [
  'e36a2738-e1b9-4c37-aa95-4f6aef4d13e8'
])

let updated = 0
for (const { id, sku } of rows) {
  const image_url = `${BASE_URL}/${sku}.webp`
  await client.query('UPDATE catalog_products SET image_url = $1 WHERE id = $2', [image_url, id])
  console.log(`✓ ${sku} → ${image_url}`)
  updated++
}

console.log(`\n${updated} URLs d'images mises à jour`)
console.log('\n--- Instructions upload images ---')
console.log('Convention : doterra-products/images/{sku}.webp')
console.log('Ex: lavender.webp, on-guard.webp, deep-blue.webp')
console.log('Sources images officielles :')
console.log('  - https://media.doterra.com/eu/fr/pips/{product-name}.pdf')
console.log('  - Espace Wellness Advocate dōTERRA')
console.log('  - Site shop.doterra.com > clic droit > "Enregistrer l\'image sous"')
} finally {
  await client.end()
}
