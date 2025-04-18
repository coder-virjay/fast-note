<script setup lang="ts">
import type { Note } from '@/hooks/useDexie'
import { IonIcon, IonItem, IonLabel, IonNote } from '@ionic/vue'
import { chevronForward, folderOutline, trashOutline } from 'ionicons/icons'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const props = withDefaults(
  defineProps<{
    data: Note
    noteDesktop: boolean
  }>(),
  {},
)

defineEmits(['selected'])

const route = useRoute()

const routerLink = computed(() => {
  if (props.noteDesktop)
    return undefined

  if (props.data.uuid === 'deleted') {
    return `/deleted`
  }

  if (props.data.type === 'folder') {
    /**
     * 文件夹跳转逻辑
     * 1. noteDesktop 不跳转
     * 1. 首页到文件夹: /f/ + id
     * 2. 文件夹到文件夹: 当前路径 + id
     */
    const isHome = route.path === '/home'
    if (isHome) {
      return `/f/${props.data.uuid}`
    }
    else {
      return `${route.path}/${props.data.uuid}`
    }
  }
  return `/n/${props.data.uuid}`
})
</script>

<template>
  <IonItem
    v-if="data"
    :router-link="routerLink"
    :detail="false"
    class="list-item"
    @click="$emit('selected', $props.data.uuid)"
  >
    <template v-if="data.type === 'folder'">
      <IonIcon :icon="$props.data.uuid === 'deleted' ? trashOutline : folderOutline" class="mr-3" />
      <IonLabel class="ion-text-wrap">
        <h2>
          {{ data.title }}
          <span class="date">
            <IonNote>{{ data.noteCount }}</IonNote>
          </span>
        </h2>
      </IonLabel>
      <IonIcon aria-hidden="true" :icon="chevronForward" size="small" />
    </template>
    <template v-else>
      <IonLabel class="ion-text-wrap">
        <h2>
          {{ data.title }}
          <span class="date">
            <!-- <ion-note>{{ data.newstime }}</ion-note> -->
            <!-- <ion-icon aria-hidden="true" :icon="chevronForward" size="small" /> -->
          </span>
        </h2>
      </IonLabel>
    </template>
  </IonItem>
</template>

<style lang="scss" scoped>
.list-item {
  &.active {
    --background: #4d8dff;
  }
  ion-label {
    margin-top: 12px;
    margin-bottom: 12px;
  }
}

.list-item h2 {
  font-weight: 600;
  margin: 0;

  /**
   * With larger font scales
   * the date/time should wrap to the next
   * line. However, there should be
   * space between the name and the date/time
   * if they can appear on the same line.
   */
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
}

.list-item .date {
  align-items: center;
  display: flex;
}

.list-item ion-icon {
  color: #c9c9ca;
}

.list-item ion-note {
  font-size: 0.9375rem;
  margin-right: 8px;
  font-weight: normal;
}

.list-item ion-note.md {
  margin-right: 14px;
}
</style>
