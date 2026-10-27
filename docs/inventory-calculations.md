# Inventory Calculation Contract

## Import

- Consumption month and balance date are independent. The UI suggests the month before the detected balance date; the operator can change it.
- Monthly consumption covers the complete calendar month selected by the operator. Incomplete periods are not used as completed-month history.
- Monthly and consumption-only reports can contribute consumption. Weekly, partial and full balance snapshots do not add consumption periods.
- Consumption-only reports never replace stock balances. Blank quantities stay unknown, not zero.
- Dated warehouse balance columns are detected. Ambiguous warehouse mappings require single-sheet selection and confirmation.
- Identical repeated source rows count once. Conflicting repeated rows require review and are never blindly added.
- Item identity includes brand and unit. Unknown units are not eligible for quantitative transfer recommendations.
- Pharmacy names are not a fixed list. Only known equivalent names are mapped; new pharmacy names are preserved.

## History and Revisions

- Choose the latest dated balance independently for each SKU and location, with upload time resolving same-date revisions.
- Retain the last valid observation for other locations/SKUs when a partial update arrives.
- For each SKU/location/consumption month, a newer report replaces the earlier report for that same period.
- Daily consumption is total reported consumption divided by the actual calendar days in its latest N distinct completed months.
- Different SKUs within a scientific display group are additive. Scientific grouping is not authorization to substitute medicines.
- Unknown balances/consumption and mixed snapshot dates are shown as incomplete data, not certified zero stock or dead stock.
- Future or invalid snapshot dates and future stock transactions are excluded from the reporting date.
- Cairo local date is used for daily reporting.

## Recorded Balance and Estimates

Recorded balance = latest recorded balance + receipts - issues + transfer-in - transfer-out + returns.

The recorded balance is not reduced automatically by an estimated daily consumption. A separate projected balance can illustrate depletion when no actual patient issues are recorded after the snapshot. If actual patient issues exist but their reporting coverage is unknown, additional estimated consumption is suppressed rather than deducted again. This does not certify that the transaction log is complete.

Warehouse-to-pharmacy transfers and pharmacy returns to the warehouse move stock between locations; they do not change the hospital total. The warehouse is not automatically depleted again using branch consumption forecasts.

Hospital balance for one SKU/unit = warehouse balance + balances in reported branch locations. Hospital consumption counts branch dispensing only, not internal warehouse issues. Quantities of unrelated items/units are never a meaningful hospital-wide stock total.

## Transfer Proposals

- Plan transfers by SKU and unit, not by a scientific name alone.
- Serve the most urgent recipient first and consider warehouse supply first.
- Keep the configured target coverage at each donor. Never allocate the same donor stock more than once.
- Unknown or invalid quantities are excluded. Planning does not mutate recorded stock.
- Proposals require confirmation of current stock, expiry, pack size and pharmacist approval. They do not execute inventory movements automatically.
- No external delivery lead time is assumed when it is unknown.

## Actual Monthly Dispensing

- `/consumption` in both applications selects one item/display group and one completed consumption month.
- Sum the revised reported quantities for that month across branch locations only. Exclude warehouse issues so internal replenishment is not counted again.
- Keep every available consumption month, independently of the rolling window used for forecasting. Balance-only updates do not add dispensing.
- An explicit zero counts as a report. A missing location/SKU report makes the displayed sum partial; incompatible or unknown reported units prevent a total.
- Completeness is relative to locations/SKUs known for that item in imported history, not a certificate that every hospital department has reported.
- The planning field `issued` is the daily historical rate multiplied by 30, not the actual quantity for a selected calendar month. The monthly report uses `consumptionPeriods` instead.
- Recorded branch issues are not necessarily doses administered to patients if the source combines issues with unseparated internal transfers or adjustments.

## Verification

Run the root Vitest suite with `npm test -- --run`, and the desktop UI scope tests with `npm run test:desktop` from the repository root. Check web types with `npx tsc --noEmit -p tsconfig.app.json`, and desktop types from `desktop` with `npx tsc --noEmit -p tsconfig.json`. Build each application using its package scripts.

Existing stored reports whose consumption months were entered incorrectly must be reviewed and re-imported with the correct period. The application cannot infer whether previously stored zero quantities originally meant blank cells. No original workbook or existing database is rewritten by these fixes.
