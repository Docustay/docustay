// Stage 20 Task 20.3 — STRIPE METADATA BACKFILL
//
// Page through every mirrored object (customers, products, prices, subscriptions, invoices)
// and stamp them with the correct metadata on the practice's connected account.
//
// ★★★ IDEMPOTENT: re-running writes the same values and errors on nothing.
// Objects without a stripe id are skipped and counted separately.
// Returns {summary: "<n> objects stamped"} for the ledger row.

import { metadataFor } from "./metadata.mjs";
import { stripeConnectedRequest } from "./stripeConnected.mjs";

const BATCH_SIZE = 100;

/**
 * Schema definition for each object kind:
 * - kind: metadata kind for metadataFor()
 * - table: database table name
 * - stripeIdCol: column name holding the Stripe ID
 * - fieldsQuery: SQL to fetch fields needed for metadataFor()
 */
const SCHEMAS = {
  customer: {
    kinds: ["app_user", "account"], // Both tables, same metadata kind
    queries: {
      app_user: {
        stripeIdCol: "stripe_customer_id",
        // ★ FIX, Part 1 worker-failures brief, 1 Oct 2026 — SAME "pg 42703 undefined_column" class
        //   as the price/subscription queries below, found in the SAME pass: `keystone.app_user`
        //   has neither an `assigned_coach_id` nor an `account_id` column (coach assignment is not
        //   a stored column anywhere in this schema; account membership is a many-to-many via
        //   `keystone.account_contact`, and a person can belong to more than one account, so there
        //   is no single correct "the" account_id to pick without a real ruling on which
        //   relationship wins — not guessed here). This was the FIRST query SCHEMAS processes, so
        //   stripe_metadata_backfill has never successfully stamped ANY object, of any kind, for
        //   any tenant — every later kind (product, price, subscription, invoice) was unreachable.
        query: `
          SELECT au.id, au.stripe_customer_id,
                 au.id as person_id, au.tenant_id as practice_id, au.role,
                 'mainstay' as workbench_env, 'active' as portal_status,
                 'active' as lifecycle_status, NULL::uuid as assigned_coach_id,
                 NULL::uuid as account_id, 'api' as source, au.created_at as created_in_workbench_at,
                 t.slug as tenant_slug, au.tenant_id
          FROM keystone.app_user au
          JOIN keystone.tenant t ON t.id = au.tenant_id
          WHERE au.tenant_id = $1 AND au.stripe_customer_id IS NOT NULL
          ORDER BY au.created_at, au.id LIMIT $2
        `,
      },
      account: {
        stripeIdCol: "stripe_customer_id",
        query: `
          SELECT a.id, a.stripe_customer_id,
                 a.owner_user_id as person_id, a.tenant_id as practice_id,
                 'account' as role,
                 'mainstay' as workbench_env, 'active' as portal_status,
                 'active' as lifecycle_status, NULL::uuid as assigned_coach_id,
                 a.id as account_id, 'api' as source, a.created_at as created_in_workbench_at,
                 t.slug as tenant_slug, a.tenant_id
          FROM keystone.account a
          JOIN keystone.tenant t ON t.id = a.tenant_id
          WHERE a.tenant_id = $1 AND a.stripe_customer_id IS NOT NULL
          ORDER BY a.created_at, a.id LIMIT $2
        `,
      },
    },
  },
  product: {
    kinds: ["service", "package", "plan"],
    queries: {
      service: {
        stripeIdCol: "stripe_product_id",
        query: `
          SELECT id, stripe_product_id,
                 id as service_id, tenant_id as practice_id,
                 'service' as category, tenant_id
          FROM keystone.service
          WHERE tenant_id = $1 AND stripe_product_id IS NOT NULL
          ORDER BY created_at, id LIMIT $2
        `,
      },
      package: {
        stripeIdCol: "stripe_product_id",
        query: `
          SELECT id, stripe_product_id,
                 id as service_id, tenant_id as practice_id,
                 'package' as category, tenant_id
          FROM keystone.package
          WHERE tenant_id = $1 AND stripe_product_id IS NOT NULL
          ORDER BY created_at, id LIMIT $2
        `,
      },
      plan: {
        stripeIdCol: "stripe_product_id",
        query: `
          SELECT id, stripe_product_id,
                 id as service_id, tenant_id as practice_id,
                 'plan' as category, tenant_id
          FROM keystone.plan
          WHERE tenant_id = $1 AND stripe_product_id IS NOT NULL
          ORDER BY created_at, id LIMIT $2
        `,
      },
    },
  },
  price: {
    kinds: ["price"],
    queries: {
      price: {
        stripeIdCol: "stripe_price_id",
        // ★ FIX, Part 1 worker-failures brief, 1 Oct 2026 — `keystone.price` has no `service_id`
        //   column (same "pg 42703 undefined_column" class as the subscription query below): a
        //   price is polymorphic (`subject_type`/`subject_id` — service, package, or plan), so
        //   "the service" only exists when `subject_type = 'service'`. This threw on every
        //   invocation for every tenant with at least one Stripe-linked price, before even reaching
        //   the subscription query's own bug — stripe_metadata_backfill has never completed past
        //   this point for any tenant.
        query: `
          SELECT id, stripe_price_id,
                 CASE WHEN subject_type = 'service' THEN subject_id ELSE NULL END AS service_id,
                 tenant_id as practice_id,
                 id as price_id, location_id, delivery_mode, tenant_id
          FROM keystone.price
          WHERE tenant_id = $1 AND stripe_price_id IS NOT NULL
          ORDER BY effective_from DESC, id LIMIT $2
        `,
      },
    },
  },
  subscription: {
    kinds: ["subscription"],
    queries: {
      subscription: {
        stripeIdCol: "stripe_subscription_id",
        // ★ FIX, Part 1 worker-failures brief, 1 Oct 2026 — `keystone.subscription` has no
        //   `service_id` column (a subscription is tied to a plan, which may bundle more than one
        //   service, so there is no single service to name) — this SELECT referenced one anyway,
        //   throwing "pg 42703 undefined_column" on every single invocation for every tenant,
        //   before it could reach a single row. `stripe_metadata_backfill` has never successfully
        //   run past the subscription kind (and never reached invoice, the kind after it in
        //   SCHEMAS). NULL, matching the same "not derivable here" treatment this query already
        //   gives `person_id` just above.
        query: `
          SELECT id, stripe_subscription_id,
                 NULL::uuid as person_id, tenant_id as practice_id,
                 plan_id, NULL::uuid as service_id, tenant_id
          FROM keystone.subscription
          WHERE tenant_id = $1 AND stripe_subscription_id IS NOT NULL
          ORDER BY created_at, id LIMIT $2
        `,
      },
    },
  },
  invoice: {
    kinds: ["invoice"],
    queries: {
      invoice: {
        stripeIdCol: "stripe_invoice_id",
        query: `
          SELECT id, stripe_invoice_id,
                 NULL::uuid as person_id, tenant_id as practice_id,
                 id as invoice_id, NULL::uuid as account_id, tenant_id
          FROM keystone.invoice
          WHERE tenant_id = $1 AND stripe_invoice_id IS NOT NULL
          ORDER BY created_at, id LIMIT $2
        `,
      },
    },
  },
};

/**
 * Backfill metadata for all mirrored objects in one tenant.
 * Idempotent: objects without stripe id are skipped, the same stripe ids receive the same values.
 *
 * @param {object} tx - tenant transaction
 * @param {object} options
 *   tenantId: the practice id
 * @returns {Promise<{summary: string}>}
 */
export async function stripeMetadataBackfill(tx, { tenantId }) {
  let totalStamped = 0;
  let totalSkipped = 0;

  // Process each metadata kind
  for (const [metadataKind, schema] of Object.entries(SCHEMAS)) {
    for (const [tableName, queryDef] of Object.entries(schema.queries)) {
      const { query, stripeIdCol } = queryDef;

      // Fetch objects in batches
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { rows } = await tx.query(query, [tenantId, BATCH_SIZE]);

        if (rows.length === 0) {
          hasMore = false;
          break;
        }

        // Process each object
        for (const row of rows) {
          if (!row[stripeIdCol]) {
            totalSkipped++;
            continue;
          }

          // Compose the metadata payload
          const metadata = metadataFor(metadataKind, row);

          // POST update to Stripe (idempotent — same values on re-run)
          const stripeId = row[stripeIdCol];
          const path = getStripePath(metadataKind, stripeId);

          await stripeConnectedRequest(tx, {
            tenantId,
            method: "POST",
            path,
            form: { metadata },
            movesMoney: false,
            purpose: `metadata_backfill_${tableName}`,
          });

          totalStamped++;
        }

        // Move to next batch
        offset += BATCH_SIZE;
        hasMore = rows.length === BATCH_SIZE;
      }
    }
  }

  return {
    summary: `${totalStamped} objects stamped`,
    stamped: totalStamped,
    skipped: totalSkipped,
  };
}

/**
 * Build the Stripe API path for updating metadata on an object.
 * @param {string} kind - metadata kind (customer, product, price, subscription, invoice)
 * @param {string} stripeId - the Stripe object id
 * @returns {string} API path for POST
 */
function getStripePath(kind, stripeId) {
  const paths = {
    customer: `/v1/customers/${stripeId}`,
    product: `/v1/products/${stripeId}`,
    price: `/v1/prices/${stripeId}`,
    subscription: `/v1/subscriptions/${stripeId}`,
    invoice: `/v1/invoices/${stripeId}`,
  };
  const path = paths[kind];
  if (!path) throw new Error(`Unknown metadata kind: ${kind}`);
  return path;
}
