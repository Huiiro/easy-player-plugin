<template>
  <div>
    <div>
      Rate:
      <el-slider v-model="local.rate" :min="0.1" :max="20" />
    </div>

    <div>
      Depth:
      <el-slider v-model="local.depth" :min="0" :max="1" :step="0.01" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

const props = defineProps({
  params: Object
})

const emit = defineEmits(['change'])

const local = reactive({
  rate: props.params?.rate ?? 5,
  depth: props.params?.depth ?? 0.5
})

watch(
  local,
  () => {
    emit('change', { ...local })
  },
  { deep: true }
)
</script>