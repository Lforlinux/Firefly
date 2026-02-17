export function currentValue(unitPrice: number, units: number): number {
  return unitPrice * units
}

export function gainLoss(current: number, invested: number): number {
  return current - invested
}

export function gainLossPercent(current: number, invested: number): number {
  if (invested === 0) return 0
  return ((current - invested) / invested) * 100
}

export function fireNumber(annualExpenses: number, multiplier: number): number {
  return annualExpenses * multiplier
}

export function monthsOfExpensesCovered(portfolioValue: number, monthlyExpenses: number): number {
  if (monthlyExpenses <= 0) return 0
  return portfolioValue / monthlyExpenses
}

export function pmt(principal: number, annualRate: number, termMonths: number): number {
  const r = annualRate / 100 / 12
  if (r === 0) return principal / termMonths
  return (principal * r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1)
}

export function fv(pv: number, rate: number, n: number, pmt: number = 0): number {
  const r = rate / 100 / 12
  const monthlyPmt = pmt
  let fv = pv * Math.pow(1 + r, n)
  if (monthlyPmt !== 0) {
    fv += monthlyPmt * ((Math.pow(1 + r, n) - 1) / r)
  }
  return fv
}

export function yearsToFire(
  currentPortfolio: number,
  fireTarget: number,
  monthlySavings: number,
  annualGrowthPercent: number
): number {
  if (currentPortfolio >= fireTarget) return 0
  const r = annualGrowthPercent / 100 / 12
  const monthlyPmt = monthlySavings
  let balance = currentPortfolio
  let months = 0
  const maxMonths = 600
  while (balance < fireTarget && months < maxMonths) {
    balance = balance * (1 + r) + monthlyPmt
    months++
  }
  return Math.ceil(months / 12)
}
