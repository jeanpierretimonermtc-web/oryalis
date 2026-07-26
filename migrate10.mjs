// migrate10.mjs — Ajout des nouveaux produits dōTERRA Europe
// Produits présents dans le price-list FR 2026 mais absents de la table catalog_products
// catalog_id doTERRA = e36a2738-e1b9-4c37-aa95-4f6aef4d13e8

import pg from 'pg'
const { Client } = pg
import { randomUUID } from 'crypto'

if (!process.env.SUPABASE_DB_PASSWORD) throw new Error('Missing SUPABASE_DB_PASSWORD')

const password = encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)
const client = new Client({
  connectionString: `postgresql://postgres.nhpvjfyjyculnijipzoa:${password}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
})

await client.connect()
try {
console.log('Connecté à Supabase')

const CATALOG_ID = 'e36a2738-e1b9-4c37-aa95-4f6aef4d13e8'

// Nouveaux produits : [sku, name, category, unit, retail, wholesale, pv, latin_name, description]
const newProducts = [

  // ─── HUILES ESSENTIELLES SIMPLES (nouvelles) ───────────────────────────
  ['black-spruce',    'Épinette Noire',        'Huile essentielle', '5 ml',   32.60,  24.46,  26.0,  'Picea mariana',
   'Utilisée par les Amérindiens pour ses bienfaits pour la peau. Apaise et soulage la peau. Procure un sentiment de détente et de calme. Utilisée en massage après un exercice physique intense.'],
  ['blue-tansy',      'Tanaisie Bleue',        'Huile essentielle', '5 ml',   151.93, 113.95, 120.0, 'Tanacetum annuum',
   'Extraite d\'une plante méditerranéenne annuelle aux fleurs jaunes. Principal composant de dōTERRA Balance et Deep Blue. Ajoute une goutte à la crème hydratante pour atténuer les imperfections. Attention : couleur bleu profond peut tacher.'],
  ['cassia',          'Cannelle de Chine',     'Huile essentielle', '15 ml',  35.96,  26.98,  28.5,  'Cinnamomum cassia',
   'De la même famille que la cannelle, dégage un parfum agréable utilisé depuis plusieurs millénaires. Utilisée en cuisine pour remplacer la cannelle. Très appréciée dans les entrées, pains et desserts. Huile chaude, toujours diluer.'],
  ['celery-seed',     'Graines de Céleri',     'Huile essentielle', '15 ml',  59.15,  44.36,  47.0,  'Apium graveolens',
   'Utilisé depuis le 5e siècle en Chine. Connu pour son arôme complexe, piquant, sucré et épicé. Un ajout savoureux à une grande variété de plats.'],
  ['cilantro',        'Coriandre (Feuilles)',  'Huile essentielle', '15 ml',  43.36,  32.52,  34.5,  'Coriandrum sativum',
   'Obtenue à partir des feuilles de la coriandre. Délicieuse saveur rafraîchissante. Idéale dans les dips, sauces et plats salés. Apporte fraîcheur et peps à vos plats.'],
  ['citronella',      'Citronnelle de Java',   'Huile essentielle', '15 ml',  32.60,  24.46,  26.0,  'Cymbopogon winterianus',
   'Issue de la feuille d\'une herbe haute originaire d\'Asie. Parfum vif et frais. Alliée idéale en camping, randonnée. Peut contribuer à une peau nette. Apaisante pour le cuir chevelu.'],
  ['douglas-fir',     'Pin Douglas',           'Huile essentielle', '5 ml',   38.32,  28.74,  30.5,  'Pseudotsuga menziesii',
   'Arôme doux et rafraîchissant avec une légère note citronnée. En application locale, favorise une humeur et un environnement positifs. Possède des vertus purifiantes appliquée sur la peau.'],
  ['fennel',          'Fenouil',               'Huile essentielle', '15 ml',  28.57,  21.43,  22.5,  'Foeniculum vulgare',
   'Utilisé depuis des siècles, il se distingue par son arôme de réglisse. Complément savoureux pour les soupes, sauces et salades. Prends une goutte dans l\'eau plutôt que de te jeter sur les sucreries.'],
  ['green-mandarin',  'Mandarine Verte',       'Huile essentielle', '15 ml',  46.72,  35.04,  37.0,  'Citrus nobilis',
   'Pressée à froid à partir du fruit encore vert du mandarinier. Favorise une sensation d\'apaisement. Agrémente plats ou eau pour une explosion de saveurs rafraîchissantes.'],
  ['guaiacwood',      'Bois de Gaïac',         'Huile essentielle', '15 ml',  33.28,  24.96,  26.5,  'Bulnesia sarmientoi',
   'Approvisionnement durable et éthique au Paraguay. Utilisé en parfumerie fine et dans les produits de soin de la peau pour son parfum légèrement sucré et terreux.'],
  ['juniper-berry',   'Baies de Genièvre',     'Huile essentielle', '5 ml',   36.97,  27.73,  29.0,  'Juniperus communis',
   'Obtenue à partir d\'un conifère avec un riche passé d\'utilisations traditionnelles. Applique une goutte sur la peau pour favoriser un teint net. Effet calmant et apaisant en application locale.'],
  ['lemongrass',      'Lemongrass',            'Huile essentielle', '15 ml',  22.52,  16.90,  18.0,  'Cymbopogon flexuosus',
   'Produit une huile essentielle fumée et acidulée. Utilisée dans la cuisine asiatique, les soupes, le thé et les currys. Idéale avec le Basilic, la Cardamome ou la Menthe verte.'],
  ['lime',            'Citron Vert',           'Huile essentielle', '15 ml',  27.23,  20.42,  21.5,  'Citrus aurantifolia',
   'Caractérisé par son odeur piquante d\'agrumes. Obtenu par pression à froid des zestes. Peut être utilisé pour parfumer une multitude de recettes salées ou desserts sucrés.'],
  ['madagascar-vanilla','Vanille de Madagascar','Huile essentielle', '5 ml',  62.53,  46.90,  49.5,  'Vanilla planifolia',
   'Absolu. Prisé depuis les Aztèques et souvent utilisé en parfumerie. L\'un des arômes les plus appréciés au monde. Hydrate la peau grâce à l\'huile de coco fractionnée. Utilise comme fragrance raffinée.'],
  ['melissa',         'Mélisse',               'Huile essentielle', '5 ml',   185.56, 139.16, 146.5, 'Melissa officinalis',
   'Notre huile essentielle la plus rare. Parfum d\'agrumes à la fois sucré et frais. Contribue à apaiser les tensions. Favorise une sensation de détente en application locale. Rajeunit la peau.'],
  ['myrrh',           'Myrrhe',                'Huile essentielle', '15 ml',  118.99, 89.24,  94.0,  'Commiphora myrrha',
   'Utilisée de diverses manières depuis plusieurs siècles, de la méditation à l\'embaumement. Favorise l\'équilibre émotionnel. Contient des propriétés qui nettoient la peau et améliorent son aspect.'],
  ['patchouli',       'Patchouli',             'Huile essentielle', '15 ml',  51.42,  38.57,  40.5,  'Pogostemon cablin',
   'Facilement reconnaissable à son parfum riche, musqué et sucré. Mélange à d\'autres huiles pour un parfum musqué. Peut être utilisé fréquemment pour apaiser et nettoyer la peau.'],
  ['petitgrain',      'Petitgrain',            'Huile essentielle', '15 ml',  42.01,  31.51,  33.5,  'Citrus aurantium',
   'Parfum frais et légèrement herbacé. L\'application locale peut favoriser un sentiment de calme et de détente. Les propriétés relaxantes sont bénéfiques en massage.'],
  ['pink-pepper',     'Poivre Rose',           'Huile essentielle', '5 ml',   37.98,  28.49,  30.0,  'Schinus molle',
   'Arbre sacré pour les Incas, obtenu à partir des fruits de l\'arbuste. Huile légèrement fruitée et poivrée. Peut remplacer l\'huile essentielle de Poivre noir pour relever les plats.'],
  ['roman-chamomile', 'Camomille Romaine',     'Huile essentielle', '5 ml',   81.01,  60.76,  64.0,  'Anthemis nobilis',
   'L\'huile de la plus polyvalente des camomilles. Applique sur la plante des pieds à l\'heure du coucher. Pour des cheveux et un cuir chevelu sains. Procure un effet calmant sur la peau et le corps.'],
  ['siberian-fir',    'Sapin de Sibérie',      'Huile essentielle', '15 ml',  33.61,  25.21,  26.5,  'Abies sibirca',
   'Parfum frais et boisé. Procure un effet apaisant lorsqu\'on l\'utilise en massage. En application locale, apaise les irritations cutanées bénignes.'],
  ['spanish-sage',    'Sauge Espagnole',       'Huile essentielle', '15 ml',  46.72,  35.04,  37.0,  'Salvia lavandulifolia',
   'Arôme camphré et herbacé rappelant la sauge. Idéale dans la routine beauté ou soins de la peau pour ses propriétés rafraîchissantes. Peut être utilisée pour renforcer la concentration.'],
  ['spearmint',       'Menthe Verte',          'Huile essentielle', '15 ml',  51.42,  38.57,  40.5,  'Mentha spicata',
   'Option plus douce que la Menthe poivrée. S\'associe bien avec Lavande, Romarin, Basilic, Menthe poivrée et Eucalyptus. Aromatise desserts, boissons, salades ou entrées.'],
  ['spikenard',       'Nard de l\'Himalaya',   'Huile essentielle', '5 ml',   86.72,  65.04,  68.5,  'Nardostachys jatamansi',
   'Apprécié depuis des siècles, utilisé en médecine ayurvédique indienne. Arôme réconfortant qui peut favoriser le calme et la détente. Purifie la peau et favorise un teint net et éclatant.'],
  ['tangerine',       'Mandarine',             'Huile essentielle', '15 ml',  25.55,  19.16,  18.5,  'Citrus reticulata',
   'Diffuse un parfum doux, acidulé et réconfortant. Son goût rafraîchissant apporte une note acidulée à n\'importe quelle recette à base d\'agrumes. S\'associe bien avec les huiles chaudes et épicées.'],
  ['tulsi',           'Tulsi (Basilic Sacré)', 'Huile essentielle', '5 ml',   48.40,  36.30,  38.0,  'Ocimum sanctum',
   'Parfum chaud et doux qui rappelle le basilic fraîchement cueilli avec une pointe de clou de girofle. Propriétés calmantes et relaxantes. Favorise l\'apparence d\'une peau saine.'],
  ['turmeric',        'Curcuma',               'Huile essentielle', '15 ml',  54.44,  40.84,  43.0,  'Curcuma longa',
   'Plante aromatique de la famille du gingembre utilisée depuis des siècles. Apporte une explosion de saveurs aux plats salés. Ajoute 1 à 2 gouttes dans du thé ou de l\'eau pour une saveur herbacée subtile.'],
  ['yarrow-pom',      'Yarrow|Pom',            'Huile essentielle', '30 ml',  176.46, 132.35, 139.5, null,
   'Duo Actif de Plantes. Associe les bienfaits de l\'huile essentielle d\'Achillée millefeuille et de l\'huile de graines de Grenade pressée à froid. Favorise une peau saine. Ajoute à la crème hydratante.'],

  // ─── MÉLANGES (nouveaux) ───────────────────────────────────────────────
  ['abode',           'dōTERRA Abōde™',        'Mélange',           '15 ml',  40.67,  30.50,  32.0,  null,
   'Mélange rafraîchissant de Citron vert, Litsée, Cannelle de Chine, Eucalyptus citronné, Arbre à thé, Thuya et autres. Formulé avec des huiles reconnues pour leurs composants purifiants comme le limonène.'],
  ['air-x',           'Air-X™',                'Mélange',           '15 ml',  53.10,  39.83,  42.0,  null,
   'Mélange de Litsée, Mandarine, Pamplemousse, Encens et Cardamome. Arôme intensément acidulé et boisé légèrement herbacé. Contribue à rafraîchir et à purifier en application locale.'],
  ['align',           'dōTERRA Align™',        'Mélange',           '5 ml',   35.29,  26.47,  28.0,  null,
   'Mélange de centrage de Bergamote, Coriandre, Marjolaine, Menthe Poivrée, Géranium, Basilic, Rose et Jasmin. Aide à avoir confiance en soi et à rester ouvert à toutes les possibilités.'],
  ['anchor',          'dōTERRA Anchor™',       'Mélange',           '5 ml',   35.29,  26.47,  28.0,  null,
   'Mélange stabilisant de Lavande, Genévrier de Virginie, Bois de Santal, Cannelle de Ceylan, Encens, Poivre noir et Patchouli. Aide à se reconnecter à soi-même et à son harmonie émotionnelle.'],
  ['arise',           'dōTERRA Arise™',        'Mélange',           '5 ml',   35.29,  26.47,  28.0,  null,
   'Mélange éclairant de Pamplemousse, Citron, Osmanthus, Mélisse et Sapin de Sibérie. T\'inspire pour atteindre ton but ultime. Idéal avec les postures de yoga debout.'],
  ['aromatouch',      'AromaTouch™',           'Mélange',           '15 ml',  54.44,  40.84,  43.0,  null,
   'Mélange pour massage associant Cyprès, Menthe poivrée, Marjolaine, Basilic, Pamplemousse et Lavande. Bienfaits réconfortants et relaxants. Utilise avec la technique AromaTouch.'],
  ['citrus-bliss',    'Citrus Bliss™',         'Mélange',           '15 ml',  40.00,  30.00,  31.5,  null,
   'Mélange revigorant d\'Orange douce, Citron, Pamplemousse, Tangerine, Bergamote, Mandarine, Clémentine et Vanille. Exaltera ton humeur à coup sûr. Propriétés rafraîchissantes.'],
  ['clarycalm',       'ClaryCalm™',            'Mélange',           '10 ml',  56.12,  42.10,  44.5,  null,
   'Applicateur à bille. Mélange de Sauge sclarée, Lavande, Bergamote, Camomille romaine, Genévrier de Virginie, Ylang-Ylang, Géranium, Fenouil et autres. Procure un effet rafraîchissant pour la peau.'],
  ['ddr-prime',       'DDR Prime™',            'Mélange',           '15 ml',  64.55,  48.41,  51.0,  null,
   'Mélange de renouvellement associant Encens, Orange douce, Thym, Clou de girofle, Sarriette et Lemongrass. Ajoute quelques gouttes dans ta boisson du matin pour prendre soin de ta santé cellulaire.'],
  ['hd-clear',        'HD Clear™',             'Mélange',           '10 ml',  37.31,  27.98,  29.5,  null,
   'Applicateur à bille. Mélange topique ultime pour les peaux à problèmes, formulé avec Cumin, Arbre à thé et Eucalyptus. Facile à appliquer sur des zones ciblées. Pour un teint clair.'],
  ['intune',          'InTune™',               'Mélange',           '10 ml',  60.85,  45.64,  48.0,  null,
   'Applicateur à bille. Mélange pour la concentration de Bois de Santal, Encens, Citron vert, Patchouli, Ylang-Ylang et Camomille romaine. Applique sur les tempes avant de travailler.'],
  ['metapwr',         'MetaPWR™',              'Mélange',           '15 ml',  45.37,  34.03,  36.0,  null,
   'Développé par les scientifiques de dōTERRA. Ratios équilibrés de Pamplemousse, Citron, Menthe poivrée, Gingembre et Cannelle de Ceylan. Stimulant pour les sens, complète une alimentation réfléchie.'],
  ['passion',         'dōTERRA Passion™',      'Mélange',           '5 ml',   66.90,  50.17,  53.0,  null,
   'Mélange inspirant de Gingembre, Jasmin, Bois de santal et autres. Aide à retrouver l\'enthousiasme dans la vie. Applique sur les poignets et le cœur tout au long de la journée.'],
  ['peace',           'dōTERRA Peace™',        'Mélange',           '5 ml',   54.44,  40.84,  43.0,  null,
   'Mélange rassurant de Lavande, Marjolaine, Vétiver et Ylang Ylang. Te rappelle qu\'il n\'est pas nécessaire d\'être parfait pour trouver la paix. Idéal pour la méditation et le yoga.'],
  ['salubelle',       'dōTERRA Salubelle™',    'Mélange',           '10 ml',  131.76, 98.82,  104.0, null,
   'Applicateur à bille. Mélange beauté d\'Encens, Bois de santal, Lavande, Myrrhe, Hélichryse et Rose. Contribue à réduire l\'apparence des imperfections. Contribue à la jeunesse de la peau.'],
  ['shinrin-yoku',    'dōTERRA Shinrin-Yoku™', 'Mélange',           '15 ml',  53.10,  39.83,  38.0,  null,
   'Mélange Bain de Forêt de Citron, Patchouli, Magnolia et Sapin de Sibérie. Inspiré par l\'énergie apaisante de la forêt. Formulé avec des huiles riches en terpènes et phytoncides.'],
  ['supermint',       'dōTERRA SuperMint™',    'Mélange',           '15 ml',  49.74,  37.31,  39.5,  null,
   'Mélange d\'huiles essentielles de menthe associant Menthe poivrée, Menthe des champs, Menthe citronnée et Menthe verte. Rafraîchit l\'haleine et soulage après un repas copieux.'],
  ['terrashield',     'TerraShield™',          'Mélange',           '15 ml',  24.20,  18.16,  19.0,  null,
   'Mélange d\'extérieur de Lemongrass, Thym, Géranium et Menthe poivrée. Associe des huiles reconnues depuis des siècles pour protéger contre les nuisances environnementales.'],
  ['thinker',         'dōTERRA Thinker™',      'Mélange Kids',      '10 ml',  29.58,  22.19,  23.5,  null,
   'Collection Kids. Contient Vétiver, Menthe poivrée, Clémentine et Romarin. Le mélange idéal à conserver dans le sac à dos de l\'enfant en permanence.'],
  ['calmer',          'dōTERRA Calmer™',       'Mélange Kids',      '10 ml',  35.96,  26.98,  28.5,  null,
   'Collection Kids. Mélange reposant de Lavande, Cananga, Faux bois de Santal et Camomille romaine. Favorise une sensation de calme et de sérénité. Utilise au cours du rituel du soir.'],
  ['stronger',        'dōTERRA Stronger™',     'Mélange Kids',      '10 ml',  27.90,  20.93,  22.0,  null,
   'Collection Kids. Mélange protecteur de Genévrier de Virginie, Litsée, Encens et Rose. Idéal pour la résilience quotidienne. Applique sur les mains, genoux et pieds après une longue journée.'],
  ['rescuer',         'dōTERRA Rescuer™',      'Mélange Kids',      '10 ml',  27.90,  20.93,  22.0,  null,
   'Collection Kids. Mélange apaisant de Copaïba, Lavande, Menthe verte et Zanthoxyle. Atténue les tensions. Masse sur les épaules, la nuque et le dos pour une sensation réconfortante.'],
  ['steady',          'dōTERRA Steady™',       'Mélange Kids',      '10 ml',  27.90,  20.93,  22.0,  null,
   'Collection Kids. Mélange équilibrant d\'Amyris, Sapin baumier, Coriandre et Magnolia. Procure une sensation de calme et rééquilibre l\'esprit. Applique sur les poignets pour favoriser la sérénité.'],
  ['brave',           'dōTERRA Brave™',        'Mélange Kids',      '10 ml',  37.98,  28.49,  30.0,  null,
   'Collection Kids. Mélange Courage d\'Orange douce, Amyris, Osmanthus et Cannelle de Ceylan. Formulé pour mieux gérer les inquiétudes. Utilise avant toute nouvelle situation pour courage et confiance.'],
  ['tamer',           'dōTERRA Tamer™',        'Mélange Kids',      '10 ml',  27.90,  20.93,  22.0,  null,
   'Collection Kids. Mélange digestif de Menthe verte, Menthe des champs et Gingembre. Procure un massage abdominal apaisant. Soulage l\'estomac après un repas copieux.'],
  ['whisper',         'dōTERRA Whisper™',      'Mélange',           '10 ml',  46.72,  35.04,  37.0,  null,
   'Applicateur à bille. Mélange de Jasmin, Ylang Ylang, Patchouli, Vanille, Cannelle de Ceylan et Cacao. Procure un parfum chaleureux et musqué. Applique sur les poignets et la nuque.'],

  // ─── COMPLÉMENTS (nouveaux) ────────────────────────────────────────────
  ['metapwr-advantage','MetaPWR™ Advantage',   'Complément',        '30 sachets', 126.53, 94.90, 113.5, null,
   'Contient neuf types de tripeptides de collagène et du NMN (nicotinamide mononucléotide). Le NAD+ assure le bon fonctionnement des cellules. Le collagène améliore l\'apparence de la peau.'],
  ['metapwr-assist',  'MetaPWR™ Assist',       'Complément',        '30 caps',  46.67,  35.00,  42.0,  null,
   'Contient extrait de feuilles de mûrier, berbérine, poudre d\'écorce de cannelle et le mélange MetaPWR. À prendre avant le repas le plus copieux de la journée.'],
  ['pb-restore',      'dōTERRA PB Restore™',   'Complément',        '30 caps',  65.07,  48.80,  null,  null,
   'Système de gélule à double paroi novateur protégeant les cultures bioactives. Synergie exclusive de 30 prébiotiques, probiotiques et postbiotiques. 28 souches de probiotiques différentes.'],
  ['pb-assist',       'PB Assist+™',           'Complément',        '30 sachets', 47.32, 35.49, null,  null,
   'ProBiome formulé pour toute la famille. Mélange de 13 souches probiotiques et d\'une fibre prébiotique (FOS). Favorise la colonisation des microorganismes qui garantissent un intestin en bonne santé.'],
  ['alpha-crs',       'Alpha CRS™+',           'Complément',        '120 caps', 104.52, 78.39, 94.0,  null,
   'Complexe de Vitalité Cellulaire. Formule exclusive associant des extraits botaniques naturels en concentrations puissantes. Contient des polyphénols puissants. À utiliser avec xEO Mega et Microplex VMz.'],
  ['microplex-vmz',   'Microplex VMz™',        'Complément',        '120 caps', 61.79,  46.35,  55.5,  null,
   'Complexe de Nutriments. Formule de vitamines et minéraux biodisponibles. Mélange équilibré de vitamines A, C, E et complexe B. Minéraux issus d\'aliments et oligo-éléments biologiques.'],
  ['xeo-mega',        'xEO Mega™',             'Complément',        '120 sgls', 85.12,  63.84,  76.5,  null,
   'Formule novatrice associant huiles essentielles CPTG et huiles riches en oméga 3 de la mer et de plantes. Apporte un spectre complet de caroténoïdes. Non végan (poisson).'],
  ['veo-mega',        'vEO Mega™',             'Complément',        '120 caps', 88.74,  66.55,  80.0,  null,
   'Version végane de xEO Mega. Associe huiles essentielles CPTG avec des acides gras essentiels oméga issus de plantes et d\'algues. Contient un extrait de microalgues caroténoïdes d\'astaxanthine.'],
  ['terrazyme',       'TerraZyme™',            'Complément',        '90 sgls',  56.85,  42.64,  51.0,  null,
   'Mélange exclusif d\'enzymes souvent insuffisantes dans l\'alimentation moderne. Te permet de profiter des bienfaits d\'une alimentation saine en assurant à ton corps les nutriments dont il a besoin.'],
  ['gx-assist',       'GX Assist™',            'Complément',        '60 sgls',  46.34,  34.75,  41.5,  null,
   'Associe huiles essentielles CPTG (Origan, Arbre à thé, Citron, Lemongrass, Menthe poivrée, Thym) et acide caprylique. À utiliser sur 10 jours avant la prise de PB Restore.'],
  ['ddr-prime-sgls',  'Gélules DDR Prime™',    'Complément',        '60 sgls',  64.55,  48.41,  51.0,  null,
   'Huiles essentielles d\'Encens, Orange douce, Litsée, Thym, Clou de girofle, Sarriette des montagnes, Niaouli et Lemongrass en gélules faciles à avaler.'],
  ['triease',         'Gélules TriEase™',      'Complément',        '60 sgls',  39.76,  29.82,  35.5,  null,
   'Chaque gélule contient des doses égales d\'huiles essentielles de Citron, Lavande et Menthe poivrée. Rapide et facile à administrer lors d\'événements en extérieur ou en déplacement.'],
  ['turmeric-dual',   'Gélules Curcuma Double','Complément',        '60 caps',  67.57,  50.68,  53.5,  null,
   'Première entreprise à associer l\'huile essentielle de Curcuma et l\'extrait de curcuma dans une gélule double. Crée une synergie puissante entre les turmérones et les curcuminoïdes.'],
  ['zengest-softgels','Gélules ZenGest™',      'Complément',        '60 sgls',  35.49,  26.62,  32.0,  null,
   'Les huiles essentielles du mélange ZenGest en gélules. Synergie de Gingembre, Menthe poivrée, Carvi, Coriandre et Anis. Contribuent à un soulagement doux et apaisant.'],
  ['zendocrine-sgls', 'Gélules Zendocrine™',   'Complément',        '60 sgls',  41.09,  30.82,  37.0,  null,
   'Mélange exclusif de Mandarine, Romarin, Géranium, Baies de Genièvre et Coriandre en gélules. Moyen rapide et facile d\'administrer le mélange Zendocrine en voyage.'],
  ['vmg-plus',        'VMG+™',                 'Complément',        '30 sachets', 130.14, 97.61, 117.0, null,
   'Complexe de nutriments alimentaires complets. Plus de 75 ingrédients de haute qualité dont fruits, légumes, enzymes digestives, probiotiques et huiles essentielles. Végan, sans OGM ni gluten.'],
  ['serenity-sgls',   'Gélules dōTERRA Serenity™','Complément',     '60 sgls',  40.75,  30.56,  36.5,  null,
   'Exploitent le pouvoir de l\'huile essentielle de Lavande, de la Valériane et de la Griotte pour favoriser une nuit apaisante et un repos de qualité.'],
  ['a2z-chewable',    'dōTERRA a2z Chewable™', 'Complément',        '60 tabs',  40.09,  30.07,  36.0,  null,
   'Formule exclusive pour les personnes ayant de la difficulté à avaler des capsules. Contient un mélange de vitamines B et de vitamines A, C et E. Saveur sucrée de pastèque. Pour toute la famille.'],
  ['iq-mega',         'IQ Mega™',              'Complément',        '150 ml',   56.20,  42.15,  50.5,  null,
   'Utilise l\'huile essentielle d\'Orange douce CPTG pour éliminer le goût de l\'huile de poisson. Apporte 1 300 mg de lipides marins purs avec 900 mg de DHA et 400 mg d\'EPA par portion.'],

  // ─── SOINS DE LA PEAU ──────────────────────────────────────────────────
  ['deep-blue-rub',   'Deep Blue™ Rub',        'Soin topique',      '120 ml',  61.19,  45.89,  48.5,  null,
   'Crème apaisante infusée avec le mélange Deep Blue. Produit préféré des sportifs. Formulée avec le mélange exclusif Deep Blue et d\'autres ingrédients puissants. Laisse la peau douce, sans film gras.'],
  ['deep-blue-stick', 'Stick dōTERRA Deep Blue™','Soin topique',    '48 g',    44.36,  33.28,  35.0,  null,
   'Infusé au mélange Deep Blue et aux vertus du Copaïba. Apporte un soulagement puissant et ciblé sous forme solide à action rapide. Séchage rapide pour application avant, pendant ou après le sport.'],
  ['correct-x',       'Correct-X™',            'Soin topique',      '15 ml',   23.87,  17.90,  19.0,  null,
   'Baume multi-usage qui nettoie la peau et l\'apaise tout en réparant les agressions. Idéal pour les peaux sensibles. Contient Encens, Hélichryse, Arbre à thé, Genévrier et Lavande.'],
  ['fractionated-coconut-oil', 'Huile de Coco Fractionnée', 'Accessoire', '115 ml', 25.88, 19.42, 20.5, null,
   'Idéale pour diluer les huiles essentielles en application locale. Émollient ultra léger. Intégralement soluble avec toutes les huiles essentielles. Inodore, incolore et ne tache pas.'],
]

let inserted = 0
let skipped = 0

for (const [sku, name, category, unit, retail, wholesale, pv, latin, desc] of newProducts) {
  // Vérifie si le SKU existe déjà
  const exists = await client.query(
    'SELECT id FROM catalog_products WHERE sku = $1 AND catalog_id = $2',
    [sku, CATALOG_ID]
  )
  if (exists.rowCount > 0) {
    console.log(`⏭ Déjà présent : ${sku}`)
    skipped++
    continue
  }

  await client.query(`
    INSERT INTO catalog_products
      (id, catalog_id, sku, name, category, unit, retail_price_eur, wholesale_price_eur, pv, latin_name, description, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
  `, [
    randomUUID(), CATALOG_ID, sku, name, category,
    unit, retail, wholesale, pv || null, latin || null, desc
  ])
  console.log(`✓ Inséré : ${name} (${sku})`)
  inserted++
}

console.log(`\nTerminé : ${inserted} produits insérés, ${skipped} déjà présents`)
} finally {
  await client.end()
}
