<script setup lang="ts">
import { onMounted, ref } from "vue";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import Button from "@/volt/Button.vue";
import Dialog from "@/volt/Dialog.vue";
import InputText from "@/volt/Inputtext.vue";
import Select from "@/volt/Select.vue";
import Slider from "@/volt/Slider.vue";
import ToggleSwitch from "@/volt/Toggleswitch.vue";
import { RULES } from "@/lib/classification";
import {
  addCustomGroup,
  initialize,
  itemsByPanel,
  removeCustomGroup,
  renameCustomGroup,
  resetLayouts,
  setAppearance,
  setRuleEnabled,
  store,
} from "@/stores/state";
import type { OrganizerMode, SurfaceMaterial, CornerStyle, BorderStyle } from "@/types";

const currentWindow = getCurrentWebviewWindow();

const tab = ref<"groups" | "rules" | "appearance" | "about">("groups");
const tabs = [
  { id: "groups", label: "分区与分组" },
  { id: "rules", label: "分类规则" },
  { id: "appearance", label: "外观" },
  { id: "about", label: "关于" },
] as const;

onMounted(() => {
  void initialize();
});

/* 分区与分组 ----------------------------------------------------------- */

interface ModeOption {
  label: string;
  value: OrganizerMode;
}

const modeOptions: ModeOption[] = [
  { label: "文件", value: "files" },
  { label: "应用", value: "applications" },
  { label: "混合", value: "mixed" },
];

function modeLabel(mode: OrganizerMode): string {
  return modeOptions.find((option) => option.value === mode)?.label ?? mode;
}

const createDialogVisible = ref(false);
const newGroupName = ref("");
const newGroupMode = ref<OrganizerMode>("mixed");

function openCreateDialog(): void {
  newGroupName.value = "";
  newGroupMode.value = "mixed";
  createDialogVisible.value = true;
}

function submitCreate(): void {
  const name = newGroupName.value.trim();
  if (!name) return;
  addCustomGroup(name, newGroupMode.value);
  createDialogVisible.value = false;
}

function itemCount(groupId: string): number {
  for (const panel of store.panels.filter((p) => p.groupId === groupId)) {
    return (itemsByPanel.value[panel.key] ?? []).length;
  }
  return 0;
}

/* 分类规则 ------------------------------------------------------------- */

const fileRules = RULES.filter((rule) => rule.mode === "files");
const appRules = RULES.filter((rule) => rule.mode === "applications");

/* 外观 ----------------------------------------------------------------- */

const materialOptions = [
  { label: "清透 · 深色玻璃", value: "clear" },
  { label: "雾面 · 实底安静", value: "matte" },
  { label: "毛玻璃 · 重度模糊", value: "glass" },
  { label: "亚克力 · 微光渐变", value: "acrylic" },
] as const satisfies readonly { label: string; value: SurfaceMaterial }[];

const cornerOptions = [
  { label: "直角 · 2px", value: "square" },
  { label: "紧凑 · 8px", value: "compact" },
  { label: "标准 · 14px", value: "standard" },
  { label: "大圆角 · 22px", value: "rounded" },
] as const satisfies readonly { label: string; value: CornerStyle }[];

const borderOptions = [
  { label: "无边框", value: "none" },
  { label: "纤细描边", value: "subtle" },
  { label: "明显描边", value: "strong" },
  { label: "纯阴影", value: "shadow" },
] as const satisfies readonly { label: string; value: BorderStyle }[];
</script>

<template>
  <div class="mx-auto flex min-h-screen w-full max-w-[880px] flex-col px-8 pb-10 pt-7">
    <!-- 头部 -->
    <header class="flex items-center gap-3.5">
      <span
        class="flex h-11 w-11 items-center justify-center rounded-xl text-lg font-bold"
        style="
          background: linear-gradient(145deg, rgba(122, 162, 247, 0.28), rgba(137, 221, 255, 0.12));
          color: var(--nestra-accent-strong);
          border: 1px solid rgba(122, 162, 247, 0.3);
        "
      >
        N
      </span>
      <div class="min-w-0">
        <h1 class="m-0 text-[19px] font-semibold leading-tight">Nestra 管理器</h1>
        <p class="m-0 mt-0.5 text-xs" style="color: var(--nestra-text-secondary)">
          桌面上的 {{ store.entries.length }} 个项目正在被 {{ store.panels.length }} 个分区收纳
        </p>
      </div>

      <div class="flex-1" />
      <span
        class="rounded-full border px-2.5 py-1 text-[11px]"
        style="border-color: rgba(255, 255, 255, 0.14); color: var(--nestra-text-faint)"
      >
        v0.1.0 · Tauri
      </span>
      <Button
        label="隐藏窗口"
        variant="text"
        size="small"
        title="隐藏到托盘；Ctrl+Alt+G 可再次呼出"
        @click="currentWindow.hide()"
      />
    </header>

    <!-- 导航 -->
    <nav
      class="mt-6 inline-flex w-fit rounded-xl border p-1"
      style="border-color: rgba(255, 255, 255, 0.1); background: rgba(255, 255, 255, 0.04)"
    >
      <button
        v-for="item in tabs"
        :key="item.id"
        class="cursor-pointer rounded-lg px-4 py-1.5 text-[13px] transition-colors"
        :style="
          tab === item.id
            ? 'background: rgba(122,162,247,0.18); color: var(--nestra-text); font-weight:600'
            : 'color: var(--nestra-text-secondary)'
        "
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </nav>

    <!-- 分区与分组 -->
    <section v-if="tab === 'groups'" class="mt-5 grid grid-cols-[1fr_360px] gap-5">
      <div>
        <h2 class="mb-2.5 text-[13px] font-semibold" style="color: var(--nestra-text-secondary)">
          系统分区
        </h2>
        <ul class="m-0 grid list-none grid-cols-2 gap-2.5 p-0">
          <li
            v-for="panel in store.panels.filter((p) => p.isSystem)"
            :key="panel.key"
            class="flex items-center gap-3 rounded-xl border p-3"
            style="border-color: rgba(255, 255, 255, 0.09); background: rgba(255, 255, 255, 0.03)"
          >
            <span class="glyph-badge shrink-0" style="width: 30px; height: 30px; font-size: 14px">
              {{ panel.glyph }}
            </span>
            <div class="min-w-0">
              <p class="m-0 truncate text-[13px] font-medium">{{ panel.title }}</p>
              <p class="m-0 text-[11px]" style="color: var(--nestra-text-faint)">
                {{ modeLabel(panel.mode) }} · {{ itemCount(panel.groupId) }} 项
              </p>
            </div>
          </li>
        </ul>
      </div>

      <div class="flex flex-col gap-2.5">
        <h2 class="mb-0.5 text-[13px] font-semibold" style="color: var(--nestra-text-secondary)">
          自定义分组
        </h2>

        <div
          v-for="group in store.customGroups"
          :key="group.id"
          class="flex items-center gap-2 rounded-xl border p-2.5"
          style="border-color: rgba(255, 255, 255, 0.09); background: rgba(255, 255, 255, 0.03)"
        >
          <InputText v-model="group.name" class="min-w-0 flex-1" size="small" @change="renameCustomGroup(group.id, group.name)" />
          <span class="shrink-0 text-[11px]" style="color: var(--nestra-text-faint)">
            {{ modeLabel(group.mode) }}
          </span>
          <Button label="删除" severity="danger" variant="text" size="small" @click="removeCustomGroup(group.id)" />
        </div>

        <p
          v-if="store.customGroups.length === 0"
          class="m-0 rounded-xl border border-dashed p-4 text-center text-xs"
          style="border-color: rgba(255, 255, 255, 0.14); color: var(--nestra-text-faint)"
        >
          还没有自定义分组。创建后把任意项目拖进去，规则不会动它。
        </p>

        <Button label="新建分组" @click="openCreateDialog" />
        <Button label="重置桌面面板布局" variant="outlined" size="small" @click="resetLayouts" />
      </div>
    </section>

    <!-- 分类规则 -->
    <section v-else-if="tab === 'rules'" class="mt-5 grid grid-cols-2 gap-5">
      <div v-for="section in [
        { title: '文件分区规则', rules: fileRules },
        { title: '应用分类词典', rules: appRules },
      ]"
        :key="section.title"
      >
        <h2 class="mb-2.5 text-[13px] font-semibold" style="color: var(--nestra-text-secondary)">
          {{ section.title }}
        </h2>
        <ul class="m-0 list-none p-0">
          <li
            v-for="rule in section.rules"
            :key="rule.id"
            class="mb-2 flex items-center gap-3 rounded-xl border p-3"
            style="border-color: rgba(255, 255, 255, 0.09); background: rgba(255, 255, 255, 0.03)"
          >
            <span class="glyph-badge shrink-0" style="width: 30px; height: 30px; font-size: 14px">
              {{ rule.glyph }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="m-0 text-[13px]">{{ rule.title }}</p>
              <p class="m-0 text-[11px]" style="color: var(--nestra-text-faint)">{{ rule.detail }}</p>
            </div>
            <ToggleSwitch
              :modelValue="store.ruleStates[rule.id] !== false"
              @update:modelValue="(value: boolean) => setRuleEnabled(rule.id, value)"
            />
          </li>
        </ul>
      </div>
    </section>

    <!-- 外观 -->
    <section v-else-if="tab === 'appearance'" class="mt-5 max-w-[520px]">
      <div class="grid grid-cols-[130px_1fr] items-center gap-x-4 gap-y-5 rounded-2xl border p-5"
        style="border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.03)"
      >
        <label class="text-[13px]">表面材质</label>
        <Select
          v-model="store.appearance.surfaceMaterial"
          :options="[...materialOptions]"
          optionLabel="label"
          optionValue="value"
          placeholder="选择材质"
          class="w-full"
          @update:modelValue="(value: SurfaceMaterial) => setAppearance({ surfaceMaterial: value })"
        />

        <label class="text-[13px]">圆角</label>
        <Select
          v-model="store.appearance.cornerStyle"
          :options="[...cornerOptions]"
          optionLabel="label"
          optionValue="value"
          class="w-full"
          @update:modelValue="(value: CornerStyle) => setAppearance({ cornerStyle: value })"
        />

        <label class="text-[13px]">边框</label>
        <Select
          v-model="store.appearance.borderStyle"
          :options="[...borderOptions]"
          optionLabel="label"
          optionValue="value"
          class="w-full"
          @update:modelValue="(value: BorderStyle) => setAppearance({ borderStyle: value })"
        />

        <label class="text-[13px]">面板不透明度</label>
        <div class="flex items-center gap-3">
          <Slider
            :modelValue="store.appearance.panelOpacity"
            :min="0.45"
            :max="1"
            :step="0.05"
            class="flex-1"
            @update:modelValue="(value: number) => setAppearance({ panelOpacity: value })"
          />
          <span class="w-10 text-right text-[12.5px]" style="color: var(--nestra-text-secondary)">
            {{ Math.round(store.appearance.panelOpacity * 100) }}%
          </span>
        </div>
      </div>

      <p class="mt-3 text-xs" style="color: var(--nestra-text-faint)">
        材质与透明度即时作用于桌面层；每个设置都会自动保存。
      </p>
    </section>

    <!-- 关于 -->
    <section v-else class="mt-5 max-w-[520px]">
      <div class="rounded-2xl border p-5" style="border-color: rgba(255,255,255,0.09); background: rgba(255,255,255,0.03)">
        <h2 class="m-0 text-[15px] font-semibold">Nestra</h2>
        <p class="mt-1 mb-4 text-[12.5px]" style="color: var(--nestra-text-secondary)">
          A calm, flexible desktop organizer for Windows.
        </p>
        <dl class="m-0 grid grid-cols-[120px_1fr] gap-y-2 text-[12.5px]">
          <dt style="color: var(--nestra-text-faint)">全局热键</dt>
          <dd class="m-0"><kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>G</kbd> 显示 / 隐藏管理器</dd>
          <dt style="color: var(--nestra-text-faint)">打开项目</dt>
          <dd class="m-0">双击图标；右键在资源管理器中显示</dd>
          <dt style="color: var(--nestra-text-faint)">折叠项目</dt>
          <dd class="m-0">拖到面板标题栏的「折叠」上</dd>
          <dt style="color: var(--nestra-text-faint)">数据位置</dt>
          <dd class="m-0">%LOCALAPPDATA%\app.nestra.desktop\state.json</dd>
        </dl>
      </div>
    </section>

    <!-- 新建分组对话框 -->
    <Dialog
      v-model:visible="createDialogVisible"
      modal
      header="新建分组"
      :style="{ width: '380px' }"
    >
      <div class="grid gap-4">
        <label class="grid gap-1.5">
          <span class="text-xs" style="color: var(--nestra-text-secondary)">名称</span>
          <InputText v-model="newGroupName" placeholder="例如：素材收集" @keyup.enter="submitCreate" />
        </label>
        <label class="grid gap-1.5">
          <span class="text-xs" style="color: var(--nestra-text-secondary)">接收类型</span>
          <Select v-model="newGroupMode" :options="modeOptions" optionLabel="label" optionValue="value" class="w-full" />
        </label>
      </div>
      <template #footer>
        <Button label="取消" variant="text" @click="createDialogVisible = false" />
        <Button label="创建" :disabled="!newGroupName.trim()" @click="submitCreate" />
      </template>
    </Dialog>
  </div>
</template>
