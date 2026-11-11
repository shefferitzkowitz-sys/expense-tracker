import { ISODate, MonthKey, addMonths, dayInMonth, monthOf, parts } from './dates';

/**
 * Approved rule: a purchase dated before the card's billing day is charged on that day in the same month;
 * a purchase on or after the billing day is charged on that day next month.
 * Billing days 29–31 are allowed and fall on the last day of shorter months.
 */
export function predictChargeDate(transactionDate: ISODate, billingDay: number): ISODate {
  const [, , d] = parts(transactionDate);
  const month = monthOf(transactionDate);
  const sameMonthCharge = dayInMonth(month, billingDay);
  const [, , chargeDay] = parts(sameMonthCharge);
  return d < chargeDay ? sameMonthCharge : dayInMonth(addMonths(month, 1), billingDay);
}

/** Charge date for installment index i (1-based) given the first charge date and billing day. */
export function installmentChargeDate(firstCharge: ISODate, billingDay: number, index: number): ISODate {
  return dayInMonth(addMonths(monthOf(firstCharge), index - 1), billingDay);
}

export function chargeMonth(chargeDate: ISODate): MonthKey {
  return monthOf(chargeDate);
}
