# Changelog

All notable changes to Firefly are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/) (version in `package.json`).

For version list and rollback steps, see [docs/RELEASES.md](docs/RELEASES.md).

---

## [Unreleased]

- (Add new changes here before releasing.)

---

## [0.0.8] — Current

- Dashboard: UK portfolio totals, XIRR-style gain %, grand total GBP, emergency fund and FIRE progress (UK £1M, 30x expenses), portfolio growth chart, allocation pie chart.
- Investments: UK portfolio with Exchange (NASDAQ, LSE) and Symbol; live price via Yahoo Finance (optional server), Twelve Data, Alpha Vantage.
- Expenses: expense journal and budget view (UK categories).
- Goals: FIRE calculator (25x/30x/50x, monthly savings, growth rate, years to FIRE, projection chart), emergency fund, savings goals placeholder.
- More: debt list, mortgage summary, SIP list, reports/settings placeholders.
- API server: Yahoo quote proxy, daily 23:59 snapshot, snapshots/holdings sync, price cache; SQLite for snapshots and synced holdings.
- Tech: React 18, TypeScript, Vite, Tailwind CSS, Recharts, React Router, lucide-react.

*(For earlier versions, use `git log` and `git tag` if present.)*

---

[Unreleased]: https://github.com/Lforlinux/Firefly/compare/v0.0.8...HEAD
[0.0.8]: https://github.com/Lforlinux/Firefly/compare/v0.0.7...v0.0.8
