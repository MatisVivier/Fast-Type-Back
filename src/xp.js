// Courbe simple et modifiable : XP pour passer de L -> L+1
export function xpForLevel(level) {
  // 100, 150, 200, 250, ...
  return 100 + (level - 1) * 50;
}

// À partir d'un total d'XP, calcule le niveau courant et la progression dans ce niveau
export function levelFromXp(totalXp = 0) {
  let xp = Math.max(0, totalXp | 0);
  let level = 1;
  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level++;
    if (level > 10000) break; // garde-fou
  }
  const need = xpForLevel(level);
  const inLevel = xp; // XP déjà acquis dans le niveau courant
  const progress = need ? inLevel / need : 1;
  return { level, inLevel, need, progress, total: totalXp | 0 };
}

// Gain XP pour un match classé (plus généreux si victoire)
export function gainRanked(stats = {}, isWin = false) {
  const wpm = Math.max(0, stats.wpm | 0);
  const accPct = Math.round((stats.acc || 0) * 100); // stats.acc est 0..1
  const base = isWin ? 60 : 25;
  const wpmBonus = Math.min(40, Math.floor(wpm / 5));
  const accBonus = Math.floor(accPct / 10); // 0..10 pts
  const total = base + wpmBonus + accBonus;
  return Math.max(10, Math.min(120, total));
}

// Gain XP pour une run solo (plus faible)
export function gainSolo(stats = {}) {
  const wpm = Math.max(0, stats.wpm | 0);
  const accPct = Math.round((stats.acc || 0) * 100);
  const durS = Math.round((stats.elapsed || 0) / 1000);
  const base = 12;
  const wpmBonus = Math.min(25, Math.floor(wpm / 8));
  const accBonus = Math.floor(accPct / 20); // 0..5 pts
  const durBonus = Math.min(10, Math.floor(durS / 30));
  const total = base + wpmBonus + accBonus + durBonus;
  return Math.max(5, Math.min(60, total));
}
