import type { Note } from './useDexie'
import { addCloudNote, getCloudFileRefsByLastdotime, getCloudNodesByLastdotime, updateCloudNote } from '@/api'
import { getTime } from '@/utils/date'
import { ref } from 'vue'
import { useFileRefs } from './useFileRefs'
import { useNote } from './useNote'

const defaultLastdotime = getTime('2010/01/01 00:00:00')
const lastdotime = ref(JSON.parse(localStorage.lastdotime || defaultLastdotime))
const fileRefLastdotime = ref(JSON.parse(localStorage.fileRefLastdotime || defaultLastdotime))
const fileLastdotime = ref(JSON.parse(localStorage.fileLastdotime || defaultLastdotime))

const syncing = ref(false)
export function useSync() {
  const { getNotesByLastdotime, getNote, getNotesByPUuid, addNote, deleteNote, updateNote } = useNote()

  async function sync() {
    syncing.value = true
    Promise.all([syncNote(), syncFileRefs()])
      .finally(() => {
        syncing.value = false
      })
  }

  // 同步备忘录
  async function syncNote() {
    // 获取本地变更数据
    const localNotes = await getNotesByLastdotime(lastdotime.value)
    // 获取云端变更数据
    const cloudNotes = await getCloudNodesByLastdotime(lastdotime.value)
    // newstext 转义
    cloudNotes.d.forEach((note: Note) => {
      note.newstext = note.newstext.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    })

    // 合并 本地的备忘录 和 云端的备忘录: 移除本地
    const localDefaultFoler = localNotes.find(note => note.ftitle === 'default-folder')
    const cloudDefaultFoler = cloudNotes.d.find((note: Note) => note.ftitle === 'default-folder')
    if (localDefaultFoler && cloudDefaultFoler) {
      const index = localNotes.indexOf(localDefaultFoler)
      localNotes.splice(index, 1)
      await deleteNote(localDefaultFoler.uuid)
      const changePUuidNotes = await getNotesByPUuid(localDefaultFoler.uuid)
      for (const note of changePUuidNotes) {
        note.puuid = cloudDefaultFoler.uuid
        await updateNote(note.uuid, note)
      }
    }

    // 创建UUID映射以便快速查找
    const localNotesMap = new Map(localNotes.map(note => [note.uuid, note]))
    const cloudNotesMap = new Map((cloudNotes.d as Note[]).map(note => [note.uuid, note]))

    // 准备需要处理的操作列表
    interface SyncOperation {
      note: Note
      action: 'upload' | 'update' | 'download' | 'delete' | 'deleteLocal'
    }

    const operations: SyncOperation[] = []
    const now = Math.floor(Date.now() / 1000) // 当前秒级时间戳
    const thirtyDaysInSeconds = 30 * 24 * 60 * 60 // 30天的秒数

    // 处理本地笔记
    for (const note of localNotes) {
      const cloudNote = cloudNotesMap.get(note.uuid)

      // 处理本地已删除的笔记
      if (note.isdeleted === 1) {
        // 如果删除时间超过30天
        if (now - note.lastdotime > thirtyDaysInSeconds) {
          // 从本地删除
          operations.push({ note, action: 'deleteLocal' })

          // 如果云端有此笔记，请求云端删除API接口
          if (cloudNote) {
            const noteToUpdate = { ...note, id: cloudNote.id }
            operations.push({ note: noteToUpdate, action: 'delete' })
          }
          continue
        }

        // 如果删除时间在30天内
        // 如果云端不存在此笔记，上传删除状态到云端
        if (!cloudNote) {
          operations.push({ note, action: 'upload' })
          continue
        }

        // 如果本地版本更新，上传删除状态到云端
        const localVersion = note.version || 0
        const cloudVersion = cloudNote.version || 0

        if (localVersion > cloudVersion) {
          const noteToUpdate = { ...note, id: cloudNote.id }
          operations.push({ note: noteToUpdate, action: 'update' })
        }
        continue
      }

      // 处理未删除的笔记（原有逻辑）
      if (!cloudNote) {
        // 本地存在但云端为变更 - 更新或新增到云端
        if (note.id) {
          operations.push({ note, action: 'update' })
        }
        else {
          operations.push({ note, action: 'upload' })
        }
      }
      else {
        // 本地和云端都存在 - 比较版本号
        const localLastdotime = note.lastdotime || 0
        const cloudLastdotime = cloudNote.lastdotime || 0

        if (localLastdotime > cloudLastdotime) {
          // 本地版本更新，上传到云端
          const noteToUpdate = { ...note, id: cloudNote.id }
          operations.push({ note: noteToUpdate, action: 'update' })
        }
        else if (localLastdotime < cloudLastdotime) {
          // 云端版本更新，下载到本地
          operations.push({ note: cloudNote, action: 'download' })
        }
      }
    }

    // 处理云端笔记
    for (const note of cloudNotes.d as Note[]) {
      const localNote = localNotesMap.get(note.uuid)

      // 处理云端已删除的笔记
      if (note.isdeleted === 1) {
        // 如果删除时间超过30天且本地存在，从本地删除
        if (now - note.lastdotime > thirtyDaysInSeconds) {
          if (localNote) {
            operations.push({ note, action: 'deleteLocal' })
          }
          continue
        }

        // 如果本地不存在且删除时间在30天内，下载到本地
        if (!localNote) {
          operations.push({ note, action: 'download' })
          continue
        }

        // 如果本地存在，比较版本
        const localVersion = localNote.version || 0
        const cloudVersion = note.version || 0

        if (cloudVersion > localVersion) {
          // 云端版本更新，更新本地数据
          operations.push({ note, action: 'download' })
        }
        continue
      }

      // 处理未删除的笔记（原有逻辑）
      if (!localNote) {
        // 云端存在但本地不存在 - 下载到本地
        operations.push({ note, action: 'download' })
      }
      else {
        // 本地和云端都存在 - 比较版本号
        const localVersion = localNote.version || 0
        const cloudVersion = note.version || 0

        if (cloudVersion > localVersion) {
          // 云端版本更新，更新本地数据
          operations.push({ note, action: 'download' })
        }
      }
    }

    // 按照lastdotime顺序排序所有操作
    operations.sort((a, b) => a.note.lastdotime - b.note.lastdotime)
    // 统计同步结果
    let uploadedCount = 0
    let downloadedCount = 0
    let deletedCount = 0

    // 按顺序执行所有同步操作
    for (const { note, action } of operations) {
      try {
        if (action === 'upload') {
          const id = await addCloudNote(note)
          note.id = Number.parseInt(id as string)
          await updateNote(note.uuid, note)
          uploadedCount++
        }
        else if (action === 'update') {
          await updateCloudNote(note)
          uploadedCount++
        }
        else if (action === 'download') {
          const localNote = await getNote(note.uuid)
          if (localNote) {
            await updateNote(note.uuid, note)
          }
          else {
            await addNote(note)
          }
          downloadedCount++
        }
        else if (action === 'deleteLocal') {
          await deleteNote(note.uuid)
          deletedCount++
        }
        else if (action === 'delete') {
          // 请求云端删除API接口
          await updateCloudNote(note) // 或者使用专门的删除API
          deletedCount++
        }

        // 每成功同步一条记录，就更新lastdotime
        if (note.lastdotime > lastdotime.value) {
          lastdotime.value = note.lastdotime
          localStorage.lastdotime = JSON.stringify(note.lastdotime)
        }
      }
      catch (error) {
        console.error(`同步操作失败 (${action}):`, error)
        // 继续处理下一条记录
      }
    }

    return {
      uploaded: uploadedCount,
      downloaded: downloadedCount,
      deleted: deletedCount,
    }
  }

  /**
   * 同步引用表
   * 1. 获取本地引用表 和 云端引用表
   * 2. 合并本地引用表 和 云端引用表
   * 3. 检查是否引用为 0 的文件，如果为 0 则标记删除 （延迟 14 天删除）
   * 4. 服务端为处理僵尸引用，每个引用需要在编辑文件后更新引用表的lastdotime
   */
  async function syncFileRefs() {
    const { getFileRefsByLastdotime } = useFileRefs()

    const localFileRefs = await getFileRefsByLastdotime(fileRefLastdotime.value)
    const cloudFileRefs = await getCloudFileRefsByLastdotime(fileRefLastdotime.value)
    console.log(localFileRefs, cloudFileRefs)
  }

  return {
    sync,
    syncing,
  }
}
