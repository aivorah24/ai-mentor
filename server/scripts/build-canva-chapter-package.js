/**
 * Build one chapter package for:
 * - Single chapter video narration timeline
 * - Emotion-aware TTS clip generation (via local /lesson/tts API)
 * - Canva Autofill + MP4 export workflow (optional, requires Canva token + template)
 *
 * Usage examples:
 *   node scripts/build-canva-chapter-package.js
 *   node scripts/build-canva-chapter-package.js --lesson science_g3_living_non_living_script.json --generate-tts
 *   node scripts/build-canva-chapter-package.js --lesson science_g3_living_non_living_script.json --run-canva --canva-template-id=<TEMPLATE_ID> --export-mp4
 */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const {
  extractDesignId,
  getBrandTemplateDataset,
  createAutofillJob,
  getAutofillJob,
  createExportJob,
  getExportJob,
  waitForJob,
} = require('../services/canva');

const ROOT = path.join(__dirname, '..');
const LESSONS_DIR = path.join(ROOT, 'data/lessons');
const OUTPUT_ROOT = path.join(ROOT, 'data/video_packages');
const SERVER_ROOT = ROOT;
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3006';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function formatTimeSrt(totalSec) {
  const ms = Math.max(0, Math.round(totalSec * 1000));
  const hrs = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  const msec = ms % 1000;

  const pad2 = (n) => String(n).padStart(2, '0');
  const pad3 = (n) => String(n).padStart(3, '0');
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)},${pad3(msec)}`;
}

function estimateDurationSeconds(text = '', emotion = 'happy') {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length || 1;
  const punctuationPauses =
    (text.match(/[.,!?]/g) || []).length * 0.14 +
    (text.match(/[:;]/g) || []).length * 0.2;

  const baseWpsByEmotion = {
    happy: 2.5,
    excited: 2.7,
    celebrating: 2.75,
    thinking: 2.15,
    questioning: 2.2,
    surprised: 2.5,
  };
  const wps = baseWpsByEmotion[emotion] || 2.4;
  const speech = words / wps;

  return Number((Math.max(2.4, speech + punctuationPauses + 0.45)).toFixed(2));
}

function buildVoiceRole(scene) {
  if (scene?.checkpoint) return 'checkpoint';
  const emotion = String(scene?.emotion || '').toLowerCase();
  if (emotion === 'celebrating' || emotion === 'excited') return 'celebrate';
  if (emotion === 'questioning') return 'checkpoint';
  return 'main';
}

function lessonPathFromArg(lessonArg) {
  if (!lessonArg) return path.join(LESSONS_DIR, 'science_g3_living_non_living_script.json');
  if (path.isAbsolute(lessonArg)) return lessonArg;
  if (fs.existsSync(path.join(LESSONS_DIR, lessonArg))) return path.join(LESSONS_DIR, lessonArg);
  return path.join(process.cwd(), lessonArg);
}

function buildSceneTimeline(lesson) {
  const scenes = Array.isArray(lesson.scenes) ? lesson.scenes : [];
  const timeline = [];
  let cursor = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i] || {};
    const durationSec = estimateDurationSeconds(s.text || '', s.emotion || 'happy');
    const startSec = Number(cursor.toFixed(2));
    const endSec = Number((cursor + durationSec).toFixed(2));
    cursor = endSec;

    timeline.push({
      scene: s.scene ?? i + 1,
      text: s.text || '',
      emotion: s.emotion || 'happy',
      visual: s.visual || '',
      voiceRole: buildVoiceRole(s),
      durationSec,
      startSec,
      endSec,
      checkpoint: s.checkpoint || null,
    });

    cursor += 0.35; // tiny gap between voice lines
  }

  return timeline;
}

function buildCheckpoints(timeline) {
  const cps = [];
  for (const seg of timeline) {
    if (!seg.checkpoint) continue;
    cps.push({
      scene: seg.scene,
      triggerSec: Number((seg.startSec + Math.min(2.4, seg.durationSec * 0.6)).toFixed(2)),
      prompt: seg.checkpoint.prompt,
      options: seg.checkpoint.options || [],
      correct: seg.checkpoint.correct ?? 0,
      explanation: seg.checkpoint.explanation || '',
    });
  }
  return cps;
}

function buildSrt(timeline) {
  return timeline
    .map((seg, i) => {
      const start = formatTimeSrt(seg.startSec);
      const end = formatTimeSrt(seg.endSec);
      return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
    })
    .join('\n');
}

function buildNarrationScript(timeline) {
  const lines = [];
  for (const seg of timeline) {
    lines.push(
      `Scene ${String(seg.scene).padStart(2, '0')} [${seg.emotion} | ${seg.voiceRole}] (${seg.startSec}s-${seg.endSec}s)`,
      seg.text,
      ''
    );
  }
  return lines.join('\n');
}

function buildCanvaAutofillPayload(lesson, timeline, checkpoints) {
  const payload = {
    CHAPTER_TITLE: { type: 'text', text: lesson.topic || 'Chapter Lesson' },
    GRADE_LABEL: { type: 'text', text: lesson.grade || 'Grade 3' },
    SUBJECT_LABEL: { type: 'text', text: lesson.subject || 'Science' },
    INTRO_LINE: { type: 'text', text: lesson.intro || 'Let us start our chapter lesson!' },
  };

  const maxScenes = Math.min(14, timeline.length);
  for (let i = 0; i < maxScenes; i++) {
    const seg = timeline[i];
    const n = String(i + 1).padStart(2, '0');
    payload[`SCENE_${n}_TITLE`] = { type: 'text', text: seg.visual || `Scene ${i + 1}` };
    payload[`SCENE_${n}_TEXT`] = { type: 'text', text: seg.text };
  }

  for (let i = 0; i < Math.min(3, checkpoints.length); i++) {
    const cp = checkpoints[i];
    const n = String(i + 1).padStart(2, '0');
    payload[`CHECKPOINT_${n}_PROMPT`] = { type: 'text', text: cp.prompt || '' };
    payload[`CHECKPOINT_${n}_OPT_A`] = { type: 'text', text: cp.options?.[0] || '' };
    payload[`CHECKPOINT_${n}_OPT_B`] = { type: 'text', text: cp.options?.[1] || '' };
    payload[`CHECKPOINT_${n}_OPT_C`] = { type: 'text', text: cp.options?.[2] || '' };
    payload[`CHECKPOINT_${n}_OPT_D`] = { type: 'text', text: cp.options?.[3] || '' };
  }
  return payload;
}

async function generateTtsClips(timeline, outAudioDir, opts = {}) {
  fs.mkdirSync(outAudioDir, { recursive: true });
  const baseUrl = opts.baseUrl || SERVER_URL;

  const output = [];
  for (const seg of timeline) {
    process.stdout.write(`TTS scene ${seg.scene} (${seg.voiceRole}/${seg.emotion})... `);
    try {
      const res = await axios.post(
        `${baseUrl}/lesson/tts`,
        {
          text: seg.text,
          voice: seg.voiceRole,
          emotion: seg.emotion,
          character: opts.character || 'zara',
          grade: opts.grade || 'Grade 3',
        },
        { timeout: 60000 }
      );
      const data = res.data || {};
      if (!data.audioUrl) {
        process.stdout.write('failed (no audioUrl)\n');
        output.push({ scene: seg.scene, ok: false, error: data.error || 'no audioUrl' });
        continue;
      }

      const localRel = String(data.audioUrl).replace(/^\/+/, '');
      const src = path.join(SERVER_ROOT, localRel);
      if (!fs.existsSync(src)) {
        process.stdout.write('failed (cache file missing)\n');
        output.push({ scene: seg.scene, ok: false, error: 'cache file missing' });
        continue;
      }

      const destName = `scene_${String(seg.scene).padStart(2, '0')}_${slugify(seg.emotion)}.mp3`;
      const dest = path.join(outAudioDir, destName);
      fs.copyFileSync(src, dest);
      process.stdout.write('ok\n');
      output.push({
        scene: seg.scene,
        ok: true,
        file: destName,
        voiceRole: seg.voiceRole,
        emotion: seg.emotion,
      });
    } catch (err) {
      process.stdout.write(`failed (${err.message.slice(0, 80)})\n`);
      output.push({ scene: seg.scene, ok: false, error: err.message });
    }
  }

  const playlist = output
    .filter((x) => x.ok && x.file)
    .map((x) => x.file)
    .join('\n');
  fs.writeFileSync(path.join(outAudioDir, 'voiceover_playlist.m3u'), playlist || '', 'utf8');
  return output;
}

async function runCanvaFlow(opts) {
  const {
    templateId,
    autofillPayload,
    title,
    exportMp4,
    exportQuality = 'horizontal_720p',
    outDir,
  } = opts;

  if (!templateId) throw new Error('Missing --canva-template-id');

  const dataset = await getBrandTemplateDataset(templateId);
  const allowedFields = Object.keys(dataset?.dataset || {});
  const filteredData = {};
  for (const key of allowedFields) {
    if (autofillPayload[key]) filteredData[key] = autofillPayload[key];
  }
  if (Object.keys(filteredData).length === 0) {
    throw new Error(
      'No matching autofill fields found in template dataset. Update template field names or payload keys.'
    );
  }

  const createJob = await createAutofillJob({
    templateId,
    title,
    data: filteredData,
  });
  const autofillJobId = createJob?.job?.id;
  if (!autofillJobId) throw new Error('Autofill job did not return job id');

  const autofillDone = await waitForJob(getAutofillJob, autofillJobId, {
    timeoutMs: 240000,
    pollMs: 3000,
  });

  const designUrl = autofillDone?.job?.result?.design?.url || '';
  const designId = extractDesignId(designUrl);
  const state = {
    templateId,
    autofillJobId,
    designUrl,
    designId,
  };

  if (exportMp4 && designId) {
    const exportJob = await createExportJob({
      designId,
      format: { type: 'mp4', quality: exportQuality },
    });
    const exportJobId = exportJob?.job?.id;
    if (!exportJobId) throw new Error('Export job did not return job id');

    const exportDone = await waitForJob(getExportJob, exportJobId, {
      timeoutMs: 360000,
      pollMs: 4000,
    });
    state.exportJobId = exportJobId;
    state.exportUrls = exportDone?.job?.urls || [];

    if (state.exportUrls.length > 0) {
      const url = state.exportUrls[0];
      const videoPath = path.join(outDir, 'canva_export.mp4');
      const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 120000 });
      fs.writeFileSync(videoPath, Buffer.from(response.data));
      state.downloadedMp4 = videoPath;
    }
  }

  return state;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const lessonFile = lessonPathFromArg(args.lesson);
  if (!fs.existsSync(lessonFile)) {
    throw new Error(`Lesson file not found: ${lessonFile}`);
  }

  const lesson = JSON.parse(fs.readFileSync(lessonFile, 'utf8'));
  const chapterSlug = slugify(
    `${lesson.curriculum || 'curriculum'}_${lesson.grade || 'grade'}_${lesson.subject || 'subject'}_${lesson.topic || 'chapter'}`
  );
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(OUTPUT_ROOT, chapterSlug);
  fs.mkdirSync(outDir, { recursive: true });

  const timeline = buildSceneTimeline(lesson);
  const checkpoints = buildCheckpoints(timeline);
  const autoplayQuiz = Array.isArray(lesson.quiz) ? lesson.quiz : [];
  const canvaPayload = buildCanvaAutofillPayload(lesson, timeline, checkpoints);

  fs.writeFileSync(path.join(outDir, 'chapter_manifest.json'), JSON.stringify({
    meta: {
      generatedAt: new Date().toISOString(),
      sourceLessonFile: lessonFile,
      topic: lesson.topic || '',
      grade: lesson.grade || '',
      subject: lesson.subject || '',
      curriculum: lesson.curriculum || '',
      totalScenes: timeline.length,
      estimatedRuntimeSec: timeline.length ? timeline[timeline.length - 1].endSec : 0,
    },
    timeline,
    checkpoints,
    quiz: autoplayQuiz,
  }, null, 2));

  fs.writeFileSync(path.join(outDir, 'narration_timeline.srt'), buildSrt(timeline), 'utf8');
  fs.writeFileSync(path.join(outDir, 'narration_script.txt'), buildNarrationScript(timeline), 'utf8');
  fs.writeFileSync(path.join(outDir, 'practice_quiz.json'), JSON.stringify(autoplayQuiz, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'canva_autofill_payload.json'), JSON.stringify(canvaPayload, null, 2), 'utf8');

  let tts = null;
  if (args['generate-tts']) {
    const audioDir = path.join(outDir, 'audio');
    tts = await generateTtsClips(timeline, audioDir, {
      baseUrl: args['tts-base-url'] || SERVER_URL,
      character: args.character || 'zara',
      grade: lesson.grade || 'Grade 3',
    });
    fs.writeFileSync(path.join(outDir, 'tts_generation_report.json'), JSON.stringify(tts, null, 2), 'utf8');
  }

  let canva = null;
  if (args['run-canva']) {
    canva = await runCanvaFlow({
      templateId: args['canva-template-id'] || process.env.CANVA_BRAND_TEMPLATE_ID,
      autofillPayload: canvaPayload,
      title: `${lesson.topic || 'Chapter'} - ${lesson.grade || 'Grade'}`,
      exportMp4: Boolean(args['export-mp4']),
      exportQuality: args['export-quality'] || 'horizontal_720p',
      outDir,
    });
    fs.writeFileSync(path.join(outDir, 'canva_run_output.json'), JSON.stringify(canva, null, 2), 'utf8');
  }

  const summary = {
    lessonFile,
    outDir,
    scenes: timeline.length,
    checkpoints: checkpoints.length,
    hasQuiz: autoplayQuiz.length > 0,
    ttsGenerated: Array.isArray(tts),
    canvaRun: Boolean(canva),
  };
  fs.writeFileSync(path.join(outDir, 'run_summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log('Chapter package ready:');
  console.log(`  ${outDir}`);
  console.log(`  scenes: ${summary.scenes}, checkpoints: ${summary.checkpoints}`);
  if (summary.ttsGenerated) {
    const ok = tts.filter((x) => x.ok).length;
    console.log(`  tts clips: ${ok}/${tts.length}`);
  }
  if (canva?.designUrl) {
    console.log(`  canva design: ${canva.designUrl}`);
  }
  if (canva?.downloadedMp4) {
    console.log(`  exported mp4: ${canva.downloadedMp4}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

