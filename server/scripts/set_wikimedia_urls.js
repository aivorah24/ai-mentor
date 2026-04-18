/**
 * Sets direct Wikimedia Commons URLs for Ramayana story images.
 * Source: Chitra Ramayana (1916) by Balasaheb Pant Pratinidhi — Public Domain
 * No download needed — images served directly from Wikimedia CDN.
 */
const fs   = require('fs');
const path = require('path');

const STORIES_PATH = path.join(__dirname, '../data/bhagavata_stories.json');
const stories = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));

// Direct Wikimedia Commons image URLs — Public Domain
const RAMA_SITA_PAGES = [
  'https://upload.wikimedia.org/wikipedia/commons/d/d7/Maruti_meets_Rama.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/f/f3/Kaikeyi_told_Dasharatha_that_he_must_fulfil_her_wish.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/d/d8/Guha%2C_King_of_the_hunter_tribe_%28Nishadas%29_helped_the_rama_and_his_companions_to_cross_the_river.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/d/d8/Angry_Ravana_drawing_his_sword_rushed_at_her_to_kill_Sita.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/c/c8/Building_a_Bridge_to_Sri_Lanka.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/9/9d/Killing_of_Rawana_Painting_by_Balasaheb_Pant_Pratinidhi.jpg',
];

const HANUMAN_PAGES = [
  'https://upload.wikimedia.org/wikipedia/commons/c/cb/Hanuman_Mistakes_the_Sun_for_a_Fruit.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/a/a6/Hanuman_leapt_with_all_his_might_from_the_top_of_Mahendra_Hill.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/5/52/Hanuman_Encounters_Sita_in_Ashokavana.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/c/cd/Hanuman_set_all_Lanka_on_fire.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/8/83/Hanuman_returns_with_sanjeevani_mountain_for_laxmana%27s_life.jpg',
];

// Update Rama and Sita
const ramaSita = stories.find(s => s.id === 'ramayana_rama_sita');
if (ramaSita) {
  ramaSita.coverImageUrl = RAMA_SITA_PAGES[0];
  ramaSita.pages.forEach((p, i) => { p.imageUrl = RAMA_SITA_PAGES[i] || RAMA_SITA_PAGES[0]; });
  console.log('Updated ramayana_rama_sita —', ramaSita.pages.length, 'pages');
}

// Update Hanuman
const hanuman = stories.find(s => s.id === 'hanuman');
if (hanuman) {
  hanuman.coverImageUrl = HANUMAN_PAGES[0];
  hanuman.pages.forEach((p, i) => { p.imageUrl = HANUMAN_PAGES[i] || HANUMAN_PAGES[0]; });
  console.log('Updated hanuman —', hanuman.pages.length, 'pages');
}

fs.writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2));
console.log('\nDone! Direct Wikimedia URLs set — no download or Cloudinary needed.');
