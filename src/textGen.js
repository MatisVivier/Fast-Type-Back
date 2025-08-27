// Petite liste FR (~200+) de mots fréquents (tu peux l’étoffer)
export const WORDS_FR = [
  "le","la","les","un","une","des","et","ou","mais","donc","or","ni","car",
  "je","tu","il","elle","on","nous","vous","ils","elles",
  "être","avoir","faire","dire","pouvoir","aller","voir","savoir","vouloir","venir","devoir","prendre","trouver","donner","parler","mettre","passer","aimer","penser","croire","connaître","comprendre","sembler","rester","vivre","porter","arriver","devenir","sentir","tenir","partir","rendre","laisser","revenir","regarder","appeler","tomber","attendre","sortir","entrer","reprendre","suivre","écrire","lire","apprendre","jouer","travailler","demander","répondre","commencer","finir","ouvrir","fermer","recevoir","marcher","courir","changer","utiliser","poser","montrer","offrir","perdre","gagner","créer","compter","payer","acheter","vendre","choisir","essayer","valoir","manquer","expliquer","écouter","entendre","boire","manger","cuisiner","préparer","dormir","réveiller","lever","asseoir","rire","sourire","pleurer","tomber","monter","descendre","tourner","arrêter","continuer","chercher","trouver","garder","oublier",
  "maison","école","travail","ville","pays","monde","jour","nuit","matin","soir","heure","minute","seconde","semaine","mois","année","temps","histoire","exemple","groupe","famille","ami","enfant","fille","garçon","femme","homme","personne","gens","route","chemin","main","tête","idée","question","réponse","moment","partie","côté","place","point","mot","langue","texte","livre","musique","film","jeu","sport","internet","ordinateur","téléphone","image","photo",
  "petit","grand","jeune","vieux","nouveau","premier","dernier","autre","même","beau","joli","fort","faible","rapide","lent","froid","chaud","clair","sombre","simple","difficile","possible","vrai","faux","long","court","proche","loin","haut","bas",
  "très","trop","bien","mal","déjà","encore","toujours","souvent","parfois","rarement","ici","là","ailleurs","partout","beaucoup","peu","assez","moins","plus","ensemble","seulement","vraiment","presque","exactement","simplement",
  "avec","sans","sous","sur","dans","entre","chez","devant","derrière","avant","après","pendant","pour","par","vers","contre","chez","près","loin","depuis","jusqu","grâce","selon","parmi",
  "bonjour","salut","merci","s’il","s'il","vous","plaît","pardon","excusez","bravo","d’accord","ok","oui","non"
];

// RNG déterministe (Xorshift32) pour un seed donné (utile en 1v1)
export function seededRng(seed) {
  let x = (seed >>> 0) || 123456789;
  return function () {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) / 4294967296);
  };
}

export function randomWords(count = 80, rng = Math.random) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const w = WORDS_FR[Math.floor(rng() * WORDS_FR.length)];
    out.push(w);
  }
  return out.join(' ');
}

// Génère un “texte” de n mots avec seed (pour être identique pour 2 joueurs)
export function generateMatchText(seed, count = 80) {
  const rng = seededRng(seed);
  const content = randomWords(count, rng);
  return { id: `words_${seed}_${count}`, content };
}
