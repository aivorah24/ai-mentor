/**
 * scripts/generate-scene-images.js
 * Batch-generates all scene images for every chapter using Gemini API.
 * Run: node scripts/generate-scene-images.js
 * Run single chapter: node scripts/generate-scene-images.js --ch 3
 *
 * Images saved to: server/data/images/scenes/ch<N>/scene_<NN>.png
 * Already-existing images are skipped (safe to re-run).
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { generateImage } = require('../services/gemini');

if (!process.env.GEMINI_API_KEY) {
  console.error('ERROR: GEMINI_API_KEY not set in server/.env');
  process.exit(1);
}

// ── Image prompts for every chapter scene ────────────────────────────────────
const SCENE_IMAGES = {

  3: { // Give and Take — Addition & Subtraction
    2: 'Bright cartoon illustration: cheerful Indian girl Nandini at desk with open stamp collection album showing colourful stamps, friend Chirag handing her more stamps, both smiling, warm home setting, no text, white background',
    3: 'Bright cartoon illustration: column addition layout with three rows of colourful number blocks for ones tens hundreds columns, bold arrows pointing to each column, friendly cartoon digit faces, no text, white background',
    4: 'Bright cartoon illustration: carrying over in addition — a small number "1" with wings flying from ones column to tens column, cheerful cartoon digit blocks, bold primary colours, white background',
    5: 'Bright cartoon illustration: Indian girl with colourful bangles, counting two groups of bangles on a mat, joyful expression, Indian home with rangoli in background, no text, white background',
    6: 'Bright cartoon illustration: cheerful Indian mango vendor at colourful outdoor market stall, large basket of yellow-orange mangoes, woman customer picking up mangoes, vibrant Indian bazaar, no text, white background',
    7: 'Bright cartoon illustration: number line drawn on ground like hopscotch grid, cheerful green frog jumping forward three spaces, bold numbered squares 0 through 10, primary colours, no text, white background',
    8: 'Bright cartoon illustration: number line with bouncy red rabbit jumping backward four spaces, purple backward jump arcs drawn above the line, bold numbered squares 0 through 10, white background, no text',
    9: 'Bright cartoon illustration: Indian boy Chirag with stamp collection book showing many stamps, handing some to a friend, warm colours, subtraction concept visible through two piles of stamps, no text, white background',
    10: 'Bright cartoon illustration: subtraction with borrowing — a large tens block leaning over sharing with a small ones block, both blocks with cartoon friendly faces, generous and grateful expressions, bold colours, white background',
    11: 'Bright cartoon illustration: colourful Indian mela (fair) stall with snacks and bangles, vendor counting items in groups of ten, happy crowd, vibrant festival atmosphere, no text, white background',
  },

  4: { // Long and Short — Measurement
    2: 'Bright cartoon illustration: Indian child spreading hand wide on a wooden desk showing hand-span measurement, dotted arc showing the span width, pencil box beneath for comparison, warm classroom, no text, white background',
    3: 'Bright cartoon illustration: Indian child showing arm from elbow to fingertip with dotted arc showing cubit measurement, colourful bracelet on wrist, smiling face, bright classroom, no text, white background',
    4: 'Bright cartoon illustration: child walking heel-to-toe across classroom floor, numbered footprints 1 through 8 on the floor, happy expression, colourful tiles, no text, white background',
    5: 'Bright cartoon illustration: two rulers side by side one short one long, children of different heights agreeing on using the longer one, primary colours showing comparison, no text, white background',
    6: 'Bright cartoon illustration: colourful pencil placed flat on a ruler starting at zero end, cheerful cartoon ruler, child-friendly bright colours, measurement concept clear, no text, white background',
    7: 'Bright cartoon illustration: two ribbon strips side by side — one longer red ribbon and one shorter blue ribbon — both beside a ruler showing measurement, comparison arrows, bright colours, white background',
    8: 'Bright cartoon illustration: decorated Indian classroom with colourful paper streamers, two children and teacher measuring ribbon with a metre tape for class party decorations, festive setting, no text, white background',
    9: 'Bright cartoon illustration: two Indian children standing back to back — taller boy and shorter girl — with dotted height lines going up, happy expressions, school uniforms, no text, white background',
    10: 'Bright cartoon illustration: large door next to smaller window on Indian home exterior, bold measurement arrows showing width comparison, bright cheerful colours, no text, white background',
    11: 'Bright cartoon illustration: cheerful Indian children measuring various classroom objects (desk, water bottle, book, eraser) with rulers, each child smiling, warm school atmosphere, no text, white background',
  },

  6: { // How Much Can You Carry? — Weight & Mass
    2: 'Bright cartoon illustration: colourful Indian mela (fair) with a large traditional balance scale in foreground, festival stalls and banners behind, friendly shopkeeper, vibrant colours, no text, white background',
    3: 'Bright cartoon illustration: classic balance scale with a heavy bag of rice on left pan tilting down, lighter bag of sugar on right pan tilting up, clear visual tilt, bold primary colours, white background, no text',
    4: 'Bright cartoon illustration: ancient Indian market scene, person placing different sized stones and pebbles on a traditional balance scale, clay pots and woven baskets around, curious child watching, no text, white background',
    5: 'Bright cartoon illustration: metal weighing pieces in a line smallest to largest — tiny 1g disc, small 10g disc, medium 100g cylinder, large 500g cylinder, biggest 1kg block — all with friendly cartoon faces, silver gold colours, white background',
    6: 'Bright cartoon illustration: cheerful Indian vegetable vendor at market stall placing fresh red tomatoes on one pan of balance scale with a standard weight on other pan, scale perfectly balanced, no text, white background',
    7: 'Bright cartoon illustration: row of common Indian objects arranged by approximate weight — single mango, 1L water bottle, school bag, big watermelon — size increasing left to right, bright colours, no text, white background',
    8: 'Bright cartoon illustration: Indian child happily helping mother at vegetable market, one hand holding bag of onions one hand holding bag of potatoes, colourful market stalls in background, no text, white background',
    9: 'Bright cartoon illustration: three cheerful Indian children at mela stall each carrying differently sized bags, festive fair background with lights and bunting, joyful expressions, no text, white background',
    10: 'Bright cartoon illustration: a 1kg standard weight block next to a bag labelled with 1000 small dots representing 1000 grams, bold equals sign between them, cheerful cartoon style, white background, no text',
    11: 'Bright cartoon illustration: balance scale tilted with heavy brick on one side and light feather on other, then second scale perfectly level with equal weights on both sides, clear visual contrast, white background, no text',
  },

  7: { // Time Goes On — Time
    2: 'Bright cartoon illustration: large cheerful clock face with hour hand and minute hand clearly shown with bold arrows, numbers 1 to 12 around the face in bold colours, friendly clock face with eyes and smile, white background, no text',
    3: 'Bright cartoon illustration: clock face showing 7 o\'clock with minute hand pointing up and hour hand on 7, next to cheerful Indian girl Hetal in pyjamas stretching and waking up, golden morning sunlight through window, no text, white background',
    4: 'Bright cartoon illustration: clock face showing half past 8 with minute hand pointing down and hour hand between 8 and 9, next to Indian girl eating idli and chutney breakfast, warm kitchen, no text, white background',
    5: 'Bright cartoon illustration: left side shows bright sunny sky with morning activities (child going to school eating breakfast), right side shows moon and stars with evening activities (dinner playing sleeping), bold dividing line at noon, no text, white background',
    6: 'Bright cartoon illustration: colourful timeline of an Indian girl\'s daily schedule showing six circular activity illustrations from morning to night connected by arrows, school uniform and home setting visible, no text, white background',
    7: 'Bright cartoon illustration: seven colourful day tiles arranged in a circle like a week wheel, each tile a different bright colour, small cheerful cartoon sun moving around the circle, playful rhythmic layout, white background, no text',
    8: 'Bright cartoon illustration: calendar grid showing twelve months, each month represented by a small seasonal illustration — mango for summer, umbrella for monsoon, kite for winter, flowers for spring — bright Indian seasonal themes, no text, white background',
    9: 'Bright cartoon illustration: two child hands shown as closed fists, knuckles highlighted in yellow (long months) and valleys between knuckles highlighted in blue (short months), friendly visual memory trick, no text, white background',
    10: 'Bright cartoon illustration: two large clock faces — one showing 4 o\'clock and one showing 5 o\'clock — connected by a bold curved arrow labelled with one hour, Indian girl reading a book below, warm cosy home, no text, white background',
    11: 'Bright cartoon illustration: calendar page with three days highlighted — yesterday in blue, today in bright yellow, tomorrow in green — small fun activity icons on each day, cheerful layout, white background, no text',
  },

  8: { // Who is Heavier? — Weight & Mass
    2: 'Bright cartoon illustration: traditional Indian kirana (grocery) shop interior, large bronze pan balance scale on the counter, cheerful shopkeeper behind it, shelves of dals spices and jars in background, warm shop lighting, no text, white background',
    3: 'Bright cartoon illustration: pan balance scale with a red apple on the left pan tilting it down and an orange on the right pan raised up, both fruits have cheerful cartoon smiley faces, bright primary colours, white background, no text',
    4: 'Bright cartoon illustration: perfectly level balance scale with two identical biscuit packets one on each pan, both pans at exactly the same height, smiling balance beam, primary colours, white background, no text',
    5: 'Bright cartoon illustration: row of shiny metal weights in different sizes — tiny 1g disc, small 10g disc, medium 100g cylinder, large 500g cylinder, biggest 1kg block — all with friendly cartoon faces, silver and gold, white background, no text',
    6: 'Bright cartoon illustration: balance scale with a shiny metal 200g weight on one pan and fresh red tomatoes being carefully placed on the other pan, the scale beginning to level out, Indian market background, no text, white background',
    7: 'Bright cartoon illustration: two groups side by side — left group shows light objects (biscuit packet, letter envelope, small mango) and right group shows heavy objects (flour bag, watermelon, school bag) — bold dividing line, bright colours, white background, no text',
    8: 'Bright cartoon illustration: cheerful Indian child standing on a round weighing scale at a doctor\'s clinic, smiling doctor in white coat nearby, colourful charts on clinic wall, warm friendly atmosphere, no text, white background',
    9: 'Bright cartoon illustration: three objects in a row arranged by weight from lightest to heaviest — a lime on the left, a coconut in the middle, a packet of dal on the right — clear visual size weight comparison, bright colours, white background, no text',
    10: 'Bright cartoon illustration: open school bag with items floating out around it — maths book, science book, tiffin lunch box, and water bottle — each item shown at different sizes suggesting relative weight, bright primary colours, white background, no text',
    11: 'Bright cartoon illustration: four cartoon animals in a row from smallest to largest — tiny mouse, medium cat, larger dog, huge elephant — each standing on a progressively bigger weighing scale, playful expressions, bright colours, white background, no text',
  },

  9: { // How Many Times? — Multiplication
    2: 'Bright cartoon illustration: number line from 0 to 20 with colourful dots at 2 4 6 8 10, bold jump arcs connecting each dot in alternating colours, cheerful cartoon frog skipping on the even numbers, bright primary colours, white background, no text',
    3: 'Bright cartoon illustration: Raksha Bandhan scene — three happy Indian sisters each holding exactly four flowers (marigold or jasmine), flowers grouped in clear clusters of four, colourful dupattas and bangles, celebratory Indian setting, no text, white background',
    4: 'Bright cartoon illustration: three rows of five colourful dots each arranged in a neat grid, bold equals sign, arrow pointing to a single group of fifteen dots, visual showing repeated addition equals multiplication, primary colours, white background, no text',
    5: 'Bright cartoon illustration: number line from 0 to 15 with a cheerful cartoon kangaroo making three equal jumps of four spaces each, landing on 4, 8, 12, bold red jump arcs, numbered squares visible, white background, no text',
    6: 'Bright cartoon illustration: pairs of colourful socks arranged in groups — 1 pair (2 socks), 2 pairs (4 socks), 3 pairs (6 socks), 4 pairs (8 socks), 5 pairs (10 socks) — rainbow colours, visual skip counting, white background, no text',
    7: 'Bright cartoon illustration: cartoon hands being counted — one hand showing 5 fingers, two hands showing 10 fingers, three hands showing 15 fingers — clear groupings, brown warm skin tones, cheerful cartoon style, white background, no text',
    8: 'Bright cartoon illustration: Indian 10-rupee notes arranged in skip-count groups — 1 note, 2 notes, 3 notes, 4 notes, 5 notes — running total shown by size of pile, colourful currency notes, white background, no text',
    9: 'Bright cartoon illustration: four Diwali diya trays arranged in a 4 by 3 grid, each tray holding exactly three clay diyas with warm flickering flames, warm orange and yellow diya glow, festive dark background with sparkles, no text, white background',
    10: 'Bright cartoon illustration: three cheerful cartoon toy cars in a row, each car with exactly four clearly visible colourful wheels, wheels highlighted in bright colours, twelve wheels total visible, cartoon car faces smiling, white background, no text',
    11: 'Bright cartoon illustration: two columns showing multiplication by zero and by one — left column shows objects multiplied by zero resulting in empty boxes, right column shows same objects multiplied by one staying the same — bold visual contrast, white background, no text',
  },

  10: { // Play with Patterns — Patterns
    2: 'Bright cartoon illustration: a horizontal row of eight large circles alternating red and blue — red blue red blue red blue red then a circle with a question mark — bold primary colours, clean white background, no text',
    3: 'Bright cartoon illustration: traditional Indian rangoli design with beautiful repeating geometric pattern of triangles and circles in bold festival colours — red yellow green orange — symmetrical and vibrant, kolam style, no text, white background',
    4: 'Bright cartoon illustration: horizontal pattern row of alternating big yellow star and small yellow star — big small big small big small big then a shape with question mark — bold clear stars, white background, no text',
    5: 'Bright cartoon illustration: colourful staircase growing from ground level upward, each step one block taller than the last, cheerful cartoon child climbing the stairs, each step a different primary colour, growing pattern, no text, white background',
    6: 'Bright cartoon illustration: even numbers 2 4 6 8 10 each shown as neat pairs of colourful round dots being grouped together in twos, marbles or flower pairs, clear visual grouping, rainbow colours, white background, no text',
    7: 'Bright cartoon illustration: odd numbers 1 3 5 7 shown with colourful dot groups, one extra lone dot highlighted in bright yellow sitting apart from the pairs to show the leftover that makes it odd, white background, no text',
    8: 'Bright cartoon illustration: gold 5-rupee Indian coins arranged in growing groups — 1 coin then 2 coins then 3 coins then 4 coins — skip counting by 5, piles growing in size, shiny coin colours, white background, no text',
    9: 'Bright cartoon illustration: large bright sunflower with petals in visible spiral arrangement, small cartoon bee inspecting the spiral, next to a peacock feather showing its repeating eye pattern, nature patterns, no text, white background',
    10: 'Bright cartoon illustration: number sequence with one missing number in a bright dotted box — four colourful numbers in a row with an obvious gap — cartoon detective with magnifying glass hovering over the gap, bold numbers, white background, no text',
    11: 'Bright cartoon illustration: cheerful Indian child making a body movement pattern — clap stomp clap stomp — shown as four cartoon action frames in sequence with bold arrows between each frame, bright colours, white background, no text',
  },

  11: { // Jugs and Mugs — Capacity
    2: 'Bright cartoon illustration: four containers in increasing size — small glass, mug, jug, big bucket — all shown full of blue water, each a different primary colour, cheerful cartoon faces on each container, white background, no text',
    3: 'Bright cartoon illustration: water being poured from a small jug into a larger bowl, water overflowing the bowl showing the jug holds more, cheerful blue water droplets with smiling faces, white background, no text',
    4: 'Bright cartoon illustration: cheerful Indian milkman in white uniform carrying a large brass milk vessel, different sized measuring cups arranged beside him, family waiting at door in background, warm morning light, no text, white background',
    5: 'Bright cartoon illustration: standard 1-litre transparent water bottle showing the water level at exactly full, next to a smaller 500ml milk packet, both containers with friendly cartoon faces, clear blue water, white background, no text',
    6: 'Bright cartoon illustration: three containers in a row — a tiny chai glass (clearly much less than 1 litre), a standard 1-litre bottle (exactly full), and a large bucket (much more than 1 litre) — visual water level comparison, white background, no text',
    7: 'Bright cartoon illustration: four small glasses being poured one by one into a large jug, cheerful Indian child counting each pour on fingers — showing 1 2 3 4 — the fourth glass exactly filling the jug, bright colours, white background, no text',
    8: 'Bright cartoon illustration: row of Indian household containers from tiny to large — chai cup, water bottle, pressure cooker, big bucket, rooftop water tank — each with a happy face, clearly increasing in size, white background, no text',
    9: 'Bright cartoon illustration: cheerful colourful jug of mango juice pouring exactly one litre into a glass for a guest, jug still has juice remaining showing more than 1 litre inside, warm Indian home setting, no text, white background',
    10: 'Bright cartoon illustration: large cooking pot and a smaller jug beside it, cheerful Indian cook pouring the jug of water into the pot, pot partially filled with visible water level line, warm Indian kitchen, no text, white background',
    11: 'Bright cartoon illustration: four containers arranged in order from smallest to largest capacity — teaspoon, glass, jug, bucket — connected by a bold growing arrow underneath showing ascending capacity, each a different vibrant colour, white background, no text',
  },

  12: { // Can We Share? — Division & Fractions
    2: 'Bright cartoon illustration: two cheerful Indian girls Shabnam and Mukta in school uniforms sitting at lunch together, one girl carefully folding a large round paratha exactly in half, fold line clearly visible, warm school canteen, no text, white background',
    3: 'Bright cartoon illustration: large circle divided exactly down the middle into two equal halves, left half filled with bright yellow, right half white, bold dividing line, cheerful cartoon style, white background, no text',
    4: 'Bright cartoon illustration: round chapati being folded — first fold showing two equal halves, second fold showing four equal quarters — four cartoon frames showing the folding process, equal piece sizes clear, warm Indian kitchen, no text, white background',
    5: 'Bright cartoon illustration: square piece of paper being folded in half then quarters — first fold creates two equal halves, second fold creates four equal quarters — origami style cartoon frames, bright colours, white background, no text',
    6: 'Bright cartoon illustration: eight ripe yellow mangoes arranged in two perfectly equal groups of four, bold dashed line separating the two groups, one happy child on each side of the line, bright cheerful colours, no text, white background',
    7: 'Bright cartoon illustration: rectangular grid of colourful dots showing three rows of four dots each, bold lines dividing the grid to show both 3 times 4 and 4 times 3 are both 12, multiplication division connection, primary colours, white background, no text',
    8: 'Bright cartoon illustration: round pizza cut into four exactly equal slices, two slices with toppings (showing they were eaten), two perfect slices remaining, cheerful pizza with happy face before and during eating, bright colours, white background, no text',
    9: 'Bright cartoon illustration: ten small mango illustrations arranged in two perfectly equal rows of five, bold dividing line between the rows, red arrow pointing to one half showing equal sharing, bright yellow-orange mangoes, white background, no text',
    10: 'Bright cartoon illustration: two circles side by side — left circle divided into two very unequal pieces (one huge slice one tiny sliver) with a big red X — right circle divided into two perfectly equal halves with a green checkmark, clear contrast, white background, no text',
    11: 'Bright cartoon illustration: colourful Indian lunch spread with laddoos in two equal groups, a gulab jamun cut exactly in half, portions of halwa divided equally into two bowls, warm Indian food colours, equal sharing theme, no text, white background',
  },

  13: { // Smart Charts — Data Handling
    2: 'Bright cartoon illustration: large whiteboard showing tally marks being drawn in sequence — one line, two lines, three lines, four lines, then a bold diagonal slash creating a bundle of five — teacher\'s hand drawing the fifth mark, bold lines, white background, no text',
    3: 'Bright cartoon illustration: cheerful Indian classroom survey scene — teacher at front, excited children raising hands for their favourite fruit (mango banana apple), a tally table being filled on the blackboard, warm classroom, no text, white background',
    4: 'Bright cartoon illustration: completed tally table on paper showing four different fruits with tally marks beside each fruit, three clear columns in the table, colourful fruit illustrations beside each row, neat and organised, white background, no text',
    5: 'Bright cartoon illustration: colourful pictograph with rows of small fruit icons — mangoes bananas apples guavas — where each icon represents a number of students, clear rows, cheerful fruit icons in bright colours, white background, no text',
    6: 'Bright cartoon illustration: pictograph with a KEY box in the corner showing one small flower symbol, five rows of flower icons representing data, a magnifying glass cartoon character pointing to the key box, bold primary colours, white background, no text',
    7: 'Bright cartoon illustration: colourful bar chart showing fruit popularity — one bar is clearly the tallest and one bar is clearly the shortest — bars in different bright colours, cheerful fun chart with gridlines, white background, no text',
    8: 'Bright cartoon illustration: bar chart being constructed — rectangular bars of different heights in red blue green yellow — cheerful Indian child drawing the bars with a big crayon, gridlines drawn with ruler, white background, no text',
    9: 'Bright cartoon illustration: completed colourful bar chart showing favourite colours — green bar tallest, yellow bar shortest — bars in matching colours, cheerful numbered grid lines, clear visual comparison, white background, no text',
    10: 'Bright cartoon illustration: cartoon detective character with large magnifying glass examining a colourful bar chart, thought bubbles showing simple subtraction and addition being calculated from the data, bold bright colours, white background, no text',
    11: 'Bright cartoon illustration: cheerful Indian schoolchildren going to school four different ways — walking, riding in auto-rickshaw, on school bus, in car — each mode in a separate colourful lane, vibrant Indian morning scene, no text, white background',
  },

  14: { // Rupees and Paise — Money
    2: 'Bright cartoon illustration: four shiny Indian coins arranged in a row from smallest to largest — 1 rupee, 2 rupee, 5 rupee, 10 rupee — each coin with a cheerful cartoon face, silver and gold coin colours, size proportional to value, white background, no text',
    3: 'Bright cartoon illustration: Indian currency notes fanned out in a cheerful display — 10, 20, 50, 100, 500 rupee notes — each a different colour and increasing size, Gandhi silhouette visible, Indian tricolour colours, white background, no text',
    4: 'Bright cartoon illustration: large 1-rupee coin divided into 100 equal tiny segments showing paise concept, a 50-paise coin highlighted as exactly half of the full rupee, bold visual fraction layout, shiny coin texture, white background, no text',
    5: 'Bright cartoon illustration: Indian currency notes and coins laid out in neat organised groups — three 10-rupee notes in a row, two 5-rupee coins together, one 2-rupee coin separately — bold grouping circles around each denomination, white background, no text',
    6: 'Bright cartoon illustration: colourful Indian Surajkund fair food stall, Peter uncle in apron cheerfully serving samosas, a child paying with coins across the counter, festive fair banners and lights overhead, vibrant atmosphere, no text, white background',
    7: 'Bright cartoon illustration: Indian shopkeeper\'s hand accepting a note across the kirana store counter, other hand giving change coins back, a samosa or snack on the counter, colourful shelves with products behind the shopkeeper, no text, white background',
    8: 'Bright cartoon illustration: colourful Surajkund Mela fair scene with craft and toy stalls, excited child holding a toy car, happy parent paying with a currency note, festive lights and bunting overhead, joyful Indian fair atmosphere, no text, white background',
    9: 'Bright cartoon illustration: Indian vegetable market stall with three different vegetable piles (onions tomatoes potatoes), price tags of different sizes showing price comparison visually, colourful fresh vegetables, cheerful vendor, no text, white background',
    10: 'Bright cartoon illustration: shopping basket with four grocery items (rice bag, dal packet, oil bottle, salt packet), each item shown with a visual price tag, running total being added up, bright Indian kirana store setting, no text, white background',
    11: 'Bright cartoon illustration: Indian child carefully counting money on a table — one large currency note, two coin stacks — laid out neatly next to a small toy with a price tag, satisfied expression showing the amount is exactly right, no text, white background',
  },
};

// ── Main generation loop ──────────────────────────────────────────────────────
async function main() {
  const argCh = process.argv.find(a => a.startsWith('--ch='))?.split('=')[1];
  const chapters = argCh ? [parseInt(argCh)] : Object.keys(SCENE_IMAGES).map(Number);

  let totalOk = 0, totalSkip = 0, totalFail = 0;

  for (const ch of chapters) {
    const scenes = SCENE_IMAGES[ch];
    if (!scenes) { console.log(`Ch${ch}: no prompts defined, skipping`); continue; }

    console.log(`\nChapter ${ch}`);
    const dir = path.join(__dirname, `../data/images/scenes/ch${ch}`);
    fs.mkdirSync(dir, { recursive: true });

    for (const [sceneNum, prompt] of Object.entries(scenes)) {
      const fileName  = `scene_${String(sceneNum).padStart(2, '0')}.png`;
      const savePath  = path.join(dir, fileName);
      const servePath = `/data/images/scenes/ch${ch}/${fileName}`;

      process.stdout.write(`  scene_${String(sceneNum).padStart(2,'0')}.png ... `);

      if (fs.existsSync(savePath)) {
        console.log('SKIP (exists)');
        totalSkip++;
        continue;
      }

      const result = await generateImage({ prompt, savePath, servePath });
      if (result) {
        totalOk++;
      } else {
        console.log('FAILED');
        totalFail++;
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1500));
    }
  }

  console.log(`\nDone: ${totalOk} generated, ${totalSkip} skipped, ${totalFail} failed`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
