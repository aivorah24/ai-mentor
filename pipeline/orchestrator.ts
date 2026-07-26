import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables for Groq SDK
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { AgentRegistry } from './registry';
import { PackageStore } from './package-store';
import { PipelineLogger } from './logger';
import { AgentRuntime } from './runtime/agent-runtime';
import { PromptBuilder } from './runtime/prompt-builder';
import { OutputValidator } from './runtime/output-validator';
import { RetryPolicy } from './runtime/retry-policy';
import { groundedRetrieve } from './runtime/grounded-retrieval';

export class PipelineOrchestrator {
  private pipelineId: string;
  private packageStore: PackageStore;
  private logger: PipelineLogger;
  private agentRuntime: AgentRuntime;

  constructor() {
    this.pipelineId = this.generateId();
    const runId = `run_${new Date().toISOString().split('T')[0]}_${this.pipelineId}`;
    this.packageStore = new PackageStore(runId);
    this.logger = new PipelineLogger();
    
    this.agentRuntime = new AgentRuntime(
      new PromptBuilder(),
      new OutputValidator(),
      new RetryPolicy(3)
    );
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  async runPipeline(benchmarkFilePath: string) {
    console.log(`\n🚀 Aivorah Pipeline Run: ${this.pipelineId}\n`);
    
    // Load benchmark request
    const requestData = JSON.parse(fs.readFileSync(benchmarkFilePath, 'utf-8'));

    let currentInput = requestData;

    // Phase 0: REAL retrieval — a genuine Qdrant vector search, NOT an LLM.
    // This is what grounds the whole pipeline in actual NCERT chunks; skipping
    // it (the old LLM "retrieval") let the 8B model hallucinate textbook text.
    process.stdout.write(`⏳ Retrieval (Qdrant)\r`);
    const retrStart = Date.now();
    try {
      const retrievalPackage = await groundedRetrieve(requestData, this.pipelineId);
      const chunks = retrievalPackage?.payload?.retrieved_chunks?.length ?? 0;
      this.packageStore.savePackage('001', 'Retrieval', retrievalPackage);
      console.log(`✅ Retrieval — ${chunks} real chunks from Qdrant (${((Date.now() - retrStart) / 1000).toFixed(1)} s)`);
      if (chunks === 0) {
        console.log(`⚠️  No content ingested for this lesson in Qdrant. Aborting — the pipeline will NOT fabricate textbook content. Ingest this lesson first.`);
        return;
      }
      currentInput = retrievalPackage;
    } catch (error: any) {
      console.log(`❌ Retrieval (Qdrant) FAILED\n${error.message}`);
      return;
    }

    // The grounded evidence (real NCERT chunks) must stay visible to EVERY
    // downstream agent — the Lesson Generator especially writes from it. Chaining
    // only the previous package (the old bug) left the generator with a UI plan
    // and no evidence, so it correctly refused with "coverage FAIL". We carry a
    // compact evidence block forward alongside each step's own input.
    const groundedEvidence = (currentInput as any).payload.retrieved_chunks.map((c: any) => ({
      topic: c.metadata?.topic, content: c.content,
    }));
    const withEvidence = (pkg: any) => ({ grounded_evidence: groundedEvidence, ...pkg });

    // Phase 1, 2, 3 Agents (Sequential) — Retrieval already done above.
    // Lesson Generator is held OUT of this list so it can sit inside the
    // regeneration loop below (Teacher Review FAIL → regenerate → re-review).
    const sequentialAgents = [
      { name: 'Retrieval Validation', step: '002', config: AgentRegistry.retrievalValidation },
      { name: 'Curriculum Understanding', step: '003', config: AgentRegistry.curriculumUnderstanding },
      { name: 'Learning Experience', step: '004', config: AgentRegistry.learningExperience },
      { name: 'UI Planner', step: '005', config: AgentRegistry.uiPlanner },
    ];

    for (const agent of sequentialAgents) {
      process.stdout.write(`⏳ ${agent.name}\r`);
      const startTime = Date.now();
      try {
        const outputPackage = await this.agentRuntime.execute(agent.config, withEvidence(currentInput));
        const executionTime = ((Date.now() - startTime) / 1000).toFixed(1);

        this.packageStore.savePackage(agent.step, agent.name.replace(/ /g, ''), outputPackage);
        console.log(`✅ ${agent.name} (${executionTime} s)`);

        currentInput = outputPackage; // Chain input
      } catch (error: any) {
        console.log(`❌ ${agent.name} FAILED\n${error.message}`);
        return;
      }
    }
    const uiPlan = currentInput; // preserved for regeneration re-runs

    // Phase 4+5 with REGENERATION LOOP:
    //   Lesson Generator → Illustration + Audio → Teacher Review.
    // If Teacher Review FAILs, we feed its surgical feedback back into the
    // Lesson Generator and regenerate — up to MAX_REGEN times — until the lesson
    // PASSes the teacher gate. This is what turns "grounded but thin/weak" output
    // into classroom-ready content instead of shipping a rejected lesson.
    const MAX_REGEN = 3;
    let lessonContent: any = null;
    let enrichmentOutputs: any[] = [];
    let teacherReview: any = null;
    let priorFeedback: any = null;

    for (let attempt = 1; attempt <= MAX_REGEN; attempt++) {
      const label = attempt === 1 ? 'Lesson Generator' : `Lesson Generator (regen ${attempt - 1})`;
      process.stdout.write(`⏳ ${label}\r`);
      const t0 = Date.now();
      try {
        // On a regen pass, include the previous FAIL feedback so the generator
        // fixes exactly what the teacher flagged.
        const genInput = withEvidence({
          ...uiPlan,
          ...(priorFeedback ? { revision_request: priorFeedback } : {}),
        });
        lessonContent = await this.agentRuntime.execute(AgentRegistry.lessonGenerator, genInput);
        this.packageStore.savePackage('006', 'LessonGenerator', lessonContent);
        console.log(`✅ ${label} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      } catch (error: any) {
        console.log(`❌ ${label} FAILED\n${error.message}`);
        return;
      }

      // Enrichment (parallel) on the freshly generated content.
      process.stdout.write(`⏳ Illustration, Audio\r`);
      const pStart = Date.now();
      try {
        enrichmentOutputs = await Promise.all([
          this.agentRuntime.execute(AgentRegistry.illustration, lessonContent),
          this.agentRuntime.execute(AgentRegistry.audio, lessonContent),
        ]);
        this.packageStore.savePackage('007', 'Illustration', enrichmentOutputs[0]);
        this.packageStore.savePackage('008', 'Audio', enrichmentOutputs[1]);
        this.packageStore.savePackage('009', 'QuizReview', { status: 'SKIPPED', reason: 'No quiz package available for review.' });
        console.log(`✅ Illustration + Audio (${((Date.now() - pStart) / 1000).toFixed(1)} s)`);
      } catch (error: any) {
        console.log(`❌ Enrichment FAILED\n${error.message}`);
        return;
      }

      // Teacher Review gate.
      process.stdout.write(`⏳ Teacher Review\r`);
      const rStart = Date.now();
      try {
        teacherReview = await this.agentRuntime.execute(AgentRegistry.teacherReview, {
          ...lessonContent,
          illustration: enrichmentOutputs[0],
          audio: enrichmentOutputs[1],
        });
        this.packageStore.savePackage('010', 'TeacherReview', teacherReview);
      } catch (error: any) {
        console.log(`❌ Teacher Review FAILED\n${error.message}`);
        return;
      }

      const status = teacherReview?.payload?.status;
      const score = teacherReview?.payload?.review_scores?.overall_score;
      console.log(`   Teacher Review: ${status}${score != null ? ` (${score}/100)` : ''} (${((Date.now() - rStart) / 1000).toFixed(1)} s)`);

      if (status === 'PASS') {
        console.log(`✅ Teacher Review PASS on attempt ${attempt}`);
        break;
      }
      priorFeedback = teacherReview?.payload?.surgical_feedback || teacherReview?.payload;
      if (attempt < MAX_REGEN) {
        console.log(`↻ Teacher Review FAIL — regenerating with feedback (attempt ${attempt + 1}/${MAX_REGEN})...`);
      } else {
        console.log(`⚠️  Teacher Review still FAIL after ${MAX_REGEN} attempts — this lesson is NOT release-ready.`);
      }
    }

    const passed = teacherReview?.payload?.status === 'PASS';

    // Phase 6: Functional QA + Final Audit (only meaningful once content passed).
    console.log(`\n-- Release Phase --`);
    let finalInput: any = { ...lessonContent, illustration: enrichmentOutputs[0], audio: enrichmentOutputs[1], teacher_review: teacherReview };
    for (const agent of [
      { name: 'Functional QA', step: '011', config: AgentRegistry.functionalQA },
      { name: 'Final Audit', step: '012', config: AgentRegistry.finalAudit },
    ]) {
      process.stdout.write(`⏳ ${agent.name}\r`);
      const t0 = Date.now();
      try {
        const out = await this.agentRuntime.execute(agent.config, finalInput);
        this.packageStore.savePackage(agent.step, agent.name.replace(/ /g, ''), out);
        console.log(`✅ ${agent.name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        finalInput = out;
      } catch (error: any) {
        console.log(`❌ ${agent.name} FAILED\n${error.message}`);
        return;
      }
    }

    console.log(`\n${passed ? '🎉' : '⚠️'} Pipeline Complete — lesson ${passed ? 'PASSED' : 'did NOT pass'} the teacher gate. Packages in runs/.\n`);
  }
}

// Entry point if run directly
if (require.main === module) {
  const orchestrator = new PipelineOrchestrator();
  // Benchmark file can be overridden via CLI arg for testing other lessons.
  const benchmarkFile = process.argv[2] || 'my_bicycle.json';
  const benchmarkPath = path.join(__dirname, 'benchmark', benchmarkFile);
  orchestrator.runPipeline(benchmarkPath);
}
