# Hospital Go-Live Checklist

This checklist is for running the system in a real hospital pharmacy without removing current features.

## 1. Pilot Scope

- Start with the main warehouse and one or two sub-pharmacies.
- Run the system in parallel with the existing paper/Excel workflow for 2-4 weeks.
- Compare daily: stock balance, shortages, transfers, ignored import rows, and manual adjustments.
- Do not use the system as the only source of truth until discrepancies are reviewed and signed off.

## 2. User Accounts And Roles

- Do not use shared accounts.
- Create one account per person.
- Suggested roles:
  - `system_admin`: users, backups, migrations, emergency maintenance.
  - `pharmacy_manager`: approvals, active ingredient review, reports, overrides.
  - `warehouse_keeper`: warehouse receipts/issues/returns, stock transactions.
  - `sub_pharmacist`: sub-pharmacy daily movements and recommendation review.
  - `viewer`: audit/review-only access.

## 3. Daily Operating Routine

- Review critical shortages first.
- Review near-expiry/expired stock reports before transfers or ordering.
- Review unapproved active ingredient matches before accepting recommendations.
- Record every stock movement with a document number or clear reason.
- Review yesterday's overrides in the action log.

## 4. Stock Movement Rules

- Never edit stock balances directly.
- Record changes as stock transactions:
  - warehouse receipt
  - warehouse issue to pharmacy
  - pharmacy issue
  - pharmacy transfer
  - warehouse return
  - pharmacy return to warehouse
- Every transaction must include a reason or document number.
- Any deletion/correction must be reviewed by a manager and visible in audit history.

## 5. Recommendation Safety

- Recommendations are decision support only.
- Do not execute recommendations with unreviewed medicine matching unless a manager/warehouse keeper records a reason.
- For high-alert medicines, require manual pharmacist confirmation even if the system recommendation looks correct.
- Use active ingredient + strength + dosage form as the default analysis mode for operational decisions.

## 6. Active Ingredient Dictionary

- Review low-confidence matches daily during pilot.
- Review the dictionary at least monthly after go-live.
- Do not approve entries with missing strength or dosage form for operational grouping.
- Split groups immediately if different strengths, forms, routes, or units were merged.

## 7. Downtime Plan

- Keep a printed downtime movement sheet.
- During downtime, record: date/time, item, quantity, from/to location, reason, user.
- When the system returns, enter movements as stock transactions and write `downtime entry` in the reason.

## 8. Backup And Recovery

- Export a backup before migrations and before pilot go-live.
- Keep at least weekly backups.
- Test restore on a separate machine before relying on backups.
- For desktop installs, document the database path and backup folder per workstation.

## 9. Weekly Review Metrics

- Critical shortage count.
- Near-expiry and expired item count.
- Number of overrides.
- Number of unapproved active ingredient dictionary entries.
- Stock transaction corrections/deletions.
- Top-used medicines.
- Dead stock / no-issue stock.
- Import rows ignored or requiring review.

## 10. Go-Live Exit Criteria

- No unexplained stock discrepancies for at least one full week.
- All active users have individual accounts.
- All staff have completed training.
- Backup and restore are tested.
- Active ingredient dictionary review backlog is under control.
- Managers review and accept the audit/override process.
