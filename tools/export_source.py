#!/usr/bin/env python3
"""Package portable application source only; never export private inventory or secrets."""
import hashlib
import os
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT.parent / 'deliverables' / 'Emmyjosh_Admin_Tools_Source.zip'
SKIP_DIRS = {'.git', 'node_modules', 'dist', '__pycache__', '.cache', '.keys', 'private', 'uploads', 'logs', '.addon-screenshots'}
SKIP_SUFFIXES = {'.zip', '.db', '.sqlite', '.sqlite3', '.log', '.pem', '.key', '.p12', '.pfx'}
SECRET_NAMES = ['DATABASE_URL', 'DONMARKETPLACE_API_KEY', 'DONMARKETPLACE_SANDBOX_API_KEY', 'INVENTORY_ENCRYPTION_KEY_V1', 'ADMIN_BOOTSTRAP_PASSWORD', 'JWT_SECRET', 'POCKETFI_API_TOKEN', 'POCKETFI_SECRET_KEY', 'PROVIDER1_5SIM_API_TOKEN', 'PROVIDER2_SMSBOWER_API_KEY', 'MANUS_API_KEY', 'MANUS_JWT_SECRET']
secret_values = [os.environ[name].encode() for name in SECRET_NAMES if len(os.environ.get(name, '')) >= 8]
paths = []
for directory, subdirs, filenames in os.walk(ROOT):
    subdirs[:] = [name for name in subdirs if name not in SKIP_DIRS and not (Path(directory) / name).is_symlink()]
    for name in sorted(filenames):
        path = Path(directory) / name
        if path.is_symlink() or path == OUT:
            continue
        if name.startswith('.env') and name != '.env.example':
            continue
        if path.suffix.lower() in SKIP_SUFFIXES:
            continue
        relative = path.relative_to(ROOT).as_posix()
        if name.endswith('-debug.txt') or name in {'inspect-db.js', 'database-diff.sql'}:
            continue
        if path.suffix.lower() == '.sql' and not relative.startswith(('backend/migrations/', 'legacy-api/prisma/migrations/')) and relative != 'docs/sql/Complete_Checkout_Database.sql':
            continue
        content = path.read_bytes()
        if any(value in content for value in secret_values):
            raise SystemExit('Refusing source archive: configured secret found in ' + path.relative_to(ROOT).as_posix())
        paths.append(path)
OUT.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(paths):
        archive.write(path, 'emmyjosh/' + path.relative_to(ROOT).as_posix())
with zipfile.ZipFile(OUT) as archive:
    bad = archive.testzip()
    if bad:
        raise SystemExit('ZIP integrity failure')
    required = ['README.md', 'SETUP.md', '.env.example', 'server.js', 'index.html', 'package-lock.json', 'pnpm-lock.yaml', 'backend/index.js', 'backend/commerce/service.js', 'backend/migrations/001_admin_tools.sql', 'backend/migrations/002_customer_tables.sql', 'backend/migrations/003_commerce.sql', 'backend/migrations/004_pocketfi.sql', 'docs/sql/Complete_Checkout_Database.sql', 'js/api.js', 'js/admin-tools.js', 'legacy-api/src/services/pocketfi.js', 'legacy-api/prisma/schema.prisma', 'tests/commerce-sql.integration.test.js', 'assets/emmyjosh-logo-original-crop.png']
    for name in required:
        if 'emmyjosh/' + name not in archive.namelist():
            raise SystemExit('ZIP is incomplete: missing ' + name)
print(str(OUT))
print('Source archive verified: ' + str(len(paths)) + ' files; secrets/private stock/database data excluded.')
print('SHA-256: ' + hashlib.sha256(OUT.read_bytes()).hexdigest())
