import type { ProductImage } from "./types"

/**
 * 图片按 SPUID + 颜色匹配：
 * 先取该 SPUID 下精确颜色的图，再补上「通用」（未填颜色）的图。
 * 颜色为空时返回该 SPUID 的全部图。
 */
export function matchProductImages(
  images: ProductImage[],
  sku: string,
  color?: string | null,
): ProductImage[] {
  const own = images.filter((img) => img.sku === sku)
  const c = (color ?? "").trim()
  if (!c) return own
  const exact = own.filter((img) => img.color === c)
  const generic = own.filter((img) => !img.color)
  return [...exact, ...generic]
}

/** 匹配结果里的第一张（列表缩略图等场景用） */
export function firstMatchedImage(
  images: ProductImage[],
  sku: string,
  color?: string | null,
): ProductImage | null {
  return matchProductImages(images, sku, color)[0] ?? null
}
