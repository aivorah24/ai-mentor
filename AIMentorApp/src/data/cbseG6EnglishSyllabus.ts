/**
 * cbseG6EnglishSyllabus.ts
 * Curated, chapter-accurate syllabus for CBSE / NCERT Grade 6 English —
 * "Poorvi". Verified directly against the official NCERT source PDFs
 * (fepr101–fepr105.pdf) rather than the raw ingested Qdrant chunks, which
 * were found to mix in image captions and over-granular sub-concepts as
 * flat "topics" (see curriculum ingestion investigation, Jul 2026).
 *
 * This is the CBSE Grade 6 English pilot for the textbook-first Learning
 * Path redesign. Other subject/grade/curriculum combinations still fall
 * back to the flat topic list until they get the same curated treatment.
 */

export interface SyllabusTopic {
  name:  string;
  kind:  string;   // Story / Poem / Conversation / Non-fiction / Letter / Real-life story
  page:  string;
  done?: boolean;
  // Real book PDF location — only set once the exact file+page has been
  // verified against the source PDF (don't guess; a wrong page here would
  // reintroduce the same content-mismatch problem we fixed earlier).
  pdfFile?: string;   // e.g. 'fepr101.pdf', served from /data/ncert_books/grade6/english/
  pdfPage?: number;   // verified PDF page number (1-indexed, matches the file's own page numbering)
  readText: {
    intro: string;
    body:  string[];   // paragraphs
    figureUrl?: string;      // real page image, extracted from the source PDF, hosted on Cloudinary (kept for back-compat = figures[0])
    figureCaption: string;
    // Gallery of real chapter illustrations shown in the Learn panel. Preferred
    // over the single figureUrl when present; falls back to figureUrl if empty.
    figures?: { url: string; caption?: string }[];
    activity: string;
    // Optional Listen-tab enrichment — only curated for a few pilot stories so
    // far; the Listen tab falls back to the plain player when these are absent.
    listenParts?: ListenPart[];
    vocab?: VocabWord[];
  };
}

// One "part" of the read-aloud — a heading + its own paragraph, an optional
// "What is happening?" plain-language summary, and an optional check-for-
// understanding question shown once the part finishes playing.
export interface ListenPart {
  heading: string;
  text:    string;
  keyIdea?: string;
  pauseThink?: {
    question: string;
    options:  string[];
    correctIndex: number;
  };
}

export interface VocabWord {
  word: string;
  definition: string;
  imageUrl?: string;
}

export interface SyllabusChapter {
  title:      string;   // Unit title as printed in the textbook
  comingSoon?: boolean;
  topics:     SyllabusTopic[];
}

export const CBSE_G6_ENGLISH_SYLLABUS: SyllabusChapter[] = [
  {
    title: 'Fables and Folk Tales',
    topics: [
      {
        name: 'A Bottle of Dew', kind: 'Story', page: 'p.1', pdfFile: 'fepr101.pdf', pdfPage: 1,
        readText: {
          intro: 'By Sudha Murty. A fable about a landlord who chases a magic potion instead of tending his own land — until a wise sage teaches him where real wealth comes from.',
          body: [
            'Rama Natha inherits a lot of land from his father, but he\'d rather chase rumours of a magic potion that turns things into gold than actually farm it — much to his wife Madhumati\'s worry.',
            'A traveling sage offers him a "recipe" for the potion: plant banana trees and collect their morning dew, by hand, every winter, for years.',
            'Rama Natha takes the challenge seriously — and without quite realising it, spends six years building a genuinely thriving banana plantation, which Madhumati sells at the market all along.',
            'When the "potion" predictably fails to turn anything to gold, the sage reveals the real gold: the money the family earned from years of honest farming and selling. There was never any magic — just the plantation Rama Natha had built with his own hands.',
            'Rama Natha takes the lesson to heart, and keeps working the land — this time knowing exactly why it pays off.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434383/ncert_images/ncert/g6/english/fepr1_ch01_p4_i0.png',
          figureCaption: 'Rama Natha with his banana plantation.',
          activity: 'Describe one "shortcut" you\'ve been tempted to take instead of doing the real work — what happened?',
          listenParts: [
            {
              heading: 'Rama Natha\'s Idea',
              text: 'I Rama Natha was the son of a rich landlord. His father left him large tracts of land when he died. But Rama Natha did not spend even one day looking after his land. This was because he had a funny idea—he believed there was a magic potion that could turn any object into gold. He spent all his time to learn more about this potion. People cheated him often, promising to tell him about it, but he did not give up . His wife, Madhumati, was tired of this and also worried because she saw how much money Rama Natha was spending. She was sure that soon they would be without money. One day, a famous sage called Mahipati came to their town.',
              keyIdea: 'Rama Natha believes in a magic potion to turn objects into gold.',
            },
            {
              heading: 'The Sage\'s Advice',
              text: 'Rama Natha became his follower and asked him about the potion. To his surprise the sage answered, “Yes, in my travels in the Himalayas, I heard how you could make such a potion. But it is difficult.” “Tell me!” requested Rama Natha, not believing his luck. “You have to plant a banana plant and water it regularly with your hands. In winter, the morning dew is on the leaves. You have to collect the dew and store it in a bottle. When you have five litres of dew, bring it to me. I will chant some magic words, which will turn it into the magic potion.',
              keyIdea: 'The sage tells Rama Natha how to make the magic potion, but it\'s difficult.',
            },
            {
              heading: 'Rama Natha\'s Plan',
              text: 'A drop of the potion will change any object into gold.” large tracts of land : large areas of land potion : a liquid with magical properties give up : stop trying dew : small drops of water on leaves that form during night chant : to repeat or sing a word or phrase Rama Natha was worried. “But winter is only for a few months. It will take me years to collect five litres of dew.” “You can plant as many banana plants as you want. But remember, you must look after them yourself and collect the dew with your own hands.” Let us discuss 1. What did Rama Natha believe? 2. How did the sage help Rama Natha? 3.',
              keyIdea: 'Rama Natha decides to plant banana plants to collect dew for the potion.',
              pauseThink: { question: 'Why does Rama Natha want to plant banana plants?', options: ['To make the potion', 'To sell the fruits', 'To look after the land'], correctIndex: 2 },
            },
            {
              heading: 'Collecting Dew',
              text: 'Do you think Rama Natha will be able to collect the dew? Give a reason. F ables and F olk T ales —G rade II Rama Natha went home, and after talking to his wife started cleaning his large fields, which had been lying empty all these years. There he planted rows and rows of banana plants. He tended them carefully and during the winter months collected the dew that formed on them with great care. His wife helped him too. Madhumati gathered the banana crop, took it to the market and got a good price for it. Over the years, Rama Natha planted more and more plants and they had a huge banana plantation. At the end of six years, he finally had his five litres of dew.',
              keyIdea: 'Rama Natha and his wife work hard to collect dew from the banana plants.',
            },
            {
              heading: 'The Magic Potion',
              text: 'tended : looked after F ables and F olk T ales Carefully, he took the bottle to the sage. The sage smiled and muttered something over the water. Then he returned the bottle and said, “Try it out.” Rama Natha sprinkled a few drops on a copper vessel and waited for it to turn to gold. To his surprise nothing happened! “This is cheating,” he told the sage. “I have wasted six precious years of my life.” But sage Mahipati only smiled and called Madhumati to come forward. She came with a big box. When she opened it, inside shined stacks of gold coins! Now the sage turned to the very surprised Rama Natha and said, “There is no magic potion that can turn things into gold.',
              keyIdea: 'Rama Natha takes the dew to the sage, who reveals the truth about the potion.',
              pauseThink: { question: 'Why is Rama Natha angry with the sage?', options: ['Because the sage didn\'t tell him about the potion earlier', 'Because the potion didn\'t work', 'Because the sage played a trick on him'], correctIndex: 3 },
            },
            {
              heading: 'The True Lesson',
              text: 'You worked hard on your land and created this plantation. While you looked after the trees, your wife sold the fruits in the market. That’s how you got this money. It was your hard work that created this wealth, not magic. If I had told you about this earlier, you would have not listened to me, so I played a trick on you.” Rama Natha understood the wisdom behind these words and worked even harder on his plantation from that day on. s udha M ur Ty muttered : spoke in a low voice wisdom : deep understanding precious : valuable Let us discuss 1. Why was Rama Natha angry? 2. How did Rama Natha and Madhumati create wealth? G rade',
              keyIdea: 'The sage teaches Rama Natha that hard work and effort create wealth, not magic.',
            },
          ],
          vocab: [
            { word: 'land', definition: 'a large area of ground' },
            { word: 'potion', definition: 'a liquid with magical properties' },
            { word: 'dew', definition: 'small drops of water on leaves that form during night' },
            { word: 'chant', definition: 'to repeat or sing a word or phrase' },
            { word: 'tended', definition: 'looked after' },
            { word: 'muttered', definition: 'spoke in a low voice' },
            { word: 'wisdom', definition: 'deep understanding' },
            { word: 'precious', definition: 'valuable' },
            { word: 'chant', definition: 'to repeat or sing a word or phrase' },
            { word: 'travels', definition: 'journeys or trips' },
          ],
        },
      },
      {
        name: 'The Raven and the Fox', kind: 'Poem', page: 'p.9', pdfFile: 'fepr101.pdf', pdfPage: 9,
        readText: {
          intro: 'By Jean de La Fontaine. A fable told in verse, about a raven flattered out of his dinner by a clever fox.',
          body: [
            'A raven sits on a branch with a tasty morsel in its beak. A fox spots it from below and, wanting the food for himself, starts showering the raven with compliments about its handsome looks and beautiful voice.',
            'Flattered, the raven can\'t resist proving the fox right — it opens its beak to sing, and the morsel drops straight down to the waiting fox.',
            'The fox trots off with an easy meal and a pointed piece of advice: sweet words aren\'t always sincere, and pride makes it easy to fall for them.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434387/ncert_images/ncert/g6/english/fepr1_ch01_p13_i0.png',
          figureCaption: 'Illustration: the fox looking up at the raven on the branch, textbook page 13.',
          activity: 'Tell a friend one nice thing about themselves — does it feel different when it\'s said just to be kind versus said honestly?',
          listenParts: [
            {
              heading: 'Mr Raven and Reynard the Fox Meet',
              text: 'Mr Raven was perched upon a limb, And Reynard the Fox looked up at him; F or the Raven held in his great big beak, A morsel the Fox would go far to seek. Said the Fox, in admiring tones: “My word! Sir Raven, you are a handsome bird. Such feathers! If you would only sing, The birds of these woods would call you King.” G rade The Raven, who did not see the joke, Forgot that his voice was just a croak. He opened his beak, in his foolish pride– And down fell the morsel the Fox had eyed. “Ha-ha!” laughed the Fox. “And now you know, Ignore sweet words that make you glow.',
              keyIdea: 'Mr Raven and Reynard the Fox meet and the Fox admires the Raven\'s appearance.',
            },
            {
              heading: 'The Fox Teaches the Raven a Lesson',
              text: 'Pride, my friend, is rather unwise; I’m sure this teaching is quite a surprise.” J ean de l a F onT aine Let us discuss I Fill in the blanks by choosing the correct option. 1. s tanza (i) Mr Raven is a __________. (bird/frog) (ii) The name of the fox is __________. (Raven/Reynard) (iii) Mr Raven had __________ in his beak. (a piece of food/ a bunch of leaves) 2. s tanza (i) The Fox calls the Raven a __________ bird. (foolish/good-looking) (ii) The Fox asks the Raven to __________. (dance/sing) (iii) The Raven and the Fox live in the __________. (trees/woods) 3. s tanza (i) The Raven ___________ that he croaked. (remembered/forgot) (ii) The Raven opened its beak to ___________. (eat/sing) (iii) The ___________ fell down. (food/Raven) 4.',
              keyIdea: 'The Fox laughs at the Raven\'s foolish pride and teaches him a lesson.',
              pauseThink: { question: 'Why did the Fox laugh at the Raven?', options: ['Because the Fox was hungry.', 'Because the Raven lost his food.', 'Because the Raven was too proud.'], correctIndex: 2 },
            },
            {
              heading: 'The Raven Learns a Valuable Lesson',
              text: 's tanza (i) The Fox ___________ at the Raven. (laughed/looked) (ii) It is not ___________ to be too proud of oneself. (wise/unwise) (iii) The Raven learnt a ______________. (lesson/teaching) F ables and F olk T ales II Read the poem again and match the words in Column A with their meanings in Column B. Check your answers with your teacher and classmates. Column A Column B 1. perched (i) a small piece of food 2. morsel (ii) looked with interest at something 3. seek (iii) feeling that you are better than others 4. pride (iv) sat on a branch 5. eyed (v) to look for something 6. limb (vi) a smaller area of forest with similar kind of trees 7. woods (vii) branch of a tree',
              keyIdea: 'As shown in the picture, the Raven learns that pride can lead to loss, and the Fox teaches him to be humble.',
            },
          ],
          vocab: [
            { word: 'pride', definition: 'feeling that you are better than others' },
            { word: 'admiring', definition: 'looking at something with interest and pleasure' },
            { word: 'morsel', definition: 'a small piece of food' },
            { word: 'perched', definition: 'sat on a branch' },
            { word: 'seek', definition: 'to look for something' },
            { word: 'tones', definition: 'the way someone speaks or sounds' },
            { word: 'limb', definition: 'a branch of a tree' },
            { word: 'woods', definition: 'a forest or a large area of trees' },
          ],
        },
      },
      {
        name: 'Rama to the Rescue', kind: 'Graphic story', page: 'p.14', pdfFile: 'fepr101.pdf', pdfPage: 14,
        readText: {
          intro: 'A comic-panel folktale (Amar Chitra Katha) about a husband and wife who hear a thief breaking in at night, and the village kotwal (watchman), Rama, who comes to their rescue.',
          body: [
            'Late at night, a husband and wife are startled awake by strange noises outside — someone is trying to break in.',
            'They call out, and Rama, the village kotwal (watchman), comes running the moment he hears his name. He quickly realises a thief has dug his way into the house.',
            'The villagers catch the thief and hand him over to Rama — his alertness and quick response solving a problem the frightened couple couldn\'t handle alone.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434417/ncert_images/ncert/g6/english/fepr1_ch01_p24_i1.png',
          figureCaption: 'Comic strip panel: Rama the kotwal hears his name being called and rushes to investigate, textbook page 24.',
          activity: 'Think of a time you or someone you know used quick thinking to solve a problem — what happened?',
        listenParts: [
            {
              heading: 'Introduction to Story',
              text: '—G rade Let us discuss I Circle the odd one. 1. The characters are: husband, wife, children 2. Who entered the house? guest, robber, Kotwal F ables and F olk T ales Let us discuss I Write whether True or False. 1. The man tells his plan to his wife. 2. The thief wants to know where they kept their jewels. —G rade Let us discuss 1. Along with your classmates, call out the name ‘Rama’– softly , loudly and very loudly. 2. What do you think will happen next in the story? F ables and F olk T ales Let us discuss I Work in pairs to match the words in Column A with the meanings in Column B.',
              keyIdea: 'The story \'Rama to the Rescue\' starts with some discussion questions and activities for the students.',
            },
            {
              heading: 'Story Continues',
              text: 'Check your answers by sharing them with your teacher and classmates. Column a Column b 1. wonder (i) in place of someone or something 2. yard (ii) carefully 3. chatter (iii) an area outside a building 4. instead (iv) talk for a long time about unimportant things 5. closely (v) maybe 6. perhaps (vi) a feeling of surprise a Mar C hiTra k aTha G rade II Fill in the boxes with suitable words as you read the story. R a M a T o TH e R es CU e Main Characters Problem s olution s etting o ther Characters',
              keyIdea: 'As shown in the picture, the story unfolds with the characters and their actions, and students are asked to fill in the boxes with suitable words as they read the story.',
              pauseThink: { question: 'What do you think will happen next in the story?', options: ['The thief will be caught by the Kotwal', 'The family will be in danger', 'The story will end with a happy note'], correctIndex: 0 },
            },
          ],
        vocab: [
            { word: 'wonder', definition: 'a feeling of surprise' },
            { word: 'yard', definition: 'an area outside a building' },
            { word: 'chatter', definition: 'talk for a long time about unimportant things' },
            { word: 'instead', definition: 'in place of someone or something' },
            { word: 'closely', definition: 'carefully' },
            { word: 'perhaps', definition: 'maybe' },
          ],
        },
      },
    ],
  },
  {
    title: 'Friendship',
    topics: [
      {
        name: 'The Unlikely Best Friends', kind: 'Story', page: 'p.22', pdfFile: 'fepr102.pdf', pdfPage: 1,
        readText: {
          intro: 'A narrative of a unique friendship between Gajaraj, an elephant, and Buntee, a dog.',
          body: [
            'On a quiet farm, an enormous elephant named Gajaraj and a tiny dog named Buntee formed a friendship nobody expected. Despite the vast difference in their size, the two became inseparable — playing, resting, and even eating together.',
            'The story highlights how empathy and companionship can bridge any difference, and how true friendship brings joy and comfort even in the most unexpected pairing.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434443/ncert_images/ncert/g6/english/fepr1_ch02_p5_i0.png',
          figureCaption: 'Illustration: Gajaraj the elephant and Buntee the dog resting side by side.',
          activity: 'Describe a friend of yours who is very different from you. What makes your friendship work?',
        listenParts: [
            {
              heading: 'Gajaraj\'s Sad Life',
              text: 'I Gajaraj, the elephant, lived in the best booth of the royal stables . The king was fond of Gajaraj, and he had ordered that the elephant should be well looked after. In spite of royal comforts, Gajaraj was sad because he had no friends. The mahout, or elephant trainer, was the only one he ever interacted with . The mahout was a kind man who served Gajaraj food, and gave him a bath in the elephant pond daily. He was a good caretaker, but not a friend. “I wish I had a friend I can play with,” thought Gajaraj. One late evening, a dog strayed into the stable. Gajaraj could see that the visitor was tired and hungry.',
              keyIdea: 'Gajaraj, an elephant, lives in the royal stables but feels sad because he has no friends.',
            },
            {
              heading: 'A New Friend Arrives',
              text: 'He pushed booth : rectangular space stables : living spaces for animals interacted with : communicated with strayed : came by mistake F riendship some of the food he was munching towards the dog. The visitor wagged his tail, looked up at the elephant to convey his thanks, and then turned his full attention to the food in front of him. As soon as he finished eating, he fell asleep. The next morning, the mahout found the stray dog in the stable. He did not mind the dog. He also noticed that Gajaraj seemed to like the company. So, he threw some crumbs to the dog, which the animal accepted wagging his tail. When the elephant went out for a bath, the dog accompanied his friend.',
              keyIdea: 'A stray dog enters the stables and is fed by Gajaraj, who seems to like the dog\'s company.',
            },
            {
              heading: 'Gajaraj and Buntee\'s Fun',
              text: 'Plunging into the water, the elephant gave himself a shower using his long trunk , as the dog watched. The elephant took a trunkful of water and playfully splashed the water on his friend. The dog yelped for he hated taking showers. The mahout laughed. munching : chewing wagged : moved from side to side convey : communicate accompanied : went with someone plunging : jumping in trunk : long nose yelped : cried splashed : threw crumbs : small pieces of food —G rade On their way home, the elephant picked up the dog with his trunk and placed him on his back. The dog was delighted to get a ride. A farmer passing by saw the dog. “Buntee,” he yelled. The dog ran to him.',
              keyIdea: 'Gajaraj and the dog, Buntee, play together in the elephant pond, with Gajaraj splashing water on Buntee.',
              pauseThink: { question: 'Why did the dog yelp when Gajaraj splashed water on him?', options: ['Because he was happy.', 'Because he hated taking showers.', 'Because he was scared.'], correctIndex: 1 },
            },
            {
              heading: 'Buntee\'s Home',
              text: 'The farmer hugged the dog and told the mahout that he was looking for his dog ever since he disappeared from his house. He was glad he found him now. The mahout had no objection to the farmer taking the dog home. The farmer tossed a rope round the neck of the dog, saying, “Come Buntee, let’s go home.” Let us discuss disappeared : was not seen delighted : happy hugged : held closely 1. Talk about the things that Gajaraj and Buntee did together. Now, write in the shapes given below. One has been done for you. Buntee and Gajaraj _____________ played 2. Why did the farmer hug Buntee? 3. Do you think Buntee will leave Gajaraj and go home with the farmer?',
              keyIdea: 'The farmer finds Buntee and takes him home, but Buntee seems unhappy about leaving Gajaraj.',
            },
            {
              heading: 'Gajaraj\'s Sadness',
              text: 'F riendship II Only when the farmer pulled the rope did the dog realise that he was being taken away from his friend. He yelped, the elephant winced , but neither the farmer nor the mahout noticed that the two friends were in tears. The next day at lunch time the mahout served Gajaraj his favourite food. When the mahout came back after finishing his other chores , he was surprised to see that the food had remained untouched. winced : shrunk back in pain or distress chores : daily duties realise : understand —G rade “Why Gajaraj, aren’t you hungry?” he asked concerned. The elephant did not react. “He may have slight indigestion . Let me not force him to eat,” thought the mahout.',
              keyIdea: 'Gajaraj stops eating his food because he misses his friend Buntee.',
              pauseThink: { question: 'Why did Gajaraj not eat his food?', options: ['Because he was not hungry.', 'Because he had indigestion.', 'Because he missed his friend Buntee.'], correctIndex: 2 },
            },
            {
              heading: 'Buntee Returns',
              text: 'That night too, Gajaraj did not touch his food—nor the next day. Now, the mahout was worried. He ran his hand on Gajaraj’s tummy and felt there was nothing wrong. “Why was he not eating then? Is he missing his friend, that dog?” the mahout wondered. Meanwhile at the farmer’s house, the dog had also not touched his food ever since he was brought home. “Are you missing your friend?” asked the farmer remembering the happy look on Buntee’s face while sitting on the elephant’s back. “I cannot see you go hungry,” said the farmer, “If you miss your friend so much, go to him.” The farmer removed the rope with which he had tied the dog.',
              keyIdea: 'Buntee runs back to the stables to be with Gajaraj, and they are reunited.',
            },
            {
              heading: 'Reunion and Happiness',
              text: 'The dog, though weak, tummy : stomach slight : a little indigestion : upset stomach F riendship sprang to his feet. He licked the farmer’s hand once and then ran. He stopped only when he arrived at the stable. The elephant picked up the dog with his trunk and gave him a joyous swing . The mahout was relieved . He quickly brought the food. “Both of you eat first,” he said. By then the farmer who had followed the dog, joined him. The two of them watched with satisfaction the two friends eating food. “It’s not only Gajaraj who has found a friend,” said the mahout hugging the farmer, “I’ve also found one.” s ubba r ao kathakids .',
              keyIdea: 'Gajaraj and Buntee are reunited, and the mahout and farmer are happy to see the two friends together.',
            },
            {
              heading: 'Lesson Learned',
              text: 'com satisfaction : happiness joyous : happy relieved : thankful swing : move side to side or back and forth sprang : jumped Let us discuss 1. Why did Gajaraj not eat his food? 2. Who were friends at the end of the story?',
              keyIdea: 'The story teaches us that friendship is important and that we should not take our friends for granted.',
            },
          ],
        vocab: [
            { word: 'booth', definition: 'a rectangular space in the royal stables where animals lived.' },
            { word: 'stables', definition: 'living spaces for animals in the royal stables.' },
            { word: 'strayed', definition: 'came by mistake into the royal stables.' },
            { word: 'wagged', definition: 'moved from side to side to show happiness.' },
            { word: 'accompanied', definition: 'went with someone.' },
            { word: 'plunging', definition: 'jumping into the water.' },
            { word: 'trunk', definition: 'a long nose used by an elephant to breathe and drink.' },
            { word: 'crumbs', definition: 'small pieces of food.' },
            { word: 'disappeared', definition: 'was not seen.' },
            { word: 'hugged', definition: 'held closely.' },
            { word: 'winced', definition: 'shrunk back in pain or distress.' },
            { word: 'chores', definition: 'daily duties.' },
            { word: 'realise', definition: 'understand.' },
            { word: 'slight', definition: 'a little.' },
            { word: 'indigestion', definition: 'an upset stomach.' },
            { word: 'swing', definition: 'a move side to side or back and forth.' },
            { word: 'sprang', definition: 'jumped.' },
          ],
        },
      },
      {
        name: "A Friend's Prayer", kind: 'Poem', page: 'p.31',
        readText: {
          intro: 'A poem reflecting on the significance of nurturing friendships.',
          body: [
            'Written as a gentle prayer, the poem asks not for wealth or fame, but for the steady presence of a true friend through both joy and hardship.',
            'Its simple, heartfelt lines encourage readers to value the people who stand by them, and to be that same kind of friend to others.',
          ],
          figureCaption: 'Illustration: two children walking together under a shared umbrella.',
          activity: 'Write one line of your own "friend\'s prayer" — what would you wish for a friend?',
        },
      },
      {
        name: 'The Chair', kind: 'Story', page: 'p.35', pdfFile: 'fepr102.pdf', pdfPage: 21,
        readText: {
          intro: 'A grandfather helps his grandson Mario tell the difference between real and superficial friends.',
          body: [
            'Mario is excited about a group of new friends who seem popular and fun — until his grandfather notices they only show up when it\'s convenient for them.',
            'Through a simple, memorable metaphor involving an old wooden chair, the grandfather teaches Mario how to recognise friends who are truly dependable versus those who are not.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434483/ncert_images/ncert/g6/english/fepr1_ch02_p36_i1.png',
          figureCaption: 'Illustration: Mario and his grandfather sitting beside the old chair.',
          activity: 'What was the grandfather\'s "chair" lesson? Explain it in your own words.',
        listenParts: [
            {
              heading: 'Mario\'s Bet with Grandpa',
              text: 'I There was a boy called Mario who loved to have lots of friends. He showed off a lot, always talking about how many friends he had at school, and how he was so friendly with everyone. One day his grandfather said to him, “Mario, I bet you a fruit chaat . You don’t have as many friends as you think you have. I’m sure many of them are nothing more than companions or partners.” Mario accepted the bet readily . However, he wasn’t sure how he could test whether his schoolmates were real friends or not. So, he asked his grandpa for help. He suggested, “I have exactly what you need. It’s in the attic .',
              keyIdea: 'Mario\'s grandfather challenges him to a bet about his friends.',
            },
            {
              heading: 'Grandpa\'s Special Chair',
              text: 'Wait here a minute.” Grandpa left, soon returning as though carrying something in his hand, but Mario could see nothing there. “Take it. It’s a very special chair. As it’s invisible , it’s rather tricky to sit on it. But if you take it to school and manage to sit on it, then attic : a storage space in a house just under the roof accepted : agreed to readily : without any problem showed off : boasted invisible : impossible to see F riendship the magic will work and you’ll be able to tell who your real friends are.” Let us discuss 1. Mario was very proud of having so many friends. State whether True or False. 2. What did the grandfather take from the attic? 3.',
              keyIdea: 'Grandpa gives Mario a special invisible chair to test his friends.',
            },
            {
              heading: 'Mario\'s Challenge at School',
              text: 'Will Mario face any challenges? 4. Will Mario be able to use the magic? II Mario, brave and determined , took the strange invisible chair and set off for school. At break time, he asked everyone to form a circle. He put himself in the middle, with his chair. “Nobody move. You’re about to see something amazing .” determined : firm in decision amazing : very surprising Mario tried sitting on the chair. Having difficulty seeing it, he missed and fell straight onto his backside. His classmates had a pretty good laugh. “Wait, wait, just a slight technical problem,” he said, trying again. But again, he missed the seat, causing more surprised looks and laughter. Mario wouldn’t give up.',
              keyIdea: 'Mario tries to sit on the invisible chair at school, but it\'s harder than he thought.',
              pauseThink: { question: 'Why did Mario\'s classmates laugh at him?', options: ['He was wearing a funny hat.', 'He fell onto his backside.', 'He was trying to sit on a chair that wasn\'t there.'], correctIndex: 2 },
            },
            {
              heading: 'The Magic of True Friendship',
              text: 'He kept trying to sit on the magic chair and kept falling to the ground until, suddenly, he tried again and didn’t fall. This time he sat, hanging in mid-air. Then he finally experienced the magic that his grandfather had been talking about. Looking around, Mario saw Guneet, Asma, and Deepa–three of his buddies—holding him up, so he wouldn’t fall. Meanwhile, many others experienced : felt F riendship he’d thought of as friends had done nothing but made fun of him, enjoying each and every fall. Leaving with his three friends, he explained to them how his grandfather had so cleverly thought of a way to show him that true friends are those who care for us. A friend wouldn’t be someone who takes joy in our bad luck.',
              keyIdea: 'Mario discovers that his true friends are those who help him, not those who laugh at him.',
            },
            {
              heading: 'Mario Wins the Bet',
              text: 'That evening the four children went to see Mario’s grandpa as he had won the bet. They had a great time listening to stories and eating a lot of fruit chaat . From then on, they used the magic chair test on many occasions and whoever passed became friends for life. Let us discuss 1. Mario successfully sat on the invisible chair on his first attempt. State whether True or False. 2. Fill in the blank with a suitable word. Mario’ s grandfather challenged him to a bet of __________. 3. Match the following characters with their action. Guneet, Asma and Deepa (i) held Mario up, so he wouldn\'t fall (ii) made fun of Mario’s attempts',
              keyIdea: 'Mario and his friends go to see Grandpa, who has won the bet, and they have a great time together.',
              pauseThink: { question: 'What did Mario\'s grandfather challenge him to?', options: ['A game of football.', 'A bet about his friends.', 'A test of his bravery.'], correctIndex: 1 },
            },
          ],
        vocab: [
            { word: 'attic', definition: 'a storage space in a house just under the roof' },
            { word: 'accepted', definition: 'agreed to' },
            { word: 'readily', definition: 'without any problem' },
            { word: 'invisible', definition: 'impossible to see' },
            { word: 'determined', definition: 'firm in decision' },
            { word: 'amazing', definition: 'very surprising' },
            { word: 'experienced', definition: 'felt' },
          ],
        },
      },
    ],
  },
  {
    title: 'Nurturing Nature',
    topics: [
      {
        name: 'Neem Baba', kind: 'Conversation', page: 'p.44', pdfFile: 'fepr103.pdf', pdfPage: 1,
        readText: {
          intro: 'A conversation between a child, Amber, and the grand old neem tree.',
          body: [
            'Amber sits beneath an ancient neem tree and, in an imaginative conversation, learns about all the ways the tree has quietly served the village for generations — shade, clean air, and traditional remedies.',
            'The neem tree "speaks" of its roots, leaves, and healing bark, helping Amber (and the reader) appreciate the quiet, generous role trees play in our lives.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434494/ncert_images/ncert/g6/english/fepr1_ch03_p1_i0.png',
          figureCaption: 'Illustration: Amber sitting under the wide branches of the neem tree.',
          activity: 'Name one tree near your home. What do you think it gives to your neighbourhood?',
        listenParts: [
            {
              heading: 'Amber Meets Neem Baba',
              text: 'Amber returned from school and sat down in the shade of the neem tree in her courtyard. She felt that the tree was whispering to her. She looked at the tree and spoke to the tree. i Amber : Namaste! I am Amber. I would lik e to talk to you. May I? Neem Baba : Sure, dear Amber. I know you. You played in my shade in your childhood. You may call me ‘Neem Baba’. Amber : I have seen you almost everywhere. Please tell me something more about yourself. Neem Baba : I am very old. I was born millions of years ago somewhere in North India or Myanmar. Soon, my family spread outside India. Amber : Outside India? Where else can neem be found?',
              keyIdea: 'Amber talks to a neem tree in her courtyard.',
            },
            {
              heading: 'Neem Baba\'s Origins',
              text: 'Neem Baba : My family can be found in many Asian and African countries and even in some parts of America. Amber : That’s wonderful! Who gave you your name? N urturi N g N ature Neem Baba : The story of my name is very thought-provoking . I was born in India and given Sanskrit names such as Arishta (the one who cures diseases), Nimba and Nimbaca . The name ‘Neem’ is given by the Iranians. Amber : Really? Neem Baba : Yes, in Hindi, my name is Nimb . In India, I have other names— Nim, Leemba, Nimori, Nimbamond, Nimbe and Nimo . Amber : You are so well known! Th at is wonderful. Neem Baba : Dear Amber, we become well known for what we do.',
              keyIdea: 'Neem Baba was born in North India or Myanmar millions of years ago.',
            },
            {
              heading: 'How Neem Got Its Name',
              text: 'People find us useful and that is why they know us. Scientists call us ‘bitter grace of God’, ‘nature’s gift to man’, and ‘cleanliness-parting tree’. Some even call us ‘magic tree’ and ‘the tree of the twentieth century’. thought- provoking : interesting grace : blessing Let us discuss Amber found many facts about the neem tree from Neem Baba. Fill up the fact sheet based on what Neem Baba told her. LET US KNOW OUR NEEM Common name: Given by: Period of birth: Born at: Found in: Common names: Names given by scientists: 1. 2. Names given by others: 1. 2. II Amber : I know that people clean their teeth with your twigs and protect clothes with your leaves.',
              keyIdea: 'Neem Baba\'s name comes from different cultures and languages.',
              pauseThink: { question: 'Why does Neem Baba have many names?', options: ['Because it is a very old tree.', 'Because it has many uses.', 'Because it was given names by different cultures.'], correctIndex: 3 },
            },
            {
              heading: 'Uses of Neem Leaves',
              text: 'Sometime back, when m y brother had measles , the doctor told us to put neem leaves on his bed and make him lie down on them. Can you explain why? Neem Baba : The doctors know that neem leaves have chemical properties that destroy germs. Measles causes itching all over the body . Neem leaves give comfort and do not allow germs to breed . Neem leaves, bark, flowers, fruits and even roots can be used to make medicines to cure many diseases. twigs : small thin branches measles : disease with fever and red spots on skin itching : feeling the need to scratch breed : grow N urturi N g N ature Amber : Yes, I once had a cough and I could not breathe properly .',
              keyIdea: 'Neem leaves have chemical properties that destroy germs and can be used to make medicines.',
            },
            {
              heading: 'Neem\'s Benefits for Farmers',
              text: 'My grandmother cured me with a medicine made from neem bark. And when my father had itching in the eyes, she prepared a kajal from neem flowers, which cured him. Neem Baba : Oh, little Amber, you know so much. Remember, these remedies are to be used only by people who are well trained and have a lot of experience. Amber : Yes, I will. Tell me Neem Baba, is there any use of neem for the farmers? Neem Baba : Yes. If the powder of neem seeds is mixed in water and spra yed on plants and trees, then locusts don’t eat them. If it is used in rice fields, where water remains standing, it stops mosquito breeding and helps to increase crop yield.',
              keyIdea: 'Neem seeds can be used to protect crops from insects and diseases.',
              pauseThink: { question: 'What is one way neem helps farmers?', options: ['It gives them shade.', 'It makes their crops grow faster.', 'It protects their crops from insects.'], correctIndex: 2 },
            },
            {
              heading: 'Other Uses of Neem',
              text: 'It also saves the crop from termites , which eat roots of the crop, and it also stops breeding of other insects that eat crops. Amber : Tha t means, if we put the powder of neem seeds in stagnant water around our homes, mosquitoes locusts : flying insects that damage crops termites : insects that damage wood and buildings stagnant : not flowing G raDE won’t breed in them! This must be a cost-effective method to stop mosquitoes from breeding. Please tell me other uses of neem in our daily life. Neem Baba : Of course. People save their stored grains from insects b y adding neem seed powder to them. Neem oil is also used to make soaps and toothpaste.',
              keyIdea: 'Neem oil, neem wood, and neem seeds have various uses in daily life.',
            },
            {
              heading: 'Conclusion and Thanks',
              text: 'Furniture made from neem wood is not eaten by termites. Neem also purifies the air. There are many qualities yet to be discovered. Will you discover them when you grow up? Amber : Yes, Neem Baba. I will. Thank you for your time today! Neem Baba : Bless you, my child! Adapted from Neem Baba by S. I. F arooqI purifies : removes harmful particles cost-effective : good outcome in least amount of resources Let us discuss 1. How is neem useful to farmers? 2. Mention some of the uses of the neem tree. n urTurI n G n aTurE',
              keyIdea: 'Amber thanks Neem Baba for sharing its many uses and qualities.',
            },
          ],
        vocab: [
            { word: 'neem', definition: 'a type of tree' },
            { word: 'bitter', definition: 'having a strong, unpleasant taste' },
            { word: 'grace', definition: 'a blessing or favor' },
            { word: 'birth', definition: 'the time when a person or thing is born' },
            { word: 'scientists', definition: 'people who study and research science' },
            { word: 'locusts', definition: 'flying insects that damage crops' },
            { word: 'termites', definition: 'insects that damage wood and buildings' },
            { word: 'stagnant', definition: 'not flowing or moving' },
            { word: 'purifies', definition: 'removes harmful particles' },
            { word: 'effective', definition: 'good outcome in least amount of resources' },
          ],
        },
      },
      {
        name: 'What a Bird Thought', kind: 'Poem', page: 'p.50', pdfFile: 'fepr103.pdf', pdfPage: 11,
        readText: {
          intro: 'An empathetic poem seen through the eyes of a little bird.',
          body: [
            'The poem imagines the world from a bird\'s perspective — the vastness of the sky, the smallness of human worries seen from above, and the simple freedom of flight.',
            'It gently nudges readers to see their surroundings with fresh, curious eyes, the way a bird might.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434505/ncert_images/ncert/g6/english/fepr1_ch03_p12_i0.png',
          figureCaption: 'Illustration: a small bird perched on a branch, looking out over rooftops.',
          activity: 'If you were a bird for a day, what would you most want to see from the sky?',
        listenParts: [
            {
              heading: 'The Bird\'s First Home',
              text: 'I l ived first in a little house, And lived there very well, I thought the world was small and round, And made of pale, blue shell. I lived next in a little nest, Nor needed any other, I thought the world was made of str aw, And nestled by my mother. One day , I fluttered from my nest, To see what I could find, I said the world is made of leaves, I have been very blind. At length I flew beyond the tree, Quite fit for grown-up labours, I don’t know how the world is made, And neither do my neighbours. a nonymouS N URTURI N G N ATURE Let us discuss I Read the poem again. Identify the main idea of each stanza.',
              keyIdea: 'The bird lived in a small house made of a pale blue shell.',
            },
            {
              heading: 'The Bird\'s Second Home',
              text: 'There are two extra sentences are given. 1. The bird steps out into the world. 2. The bird lived happily in a small world. 3. The bird becomes blind due to leaves. 4. The bird flies away as an adult. 5. The bird is unhappy with the straw nest. 6. The bird lived in a cosy nest with its mother. II Look at the pictures 1–4 and write the matching line from the poem for each. III Answer the following with a word from the poem and check the answers with your partner. 1. What was the shape of the bird’s first house? _ O _ _ _ 2. What was the bird’s second nest made of? _ _ R _ _ .',
              keyIdea: 'The bird lived in a nest made of straw with its mother.',
              pauseThink: { question: 'Why did the bird think the world was made of straw?', options: ['Because it was cold', 'Because it was soft', 'Because it was where it lived'], correctIndex: 2 },
            },
            {
              heading: 'The Bird\'s New World',
              text: 'What did the bird see when it came out of its nest? L _ _ _ E _ 4. What did the bird do at the end? _ _ _ W IV Now, recite the poem aloud along with your teacher and classmates. 1. 2. 3. 4. G raDE',
              keyIdea: 'As shown in the picture, the bird flew beyond the tree and saw a new world.',
              pauseThink: { question: 'What did the bird say about the world when it flew beyond the tree?', options: ['It said the world was small', 'It said the world was big', 'It said it didn\'t know how the world was made'], correctIndex: 2 },
            },
          ],
        vocab: [
            { word: 'nest', definition: 'a small home made of sticks and twigs' },
            { word: 'straw', definition: 'dry, yellowish grass' },
            { word: 'blind', definition: 'unable to see' },
            { word: 'labours', definition: 'hard work or tasks' },
            { word: 'neighbours', definition: 'people or animals living nearby' },
            { word: 'shell', definition: 'the hard outer covering of a nut or a snail' },
          ],
        },
      },
      {
        name: 'Spices that Heal Us', kind: 'Letter', page: 'p.54', pdfFile: 'fepr103.pdf', pdfPage: 19,
        readText: {
          intro: 'A letter from a grandmother about the healing spices used at home.',
          body: [
            'Written as a warm letter, a grandmother describes the everyday spices in her kitchen — turmeric, ginger, clove, cinnamon — and the natural remedies passed down through generations.',
            'The letter celebrates traditional knowledge and encourages children to notice the wisdom already present in their own homes.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434516/ncert_images/ncert/g6/english/fepr1_ch03_p20_i0.png',
          figureCaption: 'Illustration: a spice box (masala dabba) with labelled compartments.',
          activity: 'Ask a family member about one home remedy they know. Write it down in 2–3 sentences.',
        listenParts: [
            {
              heading: 'What is a Spice?',
              text: 'N urturi N g N ature S piceS that h eal U S Let us do these activities before we read. I A spice is any seed, fruit, root, bark, leaf or an y other part of a plant used to give taste and colour to our food. Try to recall the names of three spices that are used for cooking in your home. Write them below and share your answers with your teacher. 1. _______________ 2. _______________ 3. _______________ II Given below are pictures of some spices. Work in pairs and write what you call them in your language. Their names in English are given in the last column. Share your answers with your teacher. S.No. Spice Name in your language Name in e nglish 1. Turmeric 2.',
              keyIdea: 'A spice is a part of a plant used to give taste and colour to food.',
            },
            {
              heading: 'Identifying Spices',
              text: 'Fenugreek 3. Cumin seeds 4. Asafoetida 5. Cinnamon 6. Clove 7. Ginger 8. Black pepper 9. F ennel seeds 10. Cardamom —G rade Dear Vikram and Vaibhavi, Namaste! I just got your message that you are better now. I am happy that the natural cures that I had shared, helped you. You should try to remember these cures and may share them with your friends. When I was a child, I learnt them from my grandmother. She used to find home remedies for most of the weather-related common illnesses. Let me share some of the benefits of the spices that most of us have in our kitchen. Let me start with haldi , which is called turmeric in English. It helps in improving our energy level and digestion.',
              keyIdea: 'Look at the pictures of spices and write their names in your language.',
            },
            {
              heading: 'Benefits of Turmeric',
              text: 'It helps in reducing body pain too. Next, let us take methi , which is called fenugreek in English. You will be surprised to know that it helps me in keeping my sugar level and my body weight in control. I need to soak the methi seeds overnight and drink the water in the morning. • Jeera (cumin) seeds soaked in water overnight can also improve digestion and help cure sleeplessness. • You know, when you were babies and had gas in your tummy, I used to put heeng (asafoetida) water on your tummy to give you some relief. Heeng can also help in controlling cough and cold. • Dalchini (cinnamon) and laung (clove) give relief when we have toothache till we can consult a dentist.',
              keyIdea: 'Turmeric helps improve energy level and digestion.',
              pauseThink: { question: 'What does turmeric help reduce?', options: ['body pain', 'sugar level', 'body weight'], correctIndex: 0 },
            },
            {
              heading: 'More Spices and Their Benefits',
              text: '• Adrak (ginger) is another herb that can help us when we have cough and cold. It also gives relief from pain. Do you know, ginger has been used in cooking for more than 4000 years? Even today, it is extensively used in cooking Indian food. • Kali mirch (black pepper) is also helpful in digestion and can give us relief from body pain. • You may have seen that at the end of a meal, saunf (fennel seeds) and ajwain (carom seeds) are served. It is because they help in the digestion of food. • Elaichi (cardamom) also helps us with digestion and respiratory troubles in addition to curing bad breath. III Do you know if these spices can be used for something else other than cooking?',
              keyIdea: 'Different spices help with various health issues like toothache, cough, and cold.',
            },
            {
              heading: 'What Else Can Spices Do?',
              text: 'Let us find out by reading the letter given below. n urTurI n G n aTurE',
              keyIdea: 'Spices can be used for things other than cooking, let\'s find out.',
            },
          ],
        vocab: [
            { word: 'turmeric', definition: 'a spice that helps improve energy level and digestion' },
            { word: 'fenugreek', definition: 'a spice that helps control sugar level and body weight' },
            { word: 'cumin', definition: 'a spice that helps improve digestion and cure sleeplessness' },
            { word: 'asafoetida', definition: 'a spice that helps control cough and cold' },
            { word: 'cinnamon', definition: 'a spice that gives relief from toothache' },
            { word: 'ginger', definition: 'a spice that helps with cough and cold, and gives relief from pain' },
            { word: 'black pepper', definition: 'a spice that helps with digestion and gives relief from body pain' },
            { word: 'fennel seeds', definition: 'a spice that helps with digestion' },
            { word: 'cardamom', definition: 'a spice that helps with digestion and respiratory troubles' },
          ],
        },
      },
    ],
  },
  {
    title: 'Sports and Wellness',
    topics: [
      {
        name: 'Change of Heart', kind: 'Story', page: 'p.62', pdfFile: 'fepr104.pdf', pdfPage: 1,
        readText: {
          intro: 'A story highlighting the value of sportsmanship, fair play, and enjoying the game regardless of winning or losing.',
          body: [
            'A young player, determined to win at any cost, initially bends the rules during a match — until a moment of honesty from a rival player makes them reconsider what winning should really mean.',
            'By the end, the player experiences a genuine "change of heart," choosing fair play over a hollow victory.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434524/ncert_images/ncert/g6/english/fepr1_ch04_p3_i0.png',
          figureCaption: 'Illustration: two young players shaking hands on the field after a match.',
          activity: 'Describe a time you saw (or showed) good sportsmanship, even when it was hard.',
        listenParts: [
            {
              heading: 'Prabhat\'s Competitive Nature',
              text: 'I Prabhat always wanted to win. His parents, teachers, and friends said that he did not know how to accept defeat . The fact was that he could not bear losing, not even at marbles. He felt so good when he won that he never wanted to give up that feeling. On the contrary , losing made him feel terrible . He thought that losing was the worst thing that could happen to anyone. If Prabhat sensed that he would lose a game, he would not play it. He would take part only when he was sure of winning, even if the game lasted only for a minute. You could not stop him from playing the kind of games he was really good at, like badminton.',
              keyIdea: 'Prabhat always wants to win and hates losing.',
            },
            {
              heading: 'New Student Joins School',
              text: 'A new student joined Prabhat’s school, and his name was Surya. Surya was an excellent badminton player. Prabhat waited for the last Friday of the month. Last Friday was significant . This was when the coach conducted friendly matches in the games period. The teams were decided on Monday and it was no surprise when Prabhat and Surya were chosen to play a round against each other. Prabhat was given the responsibility of keeping score for their match. On one hand, Prabhat prepared for the match with great seriousness. Surya, on the other hand, seemed relaxed, not taking the things seriously at all.',
              keyIdea: 'A new student named Surya joins Prabhat\'s school.',
            },
            {
              heading: 'The Match Begins',
              text: 'He walked about the defeat : loss terrible : unhappy on the contrary : just the opposite sensed : had known significant : important conducted : organised S port S and W ellne SS whole time, smiling and cracking jokes about all sorts of things. But on Friday, at the badminton court, Surya was a real phenomenon . He won points again and again, laughing and joking all the time. However, Surya was paying so little attention to the match that Prabhat managed to change the scoreboard while his opponent was looking elsewhere. Prabhat managed to win by cheating. He made a big thing of his win, but it did not matter to Surya. “It’s been fun. We should play again some other time,” said Surya.',
              keyIdea: 'Prabhat and Surya play a badminton match, with Surya winning.',
              pauseThink: { question: 'Why did Prabhat feel surprised after winning the match?', options: ['He felt happy as usual.', 'He felt sad and unhappy.', 'He felt nothing special.'], correctIndex: 1 },
            },
            {
              heading: 'Observing Surya',
              text: 'phenomenon : someone who has special qualities —G rade Let us discuss 1. State whether the following is True or False. Prabhat would accept losing to anyone easily . 2. What was special about the last Friday of each month? 3. Who was responsible for maintaining the score for the match? 4. Do you think Prabhat wished to play another match with Surya? Why do you think so? II On that day, everyone was discussing their game and how Prabhat had played so well. Surprisingly, Prabhat could not sleep well that night. He had won the game but he did not feel as happy as he usually did. What was surprising was that Surya did not feel bad about losing.',
              keyIdea: 'Prabhat observes Surya playing basketball and notices his enjoyment.',
            },
            {
              heading: 'Prabhat Learns a Lesson',
              text: 'What was more surprising was that Prabhat saw S PorT S aNd W eLLNe SS Surya playing basketball the next day. Surya was so hopeless at it that he could not score a basket for ten minutes. Yet, he enjoyed playing the game. His happy smile never left his face. Prabhat kept a close watch on Surya for some days. He was great at some things, terrible at others but what was common was the enjoyment. He enjoyed everything equally. As Prabhat went on with his observation, he realised that to enjoy a game, you did not need a scoreboard to keep a tally of your scores. Neither did you have to worry about winning nor losing. You needed to enjoy the game for its own sake.',
              keyIdea: 'Prabhat learns that enjoying the game is more important than winning or losing.',
              pauseThink: { question: 'What did Prabhat start doing after learning this lesson?', options: ['He stopped playing games.', 'He only played games he was good at.', 'He started playing games for fun.'], correctIndex: 2 },
            },
            {
              heading: 'Change of Heart',
              text: 'What matters is trying to do well, and enjoying every moment of it. Prabhat learnt something through the observations every day, soon realising the change in himself. He had even begun playing hide and seek, and felt sad whenever it was about to end. He also started joking while playing badminton. Soon, the other students started talking amongst themselves, “Good fun playing with Prabhat, that fellow definitely has a great sporting spirit.” Let us discuss 1. How did Surya feel about playing? 2. What was it about Surya that Prabhat observed? kept a close watch on : observed hopeless : having no skill in something G rade',
              keyIdea: 'As shown in the picture, Prabhat\'s attitude towards games changes after meeting Surya.',
            },
          ],
        vocab: [
            { word: 'terrible', definition: 'feeling very unhappy or sad' },
            { word: 'contrary', definition: 'the opposite of something' },
            { word: 'sensed', definition: 'knew or felt something without being sure' },
            { word: 'conducted', definition: 'organized or led an event or activity' },
            { word: 'phenomenon', definition: 'someone or something that is very special or unusual' },
            { word: 'hopeless', definition: 'having no skill or ability in something' },
            { word: 'opponent', definition: 'someone who plays against you in a game' },
            { word: 'scoreboard', definition: 'a board that shows the scores of a game' },
            { word: 'sake', definition: 'for the purpose or benefit of something' },
          ],
        },
      },
      {
        name: 'The Winner', kind: 'Poem', page: 'p.70', pdfFile: 'fepr104.pdf', pdfPage: 13,
        readText: {
          intro: 'A poem capturing the joy and excitement of childhood games.',
          body: [
            'Through quick, energetic lines, the poem captures the thrill of outdoor play — running, racing, laughing — where the real prize is the fun of playing itself.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434539/ncert_images/ncert/g6/english/fepr1_ch04_p14_i0.png',
          figureCaption: 'Illustration: children racing across a playground.',
          activity: 'What outdoor game do you enjoy most, and why does it make you happy?',
        listenParts: [
            {
              heading: 'Evenings at the Creek',
              text: 'Evenings, we play ball next to the creek in our neighbour’ s field. We run so fast I can’t even catch my breath. When blue dark turns to black, cold gr ass aches our feet, trees creep close— game’s over. Night wins! G eor Gia H eard Let us discuss I Read the given lines from the poem. Write the meaning of the lines by identifying the words/expressions in them. Sports and Wellness II Read the poem. Complete the following based on the poem. The children play ______________ in the ______________ in the neighbour ’s ______________. They run so ______________ that they run out of breath. They continue to play till the evening when the blue sky turns ______________, and the trees are not clearly visible.',
              keyIdea: 'The children play ball in their neighbour\'s field in the evening.',
            },
            {
              heading: 'Game\'s Over',
              text: 'They can feel their feet ______________, now that it is cold. Finally, they stop ______________ and go home as it is night.',
              keyIdea: 'As shown in the picture, the children stop playing when night falls and it gets cold.',
              pauseThink: { question: 'Why do the children stop playing?', options: ['Because they are tired', 'Because it is getting dark', 'Because it is cold'], correctIndex: 2 },
            },
          ],
        vocab: [
            { word: 'neighbour', definition: 'a person living nearby' },
            { word: 'creek', definition: 'a small stream of water' },
            { word: 'grassy', definition: 'covered with grass' },
            { word: 'creep', definition: 'to move slowly and quietly' },
            { word: 'ache', definition: 'to feel a sharp pain' },
            { word: 'visible', definition: 'able to be seen' },
            { word: 'stop', definition: 'to end an activity or movement' },
          ],
        },
      },
      {
        name: 'Yoga — A Way of Life', kind: 'Non-fiction', page: 'p.73', pdfFile: 'fepr104.pdf', pdfPage: 20,
        readText: {
          intro: 'A non-fiction piece about maintaining a healthy lifestyle, well-being, and discipline through yoga.',
          body: [
            'The chapter introduces simple yoga practices suited for children, explaining how breathing, posture, and stillness can build both physical fitness and mental calm.',
            'It also mentions modern tools like the WHO mYoga app, showing how a centuries-old practice fits into today\'s digital world.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434542/ncert_images/ncert/g6/english/fepr1_ch04_p20_i0.png',
          figureCaption: 'Illustration: children practising a simple yoga pose (asana) outdoors.',
          activity: 'Try one simple breathing exercise for one minute. How did it make you feel?',
        listenParts: [
            {
              heading: 'What is Yoga?',
              text: 'Yoga is a ph ysical, mental, and spiritual practice that originated in ancient India. The word ‘Yoga’ comes from the Sanskrit root ‘ yuj ’, which means ‘to join’ or ‘to unite’. This symbolises the unity of mind and body; thought and action; harmony between human and nature. It is a holistic approach to health and well-being. Sage Patanjali presented the ancient tradition of yoga in a systematic way in ‘Yoga Sutras of Patanjali’. He described yoga as the means to make the mind quiet and free from all distractions . Yoga has become increasingly popular around the world due to its many health benefits. originated : started harmony : balance distractions : disturbances 1. What do you know about yoga? Discuss in pairs and share with the whole class.',
              keyIdea: 'Yoga is a practice that originated in ancient India.',
            },
            {
              heading: '21st June Celebration',
              text: '2. What is 21st June known for? What do we do on this day? 3. List as many words you know related to yoga. Share them with your classmates. 4. Let us play the game of Antakshari . The first word is ‘yoga’. The next word must then begin with the letter ‘a’. This activity will go on and the whole class will participate and write the words on the blackboard. How many new words have you learnt? S PORT S AND W ELLNE SS Here are some of the benefits of yoga— • Yoga postures ( asanas ) help to stretch and strengthen the muscles, increase flexibility, endurance and balance. This can improve overall physical fitness. This can also help to reduce body pains, such as lower back pain.',
              keyIdea: '21st June is a special day where we celebrate yoga and its benefits.',
            },
            {
              heading: 'Yoga Benefits',
              text: '• Yoga involves breathing techniques and meditation, which can help to calm the mind and reduce stress and anxiety . It relaxes the mind, improves the quality of sleep and increases concentration. • Yoga has been shown to boost the immune system. It can improve heart health by lowering blood pressure and improving circulation. • Yoga can aid in weight loss by burning calories, and maintaining health. anxiety : worry boost : increase endurance : capacity to continue without giving up Yoga promotes a sense of overall well-being. This is the reason why the benefits of practising yoga are internationally recognised. The World Health Organisation (WHO) on June 2021, launched an App called WHO mYoga.',
              keyIdea: 'Yoga can improve our physical fitness and reduce body pains.',
              pauseThink: { question: 'What is one way yoga can improve our health?', options: ['By increasing our appetite', 'By reducing body pains', 'By increasing our weight'], correctIndex: 1 },
            },
            {
              heading: 'Yoga and Well-being',
              text: 'The app contains a collection of videos and audio files to teach and support yoga practice. The aim was to have an easy-to-use and free tool for people across the world to encourage them to practise yoga. We can start practising yoga at any given moment of time. We must remember that when we practise yoga asanas (postures), we do not just stretch the body. The mind has to be with the body. This is the reason why it should be practised without distractions. If each stretch is coordinated with the breath and awareness, our practice will become a yogic practise. Let us discuss Read the passage again and fill in the blanks with words from the box.',
              keyIdea: 'Yoga promotes a sense of overall well-being and reduces stress.',
            },
            {
              heading: 'Practising Yoga',
              text: 'Y oga is a practise that not only improves physical flexibility but also improves mental 1. ____________ and leads to a healthier 2. ______________. It involves a series of asanas , which increase muscular 3. ______________. Practising yoga also leads to a better body and mind 4. ______________ and reduces body pain such as the lower back. Moreover, the focus on breathing techniques and meditation makes the mind 5. ______________, lessens 6. ______________, and improves the quality of 7. ______________. This helps to adopt a more positive lifestyle.',
              keyIdea: 'To practice yoga, we need to focus on our breath, body, and mind.',
              pauseThink: { question: 'Why should we practice yoga without distractions?', options: ['Because it is more fun', 'Because it helps us relax', 'Because it helps us focus'], correctIndex: 2 },
            },
          ],
        vocab: [
            { word: 'Yoga', definition: 'A physical, mental, and spiritual practice that originated in ancient India.' },
            { word: 'Harmony', definition: 'Balance or agreement between different things.' },
            { word: 'Distractions', definition: 'Things that take our attention away from what we are doing.' },
            { word: 'Endurance', definition: 'The ability to continue doing something without getting tired.' },
            { word: 'Breathing', definition: 'The act of taking air into and out of the lungs.' },
            { word: 'Meditation', definition: 'A practice where we focus our minds to relax and think clearly.' },
            { word: 'Asanas', definition: 'Yoga postures that help us stretch and strengthen our bodies.' },
            { word: 'Flexibility', definition: 'The ability to move our bodies in different ways.' },
            { word: 'Balance', definition: 'The ability to keep our bodies steady and upright.' },
          ],
        },
      },
    ],
  },
  {
    title: 'Culture and Tradition',
    topics: [
      {
        name: 'Kalakritiyon ka Bharat', kind: 'Narrative', page: 'p.80', pdfFile: 'fepr105.pdf', pdfPage: 2,
        readText: {
          intro: 'Narratives of children from different parts of India, celebrating the country\'s rich heritage of craftwork.',
          body: [
            'Through the voices of children from different regions, this piece explores India\'s diverse traditional art forms — from painting to pottery to weaving — passed down through families and communities.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434552/ncert_images/ncert/g6/english/fepr1_ch05_p2_i0.png',
          figureCaption: 'Illustration: a collage of traditional Indian craft forms — pottery, painting, and weaving.',
          activity: 'Name one traditional craft or art form from your own region or family.',
        listenParts: [
            {
              heading: 'Teacher Introduces Ek Bharat Shreshtha Bharat',
              text: 'i “So, are you ready to meet your friends from all over the country?” the teacher asked the students sitting in the big hall. “Yes!” was the loud answer from the class. “Can someone tell me for which programme are we here?” the teacher asked. “Ek Bharat, Shreshtha Bharat”, the students answered together again. “Please raise your hand to tell me what it is all about,” the teacher said. Many hands went up and some were jumping to answer. The teacher asked Renu. With a smile on her face, she said, “It is to know that we all belong to one nation and that is the bond we share. And our unity in diversity makes us the most wonderful country in the world.” l et us discuss 1.',
              keyIdea: 'The teacher introduces the Ek Bharat Shreshtha Bharat programme to the students.',
            },
            {
              heading: 'What is Ek Bharat Shreshtha Bharat',
              text: 'What is the Ek Bharat, Shreshtha Bharat programme all about? 2. Why is this programme being conducted? ii The teacher smiled at her as everyone clapped. Just then, Bala pointed out, “Look! The video has started!” The big screen now had little windows each with a smiling child. Each child had something to share. —G rade Pranam! I am Aakansha from Uttarakhand. I am going to tell you about Aipan, our folk art, that we draw on family functions and festivals. It is done with white rice flour paste on brick-red walls coloured with geru . It is made on floors and walls of puja rooms, and outside the main door of the home. It is an art form made by the women in the family.',
              keyIdea: 'The teacher asks students to share their understanding of the Ek Bharat Shreshtha Bharat programme.',
            },
            {
              heading: 'Aakansha Shares Aipan Folk Art',
              text: 'The designs are very beautiful and mathematical, and are based on our cultural traditions, and observations of nature. Suprabhat! I am Priyaranjan from Odisha. My tribe practises a 4000-year-old metal craft named Dhokra. To begin, we make a figure with clay, dry it, and cover it with a layer of wax. Then, we carve the fine details on the wax. After that, we cover the figure with clay, and put it in the fire. The wax melts and comes out of small openings. Next, brass scrap is melted and poured into the empty space. The liquid metal takes the same shape as the wax.',
              keyIdea: 'Aakansha shares the traditional folk art of Aipan from Uttarakhand, which is a beautiful and mathematical art form.',
              pauseThink: { question: 'What is Aipan?', options: ['A type of Indian dance', 'A traditional folk art of Uttarakhand', 'A type of Indian music'], correctIndex: 1 },
            },
            {
              heading: 'Priyaranjan Shares Dhokra Metal Craft',
              text: 'geru : red clay used as colour scrap : small unwanted pieces carve : to make design with sharp tool Aipan —Folk art Dhokra C ulture and t radition Finally, we remove the outer layer of clay and finish the metal figure as we want. Suprabhaatam! I am Chitra from Kerala. I want to tell you about coconut shell craft. First, we clean the outside and inside of a brown coconut shell. After that, we make it smooth by using sandpaper or a machine. Then we give it the shape we want, and make it stable by fixing a base under it. At last, we polish it using wood polish to make it shine. We make household things like bowls and even jewellery from the coconut shells.',
              keyIdea: 'Priyaranjan shares the 4000-year-old metal craft of Dhokra from Odisha, which involves making a figure with clay and covering it with wax and metal.',
            },
            {
              heading: 'Chitra Shares Coconut Shell Craft',
              text: 'It is a biodegradable craft. Subhodayam! I am Balamurali from Andhra Pradesh. I want to tell you about the 400-year-old art of making toys in my village, Kondapalli. To make the toys, we take soft wood from the nearby hills. After that, we carve each part of the toy separately. Then, we use makku — a paste of tamarind seed powder and sawdust to join the pieces together. Next, we add details and finish the toys. Finally, we use oil and water-colours or vegetable dyes and enamel paints to colour them. These toys are based on folk stories, animals, birds, bullock carts, rural life, etc.',
              keyIdea: 'Chitra shares the biodegradable craft of making household items and jewelry from coconut shells.',
              pauseThink: { question: 'What is special about the craft shared by Chitra?', options: ['It is a very expensive craft', 'It is a very old craft', 'It is biodegradable'], correctIndex: 2 },
            },
            {
              heading: 'Balamurali Shares Kondapalli Toy Making',
              text: 'tamarind : an edible sour fruit stable : not able to move biodegradable : something that will not harm the environment sawdust : dust of wood dyes : colours enamel : paints that form a protective layer Coconut shell craft Kondapalli —G rade l et us discuss On the basis of what the speakers said about the art forms, complete the table given below. n ame of the child State a rt form t hings needed Akanksha Aipan Priyaranjan cla y, brass scrap, wax, fire Chitra Balamurali Andhra Pradesh Kondapalli',
              keyIdea: 'Balamurali shares the 400-year-old art of making toys in his village, Kondapalli, which involves carving soft wood and using a special paste to join the pieces together.',
            },
          ],
        vocab: [
            { word: 'geru', definition: 'red clay used as a colour' },
            { word: 'scrap', definition: 'small unwanted pieces' },
            { word: 'carve', definition: 'to make design with a sharp tool' },
            { word: 'tamarind', definition: 'an edible sour fruit' },
            { word: 'stable', definition: 'not able to move' },
            { word: 'biodegradable', definition: 'something that will not harm the environment' },
            { word: 'sawdust', definition: 'dust of wood' },
            { word: 'enamel', definition: 'paints that form a protective layer' },
          ],
        },
      },
      {
        name: 'The Kites', kind: 'Poem', page: 'p.87', pdfFile: 'fepr105.pdf', pdfPage: 11,
        readText: {
          intro: 'An autobiographical account of a kite and its invincible spirit.',
          body: [
            'Told from the kite\'s own point of view, the poem celebrates resilience — rising again after every fall, dancing with the wind no matter how many times it is pulled down.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434567/ncert_images/ncert/g6/english/fepr1_ch05_p12_i0.png',
          figureCaption: 'Illustration: colourful kites soaring against a bright sky.',
          activity: 'Write two lines imagining you are a kite — what would you feel while flying?',
        listenParts: [
            {
              heading: 'Reading the Poem',
              text: 'Up in the air See the kites fly, Like coloured birds In the wind-whipped sky . I wish I were small And light as air, I would climb on a kite And sail up there. Then I would drift upon The paper wings, And hear the songs That the wild wind sings. What fun it would be To look right down, Over the park And the rooftops of town. The people below Would stand and stare, And wish they were me High, high in the air. d aPhne l ister C ulture and t radition l et us discuss I Read the poem silently. As you read, mark the given statements as True or False. Statements t / F 1. The child is looking at the kites. 2.',
              keyIdea: 'The student reads the poem silently and marks the given statements as True or False.',
              pauseThink: { question: 'What does the child want to climb on?', options: ['a kite', 'a bird', 'a cloud'], correctIndex: 0 },
            },
            {
              heading: 'Comparing Kites and Birds',
              text: 'The kites look like birds of different colours. 3. It was a r ainy day. 4. The child wants to be like a kite. 5. The child wishes to climb on a kite. 6. The kite is made of cloth and plastic. 7. The child wants to ride the kite. 8. The child knows they would have fun. 9. The child wants to look at the kite from a rooftop. 10. The child would like to look at people down below. 11. The child knows that the people would stare. II Complete the following sentences. 1. The poet says that the kites are like coloured birds – See the kites fly/ l ike coloured birds in the sky .',
              keyIdea: 'The kites are compared to birds of different colours.',
            },
            {
              heading: 'Wishing to Fly High',
              text: 'The kites have been compared to b __ __ __ __ because they ______________. 2. The child wishes to be like air – I wish I were small / And as light as air . The child wishes to be as l __ __ __ t as __ __ __ . The child wishes this to be able to c __ __ m _ _ on a kite and fly. G RADE Do you think that the use of simile in this poem helps us imagine better when we read the poem? Share your thoughts with your teacher and classmates. III Find a set of words from the poem that begin with the same consonant sound. Stanza Which consonant sound do both words begin with?',
              keyIdea: 'The child wishes to be light as air and fly high on a kite.',
              pauseThink: { question: 'What does the child wish to do from a rooftop?', options: ['look at the kite', 'play with the kite', 'fly a kite'], correctIndex: 0 },
            },
            {
              heading: 'Understanding the Poem',
              text: 'Stanza Which consonant sound do both words begin with? This is called alliteration . For example, b ig b right b lue b ag, f unny f an, etc. Create other sets of words using alliteration. IV In the last stanza, the two words that the poet repeats are __________, __________ to tell us that the kite is flying __ __ __ y high. V Study each stanza and underline the rhyming words from the end of each line. Also, circle the end words in the stanzas that do not rhyme.',
              keyIdea: 'As shown in the picture, the kites are flying high in the sky, and the child wishes to join them.',
            },
          ],
        vocab: [
            { word: 'simile', definition: 'A comparison between two unlike things using \'like\' or \'as\'.' },
            { word: 'alliteration', definition: 'The repetition of the same consonant sound in words that are close together.' },
            { word: 'rhyming', definition: 'Words that sound the same at the end.' },
            { word: 'stanza', definition: 'A group of lines in a poem that form a unit or a section.' },
            { word: 'coloured', definition: 'Having different bright colours.' },
            { word: 'whipped', definition: 'Moved or blown strongly by the wind.' },
            { word: 'drift', definition: 'To move slowly and gently through the air.' },
            { word: 'sings', definition: 'Makes a pleasant sound, like music.' },
            { word: 'rooftops', definition: 'The flat surfaces on top of buildings.' },
          ],
        },
      },
      {
        name: 'Ila Sachani: Embroidering Dreams with her Feet', kind: 'Real-life story', page: 'p.90', pdfFile: 'fepr105.pdf', pdfPage: 21,
        readText: {
          intro: 'A tribute to the persistence of a young girl with special needs who mastered traditional embroidery using her feet.',
          body: [
            'This real-life story introduces Ila Sachani, who, born without arms, learned traditional embroidery using her feet — turning what many saw as a limitation into a source of extraordinary skill and pride.',
            'Her story is a powerful example of how focus, hard work, and positivity can turn challenges into opportunities.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434585/ncert_images/ncert/g6/english/fepr1_ch05_p24_i0.png',
          figureCaption: 'Photograph/illustration: Ila Sachani at work on an embroidery piece.',
          activity: 'What is one challenge you\'ve faced, and one small step you took to work through it?',
        listenParts: [
            {
              heading: 'Ila Sachani\'s Life',
              text: '1. When you enter a tiny room in Moti V avdi village, Bhavnagar, Gujarat, you will see lots of bright colours. There are many lovely things like cushions, bedcovers, pillows, and more, with beautiful designs. Ila Sachani, a wonderful lady with a big smile, makes all these using a shiny needle to create these designs. She is very good at Kathiawar embroidery—a style that needs a lot of skill. 2. Ila Sachani’s journey began in the quiet settings of Amreli, Gujarat, where she was born into a farmer ’s family. From the beginning, life presented its challenges , as Ila was born with her hands hanging loose by her sides. Unlike other children, she could not use her hands in the usual way.',
              keyIdea: 'Ila Sachani was born in a farmer\'s family in Gujarat.',
              pauseThink: { question: 'Why was Ila different from other children?', options: ['She was born in a different village.', 'She could not use her hands in the usual way.', 'She was born with a big smile.'], correctIndex: 1 },
            },
            {
              heading: 'Early Challenges',
              text: 'While other small hands drew figures in the sand or plucked wild flowers, she wondered why she could not join them. She too wanted to hold a chalk in her hands and draw figures on a slate. 3. Ila’s mother and grandmother encour aged the little girl and were single-minded to help her overcome her challenge. They were skilled in the traditional art of Kathiawar embroidery and decided to share this art with Ila. They taught her to create many challenges : difficulties single-minded : focused Ila Sachani C ulture and t radition beautiful patterns using her feet! It was certainly not an easy task, but Ila accepted the challenge with determination .',
              keyIdea: 'Ila\'s family encouraged her to learn Kathiawar embroidery.',
            },
            {
              heading: 'Learning with Feet',
              text: 'Her parents also helped her learn to do things with her legs, like eating and combing her hair. 4. Threading a needle was hard, but Ila did not give up and became an expert at a young age. Her younger brother and sister helped her too. She learned many styles, even ones from outside Gujarat— Kachhi , Kashmiri, Lucknawi and others. 5. For Ila, embroidery became a way to express herself. At first, she crafted fine designs only for her family and friends, who were awestruck by her talent. They talked about those designs to others. Soon, the people in the village, too, discovered Ila’s special skill and the admiration for her work began to spread. 6. Word reached the government office in Surat.',
              keyIdea: 'Ila learned to do things with her legs and feet, like eating and threading a needle.',
              pauseThink: { question: 'Why did Ila\'s family teach her embroidery?', options: ['They wanted her to be a farmer.', 'They thought she could not do it.', 'They wanted her to overcome her challenge.'], correctIndex: 2 },
            },
            {
              heading: 'Ila\'s Talent Spreads',
              text: 'They were moved by Ila’s story and impressed by her work. They decided to display some samples of her embroidery at a state exhibition. This experience opened new doors for Ila. People observed the beauty woven by her feet and readily purchased the creations. Ila was no more a hidden talent, but famous! awestruck : amazed determination : will power —G rade 7. Encouraged b y this popularity , Ila participated in more exhibitions, not just within the state but at the national level. She received many awards and honours, not just for her art but also the willpower and creativity that her work showed. Ila Sachani, once a farmer’s daughter facing a tough challenge, worked hard and became a celebrated artist and receiver of the President’s Medal. 8.',
              keyIdea: 'Ila\'s embroidery became famous, and people from the village and government office noticed her talent.',
            },
            {
              heading: 'State Exhibition',
              text: 'The most important change for Ila was the new independence. Through her skill, she not only earned a regular income but also found jo y in doing what she loved. She proved, through her creations, that challenges can be turned into victories with focus, hard work, positivity and never giving up. 9. Her embroidery, created with her feet, reminds us that art has the power to rise above physical boundaries and touch the soul. popularity : fame Kachhi embroidery C ULTURE AND T RADITION Let us discuss Read the paragraphs and write the main idea for each. Then, match the main idea with two supporting details.',
              keyIdea: 'Ila\'s embroidery was displayed at a state exhibition, and she received recognition and awards.',
              pauseThink: { question: 'What happened to Ila after her work was displayed at the state exhibition?', options: ['She became a farmer.', 'She stopped doing embroidery.', 'She became famous and received many awards.'], correctIndex: 2 },
            },
            {
              heading: 'Ila\'s Success',
              text: 'Paragraph Main idea Two supporting details Introduction to Ila Sachani’s colourful embroidery (i) Examples of embroidered things (ii) Ila’s use of shiny needle Early challenges and family support (i) (ii) (i) (ii) (i) (ii) (i) (ii) Recognition at a state exhibition (i) (ii) (i) (ii) 8–9 (i) Financial independence and joy (ii) Challenges can be turned into victories —G rade',
              keyIdea: 'Ila became a celebrated artist and received the President\'s Medal, and she found joy and independence through her work.',
            },
          ],
        vocab: [
            { word: 'determination', definition: 'the will power to do something difficult' },
            { word: 'popularity', definition: 'fame or being well-known' },
            { word: 'challenges', definition: 'problems or difficulties that need to be overcome' },
            { word: 'minded', definition: 'focused or determined' },
            { word: 'Kathiawar', definition: 'a style of embroidery from Gujarat' },
            { word: 'Kachhi', definition: 'a style of embroidery from outside Gujarat' },
          ],
        },
      },
      {
        name: 'National War Memorial', kind: 'Poem', page: 'p.96', pdfFile: 'fepr105.pdf', pdfPage: 30,
        readText: {
          intro: 'A poem to recite and appreciate the spirit behind the National War Memorial.',
          body: [
            'The poem honours the soldiers commemorated at the National War Memorial in New Delhi, reflecting on sacrifice, duty, and remembrance in simple, respectful language suited for recitation.',
          ],
          figureUrl: 'https://res.cloudinary.com/di5iq2mmb/image/upload/v1779434586/ncert_images/ncert/g6/english/fepr1_ch05_p30_i0.png',
          figureCaption: 'Illustration: the eternal flame at the National War Memorial.',
          activity: 'Why do you think it is important for a country to remember and honour its soldiers?',
        listenParts: [
            {
              heading: 'National War Memorial Description',
              text: 'In Bharat’ s heartland, a grand sight to behold, The National War Memorial, honours brave stories retold. With respect and grace, it stands with pride, Each name etched, each stone, each story to confide. From battle fields to skies, and to oceans wide, They stand for Bharat, side by side. The eternal flame, in silence it glows, Paying homage to their courage that shows. Their sacrifice, always in our mind, In blessed memory, forever remind. With pride and respect, let’s always remember, At the National War Memorial, their sacrifice forever. National War Memorial Amar Jawan Jyoti C ulture and t radition l et us do these activities. 1. Read the poem aloud. 2. Recite the poem with your classmates and teacher. 3. Remember the poem.',
              keyIdea: 'The National War Memorial is a grand sight in Bharat\'s heartland.',
            },
          ],
        vocab: [
            { word: 'Bharat', definition: 'A country in South Asia, also known as India.' },
            { word: 'Eternal', definition: 'Lasting forever, never ending.' },
            { word: 'Amar', definition: 'Immortal, never to be forgotten.' },
            { word: 'Jawan', definition: 'A soldier, especially in the Indian Army.' },
            { word: 'Cultures', definition: 'Traditions and customs of a particular group of people.' },
            { word: 'Tradition', definition: 'A custom or practice that has been passed down from previous generations.' },
            { word: 'Sacrifice', definition: 'Giving up something valuable, especially for the benefit of others.' },
          ],
        },
      },
    ],
  },
];

// Stats derive from the caller's real per-student completedTopics set
// (see SubjectSyllabusScreen), not from any hardcoded "done" flag here.
export function g6EnglishStats(completedTopicNames?: Set<string>) {
  const chapters = CBSE_G6_ENGLISH_SYLLABUS;
  const totalTopics = chapters.reduce((sum, c) => sum + c.topics.length, 0);
  const doneTopics = completedTopicNames
    ? chapters.reduce((sum, c) => sum + c.topics.filter(t => completedTopicNames.has(t.name)).length, 0)
    : 0;
  return { totalChapters: chapters.length, totalTopics, doneTopics };
}
