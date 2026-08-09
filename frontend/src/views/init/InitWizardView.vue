<template>
  <div class="init-wizard">
    <header>
      <h2>Exchange Dashboard — Initial Setup</h2>
      <ol class="stepper">
        <li :class="{ active: step === 1, done: step > 1 }">1. Database</li>
        <li :class="{ active: step === 2, done: step > 2 }">2. Admin</li>
        <li :class="{ active: step === 3 }">3. Apply</li>
      </ol>
    </header>
    <main>
      <section v-if="step === 1">
        <p>Database connection configuration will be added in a follow-up task.</p>
        <button @click="step = 2" :disabled="true">Next</button>
      </section>
      <section v-else-if="step === 2">
        <p>Admin account creation will be added in a follow-up task.</p>
        <button @click="step = 1">Back</button>
        <button @click="step = 3" :disabled="true">Next</button>
      </section>
      <section v-else>
        <p>Initialization &amp; finalization will be added in a follow-up task.</p>
        <button @click="step = 2">Back</button>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue';
const step = ref(1);
</script>

<style scoped>
.init-wizard { max-width: 720px; margin: 32px auto; padding: 24px; background: var(--panel); border-radius: 8px; }
header h2 { margin: 0 0 16px; color: var(--accent); font-size: 18px; }
.stepper { display: flex; gap: 16px; padding: 0; margin: 0 0 24px; list-style: none; }
.stepper li { padding: 6px 12px; border: 1px solid var(--border); border-radius: 4px; font-size: 13px; color: var(--muted); }
.stepper li.active { border-color: var(--accent); color: var(--accent); }
.stepper li.done { border-color: var(--green); color: var(--green); }
main section { display: flex; flex-direction: column; gap: 12px; }
main button { align-self: flex-start; }
</style>