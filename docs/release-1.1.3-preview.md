# Dawa 1.1.3 - Performance Pilot Preview

## Download and run

Download **Dawa-Portable-1.1.3.zip** from the release Assets, extract the entire folder, then open **Dawa.exe**. Windows 10/11 x64 is required. This ZIP includes the program, its runtime, an Arabic PDF guide and usage notes. It does not require Node.js or a development server. Do not run the executable from inside the ZIP.

This release is a portable local pilot, not a new MSI installer or a hosted website. Keep the whole extracted folder together when moving it. Its DawaData folder holds local application data; keep it private and back it up separately. A fresh download does not include your existing records or accounts. Do not delete an old installation before safely backing up and verifying your data in the intended installation.

## Changes

- Move desktop historical database reads and browser analysis calculations into background workers.
- Reuse authorized, data-version-scoped analysis results and invalidate them on local changes.
- Paginate report and alert tables and daily action cards while retaining complete filtered exports.
- Add an explicit all-history versus latest-upload analysis source selector.
- Reduce repeated item identity parsing, date parsing and number formatting.
- Include the desktop runtime configuration fix and regression tests.

## Verification and limits

Synthetic comparisons cover 7,300, 29,200, 87,600 and 175,200 records with unchanged calculation outputs. Automated web, desktop and isolated native checks passed during development. See PERFORMANCE-ar.txt for scope and limitations. These calculation timings are not full screen-opening benchmarks or a guarantee for every computer. The user confirmed report rows appeared after reopening the local performance hotfix; a complete automated desktop navigation sweep is not claimed.

Hospital spreadsheets, local databases and credentials are excluded. Central hospital synchronization and live web database migrations are not enabled by this release. Validate backups, permissions and operating procedures in a small approved pilot before production use.
