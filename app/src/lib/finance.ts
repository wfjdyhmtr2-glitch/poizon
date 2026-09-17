import type { OtherExpense, Product, SalesOrder, SpuMapping } from "./types"

/** 财务看板的 SPU 明细行 */
export interface FinanceSpuRow {
  sku: string
  name: string
  /** 正常成交件数 */
  soldUnits: number
  /** 已卖收入（结算金额，未结算按预计收入计） */
  soldIncome: number
  /** 已卖部分的成本 */
  soldCost: number
  /** 已卖部分的运费 */
  soldShipping: number
  /** 补贴（返利） */
  soldRebate: number
  /** 已卖盈亏 = 收入 - 成本 - 运费 + 补贴 */
  soldPnl: number
  /** 手里件数（可用 + 锁定） */
  onhandUnits: number
  /** 手里存货的投入（(成本+运费) × 件数） */
  onhandInvestment: number
  hasCost: boolean
}

export interface FinanceSummary {
  /** 一共花了多少钱买商品：已卖 + 手里，按成本价估 */
  purchaseSpend: number
  /** 目前手里一共多少件（可用 + 锁定） */
  onhandUnits: number
  /** 手里存货的投入（(成本+运费) × 件数） */
  onhandInvestment: number
  /** 一共卖了多少件（正常成交） */
  soldUnits: number
  /** 已卖的结算金额合计 */
  soldIncome: number
  soldCost: number
  soldShipping: number
  soldRebate: number
  /**
   * 其他费用净额（正 = 支出，负 = 收回）。
   * 来源是「其他费用」模块：保证金、仓储费、取回费、会员费等，不绑定商品。
   */
  otherExpenseTotal: number
  /** 已卖盈亏 = 结算金额 - 成本 - 运费 + 补贴 - 其他费用 */
  soldPnl: number
  /** 总盈亏（现金口径）= 已卖盈亏 - 手里存货的投入 */
  totalPnl: number
  /** 正常成交但没匹配到商品的订单数（成本按 0 计） */
  unmatchedSoldOrders: number
  /** 未填成本价的商品数（采购花费按 0 估） */
  productsWithoutCost: number
  perSpu: FinanceSpuRow[]
}

/**
 * 财务汇总。
 * 口径：
 * - 「已卖」= 交易成功且未退货的订单（正常成交，含已结算与未结算；未结算按预计收入计）。
 * - 单件盈亏 = 结算金额 - 成本价 - 运费 + 补贴(返利)。
 * - 「其他费用」= 平台层面的支出（保证金 / 仓储费 / 取回费 / 会员费…），不绑定商品，
 *   按净额整体从已卖盈亏里扣除——正数是支出、负数是收回。
 * - 「手里」= 可用库存 + 锁定库存。
 * - 采购总花费 = Σ (已卖件数 + 手里件数) × 成本价。
 * - 总盈亏 = 已卖盈亏 - 手里存货的投入（(成本+运费) × 手里件数），现金口径。
 */
export function buildFinanceSummary(
  orders: SalesOrder[],
  products: Product[],
  mappings: SpuMapping[] = [],
  otherExpenses: OtherExpense[] = [],
): FinanceSummary {
  const externalToSku = new Map(mappings.map((m) => [m.external_id, m.sku]))
  const resolveSku = (sku: string) => externalToSku.get(sku) ?? sku
  const productBySku = new Map(products.map((p) => [p.sku, p]))

  const rows = new Map<string, FinanceSpuRow>()
  const rowOf = (sku: string): FinanceSpuRow => {
    let row = rows.get(sku)
    if (!row) {
      const product = productBySku.get(sku)
      row = {
        sku,
        name: product?.name ?? "未匹配到商品",
        soldUnits: 0,
        soldIncome: 0,
        soldCost: 0,
        soldShipping: 0,
        soldRebate: 0,
        soldPnl: 0,
        onhandUnits: product ? product.stock + product.locked_stock : 0,
        onhandInvestment: 0,
        hasCost: product?.cost_price !== undefined && product?.cost_price !== null,
      }
      rows.set(sku, row)
    }
    return row
  }

  let unmatchedSoldOrders = 0

  for (const o of orders) {
    if (o.trade_stage !== "completed") continue
    const sku = resolveSku(o.sku)
    const product = productBySku.get(sku)
    if (!product) {
      unmatchedSoldOrders += 1
      continue
    }
    const row = rowOf(sku)
    const income = o.expected_income ?? 0
    const cost = product.cost_price ?? 0
    const shipping = product.shipping_fee ?? 0
    const rebate = product.rebate ?? 0
    row.soldUnits += 1
    row.soldIncome += income
    row.soldCost += cost
    row.soldShipping += shipping
    row.soldRebate += rebate
    row.soldPnl += income - cost - shipping + rebate
  }

  let purchaseSpend = 0
  let onhandUnits = 0
  let onhandInvestment = 0
  let productsWithoutCost = 0

  for (const p of products) {
    const sold = rows.get(p.sku)?.soldUnits ?? 0
    const onhand = p.stock + p.locked_stock
    const cost = p.cost_price ?? 0
    const shipping = p.shipping_fee ?? 0
    if (p.cost_price === null || p.cost_price === undefined) productsWithoutCost += 1
    purchaseSpend += cost * (sold + onhand)
    onhandUnits += onhand
    onhandInvestment += onhand * (cost + shipping)
    const row = rows.get(p.sku)
    if (row) {
      row.onhandUnits = onhand
      row.onhandInvestment = onhand * (cost + shipping)
    }
  }

  const perSpu = [...rows.values()]
    .filter((r) => r.soldUnits > 0 || r.onhandUnits > 0)
    .sort((a, b) => b.soldPnl - a.soldPnl)

  const sum = (pick: (r: FinanceSpuRow) => number) => perSpu.reduce((acc, r) => acc + pick(r), 0)

  const soldUnits = sum((r) => r.soldUnits)
  const soldIncome = sum((r) => r.soldIncome)
  const soldCost = sum((r) => r.soldCost)
  const soldShipping = sum((r) => r.soldShipping)
  const soldRebate = sum((r) => r.soldRebate)
  /** 其他费用净额：正数支出、负数收回，直接作为已卖盈亏的减项 */
  const otherExpenseTotal = otherExpenses.reduce(
    (acc, e) => acc + (Number.isFinite(e.amount) ? e.amount : 0),
    0,
  )
  const soldPnl = soldIncome - soldCost - soldShipping + soldRebate - otherExpenseTotal

  return {
    purchaseSpend,
    onhandUnits,
    onhandInvestment,
    soldUnits,
    soldIncome,
    soldCost,
    soldShipping,
    soldRebate,
    otherExpenseTotal,
    soldPnl,
    totalPnl: soldPnl - onhandInvestment,
    unmatchedSoldOrders,
    productsWithoutCost,
    perSpu,
  }
}
