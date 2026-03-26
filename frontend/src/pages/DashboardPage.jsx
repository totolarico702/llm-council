import { useState, useEffect } from 'react';
import { apiFetch } from '../api';
import { ROUTES } from '../api/routes';
import './DashboardPage.css';

const CHART_COLORS = [
  '#b8941f', '#6dbb87', '#cc9944', '#cc6666',
  '#d4aa2a', '#7a7570', '#cc9944', '#6dbb87',
];

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ value, label, sub, highlight }) {
  return (
    <div className={`db-kpi-card ${highlight || ''}`}>
      <div className="db-kpi-value">{value}</div>
      <div className="db-kpi-label">{label}</div>
      {sub && <div className="db-kpi-sub">{sub}</div>}
    </div>
  );
}

// ── Bar Chart horizontal (services) ──────────────────────────────────────────
function HBarChart({ data }) {
  if (!data || data.length === 0) return <div className="db-empty">Aucune donnée</div>;
  const max = Math.max(...data.map(d => d.cost), 0.01);
  return (
    <div className="db-hbar-list">
      {data.map((item, i) => (
        <div key={i} className="db-hbar-row">
          <div className="db-hbar-label">{item.service_name}</div>
          <div className="db-hbar-track">
            <div
              className="db-hbar-fill"
              style={{ width: `${Math.max((item.cost / max) * 100, 1)}%` }}
            />
          </div>
          <div className="db-hbar-value">{fmt(item.cost)} €</div>
        </div>
      ))}
    </div>
  );
}

// ── Line Chart SVG (daily costs) ──────────────────────────────────────────────
function LineChart({ data }) {
  if (!data || data.length === 0) return <div className="db-empty">Aucune donnée</div>;

  const W = 560, H = 140, PX = 40, PY = 16;
  const plotW = W - PX * 2;
  const plotH = H - PY * 2;

  const maxCost = Math.max(...data.map(d => d.cost), 0.01);
  const n       = data.length;

  const xOf = (i) => PX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yOf = (v) => PY + plotH - (v / maxCost) * plotH;

  const points = data.map((d, i) => `${xOf(i)},${yOf(d.cost)}`).join(' ');

  // Area fill path
  const areaPath = [
    `M ${xOf(0)},${PY + plotH}`,
    ...data.map((d, i) => `L ${xOf(i)},${yOf(d.cost)}`),
    `L ${xOf(n - 1)},${PY + plotH}`,
    'Z',
  ].join(' ');

  // X axis labels — show ~6 evenly spaced dates
  const step   = Math.max(1, Math.floor(n / 6));
  const xLabels = data.filter((_, i) => i % step === 0 || i === n - 1);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="db-linechart" preserveAspectRatio="none">
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#b8941f" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#b8941f" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(f => {
        const y = PY + plotH * (1 - f);
        return (
          <g key={f}>
            <line x1={PX} y1={y} x2={W - PX} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PX - 4} y={y + 4} fill="#64748B" fontSize="9" textAnchor="end">
              {(maxCost * f).toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* Area */}
      <path d={areaPath} fill="url(#areaGrad)" />

      {/* Line */}
      <polyline points={points} fill="none" stroke="#b8941f" strokeWidth="2" strokeLinejoin="round" />

      {/* Dots */}
      {data.map((d, i) => (
        <circle key={i} cx={xOf(i)} cy={yOf(d.cost)} r="3" fill="#b8941f" />
      ))}

      {/* X labels */}
      {xLabels.map((d, i) => {
        const idx = data.indexOf(d);
        const [, m, day] = d.date.split('-');
        return (
          <text key={i} x={xOf(idx)} y={H - 2} fill="#64748B" fontSize="9" textAnchor="middle">
            {day}/{m}
          </text>
        );
      })}
    </svg>
  );
}

// ── Pie Chart SVG (models) ────────────────────────────────────────────────────
function PieChart({ data }) {
  if (!data || data.length === 0) return <div className="db-empty">Aucune donnée</div>;

  const cx = 90, cy = 90, r = 72;
  let cumAngle = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac       = d.pct / 100;
    const startAngle = cumAngle;
    const endAngle   = cumAngle + frac * 2 * Math.PI;
    cumAngle         = endAngle;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const large = frac > 0.5 ? 1 : 0;
    return { ...d, x1, y1, x2, y2, large, color: CHART_COLORS[i % CHART_COLORS.length], frac };
  });

  return (
    <div className="db-pie-wrap">
      <svg viewBox="0 0 180 180" className="db-pie-svg">
        {slices.map((s, i) => (
          s.frac > 0.001 ? (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${s.x1} ${s.y1} A ${r} ${r} 0 ${s.large} 1 ${s.x2} ${s.y2} Z`}
              fill={s.color}
              stroke="#1E293B"
              strokeWidth="1.5"
            />
          ) : null
        ))}
      </svg>
      <div className="db-pie-legend">
        {slices.map((s, i) => (
          <div key={i} className="db-pie-legend-row">
            <span className="db-pie-dot" style={{ background: s.color }} />
            <span className="db-pie-model">{s.model}</span>
            <span className="db-pie-pct">{s.pct}%</span>
            <span className="db-pie-cost">{fmt(s.cost)} €</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Top Users table ───────────────────────────────────────────────────────────
function TopUsers({ data }) {
  if (!data || data.length === 0) return <div className="db-empty">Aucune donnée</div>;
  return (
    <table className="db-users-table">
      <thead>
        <tr>
          <th></th>
          <th>Utilisateur</th>
          <th>Service</th>
          <th>Coût</th>
          <th>Requêtes</th>
        </tr>
      </thead>
      <tbody>
        {data.map((u, i) => (
          <tr key={i}>
            <td>
              <div className="db-avatar">{u.login[0]?.toUpperCase()}</div>
            </td>
            <td className="db-users-login">{u.login}</td>
            <td className="db-users-service">{u.service}</td>
            <td className="db-users-cost">{fmt(u.cost)} €</td>
            <td className="db-users-reqs">{u.requests}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return typeof n === 'number' ? n.toFixed(2) : '0.00';
}

function fmtPeriod(p) {
  if (!p) return '';
  const [y, m] = p.split('-');
  const months = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
                  'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  return `${months[parseInt(m, 10) - 1]} ${y}`;
}

// ── Page principale ───────────────────────────────────────────────────────────
export default function DashboardPage({ token }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiFetch(ROUTES.dashboard(token))
      .then(r => {
        if (!r.ok) throw new Error(r.status === 404 ? 'Lien invalide' : r.status === 403 ? 'Lien expiré' : 'Erreur serveur');
        return r.json();
      })
      .then(setData)
      .catch(e => setError(e.message));
  }, [token]);

  if (error) {
    return (
      <div className="db-error-page">
        <div className="db-error-box">
          <div className="db-error-icon">⚠</div>
          <h2>Accès impossible</h2>
          <p>{error}</p>
          <small>Ce lien est peut-être expiré ou invalide.</small>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="db-loading-page">
        <div className="db-spinner" />
        <p>Chargement du tableau de bord…</p>
      </div>
    );
  }

  const { kpis, by_service, by_model, top_users, daily_costs, period, generated_at } = data;

  const varClass = kpis.variation_pct < 0 ? 'positive' : kpis.variation_pct > 0 ? 'negative' : '';
  const varSign  = kpis.variation_pct > 0 ? '+' : '';

  return (
    <div className="db-root">
      {/* Header */}
      <header className="db-header">
        <div className="db-header-left">
          <div className="db-logo">LLM Council</div>
          <div className="db-header-title">Tableau de bord — Usage IA</div>
        </div>
        <div className="db-header-right">
          <div className="db-period-badge">{fmtPeriod(period)}</div>
          <div className="db-generated-at">
            Généré le {generated_at?.replace('T', ' à ').slice(0, 19)}
          </div>
          <button className="db-export-btn dashboard-export-btn" onClick={() => window.print()}>
            ⬇ Exporter PDF
          </button>
        </div>
      </header>

      <main className="db-main">
        {/* Bloc 1 — KPIs */}
        <section className="db-section db-kpi-row">
          <KpiCard
            value={`${fmt(kpis.total_cost_month)} €`}
            label="Dépense ce mois"
            sub={`Mois précédent : ${fmt(kpis.total_cost_prev_month)} €`}
          />
          <KpiCard
            value={`${fmt(kpis.projection_end_of_month)} €`}
            label="Projection fin de mois"
            sub="Extrapolation linéaire"
          />
          <KpiCard
            value={`${varSign}${kpis.variation_pct} %`}
            label="vs mois précédent"
            highlight={varClass}
            sub={kpis.variation_pct < 0 ? 'Économie' : kpis.variation_pct > 0 ? 'Dépassement' : 'Stable'}
          />
          <KpiCard
            value={kpis.total_requests_month.toLocaleString('fr-FR')}
            label="Requêtes traitées"
            sub={`Moy. ${fmt(kpis.avg_cost_per_request)} €/req`}
          />
        </section>

        {/* Bloc 2 — Par service */}
        <section className="db-section">
          <h2 className="db-section-title">Dépense par service</h2>
          <div className="db-card">
            <HBarChart data={by_service} />
          </div>
        </section>

        {/* Bloc 3 — Évolution quotidienne */}
        <section className="db-section">
          <h2 className="db-section-title">Évolution du coût journalier</h2>
          <div className="db-card db-card-chart">
            <LineChart data={daily_costs} />
          </div>
        </section>

        {/* Bloc 4 — Deux colonnes */}
        <section className="db-section db-two-col">
          <div>
            <h2 className="db-section-title">Top 5 utilisateurs</h2>
            <div className="db-card">
              <TopUsers data={top_users} />
            </div>
          </div>
          <div>
            <h2 className="db-section-title">Répartition par modèle</h2>
            <div className="db-card">
              <PieChart data={by_model} />
            </div>
          </div>
        </section>
      </main>

      <footer className="db-footer">
        LLM Council — Données internes confidentielles · {fmtPeriod(period)}
      </footer>
    </div>
  );
}
