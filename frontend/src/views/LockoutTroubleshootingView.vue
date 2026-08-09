<template>
  <div class="lockout" data-testid="lockout-view">
    <header class="view-header">
      <h2>Exchange Account Lockout Troubleshooting</h2>
    </header>

    <section class="tips">
      <h3>Common Exchange lockout causes</h3>
      <ul>
        <li>
          <strong>EWS throttling &amp; retries:</strong> Outlook, mobile, and third-party apps
          can hammer EWS with bad-password retries and trip the
          <code>ThrottlingPolicy</code> budget faster than AD can release the lockout.
        </li>
        <li>
          <strong>MAPI / RPC client session limits:</strong> A misconfigured Outlook profile or a
          stale <code>RpcClientAccess</code> connection can authenticate repeatedly with a stale
          cached credential, locking the AD account on every reconnect attempt.
        </li>
        <li>
          <strong>ActiveSync device loops:</strong> A mobile device with an old password
          will retry ActiveSync sync indefinitely until the AD lockout threshold is hit.
        </li>
        <li>
          <strong>AD account lockout policy:</strong> The domain's
          <code>Account lockout threshold</code> and
          <code>Reset account lockout counter after</code> values determine how quickly a
          flapping client locks the account. Use this tool to correlate recent bad-password
          events against the policy.
        </li>
        <li>
          <strong>Service-account password drift:</strong> Applications using a service
          account for EWS / SMTP auth that have an outdated credential will lock the account
          across multiple Exchange servers simultaneously.
        </li>
      </ul>
    </section>

    <section class="form-section">
      <h3>Diagnose</h3>
      <p class="muted">
        Enter the affected mailbox alias (e.g. <code>jdoe</code>) and the source IP from the
        bad-password event. The tool will cross-reference recent AD lockout events, Exchange
        throttling, and active MAPI/RPC sessions for that principal.
      </p>
      <form class="form" @submit.prevent="onSubmit">
        <label>
          Username / mailbox alias
          <input
            v-model="username"
            required
            placeholder="e.g. jdoe"
            data-testid="lockout-username"
          />
        </label>
        <label>
          Source IP
          <input
            v-model="sourceIp"
            placeholder="e.g. 10.0.0.5"
            data-testid="lockout-source-ip"
          />
        </label>
        <button type="submit" :disabled="loading" data-testid="lockout-submit">
          {{ loading ? 'Diagnosing...' : 'Diagnose' }}
        </button>
      </form>
    </section>

    <div v-if="error" class="err" data-testid="lockout-error">Error: {{ error }}</div>
    <div v-if="result" class="result" data-testid="lockout-result">
      <h3>Result</h3>
      <pre>{{ result }}</pre>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { diagnose } from '../api/lockout.js';

const username = ref('');
const sourceIp = ref('');
const loading = ref(false);
const error = ref('');
const result = ref(null);

async function onSubmit() {
  error.value = '';
  result.value = null;
  loading.value = true;
  try {
    result.value = await diagnose({ username: username.value, sourceIp: sourceIp.value });
  } catch (e) {
    error.value = e.response?.data?.error?.message || e.message || 'Failed';
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.lockout { padding: 8px; }
.lockout h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.lockout h3 { margin: 0 0 8px; color: var(--accent); font-size: 14px; }
.view-header {
  margin-bottom: 16px;
  background: var(--panel);
  padding: 12px 16px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.tips,
.form-section,
.result {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 16px;
}
.tips ul {
  margin: 8px 0 0;
  padding-left: 20px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
}
.tips li { margin-bottom: 8px; }
.tips code,
.form-section code {
  background: var(--panel-alt);
  padding: 1px 6px;
  border-radius: 3px;
  color: var(--accent);
  font-size: 12px;
}
.form { display: flex; flex-direction: column; gap: 12px; max-width: 400px; }
.form label { display: flex; flex-direction: column; gap: 4px; color: var(--muted); font-size: 13px; }
.form button { align-self: flex-start; }
.result h3 { margin: 0 0 8px; }
.result pre { white-space: pre-wrap; color: var(--text); margin: 0; font-size: 13px; }
.muted { color: var(--muted); font-size: 13px; margin: 0 0 12px; }
.err { color: var(--red, #ef4444); margin-top: 12px; }
</style>