/**
 * Aivorah AI Monitor Agent
 * - Checks all critical services every 2 minutes
 * - Uses Groq AI to analyze errors and suggest fixes
 * - Notifies admin via email when issues detected
 * - Logs all incidents to Supabase for admin dashboard
 * - Auto-remediates known fixable issues
 */

const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const BASE_URL = process.env.SELF_URL || 'https://aivorah.ai';

// ── Health check definitions ───────────────────────────────────────────────
const CHECKS = [
  {
    name: 'Server',
    url: `${BASE_URL}/health`,
    critical: true,
    timeout: 8000,
  },
  {
    name: 'Student API',
    url: `${BASE_URL}/student/health-check`,
    critical: true,
    timeout: 6000,
  },
  {
    name: 'Stories API',
    url: `${BASE_URL}/stories`,
    critical: false,
    timeout: 6000,
  },
  {
    name: 'Curriculum API',
    url: `${BASE_URL}/ibpyp/health`,
    critical: false,
    timeout: 6000,
  },
  {
    name: 'Supabase DB',
    fn: checkSupabase,
    critical: true,
    timeout: 5000,
  },
  {
    name: 'Groq AI',
    fn: checkGroq,
    critical: false,
    timeout: 10000,
  },
];

// ── In-memory state ────────────────────────────────────────────────────────
const state = {
  lastCheck:     null,
  incidents:     [],      // active unresolved incidents
  checkHistory:  [],      // last 50 check results
  errorCounts:   {},      // name → consecutive error count
  alertCooldown: {},      // name → last alert time (avoid spam)
  isRunning:     false,
};

// ── Individual service checks ──────────────────────────────────────────────

async function checkSupabase() {
  const { error } = await supabase.from('users').select('id').limit(1);
  if (error) throw new Error(`Supabase: ${error.message}`);
  return { status: 'ok' };
}

async function checkGroq() {
  const resp = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 5,
  });
  if (!resp.choices?.[0]) throw new Error('Groq returned no response');
  return { status: 'ok' };
}

async function runCheck(check) {
  const start = Date.now();
  try {
    let result;
    if (check.fn) {
      const timer = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${check.timeout}ms`)), check.timeout)
      );
      result = await Promise.race([check.fn(), timer]);
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), check.timeout);
      const res = await fetch(check.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      result = await res.json().catch(() => ({ status: 'ok' }));
    }
    const latencyMs = Date.now() - start;
    return { name: check.name, ok: true, latencyMs, result, critical: check.critical };
  } catch (err) {
    const latencyMs = Date.now() - start;
    return { name: check.name, ok: false, latencyMs, error: err.message, critical: check.critical };
  }
}

// ── AI error analysis ──────────────────────────────────────────────────────

async function analyzeErrorWithAI(failures, recentErrors) {
  try {
    const prompt = `You are an AI DevOps agent for Aivorah, an EdTech platform.

The following services are DOWN or have errors:
${failures.map(f => `- ${f.name}: ${f.error}`).join('\n')}

Recent server errors (last 10 minutes):
${recentErrors.slice(0, 5).map(e => `- ${e.message} (${e.route})`).join('\n') || 'None logged'}

Analyze the failures and respond in this exact JSON format:
{
  "severity": "critical|high|medium|low",
  "rootCause": "brief diagnosis in 1 sentence",
  "impact": "what users are experiencing right now",
  "autoFix": "what the system can auto-fix (or null)",
  "adminAction": "what the admin needs to do manually",
  "eta": "estimated time to resolve if admin acts now"
}`;

    const resp = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      temperature: 0.2,
    });

    const raw = resp.choices[0].message.content.trim();
    const clean = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
    return JSON.parse(clean);
  } catch {
    return {
      severity: 'high',
      rootCause: 'Multiple services unreachable',
      impact: 'Users may experience errors or blank screens',
      autoFix: null,
      adminAction: 'Check GCP Cloud Run logs and restart the service',
      eta: '5-10 minutes',
    };
  }
}

// ── Log incident to Supabase ───────────────────────────────────────────────

async function logIncident(checkResults, aiAnalysis) {
  try {
    const failures = checkResults.filter(r => !r.ok);
    await supabase.from('monitor_incidents').insert({
      timestamp:    new Date().toISOString(),
      services_down: failures.map(f => f.name),
      severity:     aiAnalysis.severity,
      root_cause:   aiAnalysis.rootCause,
      impact:       aiAnalysis.impact,
      auto_fix:     aiAnalysis.autoFix,
      admin_action: aiAnalysis.adminAction,
      resolved:     false,
      check_results: checkResults,
    });
  } catch (err) {
    console.error('[Monitor] Failed to log incident:', err.message);
  }
}

async function resolveIncident(serviceName) {
  try {
    await supabase
      .from('monitor_incidents')
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .contains('services_down', [serviceName])
      .eq('resolved', false);
  } catch {}
}

// ── Admin notification ─────────────────────────────────────────────────────

async function notifyAdmin(checkResults, aiAnalysis) {
  const failures = checkResults.filter(r => !r.ok);
  const now = Date.now();

  // Cooldown: don't spam — max 1 alert per service per 15 minutes
  const newFailures = failures.filter(f => {
    const last = state.alertCooldown[f.name] || 0;
    return now - last > 15 * 60 * 1000;
  });

  if (newFailures.length === 0) return;

  // Mark cooldown
  newFailures.forEach(f => { state.alertCooldown[f.name] = now; });

  const severityEmoji = {
    critical: '🔴', high: '🟠', medium: '🟡', low: '🟢',
  }[aiAnalysis.severity] || '⚠️';

  const subject = `${severityEmoji} Aivorah Alert: ${newFailures.map(f => f.name).join(', ')} DOWN`;

  const body = `
AIVORAH MONITORING ALERT
========================
Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
Severity: ${aiAnalysis.severity.toUpperCase()}

SERVICES DOWN:
${newFailures.map(f => `  • ${f.name}: ${f.error}`).join('\n')}

AI DIAGNOSIS:
  Root Cause: ${aiAnalysis.rootCause}
  User Impact: ${aiAnalysis.impact}

AUTO-FIX APPLIED: ${aiAnalysis.autoFix || 'None available'}

ACTION REQUIRED:
  ${aiAnalysis.adminAction}
  Estimated Fix Time: ${aiAnalysis.eta}

CHECK DASHBOARD: ${BASE_URL}/admin#monitor

— Aivorah AI Monitor
`.trim();

  // Log to Supabase admin_notifications table
  try {
    await supabase.from('admin_notifications').insert({
      type:      'monitor_alert',
      severity:  aiAnalysis.severity,
      subject,
      body,
      sent_at:   new Date().toISOString(),
      read:      false,
    });
  } catch {}

  // Email via Resend/Nodemailer if configured
  if (process.env.ADMIN_EMAIL && process.env.RESEND_API_KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    'monitor@aivorah.ai',
          to:      [process.env.ADMIN_EMAIL],
          subject,
          text:    body,
        }),
      });
      console.log(`[Monitor] Alert email sent to ${process.env.ADMIN_EMAIL}`);
    } catch (err) {
      console.error('[Monitor] Email send failed:', err.message);
    }
  }

  console.log(`[Monitor] ALERT: ${subject}`);
}

// ── Auto-remediation ───────────────────────────────────────────────────────

async function attemptAutoFix(failures) {
  const fixes = [];

  for (const f of failures) {
    // Supabase connection drop → reinitialize client
    if (f.name === 'Supabase DB') {
      try {
        // Force reconnect by making a simple query
        await supabase.from('users').select('id').limit(1);
        fixes.push(`Supabase: reconnection attempted`);
      } catch {}
    }

    // Slow response / timeout → log for scaling decision
    if (f.error?.includes('Timeout')) {
      fixes.push(`${f.name}: timeout detected — consider scaling Cloud Run instances`);
      // Log to Supabase for admin review
      await supabase.from('monitor_incidents').insert({
        timestamp:     new Date().toISOString(),
        services_down: [f.name],
        severity:      'medium',
        root_cause:    `${f.name} timed out after ${f.latencyMs}ms`,
        impact:        'Slow response for users',
        auto_fix:      'Logged for scaling review',
        admin_action:  'Consider increasing Cloud Run min instances',
        resolved:      false,
        check_results: [f],
      }).catch(() => {});
    }
  }

  return fixes;
}

// ── Main monitor loop ──────────────────────────────────────────────────────

async function runMonitorCycle() {
  if (state.isRunning) return; // prevent overlapping runs
  state.isRunning = true;
  state.lastCheck = new Date().toISOString();

  try {
    // Run all checks in parallel
    const results = await Promise.all(CHECKS.map(runCheck));

    // Track history (keep last 50)
    state.checkHistory.unshift({ time: state.lastCheck, results });
    if (state.checkHistory.length > 50) state.checkHistory.pop();

    const failures = results.filter(r => !r.ok);
    const criticalFailures = failures.filter(r => r.critical);

    // Update consecutive error counts
    results.forEach(r => {
      if (!r.ok) {
        state.errorCounts[r.name] = (state.errorCounts[r.name] || 0) + 1;
      } else {
        if (state.errorCounts[r.name] > 0) {
          // Service recovered
          console.log(`[Monitor] ✅ ${r.name} recovered after ${state.errorCounts[r.name]} failed checks`);
          resolveIncident(r.name);
        }
        state.errorCounts[r.name] = 0;
      }
    });

    if (failures.length === 0) {
      const avgLatency = Math.round(results.reduce((a, r) => a + r.latencyMs, 0) / results.length);
      console.log(`[Monitor] ✅ All services healthy | avg latency: ${avgLatency}ms`);
      return;
    }

    console.log(`[Monitor] ⚠️  ${failures.length} service(s) down: ${failures.map(f => f.name).join(', ')}`);

    // Only run AI analysis + alert for services failing for 2+ consecutive checks
    // (avoids false alarms from transient blips)
    const persistentFailures = failures.filter(f => (state.errorCounts[f.name] || 0) >= 2);

    if (persistentFailures.length > 0) {
      // Fetch recent error logs from Supabase
      const { data: recentErrors } = await supabase
        .from('server_errors')
        .select('message, route, created_at')
        .gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(10)
        .catch(() => ({ data: [] }));

      const aiAnalysis = await analyzeErrorWithAI(persistentFailures, recentErrors || []);
      const autoFixLog = await attemptAutoFix(persistentFailures);

      if (autoFixLog.length > 0) {
        aiAnalysis.autoFix = autoFixLog.join('; ');
      }

      await logIncident(results, aiAnalysis);
      await notifyAdmin(results, aiAnalysis);
    }

  } catch (err) {
    console.error('[Monitor] Cycle error:', err.message);
  } finally {
    state.isRunning = false;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

function getStatus() {
  const latest = state.checkHistory[0];
  if (!latest) return { status: 'starting', checks: [], lastCheck: null };

  const checks = latest.results.map(r => ({
    name:      r.name,
    ok:        r.ok,
    latencyMs: r.latencyMs,
    error:     r.error || null,
    critical:  r.critical,
    consecutiveErrors: state.errorCounts[r.name] || 0,
  }));

  const allOk = checks.every(c => c.ok);
  const criticalDown = checks.some(c => !c.ok && c.critical);

  return {
    status:    criticalDown ? 'critical' : allOk ? 'healthy' : 'degraded',
    lastCheck: state.lastCheck,
    checks,
    uptime:    allOk ? '100%' : null,
  };
}

function start(intervalMs = 2 * 60 * 1000) {
  console.log(`[Monitor] Starting AI monitor — checking every ${intervalMs / 1000}s`);
  runMonitorCycle(); // run immediately on start
  return setInterval(runMonitorCycle, intervalMs);
}

module.exports = { start, runMonitorCycle, getStatus };
