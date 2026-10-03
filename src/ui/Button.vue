<script setup lang="ts">
import UButton from "@nuxt/ui/components/Button.vue";
defineProps<{ label?: string; variant?: string; size?: string; loading?: boolean; disabled?: boolean }>();
</script>
<template><UButton :label="label" :variant="variant === 'text' ? 'ghost' : variant === 'outlined' ? 'outline' : 'solid'" :size="size === 'small' ? 'sm' : 'md'" :loading="loading" :disabled="disabled"><slot /></UButton></template>
