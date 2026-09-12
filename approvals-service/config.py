"""Shared, non-secret config used by both routers."""

import os

# Unity Catalog catalog/schema names — the same in both the dev and prod
# Databricks workspaces (each workspace has its own "dev.retail" catalog;
# this isn't related to the dev/prod *application* environment switch).
CATALOG = os.environ.get("CATALOG", "dev")
SCHEMA = os.environ.get("SCHEMA", "retail")

APPROVAL_TABLE = f"{CATALOG}.{SCHEMA}.dim_approval"
VOUCHER_TABLE = f"{CATALOG}.{SCHEMA}.dim_voucher_issued"
