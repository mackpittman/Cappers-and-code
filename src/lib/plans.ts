// What a membership plan is called on screen. The database keeps the enum (sub_plan); members see this.
export function planLabel(plan: string | null | undefined): string {
  switch (plan) {
    case 'founder_season':
      return 'Founders Pass';
    case 'monthly':
      return 'Monthly';
    case 'manual':
      return 'Comp';
    default:
      return plan ? String(plan) : 'Member';
  }
}
