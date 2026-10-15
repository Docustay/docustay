// ═══════════════════════════════════════════════════════════════════════════════════════════════
// REPORTS ROUTE — GET /api/reports/home
//
// ★★★ BUILDS THE HOME DASHBOARD DATA BY ASSEMBLING EXISTING REPORT VIEWS AND TABLES.
// The ReportsHome.svelte component expects: money strip (revenueThisMonth, collected, outstanding,
// refunded), work strip (sessionsHeld, noShows, utilisation, avgPerClient), people strip
// (newClients, active, churned, leads), and revenueByMonth array for a 12-month chart.
//
// ★ Uses existing report views (report_revenue_by_month, report_sessions_by_coach) and queries
//   over invoice/payment/booking/app_user tables for missing metrics. `security_invoker` views
//   apply RLS as the caller, so no hand-written tenant filter is needed (matching the reports'
//   own discipline in db/migrations/0059_reports.sql).
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import { forbidden, invalid } from "../http/errors.mjs";
import { authoriseSection, atLeastRank } from "../nav/authorise.mjs";

export function registerReportsRoutes(app, { runTenantScoped, tenantIsPlatform } = {}) {
  // ★ Staff-only wrapper: reports are CRM data and require staff authentication.
  const staffScoped = (fn, opts = {}) => (c) =>
    runTenantScoped(c, async (ctx) => {
      if (!ctx.principal?.platformTenantId && ctx.principal?.user?.role !== "staff") {
        throw forbidden("reports are for staff only");
      }
      const isPlatform = await tenantIsPlatform(ctx.db, ctx.tenantId);
      const decision = authoriseSection(ctx.principal.user, "/reports", { tenantIsPlatform: isPlatform });
      if (!decision.allowed) throw forbidden(`section refused: ${decision.reason}`);
      return fn(ctx, c);
    }, opts).then((r) => c.json(r, opts.status ?? 200));

  app.get("/api/reports/home", staffScoped(async ({ db }) => {
      // Get the current month for filtering this month's revenue
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const thisMonthStr = monthStart.toISOString().slice(0, 7); // YYYY-MM

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // MONEY STRIP: revenueThisMonth, collected, outstanding, refunded
      // ═══════════════════════════════════════════════════════════════════════════════════════

      // Revenue this month from report_revenue_by_month (current month)
      const moneyRes = await db.query(`
        SELECT
          coalesce(rev.invoiced_minor, 0)::bigint AS invoiced_this_month,
          coalesce(rev.paid_minor, 0)::bigint AS paid_this_month,
          (SELECT coalesce(sum(p.amount_minor), 0)::bigint FROM keystone.payment_effective p WHERE p.status IN ('succeeded', 'partially_refunded')) AS total_collected,
          (SELECT coalesce(sum(r.amount_minor), 0)::bigint FROM keystone.refund_effective r WHERE r.state IN ('succeeded', 'pending')) AS total_refunded
        FROM (SELECT invoiced_minor, paid_minor FROM keystone.report_revenue_by_month WHERE month = $1::date) rev`,
        [monthStart.toISOString().slice(0, 10)]
      );

      const moneyRow = moneyRes.rows[0] || { invoiced_this_month: 0, paid_this_month: 0, total_collected: 0, total_refunded: 0 };

      // Outstanding = what people owe, as STRIPE says it (keystone.person_owes = Stripe's amount_remaining over
      // invoices Stripe says are open; void/draft/paid never count). The one owes computation in the product.
      const outstandingRes = await db.query(`
        SELECT coalesce(sum(po.owes_minor), 0)::bigint AS outstanding_minor
        FROM keystone.person_owes po`
      );

      const outstanding = Math.max(0, (outstandingRes.rows[0]?.outstanding_minor || 0));

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // WORK STRIP: sessionsHeld, noShows, utilisation, avgPerClient
      // ═══════════════════════════════════════════════════════════════════════════════════════

      // Sessions and attendance from report_sessions_by_coach
      const workRes = await db.query(`
        SELECT
          coalesce(sum(sessions_scheduled), 0)::int AS sessions_held,
          coalesce(sum(no_show), 0)::int AS no_shows,
          coalesce(sum(attended), 0)::int AS attended,
          count(distinct coach_id)::int AS coaches_count
        FROM keystone.report_sessions_by_coach`
      );

      const workRow = workRes.rows[0] || { sessions_held: 0, no_shows: 0, attended: 0, coaches_count: 0 };

      // Utilisation = attended / scheduled * 100 (or 0 if no sessions)
      const utilisation = workRow.sessions_held > 0
        ? Math.round((workRow.attended / workRow.sessions_held) * 100)
        : 0;

      // Average sessions per client
      // ★ FLAGGED: `avgPerClient` derived from report_sessions_by_coach coach count, not unique
      //   clients per session. A client may see multiple coaches; this counts coach-sessions.
      //   A more accurate metric would require joining through booking.coach_id to unique clients.
      const avgPerClient = workRow.coaches_count > 0 && workRow.sessions_held > 0
        ? Math.round(workRow.sessions_held / workRow.coaches_count)
        : 0;

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // PEOPLE STRIP: newClients, active, churned, leads
      // ═══════════════════════════════════════════════════════════════════════════════════════

      // ★ FLAGGED: All queries below derive from app_user role/lifecycle_status. The component
      //   expects specific states/flags that may not be fully defined yet per CLAUDE.md note on
      //   phase 12. Using best judgment based on column names and comments from people.mjs.

      // New clients this month (created in current month, role='*_client', lifecycle_status not 'lead')
      const newClientsRes = await db.query(`
        SELECT count(*)::int AS new_clients
        FROM keystone.app_user
        WHERE (role = 'adult_client' OR role = 'adolescent_client')
          AND lifecycle_status <> 'lead'
          AND created_at >= $1`,
        [monthStart]
      );

      // Active clients (non-staff, lifecycle_status = 'active' or similar; see people.mjs §P6.7)
      // ★ FLAGGED: lifecycle_status values not fully enumerated in readable files. Using 'active'
      //   as the assumed "current/active" state. If other states exist, this may undercount.
      const activeRes = await db.query(`
        SELECT count(*)::int AS active_count
        FROM keystone.app_user
        WHERE (role = 'adult_client' OR role = 'adolescent_client')
          AND lifecycle_status <> 'lead'`
      );

      // Churned clients (lifecycle_status = 'churned' or ended recently)
      // ★ FLAGGED: No `lifecycle_status = 'churned'` migration found. Using absence of recent
      //   activity as proxy if that column doesn't exist, or querying for explicit status.
      const churnedRes = await db.query(`
        SELECT count(*)::int AS churned_count
        FROM keystone.app_user
        WHERE (role = 'adult_client' OR role = 'adolescent_client')
          AND lifecycle_status = 'churned'`
      );

      // Leads (lifecycle_status = 'lead')
      const leadsRes = await db.query(`
        SELECT count(*)::int AS leads_count
        FROM keystone.app_user
        WHERE (role = 'adult_client' OR role = 'adolescent_client')
          AND lifecycle_status = 'lead'`
      );

      // ═══════════════════════════════════════════════════════════════════════════════════════
      // REVENUE BY MONTH CHART — last 12 months
      // ═══════════════════════════════════════════════════════════════════════════════════════

      const chartRes = await db.query(`
        SELECT
          to_char(month, 'YYYY-MM') AS month,
          invoiced_minor::bigint AS invoiced,
          paid_minor::bigint AS paid
        FROM keystone.report_revenue_by_month
        ORDER BY month DESC
        LIMIT 12`
      );

      const revenueByMonth = chartRes.rows.reverse().map((row) => ({
        month: row.month,
        invoiced: Number(row.invoiced),
        paid: Number(row.paid),
      }));

      return {
        // Money strip
        revenueThisMonth: Number(moneyRow.paid_this_month),
        collected: Number(moneyRow.total_collected),
        outstanding: Number(outstanding),
        refunded: Number(moneyRow.total_refunded),

        // Work strip
        sessionsHeld: workRow.sessions_held,
        noShows: workRow.no_shows,
        utilisation,
        avgPerClient,

        // People strip
        newClients: newClientsRes.rows[0]?.new_clients || 0,
        active: activeRes.rows[0]?.active_count || 0,
        churned: churnedRes.rows[0]?.churned_count || 0,
        leads: leadsRes.rows[0]?.leads_count || 0,

        // Chart data
        revenueByMonth,
      };
    }, { bucket: "home" })
  );

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // HUB ROUTE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  app.get("/api/reports/hub", staffScoped(async ({ db, principal, tenantId }) => {
    // For each report name, check if the viewer has access
    const cards = [];
    for (const name of reportNames) {
      // Map report names to their permission objects
      const permissionMap = {
        money: "invoice",
        people: "person",
        sessions: "engagement",
        found: "person",
        coaches: "engagement",
      };
      const permissionObject = permissionMap[name];

      // Check if user_may allows this viewer to view the report
      const mayRes = await db.query(
        `SELECT keystone.user_may($1, $2, 'view', NULL) AS allowed`,
        [principal.appUserId, permissionObject]
      );
      const available = mayRes.rows[0]?.allowed === true;

      cards.push({
        name,
        question: `View ${name} report`,
        available,
      });
    }

    // TODO: fetch sent_automatically and enough_data from actual sources when available
    return {
      cards,
      sent_automatically: {
        weekly_digest: null,
      },
      enough_data: false,
    };
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // RECEIPT ROUTE
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  app.get("/api/reports/receipt", staffScoped(async ({ db, principal, tenantId, body }, c) => {
    // ★ buildReceipt takes "YYYY-MM". A Date passed here was interpolated as its toString()
    //   ("… GMT-0700") straight into SQL.
    const requested = c.req.query("month");
    if (requested && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requested)) throw invalid("month must be YYYY-MM");
    const month = requested ?? new Date().toISOString().slice(0, 7);

    const { buildReceipt } = await import("../reports/receipt.mjs");
    const receipt = await buildReceipt(db, {
      tenantId: tenantId,
      month,
    });

    // If managed is false, return only that field
    if (receipt.managed === false) {
      return { managed: false };
    }
    return receipt;
  }));

  // ═══════════════════════════════════════════════════
  // BY PROGRAM (QUEUE §4, the maintainer 2 Oct 2026) — revenue, sessions and clients grouped by the practice's own programs.
  // Revenue is allocated from each invoice's line items (service/package/plan → program) and ALWAYS adds up to the practice total
  // (keystone.report_revenue_by_program, 0591); invoices with no program come back as program null ("No program"). Admin only — it is money.
  // ═══════════════════════════════════════════════════
  app.get("/api/reports/by-program", staffScoped(async ({ db, principal, tenantId }, c) => {
    atLeastRank(principal.user, "admin");
    const q = c.req.query();
    const now = new Date();
    const from = (q.from ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)).slice(0, 10);
    const to = (q.to ?? new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10)).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw invalid("from and to must be YYYY-MM-DD");
    const { rows: programs } = await db.query(
      `SELECT p.id, p.name, p.colour,
              coalesce(sum(r.invoiced_minor), 0)::bigint AS invoiced_minor, coalesce(sum(r.paid_minor), 0)::bigint AS paid_minor,
              coalesce(sum(r.invoice_count), 0)::int AS invoices
         FROM keystone.program p
         LEFT JOIN keystone.report_revenue_by_program r ON r.program_id = p.id AND r.month >= $1::date AND r.month < $2::date
        WHERE p.tenant_id = $3
        GROUP BY p.id, p.name, p.colour, p.position ORDER BY p.position, p.name`, [from, to, tenantId]);
    const { rows: none } = await db.query(
      `SELECT coalesce(sum(invoiced_minor), 0)::bigint AS invoiced_minor, coalesce(sum(paid_minor), 0)::bigint AS paid_minor, coalesce(sum(invoice_count), 0)::int AS invoices
         FROM keystone.report_revenue_by_program WHERE program_id IS NULL AND month >= $1::date AND month < $2::date`, [from, to]);
    const { rows: sessions } = await db.query(
      `SELECT bp.program_id, count(*)::int AS sessions
         FROM keystone.booking b JOIN keystone.booking_program bp ON bp.booking_id = b.id
        WHERE b.starts_at >= $1::date AND b.starts_at < $2::date AND b.state IN ('confirmed','completed') GROUP BY bp.program_id`, [from, to]);
    const { rows: people } = await db.query(
      `SELECT pp.program_id, count(*)::int AS people FROM keystone.person_program pp GROUP BY pp.program_id`);
    const sess = new Map(sessions.map((r) => [r.program_id, r.sessions]));
    const ppl = new Map(people.map((r) => [r.program_id, r.people]));
    const rows = [...programs.map((p) => ({ programId: p.id, name: p.name, colour: p.colour, invoicedMinor: Number(p.invoiced_minor), paidMinor: Number(p.paid_minor), invoices: p.invoices, sessions: sess.get(p.id) ?? 0, people: ppl.get(p.id) ?? 0 })),
      { programId: null, name: "No program", colour: null, invoicedMinor: Number(none[0].invoiced_minor), paidMinor: Number(none[0].paid_minor), invoices: none[0].invoices, sessions: sess.get(null) ?? 0, people: 0 }];
    return { from, to, rows, totals: { invoicedMinor: rows.reduce((a, r) => a + r.invoicedMinor, 0), paidMinor: rows.reduce((a, r) => a + r.paidMinor, 0) } };
  }));

  // ★ [TY, 2 Oct 2026] The accountant pack feature (view route, send route, email, template,
  //   nav entry, setting) is removed entirely.
  // ★ The fixed paths above are registered BEFORE `/api/reports/:name` — after it, `hub` and
  //   `receipt` were taken as report names and refused as unknown.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // REPORT ROUTES: money, people, sessions, found, coaches
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  const reportNames = ["money", "people", "sessions", "found", `coaches`];

  app.get("/api/reports/:name", staffScoped(async ({ db, principal, tenantId, body }, c) => {
    const name = c.req.param("name");
    if (!reportNames.includes(name)) {
      throw forbidden(`unknown report: ${name}`);
    }

    // Parse query params: from, to, compareFrom, compareTo (ISO date strings)
    const query = c.req.query();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const from = query.from
      ? new Date(query.from)
      : monthStart;
    const to = query.to
      ? new Date(query.to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const compareFrom = query.compareFrom
      ? new Date(query.compareFrom)
      : lastMonthStart;
    const compareTo = query.compareTo
      ? new Date(query.compareTo)
      : monthStart;

    const daterange = (a, b) => `[${a.toISOString().slice(0, 10)},${b.toISOString().slice(0, 10)})`;
    const range = daterange(from, to);
    const compare = daterange(compareFrom, compareTo);

    try {
      const result = await db.query(
        `SELECT keystone.report_${name}($1, $2, $3, $4) AS r`,
        [tenantId, range, compare, principal.appUserId]
      );
      return result.rows[0]?.r || {};
    } catch (err) {
      if (err.code === "42501") {
        throw forbidden("refused: that report is not available to your role");
      }
      throw err;
    }
  }));

  // ═══════════════════════════════════════════════════════════════════════════════════════════════
  // CSV EXPORT ROUTE — GET /api/reports/:name/export.csv
  // (Appended after 16.30's report routes block; 16.30 may add a "report routes" comment block above)
  // ═══════════════════════════════════════════════════════════════════════════════════════════════

  app.get("/api/reports/:name/export.csv", staffScoped(async ({ db, principal, tenantId, body }, c) => {
    const { toCsv } = await import("../reports/export.mjs");

    const name = c.req.param("name");
    if (!reportNames.includes(name)) {
      throw forbidden(`unknown report: ${name}`);
    }

    // Parse query params: from, to, compareFrom, compareTo (ISO date strings)
    // Same parsing as JSON route to ensure CSV export calls the same underlying function
    const query = c.req.query();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const from = query.from
      ? new Date(query.from)
      : monthStart;
    const to = query.to
      ? new Date(query.to)
      : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const compareFrom = query.compareFrom
      ? new Date(query.compareFrom)
      : lastMonthStart;
    const compareTo = query.compareTo
      ? new Date(query.compareTo)
      : monthStart;

    const daterange = (a, b) => `[${a.toISOString().slice(0, 10)},${b.toISOString().slice(0, 10)})`;
    const range = daterange(from, to);
    const compare = daterange(compareFrom, compareTo);

    try {
      // Call the exact same underlying report function as the JSON route
      const result = await db.query(
        `SELECT keystone.report_${name}($1, $2, $3, $4) AS r`,
        [tenantId, range, compare, principal.appUserId]
      );
      const reportJson = result.rows[0]?.r || {};
      const csv = toCsv(name, reportJson);

      // Build filename with date range
      const fromStr = from.toISOString().slice(0, 10);
      const toStr = to.toISOString().slice(0, 10);

      return c.text(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}-${fromStr}-${toStr}.csv"`,
        },
      });
    } catch (err) {
      if (err.code === "42501") {
        throw forbidden("refused: that report is not available to your role");
      }
      throw err;
    }
  }));

}

