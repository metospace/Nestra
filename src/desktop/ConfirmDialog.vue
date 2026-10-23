<script setup lang="ts">
import { store } from "@/stores/state";
import { nextTick, ref, watch } from "vue";

const cancelButton = ref<HTMLButtonElement | null>(null);
watch(() => store.confirmRequest, async (request) => {
  if (!request) return;
  await nextTick();
  if (store.confirmRequest === request) cancelButton.value?.focus({ preventScroll: true });
});

function answer(ok: boolean): void {
  store.confirmRequest?.resolve(ok);
}
</script>

<template>
  <!-- nestra-hit：整个遮罩纳入命中矩形，否则光标一出面板区点击就穿透到桌面 -->
  <div
    v-if="store.confirmRequest"
    class="nestra-hit confirm-scrim"
    @click.self="answer(false)"
    @contextmenu.prevent
  >
    <div class="confirm-card" role="alertdialog" @keydown.esc.prevent="answer(false)">
      <p class="confirm-message">{{ store.confirmRequest.message }}</p>
      <div class="confirm-actions">
        <button ref="cancelButton" data-desktop-input type="button" class="menu-row confirm-btn" @click="answer(false)">取消</button>
        <button data-desktop-input type="button" class="menu-row confirm-btn confirm-ok" @click="answer(true)">确定</button>
      </div>
    </div>
  </div>
</template>
