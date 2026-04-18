const fs = require('fs');
const path = require('path');

const STORIES_PATH = path.join(__dirname, '../data/bhagavata_stories.json');
const stories = JSON.parse(fs.readFileSync(STORIES_PATH, 'utf8'));

const newStories = [
  {
    id: 'ramayana_birth_of_rama',
    title: 'The Birth of Rama',
    subtitle: 'The Divine Prince of Ayodhya',
    coverColor: '#ea580c',
    coverGradient: ['#ea580c', '#f59e0b'],
    coverIcon: 'sun',
    coverImageUrl: null,
    ageGroup: '6-12',
    collection: 'Ramayana',
    pages: [
      {
        pageNumber: 1,
        sceneIcon: 'home',
        sceneColor: '#ea580c',
        sceneLabel: 'The Golden Kingdom',
        sceneEmoji: '',
        imageUrl: null,
        text: 'Long, long ago, in the beautiful golden city of Ayodhya, there lived a great and kind king named Dasharatha. His kingdom was full of happiness — the trees were full of fruit, the rivers flowed with clear water, and all the people lived in peace.\n\nBut King Dasharatha had one sorrow in his heart. He had three wonderful queens — Kaushalya, Kaikeyi, and Sumitra — but no children to carry on his kingdom.'
      },
      {
        pageNumber: 2,
        sceneIcon: 'star',
        sceneColor: '#f59e0b',
        sceneLabel: 'The Sacred Fire',
        sceneEmoji: '',
        imageUrl: null,
        text: 'The king prayed to Lord Vishnu with all his heart. A great sage told King Dasharatha to perform a special fire ceremony called the Putrakameshti Yagna.\n\nAs the sacred fire blazed brightly, a divine figure rose from the flames holding a golden bowl of sweet kheer. "Give this to your queens," said the figure with a gentle smile, "and Lord Vishnu himself will be born as your son."'
      },
      {
        pageNumber: 3,
        sceneIcon: 'sunrise',
        sceneColor: '#f97316',
        sceneLabel: 'Four Divine Sons',
        sceneEmoji: '',
        imageUrl: null,
        text: 'The three queens ate the sacred kheer with joy. Soon, four beautiful baby boys were born in the palace of Ayodhya!\n\nQueen Kaushalya gave birth to Rama — the eldest, who shone like the sun itself. Kaikeyi gave birth to Bharata. And Sumitra was blessed with twins — Lakshmana and Shatrughna. The whole kingdom celebrated with music, flowers, and feasts for days!'
      },
      {
        pageNumber: 4,
        sceneIcon: 'book-open',
        sceneColor: '#ea580c',
        sceneLabel: 'Growing Up',
        sceneEmoji: '',
        imageUrl: null,
        text: 'The four princes grew up together, playing, learning and loving each other deeply. Rama and Lakshmana were especially close — always together, like the sun and its light.\n\nThey learned sacred scriptures, rode horses, and shot arrows with perfect aim. People who saw young Rama would stop and stare — his face was so calm and beautiful, his heart so full of goodness.'
      },
      {
        pageNumber: 5,
        sceneIcon: 'shield',
        sceneColor: '#f59e0b',
        sceneLabel: 'The Bow of Shiva',
        sceneEmoji: '',
        imageUrl: null,
        text: 'When Rama was a young man, a wise sage took him to the kingdom of Mithila. There sat an enormous bow — the divine bow of Lord Shiva — so heavy that a hundred men could not move it.\n\nKing Janaka had made a promise: whoever could lift and string this bow would marry his beloved daughter, the wise Princess Sita. Many great kings and warriors had tried and failed.'
      },
      {
        pageNumber: 6,
        sceneIcon: 'heart',
        sceneColor: '#ea580c',
        sceneLabel: 'Rama and Sita',
        sceneEmoji: '',
        imageUrl: null,
        text: 'Rama stepped forward quietly, bowed to the bow with respect, then — with the ease of picking up a flower — lifted the mighty bow, strung it and drew it back. The bow snapped with a sound like thunder!\n\nEveryone cheered. Sita walked forward with a garland of flowers and placed it around Rama\'s neck. Their eyes met, and both hearts knew — this was the beginning of a love story the whole world would tell forever.'
      }
    ]
  },
  {
    id: 'ramayana_exile',
    title: 'Rama Goes to the Forest',
    subtitle: 'The Prince Who Kept His Father\'s Promise',
    coverColor: '#16a34a',
    coverGradient: ['#16a34a', '#0891b2'],
    coverIcon: 'compass',
    coverImageUrl: null,
    ageGroup: '6-12',
    collection: 'Ramayana',
    pages: [
      {
        pageNumber: 1,
        sceneIcon: 'award',
        sceneColor: '#16a34a',
        sceneLabel: 'The Coronation Day',
        sceneEmoji: '',
        imageUrl: null,
        text: 'Years passed, and Rama grew into the most beloved prince in all of Ayodhya. King Dasharatha decided it was time to make Rama the next king.\n\nThe whole city was decorated with flowers and lights. Everyone was dancing and singing. Rama and Sita dressed in their finest clothes. It seemed like the happiest day in the world.'
      },
      {
        pageNumber: 2,
        sceneIcon: 'alert-circle',
        sceneColor: '#dc2626',
        sceneLabel: 'Kaikeyi\'s Wish',
        sceneEmoji: '',
        imageUrl: null,
        text: 'But a wicked servant named Manthara whispered lies into Queen Kaikeyi\'s ear. Filled with jealousy, Kaikeyi went to King Dasharatha and demanded two old promises be fulfilled.\n\n"I want Bharata to be king instead of Rama," she said. "And I want Rama to live in the forest for fourteen years." The king\'s heart broke — but a promise must always be kept.'
      },
      {
        pageNumber: 3,
        sceneIcon: 'smile',
        sceneColor: '#16a34a',
        sceneLabel: 'Rama\'s Answer',
        sceneEmoji: '',
        imageUrl: null,
        text: 'King Dasharatha wept as he told Rama what had happened. But Rama smiled — a calm, peaceful smile.\n\n"Father, a promise must always be kept," Rama said gently. "I am happy to go to the forest. Please do not be sad." He changed his royal clothes for simple forest garments without any complaint — because he loved his father and believed in always doing what was right.'
      },
      {
        pageNumber: 4,
        sceneIcon: 'heart',
        sceneColor: '#0891b2',
        sceneLabel: 'Sita and Lakshmana Follow',
        sceneEmoji: '',
        imageUrl: null,
        text: 'Sita heard what was happening and came to Rama at once. "Where you go, I go," she said with a bright smile. "The forest with you is better than a palace without you."\n\nLakshmana too refused to stay behind. "I will protect you both," he said, picking up his bow. And so the three of them — Rama, Sita, and Lakshmana — walked out of the palace together into the great forest.'
      },
      {
        pageNumber: 5,
        sceneIcon: 'users',
        sceneColor: '#16a34a',
        sceneLabel: 'The People\'s Love',
        sceneEmoji: '',
        imageUrl: null,
        text: 'As Rama walked through the streets, thousands of people followed him weeping. Children ran forward to touch his feet. Old men and women called out blessings.\n\nRama turned and spoke with great love. "Please go back and take care of each other. I will return in fourteen years, I promise." His words were gentle but firm — like someone who knows that every difficulty has a purpose.'
      },
      {
        pageNumber: 6,
        sceneIcon: 'compass',
        sceneColor: '#16a34a',
        sceneLabel: 'Into the Forest',
        sceneEmoji: '',
        imageUrl: null,
        text: 'King Dasharatha watched from the palace walls until he could see Rama no more. His heart was shattered, and within days the old king passed away from grief.\n\nBut Rama, Sita and Lakshmana walked on with peace in their hearts. They built a small hut and lived simply in the forest. Rama knew that a life lived with truth and love is always full — even in a forest. And deep in every heart in Ayodhya, they waited for the day Rama would return.'
      }
    ]
  }
];

// Insert after hanuman story
const hanumanIdx = stories.findIndex(s => s.id === 'hanuman');
stories.splice(hanumanIdx + 1, 0, ...newStories);

fs.writeFileSync(STORIES_PATH, JSON.stringify(stories, null, 2));
console.log('Done! Total stories:', stories.length);
console.log('Ramayana:', stories.filter(s => s.collection === 'Ramayana').map(s => s.title).join(', '));
