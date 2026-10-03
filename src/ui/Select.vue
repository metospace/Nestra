<script setup lang="ts">
import USelect from "@nuxt/ui/components/Select.vue";
defineProps<{ modelValue?: any; options?: any[]; optionLabel?: string; optionValue?: string; overlayClass?: string; size?: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: any] }>();
</script>
<template><USelect :model-value="modelValue" :items="options" :label-key="optionLabel ?? 'label'" :value-key="optionValue ?? 'value'" :size="size === 'small' ? 'sm' : 'md'" :ui="{ content: 'nestra-hit nestra-select-overlay' }" @update:model-value="emit('update:modelValue', $event)" /></template>
