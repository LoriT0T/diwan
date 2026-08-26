/* Hikma — the dīwān inside the Dīwān.
 *
 * A dīwān is, before it is anything else, a collection of poetry. This hub
 * carried the name for months and contained none. This module repays the debt:
 * one line a day in the masthead — Qur'an, hadith, Mutanabbi, Shafi'i — chosen
 * to match the actual shape of the day rather than drawn from a hat.
 *
 * Selection is deterministic by date within the day's pool, so the line does
 * not reshuffle on every repaint; but the POOL follows the day's state, so a
 * heavy evening and a strong one read differently, a Friday reads like a
 * Friday, and a trip reads like the road.
 *
 * Sources are given exactly. Nothing here is decoration; every line was
 * chosen because it is true about the way he is trying to live.
 */

const h32 = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/* when-tags: any · begin (morning) · night · heavy (day going badly)
 * strong (day going well) · gymday · fri · trip · grind (deep-work stretch) */
const LINES = [
  { ar: 'أَحَبُّ الأَعْمَالِ إِلَى اللهِ أَدْوَمُهَا وَإِنْ قَلَّ',
    en: 'The most beloved of deeds to Allah are the most constant, even if small.',
    src: 'Hadith · Muslim', when: ['any', 'begin'] },
  { ar: 'أَلَا بِذِكْرِ اللهِ تَطْمَئِنُّ الْقُلُوبُ',
    en: 'Truly, in the remembrance of Allah do hearts find rest.',
    src: 'Qur’an · ar-Ra’d 13:28', when: ['begin', 'any'] },
  { ar: 'وَقُلِ اعْمَلُوا فَسَيَرَى اللهُ عَمَلَكُمْ',
    en: 'Say: act — for Allah will see your deed.',
    src: 'Qur’an · at-Tawbah 9:105', when: ['begin', 'grind'] },
  { ar: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    en: 'Truly, with hardship comes ease.',
    src: 'Qur’an · ash-Sharh 94:6', when: ['heavy'] },
  { ar: 'لَا تَقْنَطُوا مِن رَّحْمَةِ اللهِ',
    en: 'Do not despair of the mercy of Allah.',
    src: 'Qur’an · az-Zumar 39:53', when: ['heavy'] },
  { ar: 'لَئِن شَكَرْتُمْ لَأَزِيدَنَّكُمْ',
    en: 'If you are grateful, I will surely give you more.',
    src: 'Qur’an · Ibrāhīm 14:7', when: ['strong'] },
  { ar: 'إِنَّ اللهَ يُحِبُّ إِذَا عَمِلَ أَحَدُكُمْ عَمَلًا أَنْ يُتْقِنَهُ',
    en: 'Allah loves that when one of you does a thing, he does it with excellence.',
    src: 'Hadith · al-Bayhaqī', when: ['strong', 'grind'] },
  { ar: 'الْمُؤْمِنُ الْقَوِيُّ خَيْرٌ وَأَحَبُّ إِلَى اللهِ مِنَ الْمُؤْمِنِ الضَّعِيفِ',
    en: 'The strong believer is better, and more beloved to Allah, than the weak believer — and in both there is good.',
    src: 'Hadith · Muslim', when: ['gymday'] },
  { ar: 'عَلَى قَدْرِ أَهْلِ الْعَزْمِ تَأْتِي الْعَزَائِمُ • وَتَأْتِي عَلَى قَدْرِ الْكِرَامِ الْمَكَارِمُ',
    en: 'Resolves arrive in the measure of the resolute; noble deeds in the measure of the noble.',
    src: 'al-Mutanabbī', when: ['gymday', 'any'] },
  { ar: 'وَإِذَا كَانَتِ النُّفُوسُ كِبَارًا • تَعِبَتْ فِي مُرَادِهَا الْأَجْسَامُ',
    en: 'When souls are great, the body wearies in what they ask of it.',
    src: 'al-Mutanabbī', when: ['gymday'] },
  { ar: 'إِذَا غَامَرْتَ فِي شَرَفٍ مَرُومٍ • فَلَا تَقْنَعْ بِمَا دُونَ النُّجُومِ',
    en: 'If you venture for an honour worth the wanting, settle for nothing beneath the stars.',
    src: 'al-Mutanabbī', when: ['any', 'grind'] },
  { ar: 'بِقَدْرِ الْكَدِّ تُكْتَسَبُ الْمَعَالِي • وَمَنْ طَلَبَ الْعُلَا سَهِرَ اللَّيَالِي',
    en: 'Heights are earned in the measure of the toil; who seeks the summit keeps vigil through the nights.',
    src: 'attributed to ash-Shāfi’ī', when: ['grind', 'any'] },
  { ar: 'الْوَقْتُ كَالسَّيْفِ إِنْ لَمْ تَقْطَعْهُ قَطَعَكَ',
    en: 'Time is a sword: cut it, or it cuts you.',
    src: 'attributed to ash-Shāfi’ī', when: ['grind'] },
  { ar: 'اغْتَنِمْ خَمْسًا قَبْلَ خَمْسٍ: شَبَابَكَ قَبْلَ هَرَمِكَ، وَصِحَّتَكَ قَبْلَ سَقَمِكَ',
    en: 'Seize five before five: your youth before your old age, your health before your illness…',
    src: 'Hadith · al-Ḥākim', when: ['any', 'begin'] },
  { ar: 'وَجَعَلْنَا نَوْمَكُمْ سُبَاتًا',
    en: 'And We made your sleep for rest.',
    src: 'Qur’an · an-Naba’ 78:9', when: ['night'] },
  { ar: 'فَإِذَا قُضِيَتِ الصَّلَاةُ فَانتَشِرُوا فِي الْأَرْضِ وَابْتَغُوا مِن فَضْلِ اللهِ',
    en: 'When the prayer is done, disperse through the land and seek of the bounty of Allah.',
    src: 'Qur’an · al-Jumu’ah 62:10', when: ['fri'] },
  { ar: 'سَافِرْ فَفِي الْأَسْفَارِ خَمْسُ فَوَائِدَ',
    en: 'Travel — for in journeys there are five gains.',
    src: 'attributed to ash-Shāfi’ī', when: ['trip'] },
  { ar: 'قُلْ سِيرُوا فِي الْأَرْضِ فَانظُرُوا كَيْفَ بَدَأَ الْخَلْقَ',
    en: 'Say: travel through the earth and see how He began creation.',
    src: 'Qur’an · al-’Ankabūt 29:20', when: ['trip'] },
  { ar: 'خَيْرُكُمْ خَيْرُكُمْ لِأَهْلِهِ',
    en: 'The best of you is the best to his family.',
    src: 'Hadith · at-Tirmidhī', when: ['trip', 'fri'] },
];

/* The day's shape, read from what is already known. `q` is the built queue
 * (may be null before first build); everything else is derived locally. */
export function lineFor(dateISO, q) {
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const tags = [];

  try {
    const af = JSON.parse(localStorage.getItem('afaq.v1') || 'null');
    if ((af?.trips || []).some(t => t.from <= dateISO && t.to >= dateISO && t.status !== 'idea'))
      tags.push('trip');
  } catch { /* no afaq on this device — the day is read without it */ }

  if (now.getDay() === 5) tags.push('fri');

  if (!tags.includes('trip')) {
    try {
      // Compound's own schedule decides what a gym day is.
      const sched = JSON.parse(localStorage.getItem('compound.v1') || 'null');
      // The schedule ships in data.js, not storage — a workout task in the queue is the truer signal.
      if (q && q.all && q.all.some(t => t.domain === 'workout')) tags.push('gymday');
      void sched;
    } catch { /* absent is fine */ }
  }

  if (q && (q.doneCount + q.openCount) > 0) {
    const total = q.doneCount + q.openCount;
    if (hour >= 17 && q.doneCount / total >= 0.75) tags.push('strong');
    if (hour >= 17 && q.doneCount / total < 0.35) tags.push('heavy');
  }
  if (hour < 10) tags.push('begin');
  if (hour >= 21.5) tags.push('night');
  if (hour >= 10 && hour < 17) tags.push('grind');
  tags.push('any');

  /* First tag with a non-empty pool wins — the list above is priority order. */
  for (const tag of tags) {
    const pool = LINES.filter(l => l.when.includes(tag));
    if (pool.length) return pool[h32(dateISO + ':' + tag) % pool.length];
  }
  return LINES[0];
}
