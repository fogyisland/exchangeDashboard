<template>
  <div class="package-upload" data-testid="package-upload">
    <input type="file" accept=".zip" data-testid="package-upload-input" @change="onChange" :disabled="uploading" />
    <div v-if="uploading" class="package-upload-progress" data-testid="package-upload-progress">Installing...</div>
    <div v-if="error" class="package-upload-error" data-testid="package-upload-error">{{ error }}</div>
  </div>
</template>

<script setup>
defineProps({
  uploading: { type: Boolean, default: false },
  error: { type: String, default: '' }
});
const emit = defineEmits(['file-selected']);
function onChange(e) {
  const file = e.target.files && e.target.files[0];
  if (file) emit('file-selected', file);
}
</script>

<style scoped>
.package-upload { padding: 12px; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; }
.package-upload-progress { margin-top: 8px; color: var(--accent); font-size: 13px; }
.package-upload-error { margin-top: 8px; color: var(--danger); font-size: 13px; }
</style>
