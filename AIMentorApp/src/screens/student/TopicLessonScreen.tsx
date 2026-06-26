/**
 * TopicLessonScreen.tsx
 * Clean lesson card viewer for topics without video (Grade 4/5).
 * Loads pre-written lesson JSON from server, displays one card at a time,
 * auto-reads each card via Web Speech API (instant, no network delay).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Platform, ScrollView, Image, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../../context/ThemeContext';
import { useStudentData } from '../../context/StudentDataContext';
import ScreenLayout from '../../components/common/ScreenLayout';
import Header from '../../components/common/Header';
import { NumberLineVisual, VennCirclesVisual, BarModelVisual, ConversionChartVisual } from '../../components/common/LessonVisuals';
import { spacing, radius, fonts } from '../../theme';
import SERVER_URL from '../../config/serverUrl';

// ── Bundled lesson data (fallback when server unavailable) ────────────────────
const BUNDLED_LESSONS: Record<string, any> = {
  'Grade 4|Area and Perimeter': {
    id: 'pyp_g4_mathematics_area_and_perimeter',
    title: 'Area and Perimeter',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#38bdf8',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['AREA', 'PERIMETER', 'SHAPES'], subtext: 'What are Area and Perimeter?', accent: '#38bdf8',
        voice: "Hey everyone! Today we are going to learn about two super useful maths concepts — Area and Perimeter! You use these every time you measure a room, a garden, or even your desk. Let's explore!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['PERIMETER', '=', 'BOUNDARY'], subtext: 'Perimeter — the border', accent: '#38bdf8',
        voice: "Perimeter is the total distance around the outside of a shape. Imagine walking around the edge of a football field — the total distance you walk is the perimeter! For a rectangle, you add all four sides: Perimeter equals 2 times length plus width." },
      { id: '03', scene_number: 3, type: 'concept', words: ['AREA', '=', 'SPACE'], subtext: 'Area — the space inside', accent: '#38bdf8',
        voice: "Area is the amount of space inside a shape. Think about how many square tiles you need to cover the floor of a room — that is the area! For a rectangle, Area equals length multiplied by width. Easy to remember!" },
      { id: '04', scene_number: 4, type: 'example', words: ['RECTANGLE', '6cm', '×', '4cm'], subtext: 'Let\'s solve one!', accent: '#38bdf8',
        voice: "Let's try an example! A rectangle is 6 centimetres long and 4 centimetres wide. The perimeter is 2 times 6 plus 4, which equals 20 centimetres. The area is 6 times 4, which equals 24 square centimetres. See how different they are?" },
      { id: '05', scene_number: 5, type: 'fun_fact', words: ['REAL', 'LIFE', 'MATHS'], subtext: 'Where do we use this?', accent: '#38bdf8',
        voice: "We use area and perimeter in real life all the time! Builders use area to calculate how much flooring to buy. Farmers use perimeter to build fences around fields. Even a picture frame uses perimeter! Maths is everywhere." },
      { id: '06', scene_number: 6, type: 'summary', words: ['REMEMBER', 'KEY', 'IDEAS'], subtext: 'Let\'s recap!', accent: '#38bdf8',
        voice: "Great work today! Remember: Perimeter is the distance around the outside, and you add all sides. Area is the space inside, and you multiply length by width. Keep practising and you will master these concepts in no time!" },
    ],
  },
  'Grade 4|Perimeter and Area Problems': {
    id: 'pyp_g4_mathematics_area_and_perimeter',
    title: 'Perimeter and Area Problems',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#38bdf8',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['AREA', 'PERIMETER', 'PROBLEMS'], subtext: 'Solving Area & Perimeter Problems', accent: '#38bdf8',
        voice: "Welcome, maths explorers! Today we are going to solve area and perimeter problems like real mathematicians. You will learn to figure out the size of shapes and the distance around them. Ready? Let's go!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['PERIMETER', 'ALL', 'SIDES'], subtext: 'Perimeter — add all sides', accent: '#38bdf8',
        voice: "Perimeter means the total length around the outside of a shape. To find the perimeter of any shape, add up all the sides. For a rectangle, the formula is: Perimeter equals 2 times the quantity length plus width." },
      { id: '03', scene_number: 3, type: 'concept', words: ['AREA', 'LENGTH', '×', 'WIDTH'], subtext: 'Area — length times width', accent: '#38bdf8',
        voice: "Area tells us how much flat space is inside a shape. For a rectangle, Area equals length multiplied by width. The answer is always in square units — like square centimetres or square metres." },
      { id: '04', scene_number: 4, type: 'example', words: ['ROOM', '8m', '×', '5m'], subtext: 'Real problem: a room!', accent: '#38bdf8',
        voice: "A room is 8 metres long and 5 metres wide. What is the area of the floor? Area equals 8 times 5, which is 40 square metres. Now for the perimeter: 2 times 8 plus 5 equals 26 metres. You can now measure any room!" },
      { id: '05', scene_number: 5, type: 'example', words: ['COMPOSITE', 'L-SHAPE'], subtext: 'Composite shapes', accent: '#38bdf8',
        voice: "Some shapes are more complex — like an L-shape. Break them into smaller rectangles, calculate each area separately, then add them together. The same goes for perimeter — just add all the outside edges." },
      { id: '06', scene_number: 6, type: 'summary', words: ['PRACTISE', 'AND', 'MASTER'], subtext: 'You did it!', accent: '#38bdf8',
        voice: "Amazing effort! You can now solve area and perimeter problems. Remember: perimeter goes around the outside, area fills the inside. Practice these with real objects at home — your bed, your book, your table! See you next time." },
    ],
  },
  'Grade 4|Numbers Up to 6 Digits': {
    id: 'pyp_g4_mathematics_numbers_up_to_6_digits',
    title: 'Numbers Up to 6 Digits',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['SIX', 'DIGIT', 'NUMBERS'], subtext: 'Read big numbers confidently', accent: '#a78bfa', voice: "Welcome, number detectives! Today we will work with numbers up to six digits, like 345,678. These big numbers appear on city populations, sports attendance, and online views. You will learn how to read, write, and understand them without fear. By the end, large numbers will feel friendly and familiar, and you will be ready to use them in real life with confidence." },
      { id: '02', scene_number: 2, type: 'concept', words: ['PLACE', 'VALUE', 'CHART'], subtext: 'Ones to hundred thousands', accent: '#a78bfa', voice: "A six-digit number has places: ones, tens, hundreds, thousands, ten thousands, and hundred thousands. In 345,678, the 3 means three hundred thousands, not just three. Each place to the left is ten times bigger than the one before it. A place-value chart helps us see this clearly and avoid mistakes while reading or comparing big numbers." },
      { id: '03', scene_number: 3, type: 'concept', words: ['READ', 'WRITE', 'EXPAND'], subtext: 'Say and expand numbers', accent: '#a78bfa', voice: "Let us read 427,305 as four hundred twenty-seven thousand three hundred five. Now expand it: 400,000 + 20,000 + 7,000 + 300 + 5. Expanded form shows exactly how each digit contributes. This skill helps when checking bills, understanding scores, and solving longer calculations because you can break one big number into smaller understandable parts." },
      { id: '04', scene_number: 4, type: 'example', words: ['STADIUM', 'FANS', 'COUNT'], subtext: 'Step-by-step place value', accent: '#a78bfa', voice: "A stadium report says 582,469 fans visited this season. Step 1: identify each digit place: 5 hundred thousands, 8 ten thousands, 2 thousands, 4 hundreds, 6 tens, 9 ones. Step 2: write expanded form: 500,000 + 80,000 + 2,000 + 400 + 60 + 9. Step 3: add to verify: 582,469. Correct! This is how analysts read attendance numbers." },
      { id: '05', scene_number: 5, type: 'example', words: ['CITY', 'MAP', 'DATA'], subtext: 'Compare two populations', accent: '#a78bfa', voice: "City A has 364,250 people and City B has 359,980 people. Step 1: compare hundred-thousands: both have 3. Step 2: compare ten-thousands: 6 is greater than 5. So 364,250 is greater than 359,980. Step 3: find difference: 364,250 - 359,980 = 4,270. City A has 4,270 more people. That is practical data comparison." },
      { id: '06', scene_number: 6, type: 'summary', words: ['BIG', 'NUMBERS', 'MASTERED'], subtext: 'You can handle large values', accent: '#a78bfa', voice: "Excellent work! You learned to read, write, expand, and compare six-digit numbers. Remember to use place value from left to right and check using expanded form. These skills help in maps, statistics, sports, and money reports. Keep practicing with newspaper numbers, and soon you will handle even bigger numbers quickly and accurately like a real mathematician." },
    ],
  },
  'Grade 4|Indian Place Value Chart': {
    id: 'pyp_g4_mathematics_indian_place_value_chart',
    title: 'Indian Place Value Chart',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['LAKHS', 'CRORES', 'INDIA'], subtext: 'The Indian Number System', accent: '#a78bfa',
        imageUrl: '/data/images/indian_place_value_chart.svg',
        imageCaption: 'Indian Place Value Chart — Ones, Thousands, Lakhs, Crores',
        voice: "Welcome, mathematicians! Today we are going to learn the Indian Place Value system — the way India writes and reads large numbers. India has its own unique way of grouping digits, different from the international system. Instead of millions and billions, we use Lakhs and Crores. By the end of this lesson, you will read and write any large number in the Indian system confidently!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['ONES', 'THOUSANDS', 'LAKHS'], subtext: 'How Indian grouping works', accent: '#a78bfa',
        imageUrl: '/data/images/indian_place_value_chart.svg',
        imageCaption: 'Indian grouping: first 3 digits, then pairs of 2',
        voice: "In the Indian system, digits are grouped from the right. The first group from the right has 3 digits — Ones, Tens, and Hundreds. After that, every group has just 2 digits. The second group is Thousands and Ten Thousands. The third group is Lakhs and Ten Lakhs. The fourth group is Crores and Ten Crores. This is why Indian numbers use commas differently — for example: 5 crore 23 lakh 45 thousand 6 hundred 78 is written as 5,23,45,678." },
      { id: '03', scene_number: 3, type: 'concept', words: ['CRORE', 'LAKH', 'THOUSAND'], subtext: 'Place values and their worth', accent: '#a78bfa',
        voice: "Let us learn the value of each place. Ones = 1. Tens = 10. Hundreds = 100. Thousands = 1,000. Ten Thousands = 10,000. Lakhs = 1,00,000 — that is one hundred thousand. Ten Lakhs = 10,00,000. Crores = 1,00,00,000 — that is ten million! Ten Crores = 10,00,00,000. Interesting fact: One lakh rupees is used every day in conversations in India. When a cricketer scores a century in front of one lakh fans, the stadium is completely full!" },
      { id: '04', scene_number: 4, type: 'example', words: ['READ', 'WRITE', 'EXPAND'], subtext: 'Reading a number the Indian way', accent: '#a78bfa',
        voice: "Let us read the number 3,45,67,890. Step 1: from the right, mark groups — 890 is the ones group, 67 is thousands, 45 is lakhs, 3 is crores. Step 2: read each group with its period name — 3 crore, 45 lakh, 67 thousand, 8 hundred and 90. Step 3: say it all together — Three crore forty-five lakh sixty-seven thousand eight hundred and ninety. Now try expanding it: 3,00,00,000 plus 45,00,000 plus 67,000 plus 890." },
      { id: '05', scene_number: 5, type: 'concept', words: ['INDIAN', 'VS', 'INTERNATIONAL'], subtext: 'Indian vs International system', accent: '#a78bfa',
        voice: "How does the Indian system compare to the international system? In the international system, 10 lakh is called one million. One crore is called ten million. Ten crore is one hundred million. So when you read international news saying a company earned 50 million dollars, that is 5 crore dollars in Indian terms! Understanding both systems helps you read news, understand cricket statistics, government budgets, and global business reports." },
      { id: '06', scene_number: 6, type: 'summary', words: ['LAKH', 'CRORE', 'CHART'], subtext: 'Place value expert!', accent: '#a78bfa',
        imageUrl: '/data/images/indian_place_value_chart.svg',
        imageCaption: 'Remember: 1 Lakh = 1,00,000 and 1 Crore = 1,00,00,000',
        voice: "Excellent! You have mastered the Indian Place Value Chart. Remember: digits group in 3 from the right for the ones period, then in pairs of 2 for thousands, lakhs, and crores. One lakh has 6 digits. One crore has 8 digits. Use commas to mark each group. This system is used on Indian currency notes, bank statements, population data, and cricket scoreboards. You are now ready to read and write any number in the Indian system!" },
    ],
  },
  'Grade 4|Place Value and Comparison': {
    id: 'pyp_g4_mathematics_place_value_and_comparison',
    title: 'Place Value and Comparison',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['PLACE', 'VALUE', 'COMPARE'], subtext: 'Know which number is greater', accent: '#a78bfa', voice: "Hi, maths champions! Today we will master place value and compare numbers correctly. Sometimes two numbers look similar, but one tiny digit changes everything. Understanding digit position helps us choose larger, smaller, or equal values. This is useful for ranking race scores, checking prices, and reading weather records. Let us build sharp comparison skills with clear steps and smart strategies." },
      { id: '02', scene_number: 2, type: 'concept', words: ['GREATER', 'LESS', 'EQUAL'], subtext: 'Use comparison symbols', accent: '#a78bfa', voice: "Comparison uses symbols: greater than, less than, and equal to. Always compare from the leftmost digit because that place has the highest value. If those digits are equal, move one place right until you find a difference. This method is faster and safer than guessing. Place value tells us why 6 in the thousands place is much bigger than 6 in the tens place." },
      { id: '03', scene_number: 3, type: 'concept', words: ['ORDER', 'ASCENDING', 'DESCENDING'], subtext: 'Arrange numbers correctly', accent: '#a78bfa', voice: "Ascending order means smallest to largest. Descending order means largest to smallest. To order several numbers, compare pair by pair using place values. A quick tip: make a table with columns for hundred-thousands, ten-thousands, and so on. This makes sorting neat and accurate. Data scientists and teachers use the same logic when arranging test scores or population lists." },
      { id: '04', scene_number: 4, type: 'example', words: ['SHOP', 'PRICE', 'CHECK'], subtext: 'Compare two bills', accent: '#a78bfa', voice: "Two school event bills are 48,735 rupees and 48,573 rupees. Step 1: compare ten-thousands: both 4. Step 2: compare thousands: both 8. Step 3: compare hundreds: 7 is greater than 5. So 48,735 > 48,573. Step 4: subtract to see gap: 48,735 - 48,573 = 162. The first bill is 162 rupees higher." },
      { id: '05', scene_number: 5, type: 'example', words: ['RACE', 'SCORES', 'ORDER'], subtext: 'Arrange results with steps', accent: '#a78bfa', voice: "Team scores are 39,420, 39,402, and 39,240. Step 1: all have 39 thousand, so compare hundreds next. Step 2: hundreds are 4, 4, and 2, so 39,240 is smallest. Step 3: compare 39,420 and 39,402 using tens: 2 is greater than 0. Final ascending order: 39,240, 39,402, 39,420. This is how scoreboards are ranked fairly." },
      { id: '06', scene_number: 6, type: 'summary', words: ['LEFT', 'TO', 'RIGHT'], subtext: 'Comparison made easy', accent: '#a78bfa', voice: "Great progress! You now compare and order numbers by reading place value from left to right. Use symbols correctly and avoid rushing to the last digits too early. When many numbers are involved, organize them in a place-value table for accuracy. Keep practicing with prices and scores around you, and comparing large numbers will become quick, easy, and reliable every day." },
    ],
  },
  'Grade 4|Addition and Subtraction': {
    id: 'pyp_g4_mathematics_addition_and_subtraction',
    title: 'Addition and Subtraction',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['ADD', 'SUBTRACT', 'SOLVE'], subtext: 'Everyday number operations', accent: '#a78bfa', voice: "Hello problem solvers! Today we will sharpen addition and subtraction with larger numbers. These operations help when tracking expenses, counting points, and checking inventory. You will learn column method, regrouping, and quick checking tricks. We will solve practical examples step by step so you can see exactly why each move works. Let us build speed and accuracy together in a fun way." },
      { id: '02', scene_number: 2, type: 'concept', words: ['COLUMN', 'METHOD', 'REGROUP'], subtext: 'Align places carefully', accent: '#a78bfa', voice: "In addition and subtraction, always align digits by place value: ones under ones, tens under tens, and so on. For addition, carry to the next place when a column total is 10 or more. For subtraction, borrow from the next place when the top digit is smaller. Clean alignment prevents most errors and makes long calculations easy to read and correct." },
      { id: '03', scene_number: 3, type: 'concept', words: ['ESTIMATE', 'CHECK', 'REVERSE'], subtext: 'Verify your answer', accent: '#a78bfa', voice: "A smart mathematician always checks answers. Use estimation first by rounding numbers to nearby tens or hundreds. Then do the exact operation. For addition, check by subtraction. For subtraction, check by adding the difference to the smaller number. These habits save marks in exams and prevent mistakes in real life, especially when dealing with money, tickets, or score totals." },
      { id: '04', scene_number: 4, type: 'example', words: ['LIBRARY', 'BOOKS', 'TOTAL'], subtext: 'Addition with carrying', accent: '#a78bfa', voice: "A library bought 2,468 books in June and 3,759 books in July. Step 1: add ones, 8 + 9 = 17, write 7 carry 1. Step 2: tens, 6 + 5 + 1 = 12, write 2 carry 1. Step 3: hundreds, 4 + 7 + 1 = 12, write 2 carry 1. Step 4: thousands, 2 + 3 + 1 = 6. Total = 6,227 books." },
      { id: '05', scene_number: 5, type: 'example', words: ['SHOP', 'STOCK', 'LEFT'], subtext: 'Subtraction with borrowing', accent: '#a78bfa', voice: "A store had 5,000 notebooks and sold 2,786. Step 1: ones, 0 - 6 cannot, borrow from tens; tens is 0, so borrow through hundreds and thousands. Step 2: ones become 10, so 10 - 6 = 4. Step 3: tens become 9, so 9 - 8 = 1. Step 4: hundreds 9 - 7 = 2, thousands 4 - 2 = 2. Notebooks left = 2,214." },
      { id: '06', scene_number: 6, type: 'summary', words: ['ALIGN', 'REGROUP', 'CHECK'], subtext: 'Operations mastered today', accent: '#a78bfa', voice: "Fantastic work today! You practiced addition and subtraction using place-value columns, carrying, and borrowing. Remember to align numbers first, then solve from right to left. Always check with the opposite operation or estimation. These skills are useful for school maths and daily tasks like shopping and scorekeeping. Keep practicing a few sums each day and your confidence will grow quickly." },
    ],
  },
  'Grade 4|Multiplication (2-digit × 2-digit)': {
    id: 'pyp_g4_mathematics_multiplication_2_digit_by_2_digit',
    title: 'Multiplication (2-digit × 2-digit)',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['MULTIPLY', 'TWO', 'DIGITS'], subtext: 'Bigger products made easy', accent: '#a78bfa', voice: "Welcome, multiplication masters! Today we will multiply two-digit numbers by two-digit numbers, like 24 times 36. This helps in finding total seats, packets, and group scores quickly. We will use the column method and partial products clearly. Once you learn the steps, these questions become systematic and fun. Let us break the process into small, easy actions you can trust every time." },
      { id: '02', scene_number: 2, type: 'concept', words: ['ONES', 'TENS', 'PLACE'], subtext: 'Multiply by each place', accent: '#a78bfa', voice: "In 2-digit by 2-digit multiplication, multiply the top number by each digit of the bottom number separately. First use the ones place, then the tens place. The tens row must shift one place left, or start with a zero, because it represents tens. Finally add both rows. This place-value shift is the key idea that makes long multiplication correct." },
      { id: '03', scene_number: 3, type: 'concept', words: ['PARTIAL', 'PRODUCTS', 'ADD'], subtext: 'Combine sub-answers', accent: '#a78bfa', voice: "Partial products means we split multiplication into smaller chunks and add them. Example idea: 23 times 14 is 23 times 4 plus 23 times 10. This method explains why the algorithm works, not just how to do it. Understanding partial products helps you estimate quickly and catch mistakes when a final answer looks too small or too large." },
      { id: '04', scene_number: 4, type: 'example', words: ['BOXES', '24', '×', '36'], subtext: 'Step-by-step multiplication', accent: '#a78bfa', voice: "A warehouse has 24 crayons per box and 36 boxes. Step 1: 24 times 6 = 144. Step 2: 24 times 30 = 720. Step 3: add partial products, 144 + 720 = 864. So total crayons = 864. Check: 20 times 36 is 720 and 4 times 36 is 144; together 864. The answer is verified and realistic for a warehouse count." },
      { id: '05', scene_number: 5, type: 'example', words: ['SEATS', '18', '×', '27'], subtext: 'Real-life hall capacity', accent: '#a78bfa', voice: "An auditorium has 18 seats in each row and 27 rows. Step 1: 18 times 7 = 126. Step 2: 18 times 20 = 360. Step 3: add 126 + 360 = 486. Total seats are 486. Verification: 10 times 27 = 270 and 8 times 27 = 216; 270 + 216 = 486. Two methods, same result, so our multiplication is correct." },
      { id: '06', scene_number: 6, type: 'summary', words: ['ROWS', 'SHIFT', 'ADD'], subtext: 'Long multiplication success', accent: '#a78bfa', voice: "You did brilliant work! You now know how to multiply 2-digit numbers by 2-digit numbers using place value and partial products. Remember the tens-row shift and always add carefully at the end. Estimate first to judge if your final answer makes sense. Practice with shopping packs and seating plans, and long multiplication will become one of your strongest maths skills." },
    ],
  },
  'Grade 4|Division with Remainders': {
    id: 'pyp_g4_mathematics_division_with_remainders',
    title: 'Division with Remainders',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['DIVIDE', 'SHARE', 'LEFTOVER'], subtext: 'Equal groups with remainder', accent: '#a78bfa', voice: "Hello, equal-sharing experts! Today we will learn division with remainders. Sometimes items cannot be shared perfectly, and a few are left over. That leftover is called the remainder. This idea appears in seating groups, packet distribution, and game teams. We will use clear long-division steps so you can solve confidently and explain your answer in words and numbers." },
      { id: '02', scene_number: 2, type: 'concept', words: ['QUOTIENT', 'REMAINDER', 'DIVISOR'], subtext: 'Key division vocabulary', accent: '#a78bfa', voice: "In division, dividend is the number being divided, divisor is what you divide by, quotient is the answer, and remainder is what is left. Remainder must always be smaller than the divisor. If remainder is bigger, division is incomplete. Keep this rule in mind while doing long division, and your answers will stay mathematically correct every time." },
      { id: '03', scene_number: 3, type: 'concept', words: ['DIVIDE', 'MULTIPLY', 'SUBTRACT'], subtext: 'Long division cycle', accent: '#a78bfa', voice: "Long division follows a cycle: divide, multiply, subtract, and bring down. Repeat until no digits remain. This cycle keeps work organized and easy to check. After solving, verify using: divisor times quotient plus remainder equals dividend. This checking formula is powerful because it proves your division answer is correct and complete, especially in exam word problems." },
      { id: '04', scene_number: 4, type: 'example', words: ['CANDIES', '53', '÷', '8'], subtext: 'Sharing into equal groups', accent: '#a78bfa', voice: "There are 53 candies shared among 8 children. Step 1: 8 goes into 53 six times because 8 times 6 = 48. Step 2: subtract 53 - 48 = 5. So quotient is 6 and remainder is 5. Step 3: verify: 8 times 6 + 5 = 48 + 5 = 53. Each child gets 6 candies, and 5 candies are left over." },
      { id: '05', scene_number: 5, type: 'example', words: ['CHAIRS', '97', '÷', '9'], subtext: 'Rows and leftover chairs', accent: '#a78bfa', voice: "A school has 97 chairs and makes rows of 9. Step 1: 9 goes into 97 ten times because 9 times 10 = 90. Step 2: subtract 97 - 90 = 7. So we have 10 full rows with remainder 7 chairs. Check: 9 times 10 + 7 = 90 + 7 = 97. The remainder tells us chairs that do not complete another full row." },
      { id: '06', scene_number: 6, type: 'summary', words: ['SHARE', 'CHECK', 'REMAINDER'], subtext: 'Division logic is clear', accent: '#a78bfa', voice: "Excellent work! You can now divide with remainders and explain what the remainder means in context. Remember the long division cycle and always verify using divisor times quotient plus remainder. Keep the remainder smaller than divisor. Practice with sharing toys, books, or snacks at home, and you will become very fast and accurate with division problems." },
    ],
  },
  'Grade 4|Factors and Multiples': {
    id: 'pyp_g4_mathematics_factors_and_multiples',
    title: 'Factors and Multiples',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['FACTORS', 'MULTIPLES', 'PATTERNS'], subtext: 'Number relationships around us', accent: '#a78bfa', voice: "Hi maths explorers! Today we will discover factors and multiples, two ideas that reveal hidden number patterns. These help when arranging equal rows, planning schedules, and simplifying fractions later. A factor divides exactly, while a multiple comes from multiplying. Once you see the pattern, many number questions become easier. Let us investigate these relationships like true number scientists." },
      { id: '02', scene_number: 2, type: 'concept', words: ['FACTOR', 'DIVIDES', 'EXACTLY'], subtext: 'No remainder allowed', accent: '#a78bfa', voice: "A factor of a number divides it completely with no remainder. For example, factors of 12 are 1, 2, 3, 4, 6, and 12. A quick way is to test numbers from 1 upward and pair factors: if 3 divides 12, then 4 is also a factor because 3 times 4 equals 12. Factor pairs save time and reduce mistakes." },
      { id: '03', scene_number: 3, type: 'concept', words: ['MULTIPLE', 'TIMES', 'TABLE'], subtext: 'Generated by multiplication', accent: '#a78bfa', voice: "Multiples are numbers you get by multiplying. Multiples of 5 are 5, 10, 15, 20, and so on. They continue forever. Every number has unlimited multiples but limited factors. Multiples are useful for skip counting, time intervals, and finding common meeting points in schedules. Learning both factors and multiples helps with division, fractions, and advanced number topics." },
      { id: '04', scene_number: 4, type: 'example', words: ['PACKETS', '24', 'BISCUITS'], subtext: 'Find all factor groups', accent: '#a78bfa', voice: "A baker has 24 biscuits and wants equal packets. Step 1: test divisors: 1, 2, 3, 4, 6, 8, 12, 24 divide exactly. Step 2: write factor pairs: 1 x 24, 2 x 12, 3 x 8, 4 x 6. Step 3: check one pair: 24 divided by 6 = 4, and 6 x 4 = 24. So all packet sizes are valid and verified." },
      { id: '05', scene_number: 5, type: 'example', words: ['BELL', 'TIMES', 'COMMON'], subtext: 'Common multiples in school', accent: '#a78bfa', voice: "Two school bells ring every 6 minutes and 8 minutes. Step 1: list multiples of 6: 6, 12, 18, 24, 30. Step 2: list multiples of 8: 8, 16, 24, 32. Step 3: first common multiple is 24. So both bells ring together every 24 minutes. Verification: 24 divided by 6 = 4 and 24 divided by 8 = 3, both exact." },
      { id: '06', scene_number: 6, type: 'summary', words: ['DIVIDE', 'MULTIPLY', 'RELATE'], subtext: 'Numbers are connected', accent: '#a78bfa', voice: "Great learning today! You identified factors using exact division and multiples using times tables. Remember, factors are finite but multiples continue forever. Factor pairs and multiple lists are useful tools for many problems. Keep practicing with everyday examples like packets and schedules, and your number sense will become stronger, faster, and more flexible in future maths lessons." },
    ],
  },
  'Grade 4|Prime and Composite Numbers': {
    id: 'pyp_g4_mathematics_prime_and_composite_numbers',
    title: 'Prime and Composite Numbers',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['PRIME', 'COMPOSITE', 'NUMBERS'], subtext: 'Classifying whole numbers', accent: '#a78bfa', voice: "Welcome, number classifiers! Today we will sort numbers into prime and composite groups. This topic is like giving numbers identity cards. It helps in factors, fractions, and many future maths ideas. A prime number is special because it has only two factors. A composite number has more. Let us use factor checks to classify numbers quickly and correctly like maths detectives." },
      { id: '02', scene_number: 2, type: 'concept', words: ['PRIME', 'TWO', 'FACTORS'], subtext: 'Only 1 and itself', accent: '#a78bfa', voice: "A prime number has exactly two factors: 1 and the number itself. Examples are 2, 3, 5, 7, and 11. Number 2 is the only even prime number. To test if a number is prime, check if any smaller number divides it exactly. If none do, it is prime. This method is systematic and easy for Grade 4 numbers." },
      { id: '03', scene_number: 3, type: 'concept', words: ['COMPOSITE', 'MORE', 'FACTORS'], subtext: 'Can be split many ways', accent: '#a78bfa', voice: "A composite number has more than two factors. For example, 12 has factors 1, 2, 3, 4, 6, and 12, so it is composite. Number 1 is neither prime nor composite because it has only one factor. Knowing this exception is important. Prime and composite classification helps when finding common factors and simplifying mathematical expressions later." },
      { id: '04', scene_number: 4, type: 'example', words: ['IS', '29', 'PRIME'], subtext: 'Test with factor checks', accent: '#a78bfa', voice: "Let us test 29. Step 1: try dividing by 2: 29 divided by 2 leaves remainder 1. Step 2: try 3: 29 divided by 3 leaves remainder 2. Step 3: try 5: remainder 4. No exact division by smaller primes, so 29 has only factors 1 and 29. Therefore 29 is prime. Verification complete using factor test." },
      { id: '05', scene_number: 5, type: 'example', words: ['IS', '36', 'COMPOSITE'], subtext: 'Show multiple factors', accent: '#a78bfa', voice: "Now test 36. Step 1: 36 divided by 2 = 18 exactly. Step 2: 36 divided by 3 = 12 exactly. Step 3: 36 divided by 4 = 9 exactly. Since we found many exact divisors besides 1 and 36, the number has more than two factors. So 36 is composite. In real life, this means 36 items can be arranged in many equal rows." },
      { id: '06', scene_number: 6, type: 'summary', words: ['CLASSIFY', 'CHECK', 'CONFIRM'], subtext: 'Prime or composite solved', accent: '#a78bfa', voice: "Excellent job! You learned prime means exactly two factors, composite means more than two, and 1 is neither. Use division checks to classify any number carefully. These skills are useful in factor trees and advanced arithmetic. Keep practicing with numbers you see around you, and soon you will identify primes and composites quickly without confusion." },
    ],
  },
  'Grade 4|Fractions (Types and Comparison)': {
    id: 'pyp_g4_mathematics_fractions_types_and_comparison',
    title: 'Fractions (Types and Comparison)',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['FRACTIONS', 'PARTS', 'WHOLE'], subtext: 'Sharing equally in maths', accent: '#a78bfa', voice: "Hello, fraction friends! Today we will learn fraction types and compare them confidently. Fractions appear when pizzas, chocolates, or time are shared into equal parts. You will understand numerator and denominator, then decide which fraction is bigger. With visual thinking and smart rules, fractions become simple and useful. Let us begin with clear definitions and practical examples you can imagine easily." },
      { id: '02', scene_number: 2, type: 'concept', words: ['NUMERATOR', 'DENOMINATOR', 'EQUAL'], subtext: 'Reading fraction language', accent: '#a78bfa', voice: "In a fraction like 3/5, the numerator 3 tells how many parts we take, and denominator 5 tells total equal parts. Types include proper fractions, improper fractions, and mixed numbers. Proper means numerator is smaller than denominator. This vocabulary helps us read fractions correctly and avoid confusion while comparing or solving word problems involving sharing and measurements." },
      { id: '03', scene_number: 3, type: 'concept', words: ['COMPARE', 'SAME', 'DENOMINATOR'], subtext: 'Use denominator rules', accent: '#a78bfa', voice: "To compare fractions with the same denominator, compare numerators: bigger numerator means bigger fraction. If numerators are same, smaller denominator means larger pieces, so bigger fraction. For different denominators, convert to common denominators before comparing. These rules are reliable and help in recipe quantities, sports statistics, and classroom sharing activities where fairness matters." },
      { id: '04', scene_number: 4, type: 'example', words: ['PIZZA', '3/8', '5/8'], subtext: 'Same denominator comparison', accent: '#a78bfa', voice: "Two friends ate 3/8 and 5/8 of identical pizzas. Step 1: denominators are both 8, so pieces are same size. Step 2: compare numerators, 5 is greater than 3. Therefore 5/8 is greater than 3/8. Step 3: difference is 5/8 - 3/8 = 2/8 = 1/4. So one friend ate one quarter more pizza. Clear and fair comparison!" },
      { id: '05', scene_number: 5, type: 'example', words: ['JUICE', '1/2', '3/4'], subtext: 'Different denominator steps', accent: '#a78bfa', voice: "Compare 1/2 and 3/4 juice bottles. Step 1: find common denominator 4. Step 2: convert 1/2 to 2/4 by multiplying top and bottom by 2. Step 3: compare 2/4 and 3/4; 3/4 is larger. Verification in decimals: 1/2 = 0.5 and 3/4 = 0.75, so 0.75 is greater. This method works for many fraction comparisons." },
      { id: '06', scene_number: 6, type: 'summary', words: ['TYPE', 'COMPARE', 'CONFIDENCE'], subtext: 'Fractions now make sense', accent: '#a78bfa', voice: "Wonderful work today! You learned fraction parts, different fraction types, and comparison rules for same or different denominators. Always check if parts are equal-sized before comparing. Convert to a common denominator when needed. Practice with food portions and measuring cups at home, and fractions will feel natural, useful, and easy in both classwork and daily life." },
    ],
  },
  'Grade 4|Equivalent Fractions': {
    id: 'pyp_g4_mathematics_equivalent_fractions',
    title: 'Equivalent Fractions',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['EQUIVALENT', 'FRACTIONS', 'SAME'], subtext: 'Different look, same value', accent: '#a78bfa', voice: "Hi learners! Today we will study equivalent fractions, fractions that look different but have the same value. This is like two different roads reaching the same destination. Equivalent fractions are useful in comparing, adding, and simplifying fractions later. We will use multiplication and division rules, plus real examples, to prove fractions are equal without guessing." },
      { id: '02', scene_number: 2, type: 'concept', words: ['MULTIPLY', 'TOP', 'BOTTOM'], subtext: 'Create equivalent forms', accent: '#a78bfa', voice: "To make an equivalent fraction, multiply numerator and denominator by the same non-zero number. Example: 1/2 becomes 2/4, 3/6, and 4/8. The value stays same because we scale both parts equally. Think of cutting each half into two smaller equal pieces; amount is unchanged. This rule helps build common denominators for later operations." },
      { id: '03', scene_number: 3, type: 'concept', words: ['DIVIDE', 'SIMPLIFY', 'LOWEST'], subtext: 'Reduce fractions neatly', accent: '#a78bfa', voice: "We can also divide numerator and denominator by the same common factor to simplify fractions. Example: 8/12 divided by 4 becomes 2/3. This is called writing in lowest terms. Simplified fractions are easier to compare and calculate. Always divide both parts by the same number, otherwise the fraction value changes and the answer becomes incorrect." },
      { id: '04', scene_number: 4, type: 'example', words: ['RECIPE', '2/3', '4/6'], subtext: 'Prove equivalence with steps', accent: '#a78bfa', voice: "A recipe needs 2/3 cup milk, but your cup marks show sixths. Step 1: convert 2/3 to denominator 6 by multiplying top and bottom by 2. Step 2: 2 x 2 = 4 and 3 x 2 = 6, so 2/3 = 4/6. Step 3: verify in decimal: 2/3 and 4/6 both equal 0.666... approximately. Same quantity, different fraction form." },
      { id: '05', scene_number: 5, type: 'example', words: ['POSTER', '9/12', '3/4'], subtext: 'Simplify to lowest terms', accent: '#a78bfa', voice: "A poster is colored 9/12 blue. Step 1: find greatest common factor of 9 and 12, which is 3. Step 2: divide numerator and denominator by 3: 9/12 = 3/4. Step 3: check by cross multiplication: 9 x 4 = 36 and 12 x 3 = 36, equal products confirm equivalent fractions. So 9/12 and 3/4 represent the same colored area." },
      { id: '06', scene_number: 6, type: 'summary', words: ['SAME', 'VALUE', 'FORMS'], subtext: 'Equivalent fractions mastered', accent: '#a78bfa', voice: "Great job! You can now create and simplify equivalent fractions using equal multiplication or division. Remember, both numerator and denominator must change by the same factor. Use this skill to compare fractions and solve recipe or measurement questions faster. Keep practicing with drawings and fraction strips, and you will spot equivalent fractions instantly." },
    ],
  },
  'Grade 4|Adding and Subtracting Fractions': {
    id: 'pyp_g4_mathematics_adding_and_subtracting_fractions',
    title: 'Adding and Subtracting Fractions',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['ADD', 'SUBTRACT', 'FRACTIONS'], subtext: 'Combine and remove parts', accent: '#a78bfa', voice: "Welcome back, fraction thinkers! Today we will add and subtract fractions in a simple, structured way. This helps in recipes, time planning, and sharing quantities. We will start with same denominators, then handle different denominators using equivalent fractions. By the end, you will solve step-by-step confidently and know exactly why each step works." },
      { id: '02', scene_number: 2, type: 'concept', words: ['SAME', 'DENOMINATOR', 'EASY'], subtext: 'Add numerators only', accent: '#a78bfa', voice: "When denominators are the same, keep denominator unchanged and add or subtract only numerators. Example: 2/7 + 3/7 = 5/7. Think of slices of equal size; only number of slices changes. This rule is quick and reliable. Always simplify your final fraction if possible to present clean and correct answers." },
      { id: '03', scene_number: 3, type: 'concept', words: ['COMMON', 'DENOMINATOR', 'CONVERT'], subtext: 'Different denominator method', accent: '#a78bfa', voice: "For different denominators, first convert to equivalent fractions with a common denominator. Then operate on numerators. Example idea: 1/2 and 1/3 become 3/6 and 2/6. After adding or subtracting, simplify if needed. This process avoids mistakes and ensures parts are the same size before combining or taking away." },
      { id: '04', scene_number: 4, type: 'example', words: ['PIZZA', '3/8', '+2/8'], subtext: 'Addition with same denominator', accent: '#a78bfa', voice: "At a party, one group ate 3/8 pizza and another ate 2/8. Step 1: denominator is same, keep 8. Step 2: add numerators, 3 + 2 = 5. So total eaten = 5/8. Step 3: check with pieces: out of 8 equal slices, 5 were eaten, 3 left. The fraction model matches our answer exactly." },
      { id: '05', scene_number: 5, type: 'example', words: ['JUICE', '3/4', '-1/6'], subtext: 'Subtraction with conversion', accent: '#a78bfa', voice: "A bottle had 3/4 liter juice, and 1/6 liter was used. Step 1: common denominator of 4 and 6 is 12. Step 2: convert 3/4 = 9/12 and 1/6 = 2/12. Step 3: subtract numerators, 9 - 2 = 7, denominator stays 12. Remaining juice = 7/12 liter. Verification: 2/12 + 7/12 = 9/12 = 3/4." },
      { id: '06', scene_number: 6, type: 'summary', words: ['COMMON', 'THEN', 'SOLVE'], subtext: 'Fraction operations clear', accent: '#a78bfa', voice: "Brilliant effort! You now add and subtract fractions by checking denominators first. Same denominators mean direct numerator operation. Different denominators need conversion to common denominator before solving. Always simplify and verify with reverse operations when possible. Practice with food and measurement examples, and fraction arithmetic will become fast, clear, and accurate." },
    ],
  },
  'Grade 4|Multiplying Fractions by Whole Numbers': {
    id: 'pyp_g4_mathematics_multiplying_fractions_by_whole_numbers',
    title: 'Multiplying Fractions by Whole Numbers',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['FRACTION', 'TIMES', 'WHOLE'], subtext: 'Repeated fractional groups', accent: '#a78bfa', voice: "Hello maths builders! Today we will multiply fractions by whole numbers, like 3 times 1/4. This means repeated addition of the same fraction. You will see how useful this is in recipes, distances, and sharing tasks. We will use simple rules and visual logic so every answer feels meaningful, not memorized. Let us get started with confidence and curiosity." },
      { id: '02', scene_number: 2, type: 'concept', words: ['NUMERATOR', 'MULTIPLY', 'KEEP'], subtext: 'Denominator stays same', accent: '#a78bfa', voice: "Rule: multiply the whole number with the numerator, and keep denominator the same. Example: 4 times 2/5 equals 8/5. This works because you are adding 2/5 four times. You may convert improper fractions to mixed numbers if needed. Understanding repeated addition helps you trust the formula and apply it accurately in word problems." },
      { id: '03', scene_number: 3, type: 'concept', words: ['REPEATED', 'ADDITION', 'MODEL'], subtext: 'Why formula works', accent: '#a78bfa', voice: "Think of 3 times 1/6 as 1/6 + 1/6 + 1/6 = 3/6. Same denominator stays because part size does not change; only number of parts increases. Sometimes the result simplifies, like 3/6 to 1/2. This connection between multiplication and addition strengthens your fraction sense and helps in mental maths too." },
      { id: '04', scene_number: 4, type: 'example', words: ['RIBBON', '3', '×', '2/7'], subtext: 'Craft class calculation', accent: '#a78bfa', voice: "Each craft project needs 2/7 meter ribbon. For 3 projects, Step 1: multiply numerator 2 x 3 = 6. Step 2: keep denominator 7, so total ribbon = 6/7 meter. Step 3: verify by repeated addition: 2/7 + 2/7 + 2/7 = 6/7. The answer matches. This helps teachers buy exact supplies for class activities." },
      { id: '05', scene_number: 5, type: 'example', words: ['WATER', '5', '×', '3/4'], subtext: 'Convert improper result', accent: '#a78bfa', voice: "A runner drinks 3/4 liter water after each lap and completes 5 laps. Step 1: multiply 5 x 3/4 = 15/4 liters. Step 2: convert to mixed number: 15 divided by 4 = 3 remainder 3, so 15/4 = 3 3/4 liters. Step 3: check: 3 3/4 equals 3.75 liters, reasonable for sports hydration after multiple laps." },
      { id: '06', scene_number: 6, type: 'summary', words: ['MULTIPLY', 'SIMPLIFY', 'INTERPRET'], subtext: 'Fraction multiplication done', accent: '#a78bfa', voice: "Excellent learning! You multiplied fractions by whole numbers using numerator multiplication and constant denominator. You also used repeated addition to verify and converted improper fractions when needed. Keep connecting answers to real contexts like water, ribbon, and food portions. Practice daily, and this skill will become automatic and very useful in later fraction topics." },
    ],
  },
  'Grade 4|Decimals (Tenths and Hundredths)': {
    id: 'pyp_g4_mathematics_decimals_tenths_and_hundredths',
    title: 'Decimals (Tenths and Hundredths)',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['DECIMALS', 'TENTHS', 'HUNDREDTHS'], subtext: 'Parts smaller than one', accent: '#a78bfa', voice: "Welcome, decimal explorers! Today we will understand tenths and hundredths. Decimals help us describe values between whole numbers, such as money, length, and weight. You already know fractions, and decimals are another way to write those parts. We will read, write, and interpret decimals with confidence. By the end, 0.4 and 0.25 will feel as clear as ordinary whole numbers." },
      { id: '02', scene_number: 2, type: 'concept', words: ['DECIMAL', 'POINT', 'PLACES'], subtext: 'Know each place value', accent: '#a78bfa', voice: "In decimals, the first place right of the decimal point is tenths, and the second is hundredths. So in 3.47, 4 means four tenths and 7 means seven hundredths. Place value still matters greatly. Moving one place right divides value by ten. This idea helps in reading prices and measuring lengths correctly without mixing digits." },
      { id: '03', scene_number: 3, type: 'concept', words: ['FRACTION', 'TO', 'DECIMAL'], subtext: 'Convert familiar parts', accent: '#a78bfa', voice: "Tenths and hundredths connect directly to fractions. Example: 3/10 = 0.3, 25/100 = 0.25. You can read 0.25 as twenty-five hundredths. Using grids and money models makes this easy to visualize. Knowing these conversions helps compare values and perform operations later. It also helps in real situations like reading meter scales and shopping bills." },
      { id: '04', scene_number: 4, type: 'example', words: ['MONEY', 'RUPEES', 'PAISE'], subtext: 'Decimal place meaning', accent: '#a78bfa', voice: "A snack costs 12.45 rupees. Step 1: whole part is 12 rupees. Step 2: 4 in tenths place means 0.4 rupee, and 5 in hundredths means 0.05 rupee. Step 3: 0.4 + 0.05 = 0.45 rupee, so total is 12 rupees 45 paise. Verification with fraction: 45/100 rupee equals 0.45 rupee. Decimal reading is correct." },
      { id: '05', scene_number: 5, type: 'example', words: ['LENGTH', '0.7', '0.35'], subtext: 'Convert and compare parts', accent: '#a78bfa', voice: "Two ribbons are 0.7 m and 0.35 m. Step 1: convert 0.7 to hundredths: 0.70. Step 2: compare 0.70 and 0.35; 70 hundredths is greater than 35 hundredths. Step 3: find difference, 0.70 - 0.35 = 0.35 m. So first ribbon is longer by 0.35 meter. This is useful in tailoring and craft measurements." },
      { id: '06', scene_number: 6, type: 'summary', words: ['POINT', 'PLACE', 'VALUE'], subtext: 'Decimals are now clear', accent: '#a78bfa', voice: "Excellent work! You understood tenths, hundredths, and how decimal place value works. You also linked decimals with fractions and money units. Keep reading decimals aloud and converting between forms to build fluency. These skills are the foundation for decimal comparison and arithmetic. Practice with receipts and rulers, and decimals will soon become one of your easiest topics." },
    ],
  },
  'Grade 4|Comparing and Ordering Decimals': {
    id: 'pyp_g4_mathematics_comparing_and_ordering_decimals',
    title: 'Comparing and Ordering Decimals',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['COMPARE', 'ORDER', 'DECIMALS'], subtext: 'Which value is greater?', accent: '#a78bfa', voice: "Hi decimal detectives! Today we will compare and order decimal numbers correctly. This skill helps in shopping, race timings, and measurement tasks. Decimals may look tricky, but place value gives us a clear method. We will align decimal points, compare tenths and hundredths, and arrange numbers in ascending or descending order. Let us make decimal comparison quick and reliable." },
      { id: '02', scene_number: 2, type: 'concept', words: ['ALIGN', 'POINTS', 'COMPARE'], subtext: 'Compare place by place', accent: '#a78bfa', voice: "Always align decimal points before comparing. Then compare whole-number part first. If equal, compare tenths, then hundredths. You may add trailing zeroes, like 0.7 as 0.70, because value does not change. This makes comparison easier and prevents confusion. Working place by place gives accurate results for marks, prices, and distances." },
      { id: '03', scene_number: 3, type: 'concept', words: ['ASCENDING', 'DESCENDING', 'LIST'], subtext: 'Sort decimal sets', accent: '#a78bfa', voice: "To order decimals, write them with equal decimal places if needed, then compare left to right. Ascending means smallest to greatest; descending is greatest to smallest. Sorting decimals is common in data tables and scoreboards. If two values have same tenths, check hundredths next. This organized method works for any list and reduces careless errors." },
      { id: '04', scene_number: 4, type: 'example', words: ['PRICE', '2.45', '2.5'], subtext: 'Shopping comparison steps', accent: '#a78bfa', voice: "Two juice boxes cost 2.45 and 2.5 rupees. Step 1: write 2.5 as 2.50. Step 2: compare whole parts, both are 2. Step 3: compare tenths, both 5? Actually 2.45 has 4 tenths and 2.50 has 5 tenths, so 2.50 is greater. Step 4: difference is 2.50 - 2.45 = 0.05. Second juice costs five paise more." },
      { id: '05', scene_number: 5, type: 'example', words: ['RACE', 'TIMES', 'ORDER'], subtext: 'Arrange decimal timings', accent: '#a78bfa', voice: "Race times are 12.38 s, 12.03 s, and 12.3 s. Step 1: write 12.3 as 12.30. Step 2: compare whole parts, all 12. Step 3: compare tenths: 0, 3, 3 so 12.03 is smallest. Step 4: compare 12.30 and 12.38 by hundredths, 30 < 38. Ascending order is 12.03, 12.30, 12.38 seconds." },
      { id: '06', scene_number: 6, type: 'summary', words: ['PLACE', 'COMPARE', 'SORT'], subtext: 'Decimal ordering mastered', accent: '#a78bfa', voice: "Excellent! You can now compare and order decimals by aligning points and checking place values step by step. Add trailing zeroes when useful, and do not rush. This method works in money, time, and measurement contexts. Keep practicing with real numbers from receipts and sports results, and decimal ordering will become fast and accurate every time." },
    ],
  },
  'Grade 4|Adding and Subtracting Decimals': {
    id: 'pyp_g4_mathematics_adding_and_subtracting_decimals',
    title: 'Adding and Subtracting Decimals',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['ADD', 'SUBTRACT', 'DECIMALS'], subtext: 'Accurate money and measures', accent: '#a78bfa', voice: "Welcome back! Today we will add and subtract decimals, a very useful life skill for money, distance, and weight. The key idea is simple: line up decimal points first. Then operate like whole numbers. We will solve practical examples with clear column steps and checking methods. By the end, decimal arithmetic will feel organized, logical, and easy to trust." },
      { id: '02', scene_number: 2, type: 'concept', words: ['LINE', 'UP', 'POINTS'], subtext: 'Column method for decimals', accent: '#a78bfa', voice: "When adding or subtracting decimals, always place decimal points directly under each other. Add zeroes to match places if needed, like 4.5 as 4.50. Then add or subtract each column from right to left. Bring decimal point straight down into answer. This alignment rule is the most important step for correct decimal calculations." },
      { id: '03', scene_number: 3, type: 'concept', words: ['ESTIMATE', 'CHECK', 'REASON'], subtext: 'Verify decimal answers', accent: '#a78bfa', voice: "Before solving, estimate to predict answer size. For example, 2.49 + 1.52 is near 4. After solving exactly, compare with estimate. For subtraction, ensure answer is smaller than starting number when subtracting a positive value. You can also reverse-check using opposite operation. These habits build accuracy in bills and measurements." },
      { id: '04', scene_number: 4, type: 'example', words: ['BILL', '12.45', '+8.3'], subtext: 'Decimal addition steps', accent: '#a78bfa', voice: "A stationery bill has 12.45 rupees for notebooks and 8.3 rupees for pens. Step 1: write 8.3 as 8.30. Step 2: add hundredths: 5 + 0 = 5. Step 3: tenths: 4 + 3 = 7. Step 4: ones and tens: 12 + 8 = 20. Total = 20.75 rupees. Check estimate: 12 + 8 is about 20, so answer is sensible." },
      { id: '05', scene_number: 5, type: 'example', words: ['ROPE', '5.8', '-2.47'], subtext: 'Decimal subtraction steps', accent: '#a78bfa', voice: "A rope is 5.8 meters long, and 2.47 meters is cut off. Step 1: write 5.8 as 5.80. Step 2: hundredths: 0 - 7 borrow from tenths, 10 - 7 = 3. Step 3: tenths now 7 - 4 = 3. Step 4: ones: 5 - 2 = 3. Remaining rope = 3.33 meters. Verification: 3.33 + 2.47 = 5.80." },
      { id: '06', scene_number: 6, type: 'summary', words: ['ALIGN', 'SOLVE', 'VERIFY'], subtext: 'Decimal arithmetic success', accent: '#a78bfa', voice: "Great work today! You learned to add and subtract decimals by aligning decimal points and matching place values. You also used estimation and reverse operations to check answers. These skills are essential in shopping, measuring, and science activities. Keep practicing a few decimal sums daily, and you will become quick, precise, and confident with decimal arithmetic." },
    ],
  },
  'Grade 4|Measurement — Length': {
    id: 'pyp_g4_mathematics_measurement_length',
    title: 'Measurement — Length',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['LENGTH', 'UNITS', 'MEASURE'], subtext: 'How long is it?', accent: '#a78bfa', voice: "Hello measurement experts! Today we will learn about length using units like millimeter, centimeter, meter, and kilometer. Length tells us how long or tall something is. This helps in crafts, sports tracks, and travel distances. We will practice converting units and solving real examples step by step. Let us measure the world around us with confidence and accuracy." },
      { id: '02', scene_number: 2, type: 'concept', words: ['MM', 'CM', 'M'], subtext: 'Small to medium units', accent: '#a78bfa', voice: "Millimeter is very small, centimeter is larger, and meter is larger still. Key facts: 10 mm = 1 cm and 100 cm = 1 m. Choose units wisely: pencil length in cm, room length in m, and tiny object thickness in mm. Correct unit choice makes measurements meaningful and avoids confusingly large or tiny numbers." },
      { id: '03', scene_number: 3, type: 'concept', words: ['KM', 'CONVERT', 'CHOOSE'], subtext: 'Long-distance measurement', accent: '#a78bfa', voice: "Kilometer is used for long distances like roads and travel. Also, 1 km = 1000 m. To convert larger to smaller units, multiply. To convert smaller to larger units, divide. Example: 3 m = 300 cm, and 4500 m = 4.5 km. These conversions are used in maps, races, and transportation planning." },
      { id: '04', scene_number: 4, type: 'example', words: ['RIBBON', '3m', '45cm'], subtext: 'Convert and add lengths', accent: '#a78bfa', voice: "A ribbon is 3 m 45 cm and another is 2 m 80 cm. Step 1: convert to centimeters: 345 cm and 280 cm. Step 2: add: 345 + 280 = 625 cm. Step 3: convert back: 625 cm = 6 m 25 cm. Verification: 6 x 100 + 25 = 625. So total ribbon length is 6 m 25 cm." },
      { id: '05', scene_number: 5, type: 'example', words: ['RUN', '2.4KM', '750M'], subtext: 'Subtract travel distance', accent: '#a78bfa', voice: "A student plans to run 2.4 km and has already run 750 m. Step 1: convert 2.4 km to meters: 2.4 x 1000 = 2400 m. Step 2: subtract 2400 - 750 = 1650 m left. Step 3: convert to kilometers if needed: 1650 m = 1.65 km. This helps track workout goals accurately." },
      { id: '06', scene_number: 6, type: 'summary', words: ['UNITS', 'CONVERT', 'APPLY'], subtext: 'Length skills complete', accent: '#a78bfa', voice: "Excellent measuring today! You learned length units, conversions, and real-life operations. Remember key links: 10 mm = 1 cm, 100 cm = 1 m, and 1000 m = 1 km. Choose units based on object size, then convert carefully when adding or subtracting. Practice with rulers, room sizes, and map distances to strengthen your measurement confidence." },
    ],
  },
  'Grade 4|Measurement — Mass and Weight': {
    id: 'pyp_g4_mathematics_measurement_mass_and_weight',
    title: 'Measurement — Mass and Weight',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['MASS', 'WEIGHT', 'UNITS'], subtext: 'How heavy is it?', accent: '#a78bfa', voice: "Welcome, young scientists! Today we will measure mass and weight using grams and kilograms. We use these units for groceries, school bags, and science experiments. You will learn how to convert between units and solve practical questions with steps. Understanding weight helps in cooking, shopping, and health. Let us make mass measurement simple and useful." },
      { id: '02', scene_number: 2, type: 'concept', words: ['GRAM', 'KILOGRAM', 'SCALE'], subtext: 'Choose the right unit', accent: '#a78bfa', voice: "Gram is used for lighter objects like pencils and snacks. Kilogram is used for heavier objects like rice bags and body weight. Key fact: 1000 g = 1 kg. Use a weighing scale for accurate reading. Choosing proper unit avoids awkward values and helps communicate weight clearly in home and market situations." },
      { id: '03', scene_number: 3, type: 'concept', words: ['CONVERT', 'ADD', 'SUBTRACT'], subtext: 'Work with mixed units', accent: '#a78bfa', voice: "To convert kilograms to grams, multiply by 1000. To convert grams to kilograms, divide by 1000. For addition or subtraction, convert all values into same unit first. This prevents errors and makes operations straightforward. These steps are important for cooking measurements, parcel weights, and shopping bills." },
      { id: '04', scene_number: 4, type: 'example', words: ['FRUITS', '2KG', '750G'], subtext: 'Total basket weight', accent: '#a78bfa', voice: "A basket has apples weighing 2 kg 750 g and oranges weighing 1 kg 500 g. Step 1: convert to grams: 2750 g and 1500 g. Step 2: add: 2750 + 1500 = 4250 g. Step 3: convert back: 4250 g = 4 kg 250 g. Verification: 4 x 1000 + 250 = 4250. Total basket weight is correct." },
      { id: '05', scene_number: 5, type: 'example', words: ['FLOUR', '5KG', '1.8KG'], subtext: 'Remaining stock calculation', accent: '#a78bfa', voice: "A bakery had 5 kg flour and used 1.8 kg. Step 1: convert to grams: 5000 g and 1800 g. Step 2: subtract 5000 - 1800 = 3200 g. Step 3: convert back: 3200 g = 3.2 kg or 3 kg 200 g. Check: 3.2 + 1.8 = 5.0 kg. Remaining flour amount is verified." },
      { id: '06', scene_number: 6, type: 'summary', words: ['G', 'KG', 'ACCURACY'], subtext: 'Mass maths in daily life', accent: '#a78bfa', voice: "Great effort! You learned to choose gram or kilogram, convert correctly, and solve weight calculations step by step. Remember 1000 grams make 1 kilogram. Always convert to one unit before adding or subtracting. These skills help you in cooking, shopping, and science projects. Keep practicing with household objects and your measurement confidence will keep growing." },
    ],
  },
  'Grade 4|Measurement — Capacity and Volume': {
    id: 'pyp_g4_mathematics_measurement_capacity_and_volume',
    title: 'Measurement — Capacity and Volume',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['CAPACITY', 'VOLUME', 'LIQUID'], subtext: 'How much can it hold?', accent: '#a78bfa', voice: "Hello measurement stars! Today we will learn capacity and volume, which tell us how much a container can hold. This is useful for water bottles, milk packets, and cooking. We will use liters and milliliters and solve practical problems step by step. By the end, you will confidently compare, add, and subtract liquid amounts in real-life situations." },
      { id: '02', scene_number: 2, type: 'concept', words: ['LITER', 'MILLILITER', 'UNIT'], subtext: 'Basic liquid units', accent: '#a78bfa', voice: "Capacity is usually measured in liters and milliliters. Key relation: 1 liter equals 1000 milliliters. Use milliliters for small amounts like medicine and liters for larger amounts like juice bottles. Correct unit selection makes communication clear and calculations meaningful. We can convert between units just like other measurement topics." },
      { id: '03', scene_number: 3, type: 'concept', words: ['CONVERT', 'COMPARE', 'SOLVE'], subtext: 'Use same units first', accent: '#a78bfa', voice: "To add or subtract capacities, convert all values to the same unit first. Multiply liters by 1000 to get milliliters. Divide milliliters by 1000 to get liters. This step avoids mistakes and gives neat answers. These conversions are used in science labs, kitchen recipes, and daily hydration tracking." },
      { id: '04', scene_number: 4, type: 'example', words: ['JUICE', '1.5L', '+750ML'], subtext: 'Add mixed capacities', accent: '#a78bfa', voice: "A jug has 1.5 L juice, and you add 750 mL more. Step 1: convert 1.5 L to milliliters: 1.5 x 1000 = 1500 mL. Step 2: add 1500 + 750 = 2250 mL. Step 3: convert back: 2250 mL = 2.25 L or 2 L 250 mL. Verification: 2.25 L equals 2250 mL exactly." },
      { id: '05', scene_number: 5, type: 'example', words: ['TANK', '5L', '-1.8L'], subtext: 'Subtract used water', accent: '#a78bfa', voice: "A water tank has 5 L, and 1.8 L is used for plants. Step 1: convert to milliliters: 5000 mL and 1800 mL. Step 2: subtract 5000 - 1800 = 3200 mL. Step 3: convert back to liters: 3200 mL = 3.2 L. Check: 3.2 + 1.8 = 5.0, so subtraction is correct and practical for garden planning." },
      { id: '06', scene_number: 6, type: 'summary', words: ['L', 'ML', 'CONFIDENCE'], subtext: 'Capacity maths complete', accent: '#a78bfa', voice: "Great job today! You learned liters, milliliters, and the key conversion 1 L = 1000 mL. You practiced adding and subtracting by converting to one unit first. These skills help in cooking, science, and daily water tracking. Keep practicing with bottles and containers at home, and capacity calculations will become quick and accurate." },
    ],
  },
  'Grade 4|Perimeter of Polygons': {
    id: 'pyp_g4_mathematics_perimeter_of_polygons',
    title: 'Perimeter of Polygons',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['PERIMETER', 'POLYGON', 'BOUNDARY'], subtext: 'Distance around shapes', accent: '#a78bfa', voice: "Welcome, geometry learners! Today we will find the perimeter of polygons. Perimeter means the total distance around the outside of a shape. We use it for fencing gardens, framing art, and planning tracks. You will add side lengths and use shortcuts for regular polygons. Let us walk around shapes with numbers and solve practical perimeter questions." },
      { id: '02', scene_number: 2, type: 'concept', words: ['ADD', 'ALL', 'SIDES'], subtext: 'Main perimeter rule', accent: '#a78bfa', voice: "Perimeter of any polygon is found by adding all side lengths. For a regular polygon, where all sides are equal, multiply one side length by number of sides. Units stay as length units like cm or m, not square units. Accurate side reading and careful addition are essential for correct perimeter values." },
      { id: '03', scene_number: 3, type: 'concept', words: ['REGULAR', 'IRREGULAR', 'UNITS'], subtext: 'Two shape situations', accent: '#a78bfa', voice: "Regular polygons have equal sides, so multiplication is fast. Irregular polygons have different side lengths, so we add each side one by one. Always include every outer side exactly once. This method is useful in designing playground borders, chart edges, and tile paths. Perimeter helps estimate materials needed for boundaries." },
      { id: '04', scene_number: 4, type: 'example', words: ['PENTAGON', '5', 'SIDES'], subtext: 'Regular polygon shortcut', accent: '#a78bfa', voice: "A regular pentagon has side length 7 cm. Step 1: identify number of sides, 5. Step 2: perimeter = 5 x 7 = 35 cm. Step 3: verify by repeated addition: 7 + 7 + 7 + 7 + 7 = 35. So perimeter is 35 cm. This shortcut saves time for regular polygons." },
      { id: '05', scene_number: 5, type: 'example', words: ['GARDEN', 'SIDES', 'ADD'], subtext: 'Irregular shape perimeter', accent: '#a78bfa', voice: "An irregular garden has side lengths 6 m, 4 m, 5 m, 3 m, and 2 m. Step 1: add all sides: 6 + 4 + 5 + 3 + 2 = 20. Step 2: perimeter = 20 m. Step 3: check by regrouping: (6 + 4) + (5 + 3 + 2) = 10 + 10 = 20. Fence required is 20 meters." },
      { id: '06', scene_number: 6, type: 'summary', words: ['OUTSIDE', 'ADD', 'MEASURE'], subtext: 'Perimeter skills ready', accent: '#a78bfa', voice: "Excellent! You can now find polygon perimeter by adding side lengths, and use multiplication for regular polygons. Remember perimeter is outside distance, so unit is cm, m, or km. These skills help in design and construction tasks. Keep practicing with different shapes, and perimeter problems will become very quick and accurate for you." },
    ],
  },
  'Grade 4|Area of Rectangles': {
    id: 'pyp_g4_mathematics_area_of_rectangles',
    title: 'Area of Rectangles',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['AREA', 'RECTANGLE', 'SPACE'], subtext: 'Covering inside surface', accent: '#a78bfa', voice: "Hello, geometry champs! Today we will learn area of rectangles. Area measures the space inside a shape, not around it. We use area to plan flooring, wall posters, and garden beds. You will use the rectangle formula and solve real examples with clear steps. By the end, you will confidently calculate how much surface is covered." },
      { id: '02', scene_number: 2, type: 'concept', words: ['AREA', 'LENGTH', 'WIDTH'], subtext: 'Rectangle formula rule', accent: '#a78bfa', voice: "For rectangles, area equals length multiplied by width. The answer is in square units, such as square centimeters or square meters. Why square? Because we count how many unit squares fit inside the shape. If dimensions are in different units, convert first. Using correct units is essential for meaningful area answers." },
      { id: '03', scene_number: 3, type: 'concept', words: ['SQUARE', 'UNITS', 'GRID'], subtext: 'Visualize with tiles', accent: '#a78bfa', voice: "Imagine a rectangle drawn on grid paper. If length is 6 units and width is 4 units, there are 24 tiny squares inside. This visual model proves the formula length times width. Area helps compare surface sizes, while perimeter compares boundary lengths. Knowing this difference prevents common mistakes in geometry questions." },
      { id: '04', scene_number: 4, type: 'example', words: ['CLASSROOM', '8M', '×4M'], subtext: 'Flooring area calculation', accent: '#a78bfa', voice: "A classroom floor is 8 m long and 4 m wide. Step 1: use area formula, A = l x w. Step 2: multiply 8 x 4 = 32. Step 3: write units as square meters: 32 m squared. Verification: 8 rows of 4 unit squares also gives 32 squares. So flooring area is 32 square meters." },
      { id: '05', scene_number: 5, type: 'example', words: ['PHOTO', '15CM', '×10CM'], subtext: 'Poster coverage problem', accent: '#a78bfa', voice: "A photo frame front is 15 cm by 10 cm. Step 1: area = 15 x 10. Step 2: multiply to get 150. Step 3: units are square centimeters, so area = 150 cm squared. Check by splitting: 10 x 10 + 5 x 10 = 100 + 50 = 150. This helps decide paper size needed to cover the frame." },
      { id: '06', scene_number: 6, type: 'summary', words: ['INSIDE', 'MULTIPLY', 'SQUARE'], subtext: 'Area concept secured', accent: '#a78bfa', voice: "Great work! You learned area of rectangles using length times width and wrote answers in square units. You also checked results using grid thinking and decomposition. Remember area is inside space, not outside boundary. Practice with notebooks, desks, and room floors around you, and rectangle area problems will become simple and accurate every time." },
    ],
  },
  'Grade 4|Time (24-hour Clock)': {
    id: 'pyp_g4_mathematics_time_24_hour_clock',
    title: 'Time (24-hour Clock)',
    grade: 'Grade 4', subject: 'Mathematics', curriculum: 'IB PYP',
    accent: '#a78bfa',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['TIME', '24-HOUR', 'CLOCK'], subtext: 'Read military style time', accent: '#a78bfa', voice: "Welcome, time managers! Today we will learn the 24-hour clock format used in airports, hospitals, and train schedules. Instead of AM and PM, the day runs from 00:00 to 23:59. You will convert between 12-hour and 24-hour time and solve time difference examples. This skill helps avoid confusion and improve daily planning accuracy." },
      { id: '02', scene_number: 2, type: 'concept', words: ['AM', 'PM', 'CONVERT'], subtext: 'Switch between formats', accent: '#a78bfa', voice: "To convert PM time to 24-hour format, add 12 to the hour, except for 12 PM. Example: 3:20 PM becomes 15:20. AM times stay same, but 12:00 AM becomes 00:00. Converting correctly helps read timetables and alarms. Keep minutes unchanged while converting hours." },
      { id: '03', scene_number: 3, type: 'concept', words: ['ELAPSED', 'TIME', 'SCHEDULE'], subtext: 'Find duration between times', accent: '#a78bfa', voice: "Elapsed time means how long an activity lasts. In 24-hour format, subtraction is often easier. If a movie starts at 14:30 and ends at 16:05, subtract to find duration. You can also split into chunks like 14:30 to 15:30 and then to 16:05. This method is practical for planning travel and study sessions." },
      { id: '04', scene_number: 4, type: 'example', words: ['TRAIN', '7:45PM', '->19:45'], subtext: 'Convert time format', accent: '#a78bfa', voice: "A train leaves at 7:45 PM. Step 1: because it is PM, add 12 to hour 7. Step 2: 7 + 12 = 19. Step 3: keep minutes 45, so time is 19:45. Verification: converting back, 19 - 12 = 7 PM, so 19:45 equals 7:45 PM. This is exactly how railway charts show evening times." },
      { id: '05', scene_number: 5, type: 'example', words: ['CLASS', '13:20', '15:05'], subtext: 'Find elapsed time', accent: '#a78bfa', voice: "A workshop starts at 13:20 and ends at 15:05. Step 1: from 13:20 to 14:20 is 1 hour. Step 2: from 14:20 to 15:00 is 40 minutes. Step 3: from 15:00 to 15:05 is 5 minutes. Total duration = 1 hour 45 minutes. Check by subtraction: 15:05 - 13:20 also gives 1:45." },
      { id: '06', scene_number: 6, type: 'summary', words: ['CONVERT', 'SUBTRACT', 'PLAN'], subtext: 'Time skills improved', accent: '#a78bfa', voice: "Excellent timing work! You learned to convert between 12-hour and 24-hour formats and calculate elapsed time. Remember key rule: add 12 for PM times except 12 PM, and midnight is 00:00. These skills are essential for travel, exams, and daily routines. Practice with your timetable, and time calculations will become easy and precise." },
    ],
  },
  'Grade 4|Angles (Types and Measurement)': {
    id: "pyp_g4_mathematics_angles_types_and_measurement",
    title: "Angles (Types and Measurement)",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ANGLES", "TYPES", "MEASUREMENT"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Angles (Types and Measurement). You use this skill when construction and turn measurements. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ANGLES", "TYPES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: angles are measured in degrees and classified by size. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ANGLES", "TYPES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: line angles use 180 degrees and point angles use 360 degrees. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ANGLES", "TYPES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Angle on protractor reads 65 degrees. Step 1: 65 is less than 90 so it is acute. Step 2: complement to 90 is 25. Step 3: classification check is complete. type identification is correct. This is useful in design drawings, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Two angles on a line are 125 and x. Step 1: 125 + x = 180 so x = 55. Step 2: around-point checks use 360 similarly. Step 3: substitution verifies linear sum. angle relation is clear. This is useful in road layouts, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Angles (Types and Measurement). You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Lines and Line Segments': {
    id: "pyp_g4_mathematics_lines_and_line_segments",
    title: "Lines and Line Segments",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["LINES", "LINE", "SEGMENTS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Lines and Line Segments. You use this skill when map routes and measurements. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["LINES", "LINE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: line, ray, and segment differ by endpoints and direction. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["LINES", "LINE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: segment length is measured directly or by scale conversion. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["LINES", "LINE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Scale says 1 cm equals 5 m and segment is 7 cm. Step 1: convert with 7 x 5 = 35 m. Step 2: segment length is 35 m. Step 3: reverse divide checks scale. measurement is correct. This is useful in map reading, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "A 24 m rope is cut into 3 equal segments. Step 1: 24/3 = 8 m per segment. Step 2: each segment is equal. Step 3: 8 x 3 = 24 verifies cut. division check is complete. This is useful in sports marking, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Lines and Line Segments. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|2D Shapes and Properties': {
    id: "pyp_g4_mathematics_2d_shapes_and_properties",
    title: "2D Shapes and Properties",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["2D", "SHAPES", "PROPERTIES"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning 2D Shapes and Properties. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["2D", "SHAPES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["2D", "SHAPES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["2D", "SHAPES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on 2D Shapes and Properties. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|3D Shapes and Nets': {
    id: "pyp_g4_mathematics_3d_shapes_and_nets",
    title: "3D Shapes and Nets",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["3D", "SHAPES", "NETS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning 3D Shapes and Nets. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["3D", "SHAPES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["3D", "SHAPES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["3D", "SHAPES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on 3D Shapes and Nets. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Symmetry and Reflection': {
    id: "pyp_g4_mathematics_symmetry_and_reflection",
    title: "Symmetry and Reflection",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SYMMETRY", "REFLECTION"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Symmetry and Reflection. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SYMMETRY", "REFLECTION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SYMMETRY", "REFLECTION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SYMMETRY", "REFLECTION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Symmetry and Reflection. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Patterns and Sequences': {
    id: "pyp_g4_mathematics_patterns_and_sequences",
    title: "Patterns and Sequences",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PATTERNS", "SEQUENCES"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Patterns and Sequences. You use this skill when daily maths applications. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PATTERNS", "SEQUENCES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: this topic builds strong number sense and problem-solving habits. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PATTERNS", "SEQUENCES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: step-by-step work and checking improve accuracy and confidence. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PATTERNS", "SEQUENCES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Start with a practical number task. Step 1: calculate 24 + 36 = 60. Step 2: then 60 x 3 = 180. Step 3: reverse 180/3 = 60 checks consistency. operations are verified. This is useful in everyday planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Use two operations in sequence. Step 1: 84 - 29 = 55 then 55 + 17 = 72. Step 2: subtract 17 to return 55. Step 3: inverse check confirms each step. calculation chain is reliable. This is useful in home tasks, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Patterns and Sequences. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Introduction to Algebra': {
    id: "pyp_g4_mathematics_introduction_to_algebra",
    title: "Introduction to Algebra",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["INTRODUCTION", "ALGEBRA"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Introduction to Algebra. You use this skill when unknown values and formulas. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["INTRODUCTION", "ALGEBRA", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: variables represent unknowns and expressions model relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["INTRODUCTION", "ALGEBRA", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: inverse operations and substitution verify results. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["INTRODUCTION", "ALGEBRA", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Solve x + 7 = 19. Step 1: x = 19 - 7 = 12. Step 2: substitute to check 12 + 7 = 19. Step 3: equation is balanced. solution is correct. This is useful in puzzles, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Evaluate 3a + 2 at a = 5. Step 1: 3 x 5 + 2 = 17. Step 2: expression value is 17. Step 3: try another value to check pattern. substitution method works. This is useful in formula use, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Introduction to Algebra. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Data Handling ? Bar Graphs': {
    id: "pyp_g4_mathematics_data_handling_bar_graphs",
    title: "Data Handling ? Bar Graphs",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["DATA", "HANDLING", "BAR", "GRAPHS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Data Handling ? Bar Graphs. You use this skill when visual data reading and comparison. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["DATA", "HANDLING", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: graphs and pictographs show values using scales or keys. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["DATA", "HANDLING", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: read carefully to find totals, differences, and trends. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["DATA", "HANDLING", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Values are 12, 9, and 15. Step 1: difference is 15 - 9 = 6. Step 2: total is 12 + 9 + 15 = 36. Step 3: scale check confirms reading. summary values are correct. This is useful in school reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Values are 5, 8, and 7. Step 1: total is 20 and average is 20/3 = 6.67. Step 2: largest value is 8. Step 3: trend and average both make sense. data interpretation is accurate. This is useful in activity tracking, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Data Handling ? Bar Graphs. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Data Handling ? Pictographs': {
    id: "pyp_g4_mathematics_data_handling_pictographs",
    title: "Data Handling ? Pictographs",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["DATA", "HANDLING", "PICTOGRAPHS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Data Handling ? Pictographs. You use this skill when visual data reading and comparison. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["DATA", "HANDLING", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: graphs and pictographs show values using scales or keys. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["DATA", "HANDLING", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: read carefully to find totals, differences, and trends. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["DATA", "HANDLING", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Values are 12, 9, and 15. Step 1: difference is 15 - 9 = 6. Step 2: total is 12 + 9 + 15 = 36. Step 3: scale check confirms reading. summary values are correct. This is useful in school reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Values are 5, 8, and 7. Step 1: total is 20 and average is 20/3 = 6.67. Step 2: largest value is 8. Step 3: trend and average both make sense. data interpretation is accurate. This is useful in activity tracking, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Data Handling ? Pictographs. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Mean and Average': {
    id: "pyp_g4_mathematics_mean_and_average",
    title: "Mean and Average",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["MEAN", "AVERAGE"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Mean and Average. You use this skill when summarizing score and temperature data. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["MEAN", "AVERAGE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: mean = total sum divided by number of values. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["MEAN", "AVERAGE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: average gives a representative value for comparison. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["MEAN", "AVERAGE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Scores are 12, 15, 18, 15. Step 1: sum = 60 and count = 4. Step 2: mean = 60/4 = 15. Step 3: 15 x 4 = 60 verifies mean. average is accurate. This is useful in class analysis, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Temperatures are 28, 30, 29, 31, 32. Step 1: sum = 150 and count = 5. Step 2: average = 150/5 = 30. Step 3: 30 x 5 confirms total. weekly mean is correct. This is useful in weather reporting, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Mean and Average. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Roman Numerals': {
    id: "pyp_g4_mathematics_roman_numerals",
    title: "Roman Numerals",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ROMAN", "NUMERALS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Roman Numerals. You use this skill when reading clocks and chapter titles. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ROMAN", "NUMERALS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: Roman symbols I, V, X, L, C, D, and M follow addition and subtraction rules. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ROMAN", "NUMERALS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: smaller-before-larger means subtraction; otherwise add values. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ROMAN", "NUMERALS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Convert LXIV. Step 1: L + X = 50 + 10 = 60. Step 2: IV = 5 - 1 = 4. Step 3: total is 60 + 4 = 64. writing back LXIV verifies conversion. This is useful in history and time reading, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Write 89 in Roman form. Step 1: split as 50 + 30 + 9. Step 2: convert to L + XXX + IX. Step 3: final numeral is LXXXIX. value sum checks 89 exactly. This is useful in museum labels, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Roman Numerals. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Rounding and Estimation': {
    id: "pyp_g4_mathematics_rounding_and_estimation",
    title: "Rounding and Estimation",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ROUNDING", "ESTIMATION"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Rounding and Estimation. You use this skill when quick reasonableness checks. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ROUNDING", "ESTIMATION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: rounding uses nearest place-value rules. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ROUNDING", "ESTIMATION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: estimation helps catch large calculation errors. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ROUNDING", "ESTIMATION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "Round 4,768 to nearest hundred. Step 1: tens digit 6 means round up. Step 2: result is 4,800. Step 3: distance check confirms nearest hundred. rounding is correct. This is useful in budget checks, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Estimate 298 + 503. Step 1: round to 300 and 500 so estimate 800. Step 2: exact is 801 and very close. Step 3: estimate validates exact sum. reasonableness check passes. This is useful in mental maths, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Rounding and Estimation. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Money and Financial Maths': {
    id: "pyp_g4_mathematics_money_and_financial_maths",
    title: "Money and Financial Maths",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["MONEY", "FINANCIAL", "MATHS"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Money and Financial Maths. You use this skill when shopping and savings planning. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["MONEY", "FINANCIAL", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: use multiplication for repeated costs and subtraction for change. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["MONEY", "FINANCIAL", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: budgeting compares income, spending, and savings. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["MONEY", "FINANCIAL", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "3 notebooks cost 45 each and a pen costs 28. Step 1: notebooks total = 3 x 45 = 135. Step 2: bill = 135 + 28 = 163 and change from 200 is 37. Step 3: 163 + 37 = 200 confirms. money operations are correct. This is useful in store billing, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Save 120 each week for 4 weeks and already have 250. Step 1: weekly savings = 120 x 4 = 480. Step 2: total = 480 + 250 = 730. Step 3: subtract 250 to check weekly part. savings total is verified. This is useful in goal setting, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Money and Financial Maths. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Word Problems (Mixed)': {
    id: "pyp_g4_mathematics_word_problems_mixed",
    title: "Word Problems (Mixed)",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["WORD", "PROBLEMS", "MIXED"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Word Problems (Mixed). You use this skill when multi-step real situations. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["WORD", "PROBLEMS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: break stories into ordered operations with units. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["WORD", "PROBLEMS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: work backward or verify each step to avoid mistakes. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["WORD", "PROBLEMS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "6 buses with 42 seats each and 37 empty. Step 1: total seats 252 and occupied 252 - 37 = 215. Step 2: add 5 teachers to get 220 people. Step 3: step sequence validates answer. word-problem reasoning is clear. This is useful in trip planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Puzzle says number x3 then +6 gives 24. Step 1: 24 - 6 = 18 then 18/3 = 6. Step 2: check 6x3 + 6 = 24. Step 3: working backward confirms unknown. logic method is correct. This is useful in brain games, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Word Problems (Mixed). You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Logical Reasoning and Puzzles': {
    id: "pyp_g4_mathematics_logical_reasoning_and_puzzles",
    title: "Logical Reasoning and Puzzles",
    grade: "Grade 4", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#a78bfa",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["LOGICAL", "REASONING", "PUZZLES"], subtext: "Start strong today", accent: "#a78bfa", voice: "Welcome, mathematicians! Today we are learning Logical Reasoning and Puzzles. You use this skill when multi-step real situations. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["LOGICAL", "REASONING", "RULE", "FORMULA"], subtext: "First key idea", accent: "#a78bfa", voice: "First key concept: break stories into ordered operations with units. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["LOGICAL", "REASONING", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#a78bfa", voice: "Second key concept: work backward or verify each step to avoid mistakes. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["LOGICAL", "REASONING", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#a78bfa", voice: "6 buses with 42 seats each and 37 empty. Step 1: total seats 252 and occupied 252 - 37 = 215. Step 2: add 5 teachers to get 220 people. Step 3: step sequence validates answer. word-problem reasoning is clear. This is useful in trip planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#a78bfa", voice: "Puzzle says number x3 then +6 gives 24. Step 1: 24 - 6 = 18 then 18/3 = 6. Step 2: check 6x3 + 6 = 24. Step 3: working backward confirms unknown. logic method is correct. This is useful in brain games, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#a78bfa", voice: "Excellent effort today on Logical Reasoning and Puzzles. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Large Numbers and Place Value': {
    id: "pyp_g5_mathematics_large_numbers_and_place_value",
    title: "Large Numbers and Place Value",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["LARGE", "NUMBERS", "PLACE", "VALUE"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Large Numbers and Place Value. You use this skill when population and budget scale numbers. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["LARGE", "NUMBERS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: place value and alignment are crucial for big-number operations. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["LARGE", "NUMBERS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: estimate first and verify with inverse operations. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["LARGE", "NUMBERS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Expand 7,305,482. Step 1: 7,000,000 + 300,000 + 5,000 + 400 + 80 + 2. Step 2: adding parts recreates original number. Step 3: expanded form confirms place values. number decomposition is correct. This is useful in data analysis, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Add 2,458,760 and 1,236,945. Step 1: sum = 3,695,705. Step 2: estimate near 3.70 million supports answer. Step 3: subtract one addend to verify. large addition is correct. This is useful in finance totals, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Large Numbers and Place Value. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Operations on Large Numbers': {
    id: "pyp_g5_mathematics_operations_on_large_numbers",
    title: "Operations on Large Numbers",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["OPERATIONS", "LARGE", "NUMBERS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Operations on Large Numbers. You use this skill when population and budget scale numbers. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["OPERATIONS", "LARGE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: place value and alignment are crucial for big-number operations. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["OPERATIONS", "LARGE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: estimate first and verify with inverse operations. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["OPERATIONS", "LARGE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Expand 7,305,482. Step 1: 7,000,000 + 300,000 + 5,000 + 400 + 80 + 2. Step 2: adding parts recreates original number. Step 3: expanded form confirms place values. number decomposition is correct. This is useful in data analysis, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Add 2,458,760 and 1,236,945. Step 1: sum = 3,695,705. Step 2: estimate near 3.70 million supports answer. Step 3: subtract one addend to verify. large addition is correct. This is useful in finance totals, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Operations on Large Numbers. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Order of Operations (BODMAS)': {
    id: "pyp_g5_mathematics_order_of_operations_bodmas",
    title: "Order of Operations (BODMAS)",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ORDER", "OPERATIONS", "BODMAS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Order of Operations (BODMAS). You use this skill when multi-operation expressions. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ORDER", "OPERATIONS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: BODMAS order is Brackets, Orders, Division, Multiplication, Addition, Subtraction. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ORDER", "OPERATIONS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: keeping order fixed prevents incorrect answers. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ORDER", "OPERATIONS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Evaluate 48/6 x (3+1) - 5. Step 1: bracket gives 4 and 48/6 gives 8. Step 2: 8 x 4 = 32 then 32 - 5 = 27. Step 3: final answer is 27. operation order is verified. This is useful in formula solving, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Evaluate 90 - [12 + (6 x 5)]. Step 1: 6 x 5 = 30, bracket becomes 42. Step 2: 90 - 42 = 48. Step 3: substitute bracket value to check. result is correct. This is useful in spreadsheet math, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Order of Operations (BODMAS). You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|LCM and HCF': {
    id: "pyp_g5_mathematics_lcm_and_hcf",
    title: "LCM and HCF",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["LCM", "HCF"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning LCM and HCF. You use this skill when cycle timing and equal grouping. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["LCM", "HCF", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: LCM finds common multiple and HCF finds greatest shared factor. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["LCM", "HCF", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: prime factors provide a reliable method for both. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["LCM", "HCF", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Find LCM of 12 and 18. Step 1: 12=2x2x3 and 18=2x3x3. Step 2: LCM uses highest powers: 2x2x3x3 = 36. Step 3: 36 is divisible by both. LCM is verified. This is useful in event cycles, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Find HCF of 48 and 60. Step 1: common factors include 1,2,3,4,6,12. Step 2: highest common factor is 12. Step 3: both numbers divide cleanly by 12. HCF is correct. This is useful in equal grouping, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on LCM and HCF. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Fractions ? Advanced Operations': {
    id: "pyp_g5_mathematics_fractions_advanced_operations",
    title: "Fractions ? Advanced Operations",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["FRACTIONS", "ADVANCED", "OPERATIONS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Fractions ? Advanced Operations. You use this skill when sharing and recipe quantities. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["FRACTIONS", "ADVANCED", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: use common denominators for addition and subtraction. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["FRACTIONS", "ADVANCED", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: simplify final fractions and verify using reverse operations. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["FRACTIONS", "ADVANCED", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Add 3/4 and 5/6. Step 1: LCM is 12 so convert to 9/12 and 10/12. Step 2: sum = 19/12 = 1 7/12. Step 3: decimal estimate near 1.58 supports answer. fraction sum is correct. This is useful in recipe scaling, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Subtract 7/8 - 1/3. Step 1: LCM is 24 so convert to 21/24 and 8/24. Step 2: difference = 13/24. Step 3: add back 13/24 + 8/24 = 21/24 to verify. subtraction is validated. This is useful in portion tracking, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Fractions ? Advanced Operations. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Ratio and Proportion': {
    id: "pyp_g5_mathematics_ratio_and_proportion",
    title: "Ratio and Proportion",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["RATIO", "PROPORTION"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Ratio and Proportion. You use this skill when mixing and scaling values. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["RATIO", "PROPORTION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: ratios compare quantities and proportions compare equivalent ratios. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["RATIO", "PROPORTION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: simplify and use unit methods to solve unknowns. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["RATIO", "PROPORTION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Simplify ratio 18:24. Step 1: divide both terms by 6 to get 3:4. Step 2: 3:4 is simplest form. Step 3: multiply back by 6 to verify. ratio simplification is correct. This is useful in class comparison, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "5 notebooks cost 75, find 8 notebooks. Step 1: unit cost = 75/5 = 15. Step 2: cost of 8 = 15 x 8 = 120. Step 3: proportion check 5/75 = 8/120. answer is verified. This is useful in shopping, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Ratio and Proportion. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Percentage ? Concept and Calculation': {
    id: "pyp_g5_mathematics_percentage_concept_and_calculation",
    title: "Percentage ? Concept and Calculation",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PERCENTAGE", "CONCEPT", "CALCULATION"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Percentage ? Concept and Calculation. You use this skill when scores, discounts, and growth. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PERCENTAGE", "CONCEPT", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: percentage means per hundred and links fractions and decimals. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PERCENTAGE", "CONCEPT", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: find percent amount first, then add or subtract from original. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PERCENTAGE", "CONCEPT", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Find score percent for 45 out of 60. Step 1: (45/60) x 100 = 75. Step 2: score is 75 percent. Step 3: 75 percent of 60 returns 45. percentage conversion is correct. This is useful in exam reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Find 20 percent discount on 1500. Step 1: discount = 20/100 x 1500 = 300. Step 2: sale price = 1500 - 300 = 1200. Step 3: 10 percent shortcut confirms 300. price result is verified. This is useful in shopping, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Percentage ? Concept and Calculation. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Percentage ? Real Life Problems': {
    id: "pyp_g5_mathematics_percentage_real_life_problems",
    title: "Percentage ? Real Life Problems",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PERCENTAGE", "REAL", "LIFE", "PROBLEMS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Percentage ? Real Life Problems. You use this skill when scores, discounts, and growth. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PERCENTAGE", "REAL", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: percentage means per hundred and links fractions and decimals. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PERCENTAGE", "REAL", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: find percent amount first, then add or subtract from original. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PERCENTAGE", "REAL", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Find score percent for 45 out of 60. Step 1: (45/60) x 100 = 75. Step 2: score is 75 percent. Step 3: 75 percent of 60 returns 45. percentage conversion is correct. This is useful in exam reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Find 20 percent discount on 1500. Step 1: discount = 20/100 x 1500 = 300. Step 2: sale price = 1500 - 300 = 1200. Step 3: 10 percent shortcut confirms 300. price result is verified. This is useful in shopping, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Percentage ? Real Life Problems. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Decimals ? Multiplication and Division': {
    id: "pyp_g5_mathematics_decimals_multiplication_and_division",
    title: "Decimals ? Multiplication and Division",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["DECIMALS", "MULTIPLICATION", "DIVISION"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Decimals ? Multiplication and Division. You use this skill when money and precise measurements. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["DECIMALS", "MULTIPLICATION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: multiply decimals as whole numbers then place decimal. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["DECIMALS", "MULTIPLICATION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: for division, scale numbers to make divisor whole. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["DECIMALS", "MULTIPLICATION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Compute 3.6 x 2.5. Step 1: 36 x 25 = 900. Step 2: two decimal places give 9.00. Step 3: estimate near 10 supports answer. decimal placement is correct. This is useful in billing, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Compute 7.56/0.3. Step 1: scale to 75.6/3. Step 2: quotient = 25.2. Step 3: 25.2 x 0.3 = 7.56 verifies. division is correct. This is useful in unit rates, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Decimals ? Multiplication and Division. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Unitary Method': {
    id: "pyp_g5_mathematics_unitary_method",
    title: "Unitary Method",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["UNITARY", "METHOD"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Unitary Method. You use this skill when value-per-one calculations. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["UNITARY", "METHOD", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: first find value of one unit then scale up. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["UNITARY", "METHOD", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: unitary method works for cost, time, and distance. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["UNITARY", "METHOD", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "7 pens cost 84. Step 1: one pen = 84/7 = 12. Step 2: 15 pens = 12 x 15 = 180. Step 3: 12 x 7 confirms base rate. unit method is correct. This is useful in price planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "180 km in 3 h. Step 1: 1-hour distance = 60 km. Step 2: 5-hour distance = 60 x 5 = 300. Step 3: 300/5 verifies unit rate. distance result is accurate. This is useful in travel, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Unitary Method. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Profit and Loss': {
    id: "pyp_g5_mathematics_profit_and_loss",
    title: "Profit and Loss",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PROFIT", "LOSS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Profit and Loss. You use this skill when business pricing decisions. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PROFIT", "LOSS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: profit = SP - CP and loss = CP - SP. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PROFIT", "LOSS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: profit or loss percent is based on cost price. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PROFIT", "LOSS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "CP 400 and SP 460. Step 1: profit = 60. Step 2: profit percent = 60/400 x 100 = 15. Step 3: 15 percent of 400 equals 60. profit is verified. This is useful in shop sales, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "CP 750 and SP 690. Step 1: loss = 60. Step 2: loss percent = 60/750 x 100 = 8. Step 3: 8 percent of 750 equals 60. loss is verified. This is useful in price strategy, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Profit and Loss. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Simple Interest': {
    id: "pyp_g5_mathematics_simple_interest",
    title: "Simple Interest",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SIMPLE", "INTEREST"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Simple Interest. You use this skill when banking and savings planning. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SIMPLE", "INTEREST", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: simple interest formula is SI = P x R x T / 100. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SIMPLE", "INTEREST", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: amount equals principal plus simple interest. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SIMPLE", "INTEREST", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Find SI on 2000 at 5% for 3 years. Step 1: SI = 2000 x 5 x 3 / 100 = 300. Step 2: amount = 2000 + 300 = 2300. Step 3: subtract principal to verify SI. formula use is correct. This is useful in savings plans, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Find SI on 3500 at 4% for 2 years. Step 1: SI = 3500 x 4 x 2 / 100 = 280. Step 2: amount = 3780. Step 3: amount - principal = 280 verifies interest. calculation is consistent. This is useful in loan estimates, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Simple Interest. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Integers ? Introduction and Operations': {
    id: "pyp_g5_mathematics_integers_introduction_and_operations",
    title: "Integers ? Introduction and Operations",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["INTEGERS", "INTRODUCTION", "OPERATIONS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Integers ? Introduction and Operations. You use this skill when temperature and floor changes. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["INTEGERS", "INTRODUCTION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: integers include negatives, zero, and positives. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["INTEGERS", "INTRODUCTION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: number-line movement explains sign operations clearly. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["INTEGERS", "INTRODUCTION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Temperature starts at -3 and rises by 7. Step 1: -3 + 7 = 4. Step 2: final temperature is 4. Step 3: inverse 4 - 7 returns -3. integer addition is verified. This is useful in weather, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Elevator moves from -2 to 5. Step 1: movement = 5 - (-2) = 7. Step 2: it moves 7 floors. Step 3: counting floors confirms result. distance is correct. This is useful in buildings, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Integers ? Introduction and Operations. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Algebra ? Variables and Expressions': {
    id: "pyp_g5_mathematics_algebra_variables_and_expressions",
    title: "Algebra ? Variables and Expressions",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ALGEBRA", "VARIABLES", "EXPRESSIONS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Algebra ? Variables and Expressions. You use this skill when unknown values and formulas. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ALGEBRA", "VARIABLES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: variables represent unknowns and expressions model relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ALGEBRA", "VARIABLES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: inverse operations and substitution verify results. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ALGEBRA", "VARIABLES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Solve x + 7 = 19. Step 1: x = 19 - 7 = 12. Step 2: substitute to check 12 + 7 = 19. Step 3: equation is balanced. solution is correct. This is useful in puzzles, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Evaluate 3a + 2 at a = 5. Step 1: 3 x 5 + 2 = 17. Step 2: expression value is 17. Step 3: try another value to check pattern. substitution method works. This is useful in formula use, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Algebra ? Variables and Expressions. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Algebra ? Simple Equations': {
    id: "pyp_g5_mathematics_algebra_simple_equations",
    title: "Algebra ? Simple Equations",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["ALGEBRA", "SIMPLE", "EQUATIONS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Algebra ? Simple Equations. You use this skill when unknown values and formulas. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["ALGEBRA", "SIMPLE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: variables represent unknowns and expressions model relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["ALGEBRA", "SIMPLE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: inverse operations and substitution verify results. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["ALGEBRA", "SIMPLE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Solve x + 7 = 19. Step 1: x = 19 - 7 = 12. Step 2: substitute to check 12 + 7 = 19. Step 3: equation is balanced. solution is correct. This is useful in puzzles, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Evaluate 3a + 2 at a = 5. Step 1: 3 x 5 + 2 = 17. Step 2: expression value is 17. Step 3: try another value to check pattern. substitution method works. This is useful in formula use, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Algebra ? Simple Equations. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Geometry ? Angles on a Line and at a Point': {
    id: "pyp_g5_mathematics_geometry_angles_on_a_line_and_at_a_point",
    title: "Geometry ? Angles on a Line and at a Point",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["GEOMETRY", "ANGLES", "LINE", "POINT"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Geometry ? Angles on a Line and at a Point. You use this skill when construction and turn measurements. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently." },
      { id: "02", scene_number: 2, type: "concept", words: ["GEOMETRY", "ANGLES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: angles are measured in degrees and classified by size. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["GEOMETRY", "ANGLES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: line angles use 180 degrees and point angles use 360 degrees. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["GEOMETRY", "ANGLES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Angle on protractor reads 65 degrees. Step 1: 65 is less than 90 so it is acute. Step 2: complement to 90 is 25. Step 3: classification check is complete. type identification is correct. This is useful in design drawings, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Two angles on a line are 125 and x. Step 1: 125 + x = 180 so x = 55. Step 2: around-point checks use 360 similarly. Step 3: substitution verifies linear sum. angle relation is clear. This is useful in road layouts, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Geometry ? Angles on a Line and at a Point. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Triangles ? Types and Properties': {
    id: "pyp_g5_mathematics_triangles_types_and_properties",
    title: "Triangles ? Types and Properties",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["TRIANGLES", "TYPES", "PROPERTIES"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Triangles ? Types and Properties. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["TRIANGLES", "TYPES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["TRIANGLES", "TYPES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["TRIANGLES", "TYPES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Triangles ? Types and Properties. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Quadrilaterals ? Types and Properties': {
    id: "pyp_g5_mathematics_quadrilaterals_types_and_properties",
    title: "Quadrilaterals ? Types and Properties",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["QUADRILATERALS", "TYPES", "PROPERTIES"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Quadrilaterals ? Types and Properties. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["QUADRILATERALS", "TYPES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["QUADRILATERALS", "TYPES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["QUADRILATERALS", "TYPES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Quadrilaterals ? Types and Properties. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Circles ? Parts and Measurement': {
    id: "pyp_g5_mathematics_circles_parts_and_measurement",
    title: "Circles ? Parts and Measurement",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["CIRCLES", "PARTS", "MEASUREMENT"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Circles ? Parts and Measurement. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["CIRCLES", "PARTS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["CIRCLES", "PARTS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["CIRCLES", "PARTS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Circles ? Parts and Measurement. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Perimeter and Area ? Advanced': {
    id: "pyp_g5_mathematics_perimeter_and_area_advanced",
    title: "Perimeter and Area ? Advanced",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PERIMETER", "AREA", "ADVANCED"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Perimeter and Area ? Advanced. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PERIMETER", "AREA", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PERIMETER", "AREA", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PERIMETER", "AREA", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Perimeter and Area ? Advanced. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Area of Triangles and Parallelograms': {
    id: "pyp_g5_mathematics_area_of_triangles_and_parallelograms",
    title: "Area of Triangles and Parallelograms",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["AREA", "TRIANGLES", "PARALLELOGRAMS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Area of Triangles and Parallelograms. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["AREA", "TRIANGLES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["AREA", "TRIANGLES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["AREA", "TRIANGLES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Area of Triangles and Parallelograms. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Volume of Cuboids': {
    id: "pyp_g5_mathematics_volume_of_cuboids",
    title: "Volume of Cuboids",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["VOLUME", "CUBOIDS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Volume of Cuboids. You use this skill when storage and packing. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["VOLUME", "CUBOIDS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: volume of cuboid = length x breadth x height. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["VOLUME", "CUBOIDS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: volume is written in cubic units and represents capacity. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["VOLUME", "CUBOIDS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Cuboid dimensions are 12, 5, and 4 cm. Step 1: volume = 12 x 5 x 4 = 240. Step 2: volume is 240 cubic centimeters. Step 3: step multiplication confirms value. unit is correctly cubic. This is useful in box planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Tank dimensions are 2 m, 1.5 m, and 1 m. Step 1: volume = 2 x 1.5 x 1 = 3 cubic meters. Step 2: convert: 3 x 1000 = 3000 liters. Step 3: capacity is 3000 liters. conversion check confirms answer. This is useful in water storage, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Volume of Cuboids. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Surface Area Basics': {
    id: "pyp_g5_mathematics_surface_area_basics",
    title: "Surface Area Basics",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SURFACE", "AREA", "BASICS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Surface Area Basics. You use this skill when wrapping and painting solids. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SURFACE", "AREA", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: surface area is sum of all outside faces. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SURFACE", "AREA", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: cube TSA = 6a squared and cuboid TSA = 2(lb + bh + lh). After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SURFACE", "AREA", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Cube side is 4 cm. Step 1: one face area = 4 x 4 = 16. Step 2: total surface area = 6 x 16 = 96 square cm. Step 3: add six equal faces to verify. formula and count match. This is useful in gift wrapping, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Cuboid dimensions are 6, 4, and 3 cm. Step 1: lb=24, bh=12, lh=18 and sum=54. Step 2: TSA = 2 x 54 = 108 square cm. Step 3: net-face addition confirms. surface area is verified. This is useful in paint estimate, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Surface Area Basics. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Symmetry ? Lines and Rotational': {
    id: "pyp_g5_mathematics_symmetry_lines_and_rotational",
    title: "Symmetry ? Lines and Rotational",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SYMMETRY", "LINES", "ROTATIONAL"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Symmetry ? Lines and Rotational. You use this skill when geometry in design and construction. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SYMMETRY", "LINES", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: shape properties include sides, angles, area, perimeter, and symmetry relationships. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SYMMETRY", "LINES", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use formulas and property checks to classify and solve accurately. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SYMMETRY", "LINES", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Rectangle dimensions are 12 and 7. Step 1: perimeter = 2(12 + 7) = 38. Step 2: area = 12 x 7 = 84. Step 3: units show length versus square units. both measures are verified. This is useful in layout planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Triangle base is 12 and height is 9. Step 1: area = 1/2 x 12 x 9 = 54. Step 2: if sides are 6,6,8 perimeter is 20. Step 3: formula checks validate results. geometry values are consistent. This is useful in construction planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Symmetry ? Lines and Rotational. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Coordinate Geometry ? Plotting Points': {
    id: "pyp_g5_mathematics_coordinate_geometry_plotting_points",
    title: "Coordinate Geometry ? Plotting Points",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["COORDINATE", "GEOMETRY", "PLOTTING", "POINTS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Coordinate Geometry ? Plotting Points. You use this skill when maps and grid-based movement. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["COORDINATE", "GEOMETRY", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: coordinates are written as (x, y), with x horizontal and y vertical. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["COORDINATE", "GEOMETRY", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: coordinate differences help measure movement and segment length. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["COORDINATE", "GEOMETRY", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Points are A(3,2) and B(7,2). Step 1: same y means horizontal segment. Step 2: distance is 7 - 3 = 4 units. Step 3: count grid squares to verify. coordinate subtraction is correct. This is useful in navigation maps, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Robot starts at (2,3), moves right 4 and up 2. Step 1: new x = 2 + 4 = 6. Step 2: new y = 3 + 2 = 5. Step 3: final point is (6,5). reverse move returns to start. This is useful in coding movement, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Coordinate Geometry ? Plotting Points. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Data Handling ? Line Graphs': {
    id: "pyp_g5_mathematics_data_handling_line_graphs",
    title: "Data Handling ? Line Graphs",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["DATA", "HANDLING", "LINE", "GRAPHS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Data Handling ? Line Graphs. You use this skill when visual data reading and comparison. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["DATA", "HANDLING", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: graphs and pictographs show values using scales or keys. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["DATA", "HANDLING", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: read carefully to find totals, differences, and trends. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["DATA", "HANDLING", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Values are 12, 9, and 15. Step 1: difference is 15 - 9 = 6. Step 2: total is 12 + 9 + 15 = 36. Step 3: scale check confirms reading. summary values are correct. This is useful in school reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Values are 5, 8, and 7. Step 1: total is 20 and average is 20/3 = 6.67. Step 2: largest value is 8. Step 3: trend and average both make sense. data interpretation is accurate. This is useful in activity tracking, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Data Handling ? Line Graphs. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Data Handling ? Pie Charts': {
    id: "pyp_g5_mathematics_data_handling_pie_charts",
    title: "Data Handling ? Pie Charts",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["DATA", "HANDLING", "PIE", "CHARTS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Data Handling ? Pie Charts. You use this skill when part-to-whole data comparison. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["DATA", "HANDLING", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: pie chart total is 360 degrees and each sector is a fraction of whole. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["DATA", "HANDLING", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: convert sector angle to percent or count. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["DATA", "HANDLING", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Class has 40 students and sector is 90 degrees. Step 1: fraction = 90/360 = 1/4. Step 2: count = 1/4 x 40 = 10. Step 3: sector represents 10 students. 25 percent check confirms. This is useful in survey analysis, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "A sector is 144 degrees. Step 1: percent = 144/360 x 100 = 40. Step 2: sector is 40 percent. Step 3: 40 percent of 360 returns 144. conversion is verified. This is useful in library reports, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Data Handling ? Pie Charts. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Probability ? Introduction': {
    id: "pyp_g5_mathematics_probability_introduction",
    title: "Probability ? Introduction",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PROBABILITY", "INTRODUCTION"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Probability ? Introduction. You use this skill when games and random events. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PROBABILITY", "INTRODUCTION", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: probability equals favorable outcomes divided by total outcomes. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PROBABILITY", "INTRODUCTION", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: list all equally likely outcomes before calculating. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PROBABILITY", "INTRODUCTION", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Bag has 5 red, 3 blue, 2 green marbles. Step 1: total outcomes = 10. Step 2: favorable blue outcomes = 3. Step 3: P(blue) = 3/10. all color probabilities sum to 1. This is useful in fair game design, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Coin tossed twice. Step 1: outcomes are HH, HT, TH, TT so total = 4. Step 2: exactly one head in HT and TH so favorable = 2. Step 3: probability = 2/4 = 1/2. full outcome list verifies count. This is useful in science experiments, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Probability ? Introduction. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Measurement Conversions': {
    id: "pyp_g5_mathematics_measurement_conversions",
    title: "Measurement Conversions",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["MEASUREMENT", "CONVERSIONS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Measurement Conversions. You use this skill when converting units accurately. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["MEASUREMENT", "CONVERSIONS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: use standard relations like 1 km = 1000 m and 1 kg = 1000 g. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["MEASUREMENT", "CONVERSIONS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: convert to one unit before adding or subtracting. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["MEASUREMENT", "CONVERSIONS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Convert 3.5 km to meters. Step 1: 3.5 x 1000 = 3500 m. Step 2: result is 3500 m. Step 3: 3500/1000 returns 3.5 km. conversion is confirmed. This is useful in map distance, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Add 2 kg 450 g and 750 g. Step 1: 2450 g + 750 g = 3200 g. Step 2: convert to 3 kg 200 g. Step 3: unit consistency confirms result. combined mass is correct. This is useful in grocery work, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Measurement Conversions. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Speed, Distance and Time': {
    id: "pyp_g5_mathematics_speed_distance_and_time",
    title: "Speed, Distance and Time",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SPEED", "DISTANCE", "TIME"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Speed, Distance and Time. You use this skill when travel and race timing. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SPEED", "DISTANCE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: distance = speed x time and speed = distance/time. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SPEED", "DISTANCE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: choose the formula based on what value is unknown. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SPEED", "DISTANCE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "A car covers 120 km in 3 hours. Step 1: speed = 120/3 = 40 km/h. Step 2: write unit as kilometers per hour. Step 3: reverse check 40 x 3 = 120. speed answer is verified. This is useful in trip planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "A cyclist rides at 55 km/h for 4 hours. Step 1: distance = 55 x 4 = 220 km. Step 2: total distance is 220. Step 3: divide 220 by 4 to verify speed. distance calculation is correct. This is useful in sports training, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Speed, Distance and Time. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Patterns in Numbers': {
    id: "pyp_g5_mathematics_patterns_in_numbers",
    title: "Patterns in Numbers",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["PATTERNS", "NUMBERS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Patterns in Numbers. You use this skill when daily maths applications. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["PATTERNS", "NUMBERS", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: this topic builds strong number sense and problem-solving habits. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["PATTERNS", "NUMBERS", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: step-by-step work and checking improve accuracy and confidence. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["PATTERNS", "NUMBERS", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Start with a practical number task. Step 1: calculate 24 + 36 = 60. Step 2: then 60 x 3 = 180. Step 3: reverse 180/3 = 60 checks consistency. operations are verified. This is useful in everyday planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Use two operations in sequence. Step 1: 84 - 29 = 55 then 55 + 17 = 72. Step 2: subtract 17 to return 55. Step 3: inverse check confirms each step. calculation chain is reliable. This is useful in home tasks, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Patterns in Numbers. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Squares and Square Roots': {
    id: "pyp_g5_mathematics_squares_and_square_roots",
    title: "Squares and Square Roots",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["SQUARES", "SQUARE", "ROOTS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Squares and Square Roots. You use this skill when area and reverse multiplication. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["SQUARES", "SQUARE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: square root undoes squaring and perfect squares give whole roots. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["SQUARES", "SQUARE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: use square roots to recover side length from area. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["SQUARES", "SQUARE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Find roots of 36, 49, and 64. Step 1: 6x6=36, 7x7=49, 8x8=64. Step 2: roots are 6, 7, and 8. Step 3: re-squaring verifies each root. all values are consistent. This is useful in mental maths, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Square garden area is 169. Step 1: side = sqrt(169) = 13. Step 2: perimeter = 4 x 13 = 52. Step 3: 13 x 13 confirms area. side and perimeter are correct. This is useful in garden design, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Squares and Square Roots. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Cubes and Cube Roots': {
    id: "pyp_g5_mathematics_cubes_and_cube_roots",
    title: "Cubes and Cube Roots",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["CUBES", "CUBE", "ROOTS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Cubes and Cube Roots. You use this skill when 3D volume and reverse scaling. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["CUBES", "CUBE", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: cube numbers are n x n x n. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["CUBES", "CUBE", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: cube root finds the side from known cube volume. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["CUBES", "CUBE", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "Cube side is 5. Step 1: volume = 5 x 5 x 5 = 125. Step 2: volume is 125 cubic units. Step 3: cube root of 125 returns 5. relationship is verified. This is useful in packaging, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Find cube root of 1728. Step 1: 12 x 12 x 12 = 1728. Step 2: cube root is 12. Step 3: re-multiplication confirms exact cube. answer is correct. This is useful in dimension recovery, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Cubes and Cube Roots. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 5|Mixed Word Problems': {
    id: "pyp_g5_mathematics_mixed_word_problems",
    title: "Mixed Word Problems",
    grade: "Grade 5", subject: 'Mathematics', curriculum: 'IB PYP',
    accent: "#34d399",
    scenes: [
      { id: "01", scene_number: 1, type: "intro", words: ["MIXED", "WORD", "PROBLEMS"], subtext: "Start strong today", accent: "#34d399", voice: "Welcome, mathematicians! Today we are learning Mixed Word Problems. You use this skill when multi-step real situations. We will learn two key ideas and solve two worked examples with real numbers. Keep units clear and follow each step in order. By lesson end, you will choose the correct method and verify your answers confidently. This careful method keeps your maths accurate and clear in every step." },
      { id: "02", scene_number: 2, type: "concept", words: ["MIXED", "WORD", "RULE", "FORMULA"], subtext: "First key idea", accent: "#34d399", voice: "First key concept: break stories into ordered operations with units. Start by identifying what the question gives and what it asks, then arrange values neatly before calculating. Apply the rule carefully and write units at each step. This clear structure reduces errors and improves your mathematical explanation in class and assessments. This careful method keeps your maths accurate and clear in every step." },
      { id: "03", scene_number: 3, type: "concept", words: ["MIXED", "WORD", "STRATEGY", "CHECK"], subtext: "Second key idea", accent: "#34d399", voice: "Second key concept: work backward or verify each step to avoid mistakes. After solving, always check using estimation, inverse operations, or substitution. In word problems, clue words such as total, difference, each, and per help choose operations correctly. Deep understanding means knowing why each step works, not only memorizing formulas. This careful method keeps your maths accurate and clear in every step." },
      { id: "04", scene_number: 4, type: "example", words: ["MIXED", "WORD", "EXAMPLE", "STEPS"], subtext: "Worked example steps", accent: "#34d399", voice: "6 buses with 42 seats each and 37 empty. Step 1: total seats 252 and occupied 252 - 37 = 215. Step 2: add 5 teachers to get 220 people. Step 3: step sequence validates answer. word-problem reasoning is clear. This is useful in trip planning, where clear calculations matter. This careful method keeps your maths accurate and clear in every step." },
      { id: "05", scene_number: 5, type: "example", words: ["REAL", "LIFE", "MATH"], subtext: "Real-life maths use", accent: "#34d399", voice: "Puzzle says number x3 then +6 gives 24. Step 1: 24 - 6 = 18 then 18/3 = 6. Step 2: check 6x3 + 6 = 24. Step 3: working backward confirms unknown. logic method is correct. This is useful in brain games, where clear calculations matter. This careful method keeps your maths accurate and clear in every step. This careful method keeps your maths accurate and clear in every step." },
      { id: "06", scene_number: 6, type: "summary", words: ["RECAP", "PRACTICE", "CONFIDENCE"], subtext: "Recap and practice", accent: "#34d399", voice: "Excellent effort today on Mixed Word Problems. You practiced core ideas, solved step-by-step calculations, and checked answers carefully. Keep applying these skills in shopping, sports, travel, cooking, and projects. With regular short practice, your speed and confidence will keep improving. Clear methods make challenging mathematics easier and more reliable. This careful method keeps your maths accurate and clear in every step." },
    ],
  },
  'Grade 4|Families of the Orchestra': {
    id: 'pyp_g4_arts_families_of_the_orchestra',
    title: 'Families of the Orchestra',
    grade: 'Grade 4', subject: 'Arts', curriculum: 'IB PYP',
    accent: '#C87848',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['ORCHESTRA', 'FOUR', 'FAMILIES'], subtext: 'Meet the Orchestra!', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a1/Diagram_Modern_symphony_orchestra-en.svg/500px-Diagram_Modern_symphony_orchestra-en.svg.png',
        imageCaption: 'Seating layout of a symphony orchestra',
        voice: "Welcome, musicians! Today we are going to explore the orchestra — one of the most amazing musical inventions in history. A symphony orchestra has about 80 to 100 musicians playing together. Their instruments are grouped into four families: Strings, Woodwind, Brass, and Percussion. Each family makes sound in a completely different way. Let us discover them one by one!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['STRINGS', 'BOW', 'VIBRATE'], subtext: 'String Family', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/1/1b/Violin_VL100.png',
        imageCaption: 'Violin — the most common string instrument in the orchestra',
        voice: "The String family is the largest section of the orchestra. Strings make sound when the strings vibrate — either by drawing a bow across them or plucking them. From smallest and highest pitched to largest and lowest: violin, viola, cello, double bass, and harp. In Indian classical music, the sitar, sarod, and veena are also string instruments. Fun fact: the violin has four strings and is played tucked under the chin!" },
      { id: '03', scene_number: 3, type: 'concept', words: ['WOODWIND', 'BREATH', 'REED'], subtext: 'Woodwind Family', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/c/c7/Western_concert_flute.jpg',
        imageCaption: 'The flute — a woodwind instrument with no reed',
        voice: "The Woodwind family makes sound when air is blown across or through the instrument. Some use a thin piece of wood called a reed that vibrates. Members: flute (blow across a hole — no reed!), clarinet (single reed), oboe (double reed — two reeds that vibrate together), bassoon (double reed, very low sound), piccolo (tiny flute, very high sound), and saxophone (single reed, invented in 1840 by Adolphe Sax). Despite the name, modern woodwinds can be made of metal!" },
      { id: '04', scene_number: 4, type: 'concept', words: ['BRASS', 'BUZZ', 'MOUTHPIECE'], subtext: 'Brass Family', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Yamaha_Trumpet_YTR-8335LA_crop.jpg/250px-Yamaha_Trumpet_YTR-8335LA_crop.jpg',
        imageCaption: 'The trumpet — bright and powerful brass instrument',
        voice: "The Brass family makes sound when the player buzzes their lips into a cup-shaped mouthpiece. The buzzing lips set the air inside the metal tube vibrating. Members: trumpet (bright, fanfare sound), French horn (mellow, warm tone), trombone (uses a slide to change pitch), and tuba (the largest and lowest-pitched brass instrument). Brass instruments can be very loud — that is why they sit at the back of the orchestra!" },
      { id: '05', scene_number: 5, type: 'concept', words: ['PERCUSSION', 'HIT', 'SHAKE'], subtext: 'Percussion Family', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Drum_kit_parts.png/330px-Drum_kit_parts.png',
        imageCaption: 'A drum kit — part of the percussion family',
        voice: "The Percussion family includes any instrument played by hitting, shaking, or scraping. It is divided into pitched (makes specific notes) and unpitched (just rhythm). Pitched percussion: xylophone, glockenspiel, marimba, timpani drums. Unpitched percussion: bass drum, snare drum, cymbals, triangle, tambourine, maracas. Fun fact: the piano is technically a percussion instrument because tiny felt hammers strike the strings inside! The percussionist often plays many instruments in one concert." },
      { id: '06', scene_number: 6, type: 'summary', words: ['FOUR', 'FAMILIES', 'TOGETHER'], subtext: 'The Orchestra Complete!', accent: '#C87848',
        voice: "Brilliant! You now know all four families of the orchestra. Strings vibrate by bowing or plucking. Woodwinds use air and sometimes reeds. Brass use buzzing lips. Percussion use hitting or shaking. Together these four families create the rich, powerful sound of a symphony orchestra. Next time you hear an orchestra, try to pick out which family each instrument belongs to. You are now a true music explorer!" },
    ],
  },
  'Grade 4|Rhythm': {
    id: 'pyp_g4_arts_rhythm',
    title: 'Rhythm',
    grade: 'Grade 4', subject: 'Arts', curriculum: 'IB PYP',
    accent: '#C87848',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['RHYTHM', 'BEAT', 'PULSE'], subtext: "Music's heartbeat", accent: '#C87848',
        voice: "Hello, music explorers! Today we are learning about rhythm — the heartbeat of music. Every piece of music has a beat, a steady pulse you can tap your foot to. Rhythm is how long or short sounds are arranged over that steady beat. Think about clapping a pattern — clap, clap, CLAP — that is rhythm! Without rhythm, music would have no shape or movement." },
      { id: '02', scene_number: 2, type: 'concept', words: ['NOTE', 'VALUES', 'BEATS'], subtext: 'How long are notes?', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Music_notation.svg',
        imageCaption: 'Note values — whole, half, quarter and eighth notes',
        voice: "In written music, notes tell us how long to hold a sound. A whole note lasts 4 beats — the longest common note. A half note lasts 2 beats. A quarter note lasts 1 beat — the most common. An eighth note lasts half a beat. A rest means silence for that duration. You can think of it like fractions: two half notes equal one whole note, and four quarter notes equal one whole note." },
      { id: '03', scene_number: 3, type: 'concept', words: ['PULSE', 'PATTERN', 'SYNCOPATION'], subtext: 'Pulse vs Pattern', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Music_notation.svg',
        imageCaption: '4/4 time signature — 4 beats per bar, quarter note gets one beat',
        voice: "The pulse is the steady, unchanging beat you feel in all music. Rhythm patterns sit on top of the pulse and can be complex or simple. Syncopation is a special technique where the rhythm deliberately falls between the expected beats — jazz music uses this a lot! In Indian classical music, complex rhythmic cycles called tala are counted using hand gestures. Counting aloud: one and two and three and four and — helps you feel both the beat and the off-beats." },
      { id: '04', scene_number: 4, type: 'fun_fact', words: ['TABLA', 'METRONOME', 'HEARTBEAT'], subtext: 'Rhythm around the world', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Prop._Tabla.jpg/250px-Prop._Tabla.jpg',
        imageCaption: 'Tabla — India\'s famous rhythm instrument',
        voice: "Rhythm is universal! Every culture in the world has rhythmic music. The tabla is India's most famous rhythm instrument — a pair of hand drums that can create incredibly complex rhythmic patterns. A metronome is a device that ticks at a steady speed, helping musicians keep perfect rhythm while practising. The human heartbeat is also a rhythm — beating about 60 to 100 times per minute. When music tempo matches your heart rate, it can change how you feel!" },
      { id: '05', scene_number: 5, type: 'example', words: ['CLAP', 'AND', 'COUNT'], subtext: "Let's practise!", accent: '#C87848',
        voice: "Let us practise rhythm! Try clapping this pattern: CLAP — pause — CLAP CLAP — pause — CLAP. Can you feel how the pattern repeats? Now try counting: one, two and, three, four. The 'and' falls between beats two and three. This is an off-beat. Musicians call the main beats the downbeat and the off-beats the upbeat. All rhythmic patterns are built from combinations of these beats and rests." },
      { id: '06', scene_number: 6, type: 'summary', words: ['BEAT', 'NOTE', 'PATTERN'], subtext: 'Rhythm master!', accent: '#C87848',
        voice: "Excellent! You have learned that rhythm is the pattern of long and short sounds in music. The pulse is the steady beat underneath. Note values — whole, half, quarter, eighth — tell us how long sounds last. Rests are silence. And rhythm patterns can be simple or complex, from a steady march to syncopated jazz. Keep tapping rhythms on your desk and you will develop a natural sense of beat!" },
    ],
  },
  'Grade 4|Tempo and Dynamics': {
    id: 'pyp_g4_arts_tempo_and_dynamics',
    title: 'Tempo and Dynamics',
    grade: 'Grade 4', subject: 'Arts', curriculum: 'IB PYP',
    accent: '#C87848',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['TEMPO', 'DYNAMICS', 'MOOD'], subtext: 'Speed and volume in music', accent: '#C87848',
        voice: "Welcome! Today we explore two powerful tools musicians use to express emotion — Tempo and Dynamics. Tempo controls how fast or slow music moves. Dynamics controls how loud or soft it sounds. Together, they shape the mood of every piece of music. The same melody played fast and loud feels completely different from slow and soft. Let us discover the Italian terms musicians use worldwide!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['TEMPO', 'LARGO', 'ALLEGRO'], subtext: 'Tempo markings', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Music_notation.svg',
        imageCaption: 'Music notation — tempo markings tell musicians how fast to play',
        voice: "Tempo is measured in BPM — beats per minute. Italian words mark the tempo on sheet music. From slowest to fastest: Largo means very slow and broad. Adagio means slow and stately. Andante means at a walking pace — steady and calm. Moderato means moderate speed. Allegro means fast and lively. Presto means very fast! Why Italian? Italy was the centre of classical music in the 1600s and 1700s, so Italian terms became the world standard." },
      { id: '03', scene_number: 3, type: 'concept', words: ['FORTE', 'PIANO', 'CRESCENDO'], subtext: 'Dynamic markings', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/6/62/Music_notation.svg',
        imageCaption: 'Music notation showing dynamic markings — how loud or soft to play',
        voice: "Dynamic markings tell us how loud or soft to play. From softest to loudest: pp means pianissimo — very soft. p means piano — soft. mp means mezzo-piano — medium soft. mf means mezzo-forte — medium loud. f means forte — loud. ff means fortissimo — very loud! Special markings: crescendo, shown as a growing arrow, means gradually getting louder. Decrescendo or diminuendo, shown as a shrinking arrow, means gradually getting softer. Fun fact: the piano was named pianoforte — Italian for soft-loud — because it could do both!" },
      { id: '04', scene_number: 4, type: 'example', words: ['MOOD', 'FAST', 'LOUD'], subtext: 'Tempo + Dynamics = Feeling', accent: '#C87848',
        voice: "Let us see how tempo and dynamics work together to create mood. Beethoven's Fifth Symphony opens with a famous short-short-short-LONG pattern played forte and allegro — loud and fast — creating drama and tension. A lullaby is typically andante or adagio with piano dynamics — slow and soft — creating calm and sleep. A march is allegro and forte — fast and loud — creating energy and power. A hymn is adagio and mezzo-forte — slow and medium loud — creating reverence." },
      { id: '05', scene_number: 5, type: 'fun_fact', words: ['PIANOFORTE', 'ITALY', 'BPM'], subtext: 'Musical fun facts', accent: '#C87848',
        voice: "Fun facts about tempo and dynamics! The world's fastest piece of music is Flight of the Bumblebee by Rimsky-Korsakov — played at Presto, over 200 beats per minute! The quietest dynamic marking in orchestral music is ppp — triple piano — barely a whisper. Conductors use baton speed and height to signal tempo and dynamics to musicians. When a DJ gradually makes music louder and faster on a dance floor, they are using crescendo and accelerando — musical techniques used for centuries!" },
      { id: '06', scene_number: 6, type: 'summary', words: ['TEMPO', 'DYNAMICS', 'MASTER'], subtext: 'Music expression expert!', accent: '#C87848',
        voice: "Wonderful! You now understand two of music's most powerful tools. Tempo tells us speed: Largo is slowest, then Adagio, Andante, Moderato, Allegro, and Presto is fastest. Dynamics tells us volume: pp is softest, then p, mp, mf, f, and ff is loudest. Crescendo gets louder, decrescendo gets softer. Together they give music its emotional power. Listen to any song today and try naming its tempo and dynamics — you are now thinking like a musician!" },
    ],
  },
  'Grade 4|Timbre': {
    id: 'pyp_g4_arts_timbre',
    title: 'Timbre',
    grade: 'Grade 4', subject: 'Arts', curriculum: 'IB PYP',
    accent: '#C87848',
    scenes: [
      { id: '01', scene_number: 1, type: 'intro', words: ['TIMBRE', 'TONE', 'COLOUR'], subtext: "Music's unique fingerprint", accent: '#C87848',
        voice: "Hello, music detectives! Today we are exploring timbre — pronounced tam-ber. Timbre is the unique quality of a sound that makes one instrument different from another, even when they play the same note at the same volume. It is sometimes called tone colour. Close your eyes — if a flute and a trumpet both play the note A, you can still tell them apart instantly. That is timbre at work!" },
      { id: '02', scene_number: 2, type: 'concept', words: ['MATERIAL', 'SHAPE', 'METHOD'], subtext: 'What creates timbre?', accent: '#C87848',
        imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/Historical_instruments.jpg/250px-Historical_instruments.jpg',
        imageCaption: 'Each instrument has a unique tone colour (timbre) based on its material and shape',
        voice: "Timbre is created by three things: the material the instrument is made from, the shape and size of the instrument, and how sound is produced. A violin has a warm singing tone because the wooden body amplifies string vibrations. A trumpet has a bright brassy sound because air vibrates through a long metal tube with a flared bell. A drum has a resonant boom because hitting a stretched membrane creates complex vibrations. Even the human voice has unique timbre — that is why you recognise your friend's voice on the phone." },
      { id: '03', scene_number: 3, type: 'concept', words: ['BRIGHT', 'WARM', 'MELLOW'], subtext: 'Describing timbre', accent: '#C87848',
        voice: "We use descriptive words to talk about timbre: bright, warm, harsh, mellow, rich, thin, buzzy, reedy, breathy, or dark. A flute has a bright, airy timbre. A cello has a warm, rich timbre. An oboe has a reedy, nasal timbre. A tuba has a dark, round timbre. When you say a voice sounds warm, or a guitar sounds bright, you are actually describing timbre! Musicians choose instruments for specific timbres to create the exact mood they want." },
      { id: '04', scene_number: 4, type: 'concept', words: ['SOPRANO', 'TENOR', 'BASS'], subtext: 'Vocal timbre', accent: '#C87848',
        voice: "The human voice also has timbre categories. Soprano is the highest female voice — bright and clear. Alto or contralto is the lower female voice — warm and rich. Tenor is the higher male voice — bright and ringing. Baritone is the medium male voice. Bass is the lowest male voice — deep and resonant. Choirs use all these voice types together to create a full, harmonious sound. In Carnatic and Hindustani music, the tone quality of the voice is called swara and is considered extremely important." },
      { id: '05', scene_number: 5, type: 'fun_fact', words: ['OVERTONES', 'UNIQUE', 'WAVES'], subtext: 'The science of timbre', accent: '#C87848',
        voice: "Here is the science behind timbre! Every instrument produces not just one sound wave but many — the main note plus extra vibrations called overtones or harmonics. The unique combination of these overtones creates each instrument's timbre. That is why two instruments playing the same note sound different — they have different overtone patterns! Computer music uses this science to digitally recreate instrument sounds. And your voiceprint — the unique pattern of your voice's timbre — is so unique it can be used to identify you, just like a fingerprint." },
      { id: '06', scene_number: 6, type: 'summary', words: ['TIMBRE', 'COLOUR', 'SOUND'], subtext: 'Timbre expert!', accent: '#C87848',
        voice: "Amazing work! You have mastered timbre — the tone colour of sound. Timbre is what makes a violin sound different from a trumpet even on the same note. It is shaped by the instrument's material, shape, and how it produces sound. We describe timbre with words like bright, warm, mellow, and rich. Voices also have timbre: soprano, alto, tenor, and bass. Now when you hear music, you can listen not just to the notes but to the timbre — the unique colour of each sound. That is true musical listening!" },
    ],
  },
};

// ── TTS helpers (no-op on native — audio only runs on web) ───────────────────
function stopSpeech() {
  if (Platform.OS !== 'web') return;
  try { (window as any).speechSynthesis?.cancel(); } catch {}
}

// ── Scene type icons ──────────────────────────────────────────────────────────
const TYPE_ICON: Record<string, string> = {
  intro:    'play-circle',
  concept:  'book-open',
  example:  'edit-3',
  quiz:     'help-circle',
  fun_fact: 'zap',
  summary:  'check-circle',
};
const TYPE_LABEL: Record<string, string> = {
  intro:    'Introduction',
  concept:  'Key Concept',
  example:  'Example',
  quiz:     'Quick Check',
  fun_fact: 'Fun Fact',
  summary:  'Summary',
};

// Unified Aivorah lesson accent — vivid sage-green from the landing identity
// (replaces the old per-scene blue/teal so every lesson matches the theme).
const LESSON_GREEN = '#3FA06A';
// Static stylized waveform bar heights for the "Listen to Aivorah" audio widget.
const WAVE_BARS = [6, 11, 18, 9, 22, 14, 7, 16, 24, 12, 8, 19, 13, 6, 20, 10, 15, 9, 7, 12];

interface LessonScene {
  id: string;
  scene_number: number;
  type: string;
  words: string[];
  subtext: string;
  voice: string;
  accent?: string;
  imageUrl?: string;
  imageCaption?: string;
  visual?: {
    type: 'numberline' | 'venn' | 'barmodel' | 'chart';
    // numberline
    min?: number;
    max?: number;
    highlights?: number[];
    answer?: number;
    label?: string;
    // venn
    leftLabel?: string;
    rightLabel?: string;
    leftOnly?: (number | string)[];
    rightOnly?: (number | string)[];
    overlap?: (number | string)[];
    // barmodel
    total?: number;
    filled?: number;
    // chart
    items?: string[];
    factors?: string[];
  };
}

interface Lesson {
  id: string;
  title: string;
  grade: string;
  subject: string;
  accent: string;
  scenes: LessonScene[];
}

function normalizeLessonToken(value: string) {
  return (value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[—–−]/g, '-')
    .replace(/[?]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findBundledLesson(grade: string, topic: string, subject: string): Lesson | null {
  const exact =
    BUNDLED_LESSONS[`${grade}|${topic}`] ||
    BUNDLED_LESSONS[`${grade}|${subject}`];
  if (exact) return exact as Lesson;

  const normalizedTopic = normalizeLessonToken(topic);
  const normalizedSubject = normalizeLessonToken(subject);
  const prefix = `${grade}|`;

  for (const [key, val] of Object.entries(BUNDLED_LESSONS)) {
    if (!key.startsWith(prefix)) continue;
    const keyTopic = key.slice(prefix.length);
    const normalizedKeyTopic = normalizeLessonToken(keyTopic);
    if (
      normalizedKeyTopic === normalizedTopic ||
      normalizedKeyTopic === normalizedSubject
    ) {
      return val as Lesson;
    }
  }

  return null;
}

function buildGenericLesson(topic: string, grade: string, subject: string): Lesson {
  const accent = grade.includes('5') ? '#34d399' : grade.includes('4') ? '#a78bfa' : '#38bdf8';
  const tokens = topic
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const topicWords = (tokens.length ? tokens : ['LESSON', 'TOPIC']).slice(0, 4);

  return {
    id: `generic_${normalizeLessonToken(grade)}_${normalizeLessonToken(subject)}_${normalizeLessonToken(topic).replace(/\s+/g, '_')}`,
    title: topic,
    grade,
    subject,
    accent,
    scenes: [
      {
        id: '01',
        scene_number: 1,
        type: 'intro',
        words: topicWords.slice(0, 3),
        subtext: 'Welcome to this topic',
        accent,
        voice: `Welcome! Today we are learning ${topic} in ${subject}. We will understand the main idea, learn useful rules, and solve examples step by step. Keep your notebook open and write each step clearly as we go. By the end, you will be able to explain this topic confidently.`,
      },
      {
        id: '02',
        scene_number: 2,
        type: 'concept',
        words: ['KEY', 'IDEA', 'RULE'],
        subtext: 'First key concept',
        accent,
        voice: `First, identify what this topic is about and what the question asks. Break the task into small parts, then apply the main rule carefully. Always write units or labels beside values so your answer stays meaningful. This simple structure helps reduce mistakes and improve understanding.`,
      },
      {
        id: '03',
        scene_number: 3,
        type: 'concept',
        words: ['METHOD', 'STEPS', 'CHECK'],
        subtext: 'Second key concept',
        accent,
        voice: `Next, use a clear method and check each intermediate step before moving on. If possible, verify your result using reverse operations, estimation, or substitution. Strong learners do not just memorize answers, they explain why each step works. This builds long-term confidence in every subject.`,
      },
      {
        id: '04',
        scene_number: 4,
        type: 'example',
        words: ['EXAMPLE', 'STEP', 'BY', 'STEP'],
        subtext: 'Worked example one',
        accent,
        voice: `Example: A class has 24 students in one row and 3 rows in total. Step 1: multiply 24 by 3 to get 72 students. Step 2: check by repeated addition, 24 + 24 + 24 also equals 72. Step 3: verify with division, 72 divided by 3 equals 24. This is how we confirm the answer is correct.`,
      },
      {
        id: '05',
        scene_number: 5,
        type: 'example',
        words: ['REAL', 'LIFE', 'APPLICATION'],
        subtext: 'Worked example two',
        accent,
        voice: `Real-life example: You have a budget of 500 rupees and spend 185 rupees on books and 120 rupees on stationery. Step 1: add expenses, 185 + 120 = 305. Step 2: subtract from budget, 500 - 305 = 195. Step 3: check by adding back, 305 + 195 = 500. This shows the remaining amount clearly.`,
      },
      {
        id: '06',
        scene_number: 6,
        type: 'summary',
        words: ['RECAP', 'PRACTICE', 'CONFIDENCE'],
        subtext: 'Great work today',
        accent,
        voice: `Great work! You reviewed key concepts, followed structured steps, and checked answers carefully. Keep practicing a few problems each day and focus on clear working, not just final answers. This approach will help you improve quickly in ${topic} and across other lessons too.`,
      },
    ],
  };
}

export default function TopicLessonScreen({ navigation, route }: any) {
  const { topic = 'Lesson', grade = 'Grade 4', subject = 'Mathematics', curriculum = 'IB_PYP' } = route?.params ?? {};
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;
  const { recordStudyTime } = useStudentData();
  const studySessionStartRef = useRef<number>(Date.now());
  const trackedStudyMinutesRef = useRef(0);

  const [lesson, setLesson]         = useState<Lesson | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [cardIdx, setCardIdx]       = useState(0);
  const [speaking, setSpeaking]     = useState(false);
  const [paused, setPaused]         = useState(false);
  const [wordIndex, setWordIndex]   = useState(-1);
  const [playbackRate, setPlaybackRate] = useState(1);

  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const rafRef      = useRef<number | null>(null);
  const audioMetaRef = useRef<{
    words: string[];
    timings: Array<{ word: string; startTime: number; endTime: number }> | null;
    timingProvider: string;
  } | null>(null);

  function cancelHighlightLoop() {
    if (rafRef.current != null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }

  function startHighlightLoop(
    audio: HTMLAudioElement,
    words: string[],
    timings: Array<{ word: string; startTime: number; endTime: number }> | null,
  ) {
    cancelHighlightLoop();
    let lastRendered = -1;
    function tick() {
      if (!audio || audio.paused || audio.ended) return;
      let idx = 0;
      if (timings && timings.length > 0) {
        // Small look-ahead: Whisper timestamps tend to lag ~80ms behind actual speech
        const AHEAD = 0.08 / (audio.playbackRate || 1);
        const t = audio.currentTime + AHEAD;
        for (let i = 0; i < timings.length; i++) {
          const wordEnd = timings[i + 1]?.startTime ?? (audio.duration + 1);
          if (t >= timings[i].startTime && t < wordEnd) { idx = i; break; }
          if (t >= timings[i].startTime) idx = i;
        }
      } else {
        // Weight each word by its character length for a more natural highlight pace
        const totalChars = words.reduce((s, w) => s + Math.max(w.length, 1), 0);
        const LAG = 0.15 / (audio.playbackRate || 1);
        const ratio = Math.max(0, audio.currentTime - LAG) / (audio.duration || 1);
        const targetChars = ratio * totalChars;
        let cumChars = 0;
        idx = words.length - 1;
        for (let i = 0; i < words.length; i++) {
          cumChars += Math.max(words[i].length, 1);
          if (cumChars >= targetChars) { idx = i; break; }
        }
      }
      if (idx !== lastRendered) { lastRendered = idx; setWordIndex(idx); }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function stopAudio() {
    cancelHighlightLoop();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }
    setWordIndex(-1);
  }

  // Load lesson — try server first, fall back to bundled data
  useEffect(() => {
    setLoading(true);
    // If a bundled lesson exists (has hand-crafted content + images), use it immediately
    const bundled = findBundledLesson(grade, topic, subject);
    if (bundled) {
      setLesson(bundled);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    fetch(`${SERVER_URL}/ibpyp/lesson-content?topic=${encodeURIComponent(topic)}&grade=${encodeURIComponent(grade)}&subject=${encodeURIComponent(subject)}&curriculum=${encodeURIComponent(curriculum)}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        if (data.error || !data.scenes) throw new Error(data.error || 'no scenes');
        setLesson(data);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setLesson(buildGenericLesson(topic, grade, subject));
        setError('');
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [topic, grade, subject]);

  // Auto-play TTS on card change
  useEffect(() => {
    if (!lesson) return;
    const scene = lesson.scenes[cardIdx];
    if (!scene) return;
    setPaused(false);
    setWordIndex(-1);
    stopAudio();

    if (Platform.OS !== 'web') return; // audio only on web

    setSpeaking(true);
    const voiceWords = (scene.voice.match(/\S+/g) || []);
    const audioCtrl = new AbortController();

    fetch(`${SERVER_URL}/lesson/scene-audio?lessonId=${encodeURIComponent(lesson.id)}&sceneId=${encodeURIComponent(scene.id)}&text=${encodeURIComponent(scene.voice)}`, { signal: audioCtrl.signal })
      .then(r => r.json())
      .then(data => {
        if (!data.audioUrl) throw new Error('no audioUrl');
        const audio = new Audio(/^https?:\/\//i.test(data.audioUrl) ? data.audioUrl : `${SERVER_URL}${data.audioUrl}`);
        audioRef.current = audio;
        audioMetaRef.current = { words: voiceWords, timings: data.timings || null, timingProvider: data.timingProvider || 'none' };

        const timings = data.timings || null;
        // Start highlight loop once metadata is ready (duration known) and playing
        audio.onloadedmetadata = () => {
          // pre-warm: highlight word 0 immediately
          setWordIndex(0);
        };
        audio.onplay  = () => { setSpeaking(true); startHighlightLoop(audio, voiceWords, timings); };
        audio.onpause = () => { cancelHighlightLoop(); };
        audio.onended = () => { cancelHighlightLoop(); setSpeaking(false); setWordIndex(-1); };
        audio.onerror = () => { cancelHighlightLoop(); setSpeaking(false); setWordIndex(-1); };
        audio.play().catch(() => { setSpeaking(false); });
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        // Fallback to Web Speech API if server unavailable
        const synth = Platform.OS === 'web' ? (window as any).speechSynthesis as SpeechSynthesis : null;
        if (!synth) { setSpeaking(false); return; }
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(scene.voice);
        utter.rate = 0.95; utter.pitch = 1.1; utter.volume = 1.0;
        const voices = synth.getVoices();
        const pick = voices.find(v => /aria/i.test(v.name) && /en/i.test(v.lang)) ||
          voices.find(v => /jenny/i.test(v.name) && /en/i.test(v.lang)) ||
          voices.find(v => /en[-_]US/i.test(v.lang));
        if (pick) utter.voice = pick;
        utter.onend   = () => setSpeaking(false);
        utter.onerror = () => setSpeaking(false);
        synth.speak(utter);
      });

    return () => { audioCtrl.abort(); stopAudio(); stopSpeech(); setSpeaking(false); };
  }, [cardIdx, lesson]);

  // Cleanup on unmount
  useEffect(() => () => { stopAudio(); stopSpeech(); }, []);

  // Stop audio when navigating away (blur handles stack navigation without unmount)
  useEffect(() => {
    const unsub = navigation.addListener('blur', () => { stopAudio(); stopSpeech(); setSpeaking(false); setPaused(false); });
    return unsub;
  }, [navigation]);

  // Count whole minutes spent in this reading lesson and sync to student stats.
  useEffect(() => {
    function flushWholeMinutes() {
      const elapsedWholeMinutes = Math.floor((Date.now() - studySessionStartRef.current) / 60000);
      const delta = elapsedWholeMinutes - trackedStudyMinutesRef.current;
      if (delta > 0) {
        recordStudyTime(delta);
        trackedStudyMinutesRef.current += delta;
      }
    }

    const interval = setInterval(flushWholeMinutes, 15000);
    return () => {
      clearInterval(interval);
      flushWholeMinutes();
    };
  }, []);

  function togglePause() {
    if (Platform.OS !== 'web') return;
    const audio = audioRef.current;
    if (audio) {
      if (paused) { audio.play(); setPaused(false); }
      else { audio.pause(); setPaused(true); }
      return;
    }
    // Fallback: Web Speech
    const synth = (window as any).speechSynthesis as SpeechSynthesis;
    if (!synth) return;
    if (paused) { synth.resume(); setPaused(false); }
    else { synth.pause(); setPaused(true); }
  }

  function goNext() {
    if (!lesson) return;
    stopAudio(); stopSpeech(); setSpeaking(false);
    if (cardIdx < lesson.scenes.length - 1) {
      setCardIdx(i => i + 1);
    } else {
      navigation.navigate('IBPYPQuiz', { topic, grade, subject, curriculum });
    }
  }

  function goPrev() {
    if (cardIdx === 0) return;
    stopAudio(); stopSpeech(); setSpeaking(false);
    setCardIdx(i => i - 1);
  }

  function replayCard() {
    if (!lesson) return;
    stopAudio(); stopSpeech();
    // Re-trigger the effect by poking a ref approach: just re-call the scene play
    const scene = lesson.scenes[cardIdx];
    if (!scene || Platform.OS !== 'web') return;
    setSpeaking(true);
    setWordIndex(-1);
    const voiceWords = (scene.voice.match(/\S+/g) || []);
    const meta = audioMetaRef.current;

    fetch(`${SERVER_URL}/lesson/scene-audio?lessonId=${encodeURIComponent(lesson.id)}&sceneId=${encodeURIComponent(scene.id)}&text=${encodeURIComponent(scene.voice)}`)
      .then(r => r.json())
      .then(data => {
        if (!data.audioUrl) throw new Error('no audioUrl');
        const audio = new Audio(/^https?:\/\//i.test(data.audioUrl) ? data.audioUrl : `${SERVER_URL}${data.audioUrl}`);
        audioRef.current = audio;
        const timings2 = data.timings || null;
        audioMetaRef.current = { words: voiceWords, timings: timings2, timingProvider: data.timingProvider || 'none' };
        audio.onloadedmetadata = () => { setWordIndex(0); };
        audio.onplay  = () => { setSpeaking(true); startHighlightLoop(audio, voiceWords, timings2); };
        audio.onpause = () => { cancelHighlightLoop(); };
        audio.onended = () => { cancelHighlightLoop(); setSpeaking(false); setWordIndex(-1); };
        audio.onerror = () => { cancelHighlightLoop(); setSpeaking(false); setWordIndex(-1); };
        audio.play().catch(() => setSpeaking(false));
      })
      .catch(() => setSpeaking(false));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <ScreenLayout>
        <Header title={topic} subtitle={`${subject} · ${grade}`} showBack={true} onMenuPress={() => navigation.openDrawer()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={{ color: colors.textMuted, fontSize: 14 }}>Loading lesson…</Text>
        </View>
      </ScreenLayout>
    );
  }

  if (error || !lesson) {
    return (
      <ScreenLayout>
        <Header title={topic} subtitle={`${subject} · ${grade}`} showBack={true} onMenuPress={() => navigation.openDrawer()} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
          <Feather name="alert-circle" size={36} color="#ef4444" />
          <Text style={{ color: '#ef4444', textAlign: 'center' }}>{error || 'Lesson not found'}</Text>
          <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
            <Feather name="arrow-left" size={15} color="#fff" />
            <Text style={{ color: '#fff', fontWeight: '700' }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </ScreenLayout>
    );
  }

  const scene    = lesson.scenes[cardIdx];
  // Landing palette: muted sage primary + gold secondary (theme-aware, not neon).
  const accent   = colors.primary;       // landing sage
  const gold     = colors.accentYellow;  // landing gold
  const onAccent = isDark ? '#0B140F' : '#FFFFFF'; // readable text on the sage fill
  const icon    = TYPE_ICON[scene.type] || 'book-open';
  const label   = TYPE_LABEL[scene.type] || scene.type;
  const isLast  = cardIdx === lesson.scenes.length - 1;
  const pct     = Math.round(((cardIdx + 1) / lesson.scenes.length) * 100);

  return (
    <ScreenLayout>
      <Header
        title={`${topic} · ${grade}`}
        subtitle={`${subject} · ${curriculum.replace(/_/g, ' ')}`}
        showBack={true}
        onMenuPress={() => navigation.openDrawer()}
      />

      <View style={{ flex: 1, backgroundColor: colors.bgDark }}>

        {/* ── Sub bar: scene pill · Lesson Progress ── */}
        <View style={s.subBar}>
          <View style={[s.scenePill, { borderColor: accent + '66', backgroundColor: accent + '14' }]}>
            <Text style={[s.scenePillText, { color: accent }]}>{cardIdx + 1} / {lesson.scenes.length}</Text>
          </View>
          <View style={s.progressLabelRow}>
            <Text style={[s.progressLabel, { color: colors.textMuted }]}>Lesson Progress</Text>
            <Feather name="award" size={15} color={gold} />
          </View>
        </View>

        {/* Progress track — sage → gold (landing "confidence" bar) */}
        <View style={[s.track, { backgroundColor: colors.borderColor }]}>
          <LinearGradient
            colors={[accent, gold]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[s.fill, { width: `${pct}%` as any }]}
          />
        </View>

        {/* ── MAIN: two-column storybook ── */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.main}
          showsVerticalScrollIndicator={false}
        >
          <View style={[s.columns, isWide ? s.columnsRow : s.columnsCol]}>

            {/* LEFT — text panel */}
            <View style={[s.leftCard, isWide && s.leftCardWide, { backgroundColor: isDark ? colors.cardDark : '#fff', borderColor: colors.borderColor }]}>
              {/* Type badge */}
              <View style={[s.badge, { backgroundColor: accent + '18', borderColor: accent + '40' }]}>
                <Feather name={icon as any} size={13} color={accent} />
                <Text style={[s.badgeText, { color: accent }]}>{label}</Text>
              </View>

              {/* Eyebrow + serif headline */}
              <Text style={[s.eyebrow, { color: gold }]}>{grade} · {subject}</Text>
              <Text style={[s.headline, { color: isDark ? colors.textMain : '#16241B' }]}>{scene.subtext || topic}</Text>

              {/* Key words */}
              {scene.words && scene.words.length > 0 && (
                <View style={s.wordsRow}>
                  {scene.words.map((w, i) => (
                    <View key={i} style={[s.wordChip, { backgroundColor: gold + '14', borderColor: gold + '40' }]}>
                      <Text style={[s.wordChipText, { color: gold }]}>{w}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Lesson body — word-by-word highlight during playback */}
              <Text style={[s.lessonText, { color: isDark ? '#D7DCD6' : '#2d3748' }]}>
                {(scene.voice.match(/\S+/g) || []).map((w, i) => {
                  const isHighlighted = wordIndex === i;
                  return (
                    <Text
                      key={i}
                      style={isHighlighted ? [s.wordHighlight, { backgroundColor: accent + '33', color: accent }] : undefined}
                    >{w}{' '}</Text>
                  );
                })}
              </Text>

              {/* Audio widget — Listen to Aivorah */}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={paused ? togglePause : (speaking ? togglePause : replayCard)}
                style={[s.audioWidget, { backgroundColor: isDark ? '#0E0E0E' : '#F2F6EF', borderColor: colors.borderColor }]}
              >
                <View style={[s.audioBtn, { backgroundColor: accent }]}>
                  <Feather name={speaking && !paused ? 'pause' : 'volume-2'} size={16} color={onAccent} />
                </View>
                <View>
                  <Text style={[s.audioTitle, { color: colors.textMain }]}>
                    {paused ? 'Paused — tap to resume' : (speaking ? 'Listen to Aivorah' : 'Replay narration')}
                  </Text>
                  <Text style={[s.audioSub, { color: colors.textDim }]}>Your AI Tutor</Text>
                </View>
                <View style={s.waveRow}>
                  {WAVE_BARS.map((h, i) => (
                    <View key={i} style={[s.waveBar, { height: h, backgroundColor: (speaking && !paused) ? accent : colors.borderColor }]} />
                  ))}
                </View>
              </TouchableOpacity>
            </View>

            {/* RIGHT — illustration / diagram panel */}
            <View style={[s.rightPanel, isWide && s.rightPanelWide, { backgroundColor: isDark ? '#0E140F' : '#EEF4EA', borderColor: accent + '33', shadowColor: accent }]}>
              {scene.imageUrl ? (
                <>
                  <Image
                    source={{ uri: scene.imageUrl.startsWith('http') ? scene.imageUrl : `${SERVER_URL}${scene.imageUrl}` }}
                    style={s.illustration}
                    resizeMode="contain"
                  />
                  {!!scene.imageCaption && (
                    <Text style={[s.illustrationCaption, { color: colors.textMuted }]}>{scene.imageCaption}</Text>
                  )}
                </>
              ) : scene.visual?.type === 'numberline' ? (
                <NumberLineVisual min={scene.visual.min ?? 0} max={scene.visual.max ?? 20} highlights={scene.visual.highlights ?? []} answer={scene.visual.answer} label={scene.visual.label} accent={accent} />
              ) : scene.visual?.type === 'venn' ? (
                <VennCirclesVisual leftLabel={scene.visual.leftLabel ?? 'A'} rightLabel={scene.visual.rightLabel ?? 'B'} leftOnly={scene.visual.leftOnly ?? []} rightOnly={scene.visual.rightOnly ?? []} overlap={scene.visual.overlap ?? []} accent={accent} />
              ) : scene.visual?.type === 'barmodel' ? (
                <BarModelVisual total={scene.visual.total ?? 4} filled={scene.visual.filled ?? 1} label={scene.visual.label} accent={accent} />
              ) : scene.visual?.type === 'chart' ? (
                <ConversionChartVisual items={scene.visual.items ?? []} factors={scene.visual.factors ?? []} accent={accent} />
              ) : (
                <View style={s.illustrationEmpty}>
                  <View style={[s.illustrationEmptyIcon, { backgroundColor: accent + '1A', borderColor: accent + '40' }]}>
                    <Feather name={icon as any} size={34} color={accent} />
                  </View>
                  <Text style={[s.illustrationEmptyText, { color: colors.textDim }]}>Illustration coming soon</Text>
                </View>
              )}
            </View>

          </View>
        </ScrollView>

        {/* ── Scene stepper ── */}
        <View style={[s.stepperWrap, { borderTopColor: colors.borderColor }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.stepperRow}>
            {lesson.scenes.map((sc, i) => {
              const done   = i < cardIdx;
              const active = i === cardIdx;
              const stepLabel = sc.subtext || TYPE_LABEL[sc.type] || `Step ${i + 1}`;
              return (
                <TouchableOpacity
                  key={i} style={s.step} activeOpacity={0.7}
                  onPress={() => { stopAudio(); stopSpeech(); setSpeaking(false); setCardIdx(i); }}
                >
                  <View style={[s.stepNum, {
                    backgroundColor: active ? accent : (done ? accent + '2A' : colors.cardDark),
                    borderColor:     active ? accent : (done ? accent + '55' : colors.borderColor),
                  }]}>
                    {done
                      ? <Feather name="check" size={13} color={accent} />
                      : <Text style={[s.stepNumText, { color: active ? '#fff' : colors.textMuted }]}>{i + 1}</Text>}
                  </View>
                  <Feather name={(TYPE_ICON[sc.type] || 'book-open') as any} size={13} color={active ? accent : colors.textDim} />
                  <Text numberOfLines={1} style={[s.stepLabel, { color: active ? colors.textMain : colors.textDim, fontWeight: active ? '700' : '500' }]}>{stepLabel}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── BOTTOM BAR: Prev · Aivorah tutor · Pause · Next ── */}
        <View style={[s.navBar, { backgroundColor: colors.cardDark, borderTopColor: colors.borderColor }]}>
          {/* Prev */}
          <TouchableOpacity
            style={[s.navBtn, { borderColor: colors.borderColor, opacity: cardIdx === 0 ? 0.35 : 1 }]}
            onPress={goPrev} disabled={cardIdx === 0}
          >
            <Feather name="arrow-left" size={16} color={colors.textMain} />
            <Text style={[s.navBtnText, { color: colors.textMain }]}>Prev</Text>
          </TouchableOpacity>

          {/* Tutor bubble (wide only) — else flexible spacer */}
          {isWide ? (
            <View style={[s.tutorBubble, { backgroundColor: isDark ? '#0E140F' : '#EEF4EA', borderColor: colors.borderColor }]}>
              <View style={[s.tutorAvatar, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
                <Feather name="feather" size={15} color={accent} />
              </View>
              <Text style={[s.tutorText, { color: colors.textMuted }]} numberOfLines={2}>
                I'm <Text style={{ color: accent, fontWeight: '700' }}>Aivorah</Text>, your AI tutor. I'll guide you through this lesson!
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1 }} />
          )}

          {/* Pause / Resume / Replay */}
          <TouchableOpacity
            style={[s.navBtn, { borderColor: accent + '60', backgroundColor: accent + '12' }]}
            onPress={paused ? togglePause : (speaking ? togglePause : replayCard)}
          >
            <Feather
              name={speaking && !paused ? 'pause' : (paused ? 'play' : 'rotate-ccw')}
              size={16}
              color={accent}
            />
            <Text style={[s.navBtnText, { color: accent }]}>
              {speaking && !paused ? 'Pause' : (paused ? 'Resume' : 'Replay')}
            </Text>
          </TouchableOpacity>

          {/* Next */}
          <TouchableOpacity
            style={[s.nextBtn, { backgroundColor: accent }]}
            onPress={goNext}
          >
            <Text style={[s.nextBtnText, { color: onAccent }]}>{isLast ? 'Take Quiz' : 'Next'}</Text>
            <Feather name={isLast ? 'check-circle' : 'arrow-right'} size={16} color={onAccent} />
          </TouchableOpacity>
        </View>
      </View>
    </ScreenLayout>
  );
}

const s = StyleSheet.create({
  // ── Sub bar ──
  subBar:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: 12, paddingBottom: 8 },
  backRow:          { flexDirection: 'row', alignItems: 'center', gap: 6 },
  backText:         { fontSize: 14, fontWeight: '600' },
  scenePill:        { paddingHorizontal: 16, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  scenePillText:    { fontSize: 13, fontWeight: '700' },
  progressLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  progressLabel:    { fontSize: 13, fontWeight: '600' },

  track: { height: 4 },
  fill:  { height: 4 },

  // ── Main / columns ──
  main:       { padding: spacing.xl, paddingBottom: spacing.md },
  columns:    { width: '100%', maxWidth: 1200, alignSelf: 'center', gap: spacing.xl },
  columnsRow: { flexDirection: 'row', alignItems: 'stretch' },
  columnsCol: { flexDirection: 'column' },

  // ── Left text panel ──
  leftCard:     { flex: 1, borderRadius: radius.xl, borderWidth: 1, padding: 28, gap: 14, justifyContent: 'center' },
  leftCardWide: { flexBasis: '46%', maxWidth: '50%' },

  badge:     { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  badgeText: { fontSize: 12, fontWeight: '700' },

  eyebrow:  { fontFamily: fonts.serif, fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  headline: { fontFamily: fonts.serif, fontSize: 28, fontWeight: '700', lineHeight: 36, letterSpacing: -0.5 },

  wordsRow:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  wordChip:     { borderRadius: 8, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 4 },
  wordChipText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  lessonText:    { fontSize: 16, lineHeight: 27, fontWeight: '400', marginTop: 2 },
  wordHighlight: { fontWeight: '700', borderRadius: 4 },

  audioWidget: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, borderWidth: 1, padding: 12, marginTop: 6 },
  audioBtn:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  audioTitle:  { fontSize: 13, fontWeight: '700' },
  audioSub:    { fontSize: 11, fontWeight: '500', marginTop: 1 },
  waveRow:     { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: 'auto', height: 26 },
  waveBar:     { width: 2.5, borderRadius: 2 },

  // ── Right illustration panel ──
  rightPanel:     { borderRadius: radius.xl, borderWidth: 1, padding: 18, alignItems: 'center', justifyContent: 'center', minHeight: 280, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.18, shadowRadius: 18, elevation: 4 },
  rightPanelWide: { flexBasis: '54%', flexGrow: 1 },
  illustration:        { width: '100%', aspectRatio: 1.3, borderRadius: radius.lg },
  illustrationCaption: { fontSize: 12, textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  illustrationEmpty:     { alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 50 },
  illustrationEmptyIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  illustrationEmptyText: { fontSize: 13, fontWeight: '500' },

  // ── Scene stepper ──
  stepperWrap: { borderTopWidth: 1, paddingVertical: 10, paddingHorizontal: spacing.lg },
  stepperRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  step:        { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 20 },
  stepNum:     { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  stepNumText: { fontSize: 12, fontWeight: '700' },
  stepLabel:   { fontSize: 13, maxWidth: 150 },

  // ── Bottom bar ──
  navBar:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: 1 },
  navBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1 },
  navBtnText:  { fontSize: 13, fontWeight: '600' },
  nextBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 24, borderRadius: radius.lg },
  nextBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  tutorBubble: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.lg, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 14, maxWidth: 520 },
  tutorAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  tutorText:   { flex: 1, fontSize: 13, lineHeight: 18 },

  backBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#ef4444', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
});
