// migrate12.mjs — Création catalogue Zinzino + insertion produits
// SKUs = IDs produit officiels Zinzino (visibles dans les URLs shop)
// Images : https://zinzinowebstorage.blob.core.windows.net/productimages/small/{SKU}.png
// Prix : à compléter depuis ton back-office partenaire Zinzino
// catalog_id doTERRA existant : e36a2738-e1b9-4c37-aa95-4f6aef4d13e8

import pg from 'pg'
const { Client } = pg
import { randomUUID } from 'crypto'

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
})

await client.connect()
console.log('Connecté à Supabase')

// 1. Création du catalogue Zinzino (idempotent)
const ZINZINO_CATALOG_ID = randomUUID()
const existingCatalog = await client.query(
  `SELECT id FROM catalogs WHERE slug = 'zinzino'`
)

let catalogId
if (existingCatalog.rowCount > 0) {
  catalogId = existingCatalog.rows[0].id
  console.log(`Catalogue Zinzino déjà existant : ${catalogId}`)
} else {
  await client.query(`
    INSERT INTO catalogs (id, slug, name, brand, type, user_id, color, icon, created_at)
    VALUES ($1, 'zinzino', 'Zinzino', 'Zinzino', 'official', NULL, '#1B4E9B', '💧', NOW())
  `, [ZINZINO_CATALOG_ID])
  catalogId = ZINZINO_CATALOG_ID
  console.log(`Catalogue Zinzino créé : ${catalogId}`)
}

// 2. URL images officielles Zinzino CDN
const IMG = (sku) =>
  `https://zinzinowebstorage.blob.core.windows.net/productimages/small/${sku}.png`

// 3. Produits Zinzino FR
// Format : [sku, name, category, unit, retail_price_eur, wholesale_price_eur, description]
// retail_price_eur / wholesale_price_eur = null → à compléter depuis le back-office
const products = [

  // ─── TESTS ────────────────────────────────────────────────────────────────
  ['309000', 'BalanceTest',          'Test',          null,    null, null,
   'Test sanguin à domicile (goutte de sang séchée). Mesure ton profil d\'acides gras et le ratio Oméga-6:3 ainsi qu\'un panel de 11 acides gras. Résultats confidentiels en ligne. Point de départ indispensable avant de commencer la supplémentation.'],

  ['309011', 'BalanceTest x2',       'Test',          null,    null, null,
   'Lot de 2 BalanceTests. Recommandé pour suivre l\'évolution avant/après 120 jours de supplémentation avec BalanceOil+.'],

  ['309070', 'Gut Health Test',      'Test',          null,    null, null,
   'Test de santé intestinale à domicile. Analyse le microbiome intestinal et fournit des informations personnalisées sur la santé de ton côlon.'],

  ['309080', 'Gut Health Test x2',   'Test',          null,    null, null,
   'Lot de 2 Gut Health Tests. Permet de mesurer l\'évolution de la santé intestinale avant et après supplémentation.'],

  ['309049', 'Vitamin D Test',       'Test',          null,    null, null,
   'Test à domicile pour mesurer ton taux de vitamine D (25-OH-D3) dans le sang. Simple et confidentiel, résultats disponibles en ligne.'],

  ['309060', 'HbA1c Test',           'Test',          null,    null, null,
   'Test à domicile pour mesurer le taux d\'HbA1c (hémoglobine glyquée), indicateur du niveau moyen de glycémie sur les 2-3 derniers mois.'],

  // ─── OMÉGA-3 ──────────────────────────────────────────────────────────────
  ['300000', 'BalanceOil+ 300 ml',   'Oméga-3',       '300 ml', null, null,
   'Complément alimentaire Polyphénol Oméga Balance 100% naturel. Mélange unique d\'huile de poisson sauvage (EPA 20% / DHA 10%) et d\'huile d\'olive extra vierge de récolte précoce riche en polyphénols. Rééquilibre le ratio Oméga-6:3 en 120 jours. Certifié Friend of the Sea. Disponible en plusieurs saveurs (citron, pamplemousse-citron vert, orange-citron-menthe, tutti frutti).'],

  ['300430', 'BalanceOil+ 100 ml',   'Oméga-3',       '100 ml', null, null,
   'Version nomade de BalanceOil+ en format 100 ml, pratique pour les voyages et déplacements. Même formule que le 300 ml.'],

  ['300481', 'BalanceOil+ 6x100 ml', 'Oméga-3',       '6x100 ml', null, null,
   'Pack de 6 flacons de 100 ml de BalanceOil+. Idéal pour les familles ou pour avoir toujours un flacon à portée de main.'],

  ['700000', 'BalanceOil+ Premium 300 ml', 'Oméga-3', '300 ml', null, null,
   'Version Premium de BalanceOil+. Formule enrichie avec des polyphénols d\'olive de haute qualité encore plus concentrés. Pour ceux qui veulent le meilleur en matière d\'Oméga-3 et d\'antioxydants.'],

  ['300700', 'BalanceOil+ AquaX 300 ml', 'Oméga-3',   '300 ml', null, null,
   'Technologie d\'absorption optimisée AquaX. Se mélange facilement à l\'eau ou aux boissons sans effet huileux. Mêmes bienfaits que BalanceOil+ avec une texture plus légère et agréable.'],

  ['400000', 'BalanceOil+ Vegan 300 ml', 'Oméga-3',   '300 ml', null, null,
   'Version 100% végane de BalanceOil+. Remplace l\'huile de poisson par une combinaison d\'huile d\'algues (source d\'EPA et DHA) et d\'huile de lin. Certifié Vegan Society.'],

  ['301799', 'BalanceOil Tutti Frutti 300 ml', 'Oméga-3', '300 ml', null, null,
   'BalanceOil+ avec saveur Tutti Frutti, particulièrement appréciée des enfants. Même formule que BalanceOil+ standard.'],

  ['300310', 'Essent+ Premium 60 softgels', 'Oméga-3', '60 sgls', null, null,
   'Complément Oméga-3 en gélules molles. Concentration élevée en EPA et DHA. Pratique pour ceux qui préfèrent les gélules à l\'huile liquide. Certifié IFOS 5 étoiles.'],

  ['302401', 'R.E.V.O.O Olive Oil 250 ml', 'Oméga-3', '250 ml', null, null,
   'Huile d\'olive extra vierge de récolte précoce. Exceptionnellement riche en polyphénols (>750 mg/kg). Peut être utilisée en cuisine ou directement associée à BalanceOil+ pour booster l\'apport en polyphénols.'],

  ['600508', 'Dosage Cups',           'Accessoire',   null,     null, null,
   'Gobelets doseurs pour mesurer précisément la dose quotidienne de BalanceOil+. Pack pratique pour la routine quotidienne.'],

  // ─── RESTORE / BIEN-ÊTRE ──────────────────────────────────────────────────
  ['302500', 'ZinoGene+ 30 comprimés', 'Restore',     '30 tabs', null, null,
   'Complément alimentaire avancé pour la longévité cellulaire. Contient du resvératrol, du NMN (nicotinamide mononucléotide) et d\'autres nutriments clés qui soutiennent les mécanismes de réparation de l\'ADN et le métabolisme énergétique cellulaire.'],

  ['300800', 'Viva+ 60 comprimés',    'Restore',      '60 tabs', null, null,
   'Complément nootropique 100% naturel. Contient de l\'extrait de safran (Affron®), du magnésium marin, de l\'iode et de la vitamine C de l\'acérola. Contribue à réduire la fatigue, soutient la fonction psychologique normale et la cognition. Idéal en complément du protocole santé.'],

  ['302771', 'PHYCOSCI+ X20 250 ml',  'Restore',      '250 ml',  null, null,
   'Extrait liquide de spiruline naturelle avec une concentration 20x supérieure aux comprimés de spiruline standard. Source de phycocyanine, protéines complètes et antioxydants. Soutient le système immunitaire et l\'énergie.'],

  // ─── IMMUNITÉ ─────────────────────────────────────────────────────────────
  ['302600', 'ZinoShine+ 60 comprimés', 'Immunité',   '60 tabs', null, null,
   'Complément à base de vitamine D3 végétalienne et de magnésium broad-spectrum (citrate, glycinate, malate). La vitamine D contribue au fonctionnement normal du système immunitaire. Idéal en hiver ou en cas de manque d\'exposition solaire.'],

  ['302200', 'Xtend+ 60 gélules',     'Immunité',     '60 sgls', null, null,
   'Complément immunitaire et nutritionnel avancé, végétalien et 100% naturel. Contient 22 vitamines et minéraux essentiels, des bêta-glucanes 1-3/1-6, des caroténoïdes, xanthophylles et polyphénols. Le complément alimentaire le plus complet actuellement disponible. Parfait en association avec BalanceOil+ et ZinoBiotic+.'],

  ['300520', 'Xtend 60 comprimés',    'Immunité',     '60 tabs', null, null,
   'Version classique du complément immunitaire Zinzino. Contient 23 vitamines et minéraux essentiels incluant vitamines D, C, K, magnésium, zinc. Soutient la fonction immunitaire, la santé osseuse et musculaire. Complément idéal au protocole BalanceOil+ et ZinoBiotic+.'],

  ['300600', 'Protect+ 60 gélules',   'Immunité',     '60 sgls', null, null,
   'Complément à base de bêta-glucanes végétaliens 1-3/1-6 et de vitamine C et D3 d\'origine naturelle. Les bêta-glucanes activent les cellules immunitaires innées. Contribue au fonctionnement normal du système immunitaire.'],

  ['302700', 'Multify 60 comprimés',  'Immunité',     '60 tabs', null, null,
   'Multivitamine sans sucre à croquer, saveur tutti frutti, spécialement conçue pour les enfants. Contient des vitamines et minéraux essentiels adaptés aux besoins nutritionnels des enfants. Format pratique et goût apprécié.'],

  ['302780', 'SpiruMax+ 80 comprimés', 'Immunité',    '80 tabs', null, null,
   'Complément alimentaire à base de spiruline maxima d\'origine naturelle. La spiruline maxima est reconnue pour sa teneur exceptionnelle en protéines complètes, vitamines B, fer et antioxydants. Soutient l\'énergie et l\'immunité.'],

  // ─── SANTÉ INTESTINALE ────────────────────────────────────────────────────
  ['301390', 'ZinoBiotic+ 180 g',     'Santé intestinale', '180 g', null, null,
   'Mélange adapté de 8 fibres alimentaires naturelles (avoine, résistant amidon de maïs, inuline, gomme d\'acacia, pectine de pomme, poudre de psyllium, bêta-glucane d\'avoine, fibre de pois). Métabolisées dans le côlon, elles soutiennent la croissance des bactéries saines. Aide à réduire les pics de glycémie après les repas et à maintenir un taux de cholestérol normal.'],

  ['302790', 'X GOLD+ 250 ml',        'Santé intestinale', '250 ml', null, null,
   'Complément liquide à base de curcuma et de pipérine d\'origine naturelle. La curcumine du curcuma est reconnue pour ses propriétés anti-inflammatoires. La pipérine augmente la biodisponibilité de la curcumine. Soutient la santé digestive et articulaire.'],

  // ─── CONTRÔLE DU POIDS ────────────────────────────────────────────────────
  ['301331', 'LeanShake Chocolat 16x30g', 'Contrôle du poids', '16x30 g', null, null,
   'Shake protéiné riche en protéines de lactosérum et en fibres ZinoBiotic. Saveur chocolat. Remplace un repas pour soutenir la perte ou le maintien du poids. Contient des fibres prébiotiques pour la santé intestinale.'],

  ['301531', 'LeanShake Fraise 16x30g', 'Contrôle du poids', '16x30 g', null, null,
   'Shake protéiné riche en protéines de lactosérum et en fibres ZinoBiotic. Saveur fraise. Remplace un repas pour soutenir la perte ou le maintien du poids.'],

  ['301581', 'LeanShake Vanille 16x30g', 'Contrôle du poids', '16x30 g', null, null,
   'Shake protéiné riche en protéines de lactosérum et en fibres ZinoBiotic. Saveur vanille. Remplace un repas pour soutenir la perte ou le maintien du poids.'],

  ['301381', 'LeanShake Fruits Rouges 16x30g', 'Contrôle du poids', '16x30 g', null, null,
   'Shake protéiné riche en protéines de lactosérum et en fibres ZinoBiotic. Saveur fruits rouges. Remplace un repas pour soutenir la perte ou le maintien du poids.'],

  ['302011', 'Energy Bar 4x40g',      'Contrôle du poids', '4x40 g', null, null,
   'Barre énergétique riche en protéines et en fibres ZinoBiotic. Encas sain pour couper les fringales. Complément idéal au LeanShake dans un programme de gestion du poids.'],

  ['600509', 'Shake Bottle',          'Accessoire',   null,     null, null,
   'Shaker officiel Zinzino pour préparer facilement les LeanShakes. Pratique et réutilisable.'],

  ['600211', 'Measuring Tape',        'Accessoire',   null,     null, null,
   'Mètre ruban pour suivre les mensurations dans le cadre d\'un programme de gestion du poids.'],

  // ─── NUTRITION DE LA PEAU ─────────────────────────────────────────────────
  ['302800', 'Collagen Boozt 10x46ml', 'Nutrition peau', '10x46 ml', null, null,
   'Shots de collagène marin liquide. Contient du collagène hydrolysé, de la vitamine C, de l\'acide hyaluronique et du zinc. La vitamine C contribue à la formation normale de collagène pour le fonctionnement normal de la peau. Format shot pratique, goût fruité.'],

  ['302830', 'Collagen Boozt Flex 10x12.8g', 'Nutrition peau', '10x12.8 g', null, null,
   'Version en poudre du Collagen Boozt. Mêmes bienfaits que la version liquide dans un format sachets à diluer. Pratique pour les déplacements.'],

  // ─── COSMÉTIQUE SCIENTIFIQUE ──────────────────────────────────────────────
  ['310100', 'Pure Cleanse',          'Cosmétique',   null,     null, null,
   'Nettoyant visage doux de la gamme Skin Science Zinzino. Formule enrichie en polyphénols d\'olive et en actifs purifiants. Élimine les impuretés sans agresser la peau.'],

  ['310200', 'Day Cream SPF15',       'Cosmétique',   null,     null, null,
   'Crème de jour protectrice SPF15 de la gamme Skin Science. Formule riche en polyphénols d\'olive et en acides gras Oméga. Hydrate et protège la peau pendant la journée.'],

  ['310300', 'Night Cream',           'Cosmétique',   null,     null, null,
   'Crème de nuit régénérante de la gamme Skin Science. Agit pendant le sommeil pour restaurer et nourrir la peau en profondeur grâce aux polyphénols d\'olive.'],

  ['310400', 'Brilliant Eye Serum',   'Cosmétique',   null,     null, null,
   'Sérum contour des yeux de la gamme Skin Science Zinzino. Cible les signes de fatigue et les rides autour des yeux. Formule légère enrichie en actifs anti-âge.'],

  ['310500', 'Rejuvenate Serum',      'Cosmétique',   null,     null, null,
   'Sérum anti-âge de la gamme Skin Science. Formule concentrée en polyphénols et peptides pour réduire l\'apparence des rides et améliorer l\'éclat du teint.'],

  ['310600', 'Rebalance Mask',        'Cosmétique',   null,     null, null,
   'Masque visage rééquilibrant de la gamme Skin Science Zinzino. Enrichi en polyphénols d\'olive et en actifs hydratants. Utilisé 1 à 2 fois par semaine pour un teint lumineux et équilibré.'],

  // ─── KITS ─────────────────────────────────────────────────────────────────
  ['910331', 'BalanceOil+ Kit with Test', 'Kit',     null,     null, null,
   'Kit d\'entrée idéal. Contient : 1 BalanceOil+ 300 ml + 1 BalanceTest. Le test permet de mesurer ton profil Oméga avant de commencer, puis de vérifier les progrès après 120 jours.'],

  ['910330', 'BalanceOil+ Kit',       'Kit',          null,     null, null,
   'Kit BalanceOil+ sans test. Contient : 1 BalanceOil+ 300 ml. Pour ceux qui ont déjà effectué leur BalanceTest ou qui veulent simplement démarrer la supplémentation.'],

  ['910520', 'BalanceOil+ Premium Kit with Test', 'Kit', null,  null, null,
   'Kit Premium avec test. Contient : 1 BalanceOil+ Premium 300 ml + 1 BalanceTest. La formule Premium offre une concentration en polyphénols d\'olive encore plus élevée.'],
]

// 4. Insertion des produits (idempotent)
let inserted = 0
let skipped = 0

for (const [sku, name, category, unit, retail, wholesale, desc] of products) {
  const exists = await client.query(
    'SELECT id FROM catalog_products WHERE sku = $1 AND catalog_id = $2',
    [sku, catalogId]
  )
  if (exists.rowCount > 0) {
    console.log(`⏭ Déjà présent : ${name}`)
    skipped++
    continue
  }

  await client.query(`
    INSERT INTO catalog_products
      (id, catalog_id, sku, name, category, unit,
       retail_price_eur, wholesale_price_eur,
       description, image_url, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
  `, [
    randomUUID(),
    catalogId,
    sku,
    name,
    category,
    unit || null,
    retail || null,
    wholesale || null,
    desc,
    IMG(sku),
  ])
  console.log(`✓ ${name} (${sku})`)
  inserted++
}

console.log(`\nTerminé : ${inserted} produits insérés, ${skipped} déjà présents`)
console.log(`\n--- Pour compléter les prix ---`)
console.log('Connecte-toi à ton back-office Zinzino partenaire')
console.log('et mets à jour retail_price_eur / wholesale_price_eur')
console.log('via une requête UPDATE ou le Dashboard Supabase.')
console.log('\nExemple :')
console.log(`UPDATE catalog_products SET retail_price_eur = 59.00, wholesale_price_eur = 41.00 WHERE sku = '300000' AND catalog_id = '${catalogId}';`)

await client.end()
