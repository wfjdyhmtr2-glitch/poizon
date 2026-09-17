import { useEffect } from "react"
import { toast } from "sonner"

/**
 * 双击任意数据即复制（全局能力，挂在 AppShell 上）
 *
 * 规则：
 * - 从双击位置向上找**最贴近的文字元素**，复制它的文本（表格单元格里双击 → 只复制该格）
 * - 输入框 / 文本域 / 下拉框 / 可编辑区域不拦截，保持原生选中行为
 * - 带 `data-no-copy` 的区域跳过；纯占位符（—、-、暂无）不复制
 * - 复制成功弹提示，方便确认复制到的是哪个值
 */

/** 不参与双击复制的容器 */
const SKIP_SELECTOR = 'input, textarea, select, [contenteditable="true"], [data-no-copy], script, style'
/** 单次复制的文本长度上限，超过则继续向上找更小的元素 */
const MAX_LEN = 400
/** 向上查找的层数上限 */
const MAX_DEPTH = 6
/** 无意义的占位符 */
const PLACEHOLDERS = new Set(["—", "-", "--", "暂无", "无", "空"])

function normalize(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim()
}

/** 从双击目标向上找第一个有意义的文本 */
export function resolveCopyText(start: Element | null): string | null {
  let node: Element | null = start
  let depth = 0
  while (node && depth < MAX_DEPTH && node instanceof HTMLElement) {
    if (node.hasAttribute("data-no-copy")) return null
    const text = normalize(node.textContent)
    if (text && text.length <= MAX_LEN && !PLACEHOLDERS.has(text)) return text
    node = node.parentElement
    depth += 1
  }
  return null
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* 落到下面的兜底方案 */
  }
  // 兜底：临时 textarea + execCommand
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.top = "-1000px"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

export function useDoubleClickCopy() {
  useEffect(() => {
    async function onDoubleClick(event: MouseEvent) {
      const target = event.target as Element | null
      if (!target) return
      // 输入类控件保持原生行为（双击选词）
      if (target.closest(SKIP_SELECTOR)) return
      // 只在有文字的页面上生效
      const text = resolveCopyText(target)
      if (!text) return

      const ok = await writeClipboard(text)
      const preview = text.length > 32 ? `${text.slice(0, 32)}…` : text
      if (ok) toast.success(`已复制：${preview}`)
      else toast.error("复制失败，请手动选中后复制")
    }

    document.addEventListener("dblclick", onDoubleClick, true)
    return () => document.removeEventListener("dblclick", onDoubleClick, true)
  }, [])
}
