// migrate9.mjs — Enrichissement table catalog_products (doTERRA)
// Ajoute : description, unit, retail_price_eur, wholesale_price_eur, pv, latin_name, image_url
// Met à jour les 52 produits existants avec données price-list + catalogue

import pg from 'pg'
const { Client } = pg

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connecté à Supabase')

// 1. Ajout des nouvelles colonnes
await client.query(`
  ALTER TABLE catalog_products
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS unit TEXT,
    ADD COLUMN IF NOT EXISTS retail_price_eur NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS wholesale_price_eur NUMERIC(8,2),
    ADD COLUMN IF NOT EXISTS pv NUMERIC(8,1),
    ADD COLUMN IF NOT EXISTS latin_name TEXT,
    ADD COLUMN IF NOT EXISTS image_url TEXT;
`)
console.log('Colonnes ajoutées')

// 2. Données enrichies par SKU (price-list FR + catalogue)
// Format : [sku, unit, retail, wholesale, pv, latin_name, description]
const products = [
  // HUILES ESSENTIELLES SIMPLES
  ['lavender',       '15 ml',   49.74,  37.31,  39.5, 'Lavandula angustifolia',
   'Depuis des millénaires, la Lavande est appréciée pour son arôme incomparable. Couramment utilisée pour ses qualités apaisantes et relaxantes. Applique sur les tempes ou ajoute à l\'eau du bain.'],
  ['lemon',          '15 ml',   24.20,  18.16,  19.0, 'Citrus limon',
   'Huile la plus vendue, obtenue par pression à froid du zeste. Apporte une touche acidulée aux plats, peut parfumer l\'eau et possède des propriétés revigorantes pour améliorer l\'humeur.'],
  ['peppermint',     '15 ml',   41.34,  31.01,  32.5, 'Mentha piperita',
   'Très appréciée pour ses innombrables bienfaits. Ajoute des saveurs rafraîchissantes aux smoothies et desserts. Applique une goutte sur les tempes pour un effet rafraîchissant.'],
  ['tea-tree',       '15 ml',   39.32,  29.50,  31.0, 'Melaleuca alternifolia',
   'Contient 90 composés différents. Procure des bienfaits pour les cheveux, la peau et les ongles. Réputée pour ses effets purifiants et rajeunissants.'],
  ['frankincense',   '15 ml',  128.40,  96.30, 101.5, 'Boswellia carterii, frereana, sacra et papyrifera',
   'Sans doute la plus précieuse des huiles de l\'Antiquité. Peut contribuer à l\'hydratation de la peau, procure un sentiment de détente et équilibre l\'humeur.'],
  ['oregano',        '15 ml',   48.06,  36.05,  38.0, 'Origanum vulgare',
   'Obtenue à partir des feuilles d\'origan. Apporte une touche épicée et herbacée aux plats. Idéale dans les soupes, salades et assaisonnements. Huile chaude, toujours diluer.'],
  ['wild-orange',    '15 ml',   22.52,  16.90,  18.0, 'Citrus sinensis',
   'Pressée à froid à partir de l\'écorce. Parfum énergisant et nombreux bienfaits. Applique localement pour ses propriétés dynamisantes ou ajoute au gel douche.'],
  ['bergamot',       '15 ml',   66.23,  49.67,  52.5, 'Citrus bergamia',
   'Obtenue par pression à froid du zeste. Fréquemment utilisée en massothérapie pour ses bienfaits apaisants sur la peau. Photo-sensibilisante, évite l\'exposition au soleil 12h après application.'],
  ['eucalyptus',     '15 ml',   31.60,  23.70,  25.0, 'Eucalyptus radiata, polybractea, kochii, loxophleba et globulus',
   'Obtenue à partir des feuilles d\'eucalyptus. En application locale, contribue à la sensation de détente. Associe bien avec Lavande, Pin Douglas et Cyprès.'],
  ['rosemary',       '15 ml',   33.28,  24.96,  26.5, 'Rosmarinus officinalis',
   'Ingrédient sacré dans les civilisations grecques et romaines. Apporte une saveur herbacée aux viandes. Senteur herbacée et énergisante.'],
  ['clary-sage',     '15 ml',   66.23,  49.67,  52.5, 'Salvia sclarea',
   'Connue pour ses propriétés apaisantes et calmantes en application cutanée. Favorise une sensation de détente pour se préparer à une nuit de sommeil reposante.'],
  ['ylang-ylang',    '15 ml',   68.58,  51.43,  54.0, 'Cananga odorata',
   'Connu pour son parfum exquis. Propice à la relaxation lors d\'un massage. Favorise la bonne humeur tout en procurant une sensation d\'apaisement.'],
  ['geranium',       '15 ml',   79.00,  59.24,  62.5, 'Pelargonium graveolens',
   'Utilisé depuis l\'Égypte ancienne pour embellir la peau. Favorise une peau nette et saine. Ajoute dans le shampooing pour redonner brillance et éclat aux cheveux.'],
  ['helichrysum',    '5 ml',   131.76,  98.82, 104.0, 'Helichrysum italicum',
   'L\'une des huiles essentielles les plus précieuses. Atténue les taches et imperfections de la peau. Masse au niveau des tempes et sur la nuque pour un effet apaisant.'],
  ['rose',           '5 ml',   541.86, 406.39, 428.0, 'Rosa damascena',
   'La « Reine des huiles essentielles ». Parfum doux et floral aux vertus stimulantes. Atténue les imperfections de la peau et favorise un teint uniforme.'],
  ['jasmine',        '10 ml',   73.28,  54.96,  58.0, 'Jasminum grandiflorum',
   'Applicateur à bille. Parfum prestigieux. Atténue les imperfections de la peau. Intègre à la routine de soins du visage pour un teint lumineux.'],
  ['copaiba',        '15 ml',   60.85,  45.64,  48.0, 'Copaifera reticulata, officinalis, coriacea et langsdorffii',
   'Utilisé dans les pratiques médicales traditionnelles au Brésil. Favorise une peau nette et lisse. Très souvent utilisé dans les produits cosmétiques et les parfums.'],
  ['vetiver',        '15 ml',  105.22,  78.91,  83.0, 'Vetiveria zizanioides',
   'Particulièrement apprécié pour son arôme riche, exotique et complexe. Réputé pour ses propriétés ressourçantes. Applique sur la plante des pieds avant le coucher.'],
  ['sandalwood',     '5 ml',   144.54, 108.41, 114.0, 'Santalum album',
   'Utilisée depuis des millénaires. Pour une peau nette et radieuse. Très apprécié en encens et utilisé pour la méditation dans le monde entier.'],
  ['ginger',         '15 ml',   82.36,  61.76,  65.0, 'Zingiber officinale',
   'Provient du rhizome frais de la plante. Épice très appréciée en cuisine utilisée partout dans le monde. Utilise à la place du gingembre frais dans les desserts.'],
  ['clove',          '15 ml',   31.60,  23.70,  25.0, 'Eugenia caryophyllata',
   'Connu et apprécié en cuisine depuis la Chine et l\'Inde anciennes. Souvent utilisé comme épice en cuisine. Peut être utilisé ailleurs qu\'en cuisine grâce à ses propriétés puissantes. Huile chaude.'],
  ['cinnamon',       '5 ml',    47.72,  35.80,  37.5, 'Cinnamomum zeylanicum',
   'Réputée pour ses nombreux usages culinaires. Ingrédient très apprécié dans divers entrées, pains et desserts. Huile chaude, dilue toujours avant application cutanée.'],
  ['thyme',          '15 ml',   54.78,  41.09,  43.5, 'Thymus vulgaris',
   'Produit une huile essentielle très puissante. Saveur fraîche et herbacée. Idéale pour les marinades de viandes, les plats salés, le pain. Huile chaude.'],
  ['marjoram',       '15 ml',   38.32,  28.74,  30.5, 'Origanum majorana',
   'Surnommée « douceur d\'hiver » ou « joie des montagnes ». Complément chaleureux et herbacé en cuisine. Remplace la marjolaine déshydratée dans les recettes.'],
  ['cardamom',       '5 ml',    49.74,  37.31,  39.5, 'Elettaria cardamomum',
   'De la même famille que le gingembre. Épice très aromatique pour cuisiner. Arôme rafraîchissant et mentholé, idéale dans les soupes, salades et assaisonnements.'],
  ['basil',          '15 ml',   47.39,  35.54,  37.5, 'Ocimum basilicum',
   'De la même famille que la menthe. Plante bienfaisante couramment utilisée en cuisine. Ingrédient d\'assaisonnement polyvalent largement utilisé dans le monde.'],
  ['cypress',        '15 ml',   30.59,  22.94,  24.0, 'Cupressus sempervirens',
   'Souvent utilisée dans les spas par les massothérapeutes. Effet stimulant et ressourçant sur les émotions. Améliore l\'aspect des peaux grasses.'],
  ['black-pepper',   '5 ml',    35.96,  26.98,  28.5, 'Piper nigrum',
   'À la fois stimulant et riche en saveurs. Relève le goût des aliments. Ingrédient d\'assaisonnement polyvalent, largement utilisé dans les plats salés.'],
  ['arborvitae',     '5 ml',    38.32,  28.74,  30.5, 'Thuja plicata',
   'Connu sous le nom d\'« arbre de vie ». Peut être bénéfique pour la peau. Fréquemment utilisé pour la méditation.'],
  ['grapefruit',     '15 ml',   31.26,  23.45,  24.5, 'Citrus X paradisi',
   'Généralement connu pour son goût amer et acidulé. Apporte un arôme parfumé et extrêmement stimulant aux plats et boissons. Photo-sensibilisant.'],
  ['lime',           '15 ml',   27.23,  20.42,  21.5, 'Citrus aurantifolia',
   'Caractérisé par son odeur piquante d\'agrumes. Obtenu par pression à froid des zestes. Parfume une multitude de recettes salées ou desserts sucrés d\'une saveur piquante.'],
  ['cedarwood',      '15 ml',   26.56,  19.92,  21.0, 'Juniperus virginiana',
   'Connue pour sa teinte profonde et sa senteur chaude et boisée. Ajoute quelques gouttes à ta lotion tonique ou crème hydratante pour ses bienfaits purifiants.'],

  // MÉLANGES
  ['on-guard',       '15 ml',   60.85,  45.64,  48.0, null,
   'L\'un des mélanges les plus populaires de dōTERRA. Association d\'Orange douce, Clou de girofle, Cannelle, Eucalyptus et Romarin. Apporte une touche d\'agrumes épicée aux boissons chaudes.'],
  ['deep-blue',      '5 ml',    59.15,  44.36,  47.0, null,
   'Mélange de réconfort musculaire associant Menthe des champs, Romarin, Copaïba, Anis étoilé et Menthe poivrée. Cible les zones traitées pour des bienfaits rafraîchissants et apaisants.'],
  ['breathe',        '15 ml',   48.06,  36.05,  38.0, null,
   'dōTERRA Air™ en Europe. Mélange de Laurier, Eucalyptus, Menthe poivrée, Arbre à thé, Citron, Cardamome et Ravintsara. Favorise la sensation de dégagement des voies respiratoires.'],
  ['digest-zen',     '15 ml',   57.80,  43.36,  45.5, null,
   'ZenGest™ en Europe. Mélange unique de Gingembre, Menthe poivrée, Carvi et Fenouil. Bénéfique contre les maux d\'estomac. Indispensable en déplacement comme à la maison.'],
  ['serenity',       '15 ml',   65.56,  49.16,  52.0, null,
   'Mélange reposant de Lavande, Genévrier de Virginie, Coriandre, Ylang Ylang, Marjolaine, Camomille romaine, Vétiver et Bois de santal. Propice à un sommeil reposant.'],
  ['balance',        '15 ml',   40.67,  30.50,  32.0, null,
   'Mélange ressourçant d\'Épicéa, Bois de Hô, Encens, Tanaisie annuelle et Camomille bleue. Procure un sentiment de tranquillité et d\'équilibre. Idéal pour la méditation.'],
  ['elevation',      '15 ml',   68.58,  51.43,  54.0, null,
   'Mélange exaltant. Citrus Bliss™ en version européenne. Association d\'huiles essentielles d\'agrumes qui exaltera votre humeur. Propriétés rafraîchissantes.'],
  ['adaptiv',        '15 ml',   68.58,  51.43,  54.0, null,
   'Mélange calmant exclusif associant Orange douce, Lavande, Copaïba, Menthe verte, Magnolia, Romarin, Néroli et Copalme. Améliore l\'humeur en application locale.'],
  ['past-tense',     '10 ml',   31.26,  23.45,  24.5, null,
   'Applicateur à bille. Mélange relaxant de Menthe poivrée, Eucalyptus, Lavande, Géranium, Copaïba, Encens, Romarin et Coriandre. Favorise un équilibre émotionnel.'],
  ['cheer',          '5 ml',    43.02,  32.27,  34.0, null,
   'Mélange exaltant d\'Orange douce, Anis étoilé, Gingembre, Bergamote, Ylang Ylang, Encens, Lemongrass, Fève de Tonka et Vanille. Permet de retrouver la joie de vivre.'],
  ['motivate',       '5 ml',    37.31,  27.98,  29.5, null,
   'Mélange motivant de Menthe poivrée, Orange douce, Clémentine et Citron. Crée une atmosphère revigorante. Procure un sentiment de confiance, de courage et de conviction.'],
  ['console',        '5 ml',    66.90,  50.17,  53.0, null,
   'Mélange réconfortant d\'Encens, Patchouli, Ylang Ylang, Labdanum, Amyris, Bois de santal, Rose et Osmanthus. Invite à l\'espoir et à la positivité.'],
  ['forgive',        '5 ml',    40.00,  30.00,  31.5, null,
   'Mélange du renouveau à base d\'Épinette, Bergamote, Baie de Genièvre et Myrrhe. Aide à découvrir l\'action libératrice du pardon. Favorise une sensation de satisfaction.'],
  ['purify',         '15 ml',   40.67,  30.50,  32.0, null,
   'Mélange rafraîchissant de Citron, Citron vert et Sapin de Sibérie. Propriétés purifiantes pour les peaux irritées. Utilise pour rafraîchir les chaussures, réfrigérateurs, voitures.'],
  ['zendocrine',     '15 ml',   45.37,  34.03,  36.0, null,
   'Mélange de redémarrage de Mandarine, Romarin, Géranium, Baies de Genièvre et Coriandre. Pour parfumer les plats ou ajouter dans les boissons à base d\'agrumes.'],

  // COMPLÉMENTS
  ['llv',            '3 items', 142.97, 107.23, 232.0, null,
   'dōTERRA Lifelong Vitality Pack™. Association d\'Alpha CRS+, Microplex VMz et xEO Mega pour améliorer vitalité et bien-être. Contient des nutriments essentiels et des antioxydants puissants.'],
  ['mito2max',       '60 caps',  65.74,  49.30,  59.0, null,
   'MetaPWR Mito2Max. Contient Eriodictyon californicum, PQQ, CoQ10, Ginseng américain, Cordyceps, Quercétine. Le manganèse contribue au bon métabolisme énergétique.'],
  ['bone-nutrient',  '120 caps', 28.92,  21.69,  26.0, null,
   'Complexe de Nutriments Essentiels pour les Os. Mélange de vitamines C et D, calcium, magnésium et autres oligo-éléments. Conçu spécifiquement pour les femmes.'],
  ['phytoestrogen',  '60 caps',  59.16,  44.37,  53.0, null,
   'Complexe Essentiel de Phytoestrogènes. Mélange de phytoestrogènes végétaux normalisés et de lignanes de graines de lin. Formulé spécifiquement pour les femmes.'],
  ['ddpdr',          '60 sgls',  76.90,  57.68,  69.0, null,
   'DDR Prime Softgels. Huiles essentielles d\'Encens, Orange douce, Thym, Clou de girofle, Sarriette et Lemongrass en gélules. Pour prendre soin de la santé cellulaire globale.'],
]

// 3. Mise à jour de chaque produit
let updated = 0
let notFound = 0
for (const [sku, unit, retail, wholesale, pv, latin, desc] of products) {
  const res = await client.query(`
    UPDATE catalog_products
    SET
      unit                = $1,
      retail_price_eur    = $2,
      wholesale_price_eur = $3,
      pv                  = $4,
      latin_name          = $5,
      description         = $6
    WHERE sku = $7
  `, [unit, retail, wholesale, pv, latin, desc, sku])
  if (res.rowCount > 0) {
    updated++
    console.log(`✓ ${sku}`)
  } else {
    notFound++
    console.log(`✗ SKU non trouvé : ${sku}`)
  }
}

console.log(`\nMise à jour terminée : ${updated} produits enrichis, ${notFound} SKU introuvables`)
} finally {
  await client.end()
}
