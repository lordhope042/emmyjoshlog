# Emmyjosh split product catalog update

## What changed

- `ej_admin_products` and `ej_admin_inventory_units` remain the Donmarketplace/supplier-side tables.
- `ej_own_products` and `ej_own_inventory_units` are now the exclusive source for manually managed products and stock.
- Own import batches and rows use `ej_own_imports` and `ej_own_import_rows`.
- The admin products endpoint combines own products with Donmarketplace supplier mappings for display, while keeping their writes separate.
- Donmarketplace sync remains on the existing supplier tables; per-product publication is handled through the product details workflow.
- Own catalogue, inventory import, stock counts and own checkout/refund allocation use the new own tables.
- The customer marketplace already combines the own-stock catalogue with the Donmarketplace quote feed on the same marketplace page; the distinct checkout paths remain separate.

## Apply

1. Back up the production database and source tree.
2. Replace the matching files in the project with the files in this patch, preserving the folder paths.
3. Ensure the previously created `ej_own_products` and `ej_own_inventory_units` tables and copied OWN records are present.
4. Run `node backend/setup.js` with the project's normal environment variables. This applies migration `007_own_catalog.sql`, creates the own import tables, attaches the own inventory foreign key, and safely copies any remaining OWN inventory/import history with `INSERT IGNORE`.
5. Restart the application and verify the admin product list, supplier sync, own product creation, own inventory import, customer marketplace and own checkout in staging before production use.

The migration is additive; it does not drop or delete Donmarketplace tables or legacy OWN records. Legacy OWN rows remain in `ej_admin_products` as a preserved source copy, but the application no longer treats them as active own catalogue records after the migration.

## Validation performed

- Node.js syntax checks passed for the modified backend and admin frontend files, and for all supplied backend/customer runtime JavaScript files.
- The SQL migration was checked for statement splitting compatibility with the project's migration runner.
- No live database connection was available in this work session, so no production SQL execution, API integration test, or checkout transaction test is claimed.


## Admin product workflow update (2026-11-17)

- The admin Products page now has two source tabs: **Don Logs** and **My SocialLogs**.
- Pricing and Inventory have been removed from the admin sidebar. Existing inventory tables, order allocations, imports, and fulfilment records are preserved.
- Don Logs show the synced API price and a per-product selling-price editor. Saving a valid price creates/updates that product's manual retail override and activates only that Don Log. An active Don Log can be deactivated from the same details panel; its saved price remains.
- Don Logs require a product-specific MANUAL price override. Platform/default pricing rules are no longer used to publish Don Logs. The saved selling price must not be below the API price.
- My SocialLogs use the selling price entered in the own-product form. Own products do not inherit Donmarketplace pricing rules.
- Customer Donmarketplace quotes use the saved product-specific selling price. Supplier checkout remains controlled independently by the provider configuration.

### Files changed for this update

- `backend/index.js`
- `backend/providers/router.js`
- `backend/commerce/service.js`
- `js/admin-tools.js`
- `css/admin-tools.css`

### Validation

JavaScript syntax checks were run for the changed backend and frontend modules. No live database, provider API, customer checkout, or browser end-to-end test was available in this work session. Apply the files to a staging copy and verify a Don Log price save/activation, deactivation, Own SocialLog create/edit, customer listing price, and checkout before production deployment.


## SocialLog wizard integration (2026-11-17)

- The **My SocialLogs → Create SocialLog** action now opens a two-step category wizard with multi-select variants for Facebook pages, TikTok country/follower listings, Instagram subtypes, VPN variants, tutorials, website services, working tools, TextPlus/NextPlus and mail platforms.
- The details step includes the supplied SocialLogForm fields: username/label, age in months, manual NGN selling price, country, followers/variants, date of birth, SMS details, image, description, attachment/verification flags and private login/security fields.
- One submit can create multiple selected listings atomically. Each listing gets its own OWN product and one available fulfilment unit.
- Public listing metadata is stored in `ej_own_products.social_metadata_json`. Private account details are encrypted into `ej_own_inventory_units.payload_ciphertext`; public product endpoints return no private credential fields.
- Own selling prices are stored directly in `ej_own_products.selling_price_minor`. Migration `008_sociallog_catalog.sql` adds these columns and migrates existing OWN manual prices from product-scoped manual rules. Don Logs continue to use their own product-specific pricing overrides.
- The customer checkout resolver now reads the direct OWN selling price while preserving a legacy rule fallback for older records.
- The reported `supplierPage()` template was refactored into smaller strings to make the source easier to parse and maintain. The supplied line 373 expression was valid in Node's parser; a stale cached script or a different local copy may have been responsible for the browser's original parse report.

### Apply and verify

1. Back up the application and database.
2. Replace `backend/index.js`, `backend/commerce/service.js`, `js/admin-tools.js`, and `css/admin-tools.css` with the files in this patch.
3. Run `node backend/setup.js` so migration `008_sociallog_catalog.sql` is applied. This is additive and preserves existing rows.
4. Restart the app and hard-refresh the admin page so the browser loads the updated `admin-tools.js`.
5. In staging, create one SocialLog in each wizard category, test multi-variant submissions, verify the displayed OWN selling price, and complete a test checkout to confirm encrypted delivery.

### Validation limits

Node syntax checks passed for all JavaScript files in the working project. The migration statement structure was reviewed, but no live MySQL execution, browser end-to-end run, or checkout test was possible in this session. The `OTHER` category intentionally requires the admin to choose a platform and one of the supported category enums; no unprovided Prisma enum values were invented.

## SocialLog wizard redesign and Format category (2026-11-17)

- Reworked the two-step SocialLog wizard with a compact category-card grid, progress indicator, clearer section hierarchy, responsive controls, and a more focused detail layout.
- Added the **Format** category. Admins choose an existing platform or `OTHER`, enter a custom format name, and select **Write-up** or **Credentials**.
- Write-up content is saved as the public product description (up to 2,000 characters).
- Credential-based format content is saved only in the encrypted OWN inventory payload as `formatCredentials`; it is not added to public metadata or product descriptions.
- Added `FORMAT` as a SocialLog metadata category and `OTHER` as a supported platform string. The platform column in this backend's MySQL migrations is `VARCHAR(32)`, so no column-type migration is required.
- Format listings do not require an account age. The existing SocialLog categories and their enum/subtype mappings remain unchanged.

### Validation

Node syntax checks passed for the modified admin and backend JavaScript. Static checks confirm the new format credential field is added to the encrypted payload allowlist and is not included in public metadata. A live MySQL insert, browser interaction test, and end-to-end customer fulfilment test were not available in this session; verify both Format types in staging before production.


## Format content visibility correction

Format write-ups and credentials are both buyer-only fulfilment data. The public product description is blank for FORMAT products; the format name/type remain listing metadata, but the actual content is excluded from public product descriptions and metadata. Write-up text (`formatWriteup`) and credential text (`formatCredentials`) are stored inside the encrypted inventory payload and should be delivered only through the authenticated completed-order delivery flow.
