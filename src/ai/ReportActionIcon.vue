<script setup lang="ts">
defineProps<{
  name:
    | "analysis"
    | "history"
    | "details"
    | "trash"
    | "close"
    | "refresh"
    | "start";
}>();
const paths = {
  analysis:
    "M12 3v4m0 10v4M3 12h4m10 0h4M5.6 5.6l2.8 2.8m7.2 7.2 2.8 2.8M5.6 18.4l2.8-2.8m7.2-7.2 2.8-2.8M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17",
  start: "M8 5l11 7-11 7V5Z",
  history: "M3 11a9 9 0 1 1 2.6 7M3 4v7h7m2-4v5l3 2",
  details: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7",
  close: "M6 6l12 12M18 6 6 18",
};
</script>
<template>
  <svg
    :data-icon="name"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path :d="paths[name]" />
  </svg>
</template>
